// Données de l'appli : enregistrement dans le navigateur (IndexedDB), index, modifications, fusion.

export const COLLECTIONS = ['accounts', 'categories', 'entries', 'orders'];
export const DEFAULT_MODES = ['Carte', 'Chèque', 'Espèces', 'Prélèvement', 'Virement'];

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export function newId(len = 10) {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(len))) s += ALPHABET[b % 36];
  return s;
}

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyData() {
  return {
    format: 'comptes', version: 1, dsid: newId(), created: new Date().toISOString(),
    accounts: [], categories: [], entries: [], orders: [], modes: [...DEFAULT_MODES],
  };
}

// ---------- IndexedDB (clé/valeur) ----------
let dbPromise;
function idb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('comptes', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function kvGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- État ----------
export let data = null;
// seq : compteur des modifications locales ; sent : dernier seq envoyé sur le Drive ;
// replace : un import a remplacé les données, le Drive doit être écrasé.
export let syncState = { seq: 0, sent: 0 };
export const idx = { acc: new Map(), cat: new Map(), entry: new Map(), byAcc: new Map() };

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit(kind) { for (const fn of listeners) fn(kind); }

export async function load() {
  data = (await kvGet('data')) ?? null;
  syncState = (await kvGet('sync')) ?? { seq: 0, sent: 0 };
  reindex();
}
export const saveSyncState = () => kvSet('sync', syncState);
export const isDirty = () => syncState.seq !== syncState.sent || !!syncState.replace;

function reindex() {
  idx.acc = new Map(); idx.cat = new Map(); idx.entry = new Map(); idx.byAcc = new Map();
  if (!data) return;
  for (const a of data.accounts) if (!a.del) idx.acc.set(a.id, a);
  for (const c of data.categories) if (!c.del) idx.cat.set(c.id, c);
  for (const e of data.entries) {
    if (e.del) continue;
    idx.entry.set(e.id, e);
    let list = idx.byAcc.get(e.acc);
    if (!list) idx.byAcc.set(e.acc, (list = []));
    list.push(e);
  }
  // Tri stable par date : à date égale, l'ordre de saisie est conservé.
  for (const list of idx.byAcc.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Soldes en centimes : now = jusqu'à aujourd'hui, chk = opérations pointées, all = avec les opérations à venir.
export function balances(accId, today = todayStr()) {
  let now = 0, chk = 0, all = 0;
  for (const e of idx.byAcc.get(accId) ?? []) {
    all += e.amt;
    if (e.date <= today) now += e.amt;
    if (e.chk) chk += e.amt;
  }
  return { now, chk, all };
}

// ---------- Modifications ----------
async function commit(kind) {
  reindex();
  if (kind === 'local') syncState.seq++;
  await kvSet('data', data);
  await saveSyncState();
  emit(kind);
}

export async function upsert(coll, rec) {
  data ??= emptyData();
  rec.mod = new Date().toISOString();
  const arr = data[coll];
  const i = arr.findIndex(r => r.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  await commit('local');
}

// Suppression = pierre tombale, pour que la fusion entre appareils la propage.
export async function remove(coll, id) {
  const arr = data[coll];
  const i = arr.findIndex(r => r.id === id);
  if (i < 0) return;
  arr[i] = { id, del: true, mod: new Date().toISOString() };
  await commit('local');
}

// Import : remplace tout, y compris le fichier du Drive à la prochaine synchro.
export async function replaceAll(newData) {
  data = newData;
  syncState.replace = true;
  syncState.seq++;
  await commit('replace');
}

// Données reçues du Drive : fusion si même jeu de données, sinon elles remplacent les locales.
export async function applyRemote(remote) {
  const same = !!data && remote.dsid === data.dsid;
  data = same ? merge(data, remote) : remote;
  await commit('remote');
  return same;
}

// Pour chaque enregistrement, la version modifiée le plus récemment gagne.
export function merge(local, remote) {
  const out = { ...remote };
  for (const c of COLLECTIONS) {
    const byId = new Map();
    for (const r of remote[c] ?? []) byId.set(r.id, r);
    for (const r of local[c] ?? []) {
      const o = byId.get(r.id);
      if (!o || (r.mod ?? '') > (o.mod ?? '')) byId.set(r.id, r);
    }
    out[c] = [...byId.values()];
  }
  out.modes = [...new Set([...(remote.modes ?? []), ...(local.modes ?? [])])];
  return out;
}
