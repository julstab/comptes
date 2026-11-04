// Synchronisation avec un fichier du Google Drive.
// Portée drive.file : l'appli ne voit que les fichiers qu'elle a créés, pas le reste du Drive.
import { GOOGLE_CLIENT_ID } from './config.js';
import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'comptes-donnees.json.gz';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_KEY = 'comptes.gtoken';

export const configured = () => !!GOOGLE_CLIENT_ID;

// États : local (non configuré), login, syncing, ok, offline, error.
export const status = { state: 'local', message: '' };
const statusListeners = new Set();
export function onStatus(fn) { statusListeners.add(fn); }
function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
  for (const fn of statusListeners) fn(status);
}

// ---------- Connexion Google (jeton d'accès d'une heure) ----------
let token = null;
const hasToken = () => !!token && token.exp > Date.now();
function restoreToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    if (t && t.exp > Date.now()) token = t;
  } catch { /* jeton illisible : ignoré */ }
}
function forgetToken() {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
}

let gisPromise = null;
function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('Connexion Google indisponible (hors ligne ?)')); };
    document.head.append(s);
  });
  return gisPromise;
}

// À appeler depuis un clic : ouvre la fenêtre de connexion Google.
export async function signIn() {
  await loadGis();
  await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) - 60) * 1000 };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve();
      },
      error_callback: err => reject(new Error(err?.type === 'popup_closed' ? 'Connexion annulée' : 'Connexion Google impossible')),
    });
    client.requestAccessToken();
  });
  return sync();
}

export function signOut() {
  forgetToken();
  setStatus('login');
}

// ---------- API Drive ----------
const loginError = msg => Object.assign(new Error(msg), { login: true });

async function api(url, options = {}) {
  if (!hasToken()) throw loginError('Connexion Google requise');
  const res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token.value}` } });
  if (res.status === 401) { forgetToken(); throw loginError('Connexion Google expirée'); }
  return res;
}
async function apiJson(url, options) {
  const res = await api(url, options);
  if (!res.ok) throw new Error(`Google Drive : erreur ${res.status}`);
  return res.json();
}

async function getMeta(id) {
  const res = await api(`${API}/${id}?fields=id,version,trashed`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Google Drive : erreur ${res.status}`);
  const meta = await res.json();
  return meta.trashed ? null : meta;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await apiJson(`${API}?q=${q}&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id,version)`);
  return r.files?.[0] ?? null;
}

async function download(id) {
  const res = await api(`${API}/${id}?alt=media`);
  if (!res.ok) throw new Error(`Google Drive : erreur ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gz
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

async function upload(id, json) {
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  if (id) {
    return apiJson(`${UPLOAD}/${id}?uploadType=media&fields=id,version`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/gzip' }, body: gz,
    });
  }
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: FILE_NAME, mimeType: 'application/gzip' })], { type: 'application/json' }));
  form.append('file', new Blob([gz], { type: 'application/gzip' }));
  return apiJson(`${UPLOAD}?uploadType=multipart&fields=id,version`, { method: 'POST', body: form });
}

// ---------- Synchronisation ----------
let running = null, again = false, timer = null;

export function scheduleSync(delay = 2000) {
  clearTimeout(timer);
  timer = setTimeout(sync, delay);
}

export function sync() {
  if (running) { again = true; return running; }
  running = doSync().finally(() => {
    running = null;
    if (again) { again = false; sync(); }
  });
  return running;
}

async function doSync() {
  if (!configured()) return setStatus('local');
  if (!navigator.onLine) return setStatus('offline');
  if (!hasToken()) return setStatus('login');
  setStatus('syncing');
  const s = store.syncState;
  try {
    let meta = s.fileId ? await getMeta(s.fileId) : null;
    if (!meta) { meta = await findFile(); s.version = null; }

    // 1. Le fichier a changé depuis notre dernier passage (autre appareil) : on le récupère et on fusionne.
    if (meta && !s.replace && String(meta.version) !== String(s.version)) {
      await store.applyRemote(await download(meta.id));
      s.version = meta.version;
    }
    // 2. Des modifications locales ne sont pas encore sur le Drive : on envoie le tout.
    if (store.data && (!meta || store.isDirty())) {
      const seq = s.seq;
      const res = await upload(meta?.id, JSON.stringify(store.data));
      meta = res;
      s.version = res.version;
      s.sent = seq;
      s.replace = false;
    }
    if (meta) s.fileId = meta.id;
    s.lastSync = new Date().toISOString();
    await store.saveSyncState();
    setStatus('ok');
  } catch (err) {
    setStatus(err.login ? 'login' : 'error', err.message);
  }
}

export function init() {
  if (!configured()) return setStatus('local');
  restoreToken();
  if (navigator.onLine) loadGis().catch(() => {});
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  sync();
}
