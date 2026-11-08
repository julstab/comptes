// Interface : liste des comptes, opérations d'un compte, saisie, réglages.
import * as store from './store.js';
import * as drive from './drive.js';
import { convertBackup, parseBackupText } from './import.js';
import * as recur from './recur.js';
import * as stats from './stats.js';
import * as ticket from './ticket.js';
import { bankLogo } from './banks.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const PAGE = 100;

// ---------- Formatage ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = c => euro.format(c / 100);
const signed = c => (c > 0 ? '+' : '') + money(c);
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const monthLabel = d => monthFmt.format(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, 1));
const dayMonth = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dateTime = iso => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const amountInput = c => (Math.abs(c) / 100).toFixed(2).replace('.', ',');
const negClass = c => (c < 0 ? 'neg' : '');
const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

function parseAmount(str) {
  const n = Number(String(str).replace(/[\s  €]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : NaN;
}

function catLabel(id) {
  const c = id && store.idx.cat.get(id);
  if (!c) return '';
  const p = c.parent && store.idx.cat.get(c.parent);
  return p ? `${p.name} › ${c.name}` : c.name;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function setHeader(title, back) {
  $('#title').textContent = title;
  $('#back').hidden = !back;
  document.title = back ? `${title} · Comptes` : 'Comptes';
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
// Icônes au trait des boutons (24 × 24).
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  mic: icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  camera: icon('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  send: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  sparkle: icon('<path d="M11 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  pencil: icon('<path d="M15.5 5.5l3 3L8 19H5v-3z"/><path d="M13.5 7.5l3 3"/>'),
  repeat: icon('<path d="M17 3l3 3-3 3"/><path d="M4 12v-1a5 5 0 0 1 5-5h11"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v1a5 5 0 0 1-5 5H4"/>'),
  chart: icon('<path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-6"/>'),
  scan: icon('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  open: icon('<circle cx="12" cy="12" r="7.5" stroke-dasharray="3.2 2.6"/>'),
  home: icon('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  image: icon('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9.5" cy="10" r="1.5"/><path d="M20 15.5l-4.5-4.5L7 19"/>'),
  select: icon('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  trash: icon('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9l1-12.5"/>'),
  close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevron: icon('<path d="M6 9l6 6 6-6"/>'),
  gear: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};
const LAST_ACC = 'comptes.lastAcc'; // compte de la dernière saisie, proposé pour les saisies rapides
let pendingPhoto = null; // photo reçue par « Partager », lue dès l'ouverture du formulaire
let autoPhoto = false;   // 📷 d'un compte (true) : ouvre l'appareil photo dès l'ouverture du formulaire ; 🖼️ d'un compte ('pick') : le choix d'une image
let pendingSentence = null; // phrase saisie sur la page d'un compte, lue dès l'ouverture du formulaire
let pendingStatement = null; // captures de l'appli de la banque choisies pour le pointage : { acc, files }
let opSel = null; // sélection de plusieurs opérations d'un compte : { acc, ids (Set), shown (identifiants affichés) }, oubliée en changeant d'écran

// ---------- Navigation ----------
let navDepth = 0;
let currentHash = location.hash || '#/';
const scrollMem = new Map();

const routes = [
  [/^#\/?$/, () => viewAccounts()],
  [/^#\/compte\/(\w+)$/, id => viewAccount(id)],
  [/^#\/compte\/(\w+)\/modifier$/, id => viewAccountForm(id)],
  [/^#\/nouveau-compte$/, () => viewAccountForm(null)],
  [/^#\/operation\/(\w+)$/, id => viewEntryForm(id, null)],
  [/^#\/nouvelle-operation\/(\w+)$/, acc => viewEntryForm(null, acc)],
  [/^#\/photo$/, () => viewSharedPhoto()],
  [/^#\/pointage\/(\w+)$/, acc => viewStatement(acc)],
  [/^#\/recurrentes$/, () => viewOrders()],
  [/^#\/recurrente\/(\w+)$/, id => viewOrderForm(id)],
  [/^#\/nouvelle-recurrente$/, () => viewOrderForm(null)],
  [/^#\/statistiques$/, () => viewStats(null)],
  [/^#\/statistiques\/categorie\/(\w+)$/, id => viewStats(id)],
  [/^#\/reglages$/, () => viewSettings()],
  [/^#\/recherche$/, () => viewSearch()],
];

function render() {
  const hash = location.hash || '#/';
  const route = routes.find(([re]) => re.test(hash));
  if (!route) return location.replace('#/');
  document.body.classList.remove('picking', 'selecting'); // choix de catégorie, sélection d'opérations : laissés en quittant l'écran
  // Sur PC, l'accueil, la page d'un compte et les statistiques prennent toute la largeur ; le reste garde une colonne.
  view.classList.toggle('wide', /^#\/?$|^#\/compte\/\w+$|^#\/statistiques/.test(hash));
  route[1](...hash.match(route[0]).slice(1));
  $('#search-btn').hidden = !/^#\/?$/.test(hash) || !store.idx.acc.size; // loupe de l'accueil
  renderTabbar(hash);
  renderSide();
  scrollTo(0, scrollMem.get(hash) ?? 0);
}

function goBack(fallback = '#/') {
  if (navDepth > 0) history.back();
  else location.replace(fallback);
}

window.addEventListener('hashchange', () => {
  scrollMem.set(currentHash, scrollY);
  currentHash = location.hash || '#/';
  navDepth++;
  opSel = null;
  render();
});
$('#back').addEventListener('click', () => goBack());

// Re-dessine l'écran courant (après une synchro) s'il ne contient pas de formulaire en cours.
function refreshListView() {
  if (currentHash === '#/reglages') return renderDataCard();
  if (listening || $('#say')?.value) return; // phrase en cours de saisie ou de dictée sur la page d'un compte
  if (document.activeElement?.id === 'q') return; // recherche ou filtre en cours de frappe
  if (/^#\/?$|^#\/compte\/\w+$|^#\/recurrentes$|^#\/statistiques/.test(currentHash)) {
    scrollMem.set(currentHash, scrollY);
    render();
  }
}

// ---------- Écran : liste des comptes ----------

// Compte proposé par défaut pour une nouvelle saisie : celui de la dernière saisie, sinon le premier compte ouvert.
function defaultAccId() {
  const accs = [...store.idx.acc.values()].filter(a => !a.closed).sort((a, b) => a.pos - b.pos);
  let acc = null;
  try { acc = localStorage.getItem(LAST_ACC); } catch { /* stockage indisponible */ }
  return accs.some(a => a.id === acc) ? acc : accs[0]?.id;
}

// Type de compte : choisi dans le formulaire du compte, sinon deviné d'après son nom.
const SAVINGS = /livret|epargne|assurance.?vie|\bpea\b|\bldds?\b|\blep\b|\bpel\b|\bcel\b|\bper\b|compte a terme/;
const accKind = a => a.kind ?? (SAVINGS.test(norm(a.name)) ? 'epargne' : 'courant');

// Solde prévu à la fin du mois : solde du jour + opérations déjà saisies pour la suite du mois
// + échéances des récurrentes pas encore créées. warn : sous le seuil d'alerte du compte (0 par défaut).
function monthEnd(a, today = store.todayStr()) {
  const until = recur.endOfMonth(today);
  const items = (store.idx.byAcc.get(a.id) ?? [])
    .filter(e => e.date > today && e.date <= until)
    .map(e => ({ date: e.date, title: e.title, amt: e.amt }))
    .concat(recur.upcoming(a.id, until))
    .sort((x, y) => x.date.localeCompare(y.date));
  const total = store.balances(a.id, today).now + items.reduce((s, i) => s + i.amt, 0);
  return { total, items, warn: total < (a.alert ?? 0) };
}

// Comptes ouverts en deux groupes, avec leur solde pointé (chk). Les comptes marqués « toujours en haut » (top) d'abord ;
// puis les courants dans l'ordre des comptes, l'épargne Banque Populaire d'abord, puis du plus gros solde pointé au plus petit.
function accountGroups(today) {
  const accs = [...store.idx.acc.values()].sort((a, b) => a.pos - b.pos);
  const open = accs.filter(a => !a.closed);
  const chk = new Map(open.map(a => [a.id, store.balances(a.id, today).chk]));
  const isBP = a => /banque populaire|\bbp\b/.test(norm(`${a.bank ?? ''} ${a.name}`));
  const top = (x, y) => !!y.top - !!x.top;
  return {
    open, closed: accs.filter(a => a.closed), chk,
    current: open.filter(a => accKind(a) === 'courant').sort(top),
    savings: open.filter(a => accKind(a) === 'epargne').sort((x, y) => top(x, y) || (isBP(y) - isBP(x)) || (chk.get(y.id) - chk.get(x.id))),
  };
}

// ---------- Barre de navigation du bas (téléphone) : sur les écrans principaux, pas dans les formulaires ----------
const TABBAR_PAGES = /^#\/?$|^#\/compte\/\w+$|^#\/statistiques|^#\/recurrentes$|^#\/reglages$|^#\/recherche$/;

function renderTabbar(hash) {
  const bar = $('#tabbar');
  const show = TABBAR_PAGES.test(hash) && store.idx.acc.size > 0;
  bar.hidden = !show;
  document.body.classList.toggle('has-tabbar', show);
  if (!show) return;
  // Le ＋ : une récurrente sur leur page, sinon une opération (dans le compte ouvert, ou celui de la dernière saisie).
  const accId = hash.match(/^#\/compte\/(\w+)$/)?.[1];
  const plus = hash === '#/recurrentes'
    ? ['#/nouvelle-recurrente', 'Nouvelle opération récurrente']
    : [`#/nouvelle-operation/${store.idx.acc.has(accId) ? accId : defaultAccId()}`, 'Nouvelle opération'];
  const link = (href, ico, label, re) => `<a href="${href}"${re.test(hash) ? ' class="on" aria-current="page"' : ''}>${ico}${label}</a>`;
  bar.innerHTML = `
    ${link('#/', ICONS.home, 'Accueil', /^#\/?$/)}
    ${link('#/statistiques', ICONS.chart, 'Stats', /^#\/statistiques/)}
    <a class="tab-plus" href="${plus[0]}" aria-label="${plus[1]}" title="${plus[1]}"><i>${ICON_PLUS}</i></a>
    ${link('#/recurrentes', ICONS.repeat, 'Récurrentes', /^#\/recurrentes/)}
    ${link('#/reglages', ICONS.gear, 'Réglages', /^#\/reglages/)}`;
}

// ---------- Barre latérale (PC) : nouvelle opération, menu, comptes avec leur solde pointé ----------
const wideScreen = matchMedia('(min-width: 1000px)');
wideScreen.addEventListener('change', () => renderSide());

function renderSide() {
  const side = $('#side');
  if (!wideScreen.matches || !store.idx.acc.size) { side.innerHTML = ''; return; }
  const { current, savings, chk } = accountGroups(store.todayStr());
  const hash = location.hash || '#/';
  const accId = hash.match(/^#\/(?:compte|nouvelle-operation|pointage)\/(\w+)/)?.[1];
  const here = ' class="on" aria-current="page"';
  const nav = (href, ico, label, re) => `<a href="${href}"${re.test(hash) ? here : ''}>${ico}${label}</a>`;
  const row = a => `<a class="side-acc${a.id === accId ? ' on' : ''}" href="#/compte/${a.id}"${a.id === accId ? ' aria-current="page"' : ''}>
    ${bankLogo(a, 28)}<span class="side-name">${esc(a.name)}</span><span class="amt ${negClass(chk.get(a.id))}">${money(chk.get(a.id))}</span></a>`;
  const group = (title, list) => (list.length ? `<h2 class="side-h"><span>${title}</span>
    <span class="amt">${money(list.reduce((s, a) => s + chk.get(a.id), 0))}</span></h2>${list.map(row).join('')}` : '');
  side.innerHTML = `
    <a class="side-brand" href="#/">💰 Comptes</a>
    <a class="btn primary" href="#/nouvelle-operation/${store.idx.acc.has(accId) ? accId : defaultAccId()}">${ICON_PLUS}Nouvelle opération</a>
    <nav class="side-nav" aria-label="Menu">
      ${nav('#/', ICONS.home, 'Accueil', /^#\/?$/)}
      ${nav('#/recurrentes', ICONS.repeat, 'Récurrentes', /^#\/(nouvelle-)?recurrente/)}
      ${nav('#/statistiques', ICONS.chart, 'Statistiques', /^#\/statistiques/)}
      ${nav('#/reglages', ICONS.gear, 'Réglages', /^#\/reglages/)}
    </nav>
    ${group('Comptes courants', current)}
    ${group('Épargne', savings)}`;
}

// Onglet de l'accueil (courant, epargne, tous), retenu sur cet appareil.
const HOME_TAB = 'comptes.homeTab';
let homeTab = (() => { try { return localStorage.getItem(HOME_TAB) || 'courant'; } catch { return 'courant'; } })();

function viewAccounts() {
  setHeader('Comptes', false);
  if (!store.idx.acc.size) {
    view.innerHTML = `
      <section class="empty-state">
        <div class="big-emoji" aria-hidden="true">👋</div>
        <h2>Aucun compte pour l'instant</h2>
        <p class="muted">Importez votre sauvegarde MaxiComptes pour retrouver vos comptes et vos opérations.</p>
        ${drive.configured() && drive.status.state === 'login'
          ? '<button class="btn primary" data-action="drive-login">Récupérer mes données depuis Google Drive</button>' : ''}
        <a class="btn ${drive.configured() ? 'ghost' : 'primary'}" href="#/reglages">Importer une sauvegarde</a>
        <a class="btn ghost" href="#/nouveau-compte">Créer un compte vide</a>
      </section>`;
    return;
  }
  const today = store.todayStr();
  const { open, closed, current, savings, chk } = accountGroups(today);
  const ends = new Map(current.map(a => [a.id, monthEnd(a, today)]));
  // Sur l'accueil, chaque compte affiche son solde pointé : celui de la banque.
  const row = a => {
    const c = chk.get(a.id) ?? store.balances(a.id, today).chk; // les comptes clôturés ne sont pas dans chk
    return `<a class="acc" href="#/compte/${a.id}">
      ${bankLogo(a, 34)}
      <span class="acc-main"><span class="acc-name">${esc(a.name)}</span><span class="acc-bank">${esc(a.bank)}</span></span>
      <span class="acc-bal"><span class="amt ${c > 0 ? 'pos' : negClass(c)}">${money(c)}</span></span>
    </a>`;
  };
  const totalOf = list => list.reduce((s, a) => s + chk.get(a.id), 0);
  const tCurrent = totalOf(current), tSavings = totalOf(savings);
  const tEnd = [...ends.values()].reduce((s, m) => s + m.total, 0);
  const warned = [...ends.values()].filter(m => m.warn).length;
  const endHtml = `fin du mois <span class="amt ${warned ? 'warn' : negClass(tEnd)}"${warned ? ` title="${plural(warned, 'compte à surveiller', 'comptes à surveiller')}"` : ''}>${warned ? '⚠️ ' : ''}${money(tEnd)}</span>`;
  // Le mois en cours en un coup d'œil, en montants nets comme dans les statistiques.
  const month = stats.inOut(stats.pick(open.map(a => a.id), `${today.slice(0, 8)}01`, today));
  // Total en haut selon l'onglet : comptes courants (et leur fin de mois), épargne, ou tout.
  const tab = ['courant', 'epargne', 'tous'].includes(homeTab) ? homeTab : 'courant';
  const head = {
    courant: [tCurrent, `Comptes courants · ${endHtml}`],
    epargne: [tSavings, `Épargne · ${plural(savings.length, 'compte', 'comptes')}`],
    tous: [tCurrent + tSavings, `Tous les comptes · ${endHtml}`],
  }[tab];
  const flat = list => (list.length ? `<div class="flat">${list.map(row).join('')}</div>` : '<p class="empty">Aucun compte.</p>');
  const group = (title, list, total) => (list.length
    ? `<div><h2 class="section-title">${title} <small>${money(total)}</small></h2>${flat(list)}</div>` : '');
  const tabBtn = (id, label) => `<button type="button" data-action="home-tab" data-tab="${id}" class="${tab === id ? 'on' : ''}" aria-pressed="${tab === id}">${label}</button>`;
  view.innerHTML = `<div class="home ${tab === 'tous' ? 'home-all' : ''}">
    <section class="home-head">
      <div class="home-total amt ${negClass(head[0])}">${money(head[0])}</div>
      <div class="home-sub">${head[1]}</div>
      <div class="home-month">Ce mois-ci : <b>${money(month.out)}</b> dépensés · <b>${money(month.in)}</b> reçus</div>
    </section>
    <div class="seg-tabs" role="group" aria-label="Comptes affichés">${tabBtn('tous', 'Tous')}${tabBtn('courant', 'Courants')}${tabBtn('epargne', 'Épargne')}</div>
    ${tab === 'tous'
      ? `<div class="home-cols">${group('Comptes courants', current, tCurrent)}${group('Épargne', savings, tSavings)}</div>`
      : flat(tab === 'courant' ? current : savings)}
    ${closed.length ? `<details class="closed"><summary>Comptes clôturés (${closed.length})</summary>${flat(closed)}</details>` : ''}
    <a class="btn ghost block" href="#/nouveau-compte">＋ Nouveau compte</a></div>`;
}

// ---------- Écran : opérations d'un compte ----------
const acctUi = {};
let currentAccId = null;

function viewAccount(id) {
  const a = store.idx.acc.get(id);
  if (!a) return location.replace('#/');
  currentAccId = id;
  setHeader(a.name, true);
  const ui = (acctUi[id] ??= { q: '', unchk: false, limit: PAGE });
  // Sur grand écran : solde et barre IA à gauche, opérations à droite.
  view.innerHTML = `
    <div class="acct-cols">
      <div>
        <section class="summary" id="summary"></section>
        ${aiBar()}
      </div>
      <div>
        <div class="toolbar">
          <input type="search" id="q" placeholder="Rechercher : libellé, catégorie, montant…" value="${esc(ui.q)}" aria-label="Rechercher">
          <button type="button" class="chip ${ui.unchk ? 'on' : ''}" data-action="toggle-unchk" aria-pressed="${ui.unchk}">${ICONS.open}Non pointées</button>
          <button type="button" class="chip" data-action="statement">${ICONS.scan}Pointer avec une capture</button>
          <button type="button" class="chip ${opSel?.acc === id ? 'on' : ''}" data-action="select" aria-pressed="${opSel?.acc === id}">${ICONS.select}Sélectionner</button>
        </div>
        <input type="file" id="stmt" accept="image/*" multiple hidden>
        <div id="ops"></div>
      </div>
    </div>
    <a class="fab new-op" href="#/nouvelle-operation/${id}" aria-label="Nouvelle opération">${ICON_PLUS}</a>`;
  renderSummary(id);
  renderOps(id);
  // Saisie par IA : le formulaire de ce compte s'ouvre et lit la phrase, ou l'appareil photo s'ouvre.
  const toForm = () => { location.hash = `#/nouvelle-operation/${id}`; };
  wireAiBar(text => { if (keyOrSettings()) { pendingSentence = text; toForm(); } });
  $('#photo-btn').addEventListener('click', () => { if (keyOrSettings()) { autoPhoto = true; toForm(); } });
  $('#pick-btn').addEventListener('click', () => { if (keyOrSettings()) { autoPhoto = 'pick'; toForm(); } });
  $('#stmt').addEventListener('change', ev => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (!files.length) return;
    pendingStatement = { acc: id, files };
    location.hash = `#/pointage/${id}`;
  });
  let t;
  $('#q').addEventListener('input', ev => {
    clearTimeout(t);
    t = setTimeout(() => { ui.q = ev.target.value; ui.limit = PAGE; renderOps(id); }, 150);
  });
}

function renderSummary(id) {
  const b = store.balances(id);
  const a = store.idx.acc.get(id);
  const later = `<div><span class="label">Après les opé. à venir</span><span class="amt ${negClass(b.all)}">${money(b.all)}</span></div>`;
  $('#summary').innerHTML = `
    <div class="summary-head">${bankLogo(a, 44)}
      <div><span class="label">Solde pointé</span><span class="amt big ${negClass(b.chk)}">${money(b.chk)}</span></div>
      <a class="icon-btn" href="#/compte/${id}/modifier" aria-label="Modifier le compte" title="Modifier le compte">${ICONS.pencil}</a></div>
    ${accKind(a) === 'courant' ? monthEndHtml(a, monthEnd(a), later) : `<div class="row2">${later}</div>`}`;
}

// Solde avec les opérations à venir (later) et solde prévu à la fin du mois côte à côte,
// avec le détail de ce qui reste à passer ce mois-ci.
function monthEndHtml(a, m, later) {
  const cols = `<div class="row2">${later}
    <div><span class="label">Fin du mois prévue</span>
    <span class="amt ${m.warn ? 'warn' : negClass(m.total)}">${m.warn ? '⚠️ ' : ''}${money(m.total)}</span></div></div>`;
  const why = !m.warn ? '' : a.alert ? `Sous le seuil d'alerte de ${money(a.alert)} · ` : 'Solde prévu négatif · ';
  if (!m.items.length) return `<div class="month-end">${cols}<span class="sub">${why}Rien d'autre de prévu ce mois-ci.</span></div>`;
  return `<details class="month-end"><summary>${cols}
      <span class="sub">${why}${plural(m.items.length, 'opération à venir', 'opérations à venir')} ›</span></summary>
    <ul>${m.items.map(i => `<li><span>${dayMonth(i.date)} · ${esc(i.title || '(sans libellé)')}</span>
      <span class="amt ${i.amt > 0 ? 'pos' : ''}">${signed(i.amt)}</span></li>`).join('')}</ul>
  </details>`;
}

function matches(e, q) {
  if (norm(e.title).includes(q)) return true;
  if (e.cat && norm(catLabel(e.cat)).includes(q)) return true;
  if (e.mode && norm(e.mode).includes(q)) return true;
  if (e.ref && norm(e.ref).includes(q)) return true;
  if (/^[\d\s,.]+$/.test(q)) {
    const n = q.replace(/\s/g, '').replace('.', ',');
    if (amountInput(e.amt).startsWith(n)) return true;
  }
  return false;
}

function renderOps(id) {
  const ui = acctUi[id];
  const list = store.idx.byAcc.get(id) ?? [];
  const running = new Map();
  let sum = 0;
  for (const e of list) { sum += e.amt; running.set(e.id, sum); }

  const q = norm(ui.q.trim());
  let rows = list;
  if (ui.unchk) rows = rows.filter(e => !e.chk);
  if (q) rows = rows.filter(e => matches(e, q));
  rows = rows.slice().reverse();
  const today = store.todayStr();
  // Mode sélection : toucher une ligne la coche au lieu de l'ouvrir, le pointage est masqué.
  const sel = opSel?.acc === id ? opSel.ids : null;
  // Mois repliés : seul leur en-tête reste, avec le nombre d'opérations et leur total.
  const folded = (ui.folded ??= new Set());
  const months = new Map();
  for (const e of rows) {
    const s = months.get(e.date.slice(0, 7)) ?? { n: 0, total: 0 };
    s.n++; s.total += e.amt;
    months.set(e.date.slice(0, 7), s);
  }
  const visible = []; // lignes affichées : les mois repliés ne comptent pas dans la page de ui.limit lignes
  let rest = 0;

  let html = '';
  let month = '';
  for (const e of rows) {
    const m = e.date.slice(0, 7);
    if (visible.length >= ui.limit) { if (!folded.has(m)) rest++; continue; }
    if (m !== month) {
      month = m;
      const f = folded.has(m), s = months.get(m);
      html += `<button type="button" class="month" data-action="fold" data-m="${m}" aria-expanded="${!f}">
        <span>${monthLabel(e.date)}</span>
        <span class="month-sum">${f ? `${plural(s.n, 'opération', 'opérations')} · ${signed(s.total)}` : ''}${ICONS.chevron}</span></button>`;
    }
    if (folded.has(m)) continue;
    visible.push(e.id);
    const meta = [dayMonth(e.date), catLabel(e.cat), e.mode].filter(Boolean).map(esc).join(' · ');
    const main = `<span class="op-title">${esc(e.title || '(sans libellé)')}</span>
        <span class="op-meta">${e.date > today ? '<span class="tag">À venir</span> · ' : ''}${meta}</span>`;
    const amt = `<span class="op-amt"><span class="amt ${e.amt > 0 ? 'pos' : ''}">${signed(e.amt)}</span><span class="sub">${money(running.get(e.id))}</span></span>`;
    html += sel
      ? `<div class="op selectable ${e.date > today ? 'future' : ''} ${sel.has(e.id) ? 'picked' : ''}" data-id="${e.id}" data-action="sel"
          role="checkbox" aria-checked="${sel.has(e.id)}" tabindex="0">
      <span class="selbox" aria-hidden="true"></span>
      <span class="op-main">${main}</span>
      ${amt}
    </div>`
      : `<div class="op ${e.date > today ? 'future' : ''}" data-id="${e.id}">
      <button type="button" class="chk ${e.chk ? 'on' : ''}" data-action="chk" aria-pressed="${!!e.chk}" aria-label="${e.chk ? 'Dépointer' : 'Pointer'}"></button>
      <a class="op-main" href="#/operation/${e.id}">${main}</a>
      ${amt}
    </div>`;
  }
  $('#ops').innerHTML = (rows.length
    ? `<div class="list">${html}</div>${rest
      ? `<button type="button" class="btn ghost block" data-action="more">Afficher plus (${plural(rest, 'restante', 'restantes')})</button>` : ''}`
    : `<p class="empty">${ui.unchk && !q ? '🎉 Tout est pointé !' : q ? '🔍 Aucune opération ne correspond.' : 'Aucune opération sur ce compte.'}</p>`)
    + (sel ? '<div class="sel-actions" id="sel-actions"></div>' : '');
  $('.fab.new-op').hidden = !!sel;
  document.body.classList.toggle('selecting', !!sel); // la barre du bas laisse la place à celle de la sélection
  if (sel) {
    opSel.shown = visible; // « Tout » ne coche pas les opérations des mois repliés
    renderSelBar();
  }
}

// Barre du bas en mode sélection : nombre d'opérations cochées, tout cocher, supprimer, quitter.
function renderSelBar() {
  const n = opSel.ids.size;
  const all = opSel.shown.length > 0 && opSel.shown.every(id => opSel.ids.has(id));
  $('#sel-actions').innerHTML = `
    <button type="button" class="icon-btn" data-action="select" aria-label="Quitter la sélection" title="Quitter la sélection">${ICONS.close}</button>
    <span class="sel-count" role="status">${n.toLocaleString('fr-FR')}<span class="sel-word"> ${n > 1 ? 'sélectionnées' : 'sélectionnée'}</span></span>
    <button type="button" class="btn ghost" data-action="sel-all" ${opSel.shown.length ? '' : 'disabled'}>${all ? 'Aucune' : 'Tout'}</button>
    <button type="button" class="btn danger" data-action="sel-delete" ${n ? '' : 'disabled'}>${ICONS.trash}Supprimer</button>`;
}

// ---------- Écran : recherche dans tous les comptes (loupe de l'accueil) ----------
const searchUi = { q: '', limit: PAGE };

function viewSearch() {
  setHeader('Rechercher', true);
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" id="q" placeholder="Libellé, catégorie, montant… dans tous les comptes" value="${esc(searchUi.q)}"
        aria-label="Rechercher dans tous les comptes" enterkeyhint="search">
    </div>
    <div id="results"></div>`;
  renderSearch();
  const input = $('#q');
  if (!searchUi.q) input.focus();
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { searchUi.q = input.value; searchUi.limit = PAGE; renderSearch(); }, 150);
  });
}

function renderSearch() {
  const q = norm(searchUi.q.trim());
  const out = $('#results');
  if (!q) {
    out.innerHTML = '<p class="empty">🔍 Un libellé, une catégorie, un mode de paiement ou un montant : la recherche porte sur tous vos comptes.</p>';
    return;
  }
  const rows = [...store.idx.entry.values()]
    .filter(e => !e.init && store.idx.acc.has(e.acc) && matches(e, q))
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  if (!rows.length) { out.innerHTML = '<p class="empty">🔍 Aucune opération ne correspond.</p>'; return; }
  const total = rows.reduce((s, e) => s + e.amt, 0);
  const shown = rows.slice(0, searchUi.limit);
  let html = '', month = '';
  for (const e of shown) {
    if (e.date.slice(0, 7) !== month) { month = e.date.slice(0, 7); html += `<h3 class="month">${monthLabel(e.date)}</h3>`; }
    const a = store.idx.acc.get(e.acc);
    const meta = [dayMonth(e.date), a.name, catLabel(e.cat)].filter(Boolean).map(esc).join(' · ');
    html += `<a class="op found" href="#/operation/${e.id}">
      ${bankLogo(a, 32)}
      <span class="op-main"><span class="op-title">${esc(e.title || '(sans libellé)')}</span><span class="op-meta">${meta}</span></span>
      <span class="op-amt"><span class="amt ${e.amt > 0 ? 'pos' : ''}">${signed(e.amt)}</span>${e.chk ? '' : '<span class="sub">non pointée</span>'}</span>
    </a>`;
  }
  out.innerHTML = `<p class="hint found-sum">${plural(rows.length, 'opération', 'opérations')} · total <span class="amt">${signed(total)}</span></p>
    <div class="list">${html}</div>
    ${rows.length > shown.length ? `<button type="button" class="btn ghost block" data-action="search-more">Afficher plus (${plural(rows.length - shown.length, 'restante', 'restantes')})</button>` : ''}`;
}

// ---------- Écran : saisie / modification d'une opération ----------
let titleIndex = null;
function getTitleIndex() {
  if (titleIndex) return titleIndex;
  const byTitle = new Map();
  for (const e of store.idx.entry.values()) {
    if (!e.title || e.init) continue;
    const k = norm(e.title);
    let t = byTitle.get(k);
    if (!t) byTitle.set(k, (t = { title: e.title, key: k, n: 0, last: e }));
    t.n++;
    if (e.date >= t.last.date) t.last = e;
  }
  // Les libellés utilisés le plus récemment d'abord.
  titleIndex = [...byTitle.values()].sort((a, b) => (a.last.date < b.last.date ? 1 : -1));
  return titleIndex;
}

function suggest(text) {
  const q = norm(text.trim());
  if (q.length < 2) return [];
  const starts = [], contains = [];
  for (const t of getTitleIndex()) {
    if (t.key.startsWith(q)) starts.push(t);
    else if (contains.length < 8 && t.key.includes(q)) contains.push(t);
    if (starts.length >= 8) break;
  }
  return [...starts, ...contains].slice(0, 8);
}

function catOptions(type, selected, keepOther = false) {
  const cats = [...store.idx.cat.values()].filter(c => c.type === type || (keepOther && c.id === selected));
  cats.sort((a, b) => (a.type === b.type ? a.pos - b.pos : a.type === type ? -1 : 1));
  return '<option value="">— Sans catégorie —</option>'
    + cats.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(catLabel(c.id))}</option>`).join('');
}

// Catégorie : un champ où quelques lettres filtrent la liste (« boul », « alim »), au lieu d'une longue liste déroulante.
// Le <select> caché reste la valeur du formulaire, rempli comme avant par catOptions ; le champ affiche son choix.
function catField(options) {
  return `<div class="field cat-field">
        <label for="f-cat">Catégorie</label>
        <input id="f-cat" placeholder="Sans catégorie" role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="cat-list" autocomplete="off" enterkeyhint="done">
        <div class="sugg cat-list" id="cat-list" role="listbox" aria-label="Catégories" hidden></div>
        <select name="cat" hidden>${options}</select>
      </div>`;
}

// Nouvelle catégorie tapée dans le champ : « Bio » (catégorie principale) ou « Alimentation > Bio » (sous-catégorie ;
// la catégorie principale est créée aussi si elle n'existe pas). Elle se range à la suite de sa catégorie principale.
function catPlan(text, type) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const [a, b] = text.split(/\s*[>›]\s*/).map(s => s.trim());
  const cats = [...store.idx.cat.values()].filter(c => c.type === type);
  if (!b || !a) return { name: cap(text.replace(/[>›]/g, '').trim()), parent: null, newParent: null };
  // Catégorie principale : nom exact, sinon la première qui commence par ce qui est tapé (« alim » : Alimentation & Autres).
  const tops = cats.filter(c => !c.parent).sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0));
  const parent = tops.find(c => norm(c.name) === norm(a)) ?? tops.find(c => norm(c.name).startsWith(norm(a)));
  return { name: cap(b), parent, newParent: parent ? null : cap(a) };
}

async function createCategory(text, type) {
  const plan = catPlan(text, type);
  const cats = [...store.idx.cat.values()].filter(c => c.type === type);
  const maxPos = Math.max(-1, ...cats.map(c => c.pos ?? 0));
  const items = [];
  let parentId = plan.parent?.id ?? null, pos = maxPos + 1;
  if (plan.newParent) {
    parentId = store.newId();
    items.push(['categories', { id: parentId, name: plan.newParent, type, pos }]);
    pos += 1;
  } else if (parentId) {
    // Juste après la dernière sous-catégorie du parent, avant la catégorie suivante.
    const last = Math.max(plan.parent.pos ?? 0, ...cats.filter(c => c.parent === parentId).map(c => c.pos ?? 0));
    const next = Math.min(maxPos + 1, ...cats.map(c => c.pos ?? 0).filter(p => p > last));
    pos = (last + next) / 2;
  }
  const id = store.newId();
  items.push(['categories', { id, name: plan.name, type, pos, ...(parentId ? { parent: parentId } : {}) }]);
  await store.upsertMany(items);
  toast(`🏷️ Catégorie « ${catLabel(id)} » créée`);
  return id;
}

const coarsePointer = matchMedia('(pointer: coarse)');
// getType (facultatif) : type de l'opération en cours ('D' ou 'R') ; il permet de créer une catégorie depuis le champ.
function wireCatField(sel, getType) {
  const input = $('#f-cat'), list = $('#cat-list');
  let items = [], active = -1;
  const show = () => { input.value = sel.value ? sel.selectedOptions[0]?.text ?? '' : ''; };
  new MutationObserver(show).observe(sel, { childList: true }); // type changé, suggestion, lecture par Gemini…
  show();

  function fill(q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    // Les catégories dont un mot commence par ce qui est tapé d'abord (« tel » : Téléphonie avant Hotels).
    const rank = o => (words.every(w => norm(o.text).split(/[^a-z0-9]+/).some(p => p.startsWith(w))) ? 0 : 1);
    items = [...sel.options].filter(o => words.every(w => norm(o.text).includes(w))).sort((a, b) => rank(a) - rank(b));
    // Rien d'identique à ce qui est tapé : on propose de créer la catégorie, en dernier.
    const typed = q.trim(), type = getType?.();
    const same = o => norm(o.text) === norm(typed) || norm(o.text.split(' › ').pop()) === norm(typed);
    if (type && typed && !items.some(same)) {
      const p = catPlan(typed, type);
      items.push({ create: typed, label: `${p.parent?.name ?? p.newParent ?? ''}${p.parent || p.newParent ? ' › ' : ''}${p.name}` });
    }
    active = words.length ? 0 : items.findIndex(o => o.value === sel.value);
    list.innerHTML = items.length
      ? items.map((o, i) => (o.create
        ? `<button type="button" role="option" id="cat-o${i}" data-i="${i}" tabindex="-1" class="cat-new">
            <span>＋ Créer « ${esc(o.label)} »</span><small>${type === 'R' ? 'recette' : 'dépense'}</small></button>`
        : `<button type="button" role="option" id="cat-o${i}" data-i="${i}" tabindex="-1"
          aria-selected="${o.value === sel.value}">${esc(o.text)}</button>`)).join('')
      : '<p class="cat-none">Aucune catégorie ne correspond.</p>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight();
  }
  function highlight() {
    list.querySelectorAll('.active').forEach(b => b.classList.remove('active'));
    const b = active >= 0 && $(`#cat-o${active}`);
    if (b) {
      b.classList.add('active');
      input.setAttribute('aria-activedescendant', b.id);
      if (b.offsetTop < list.scrollTop || b.offsetTop + b.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = b.offsetTop - (list.clientHeight - b.offsetHeight) / 2;
      }
    } else input.removeAttribute('aria-activedescendant');
  }
  function close() {
    document.body.classList.remove('picking');
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (!input.value.trim()) sel.value = ''; // champ vidé : sans catégorie
    show(); // texte tapé sans choisir : on revient à la catégorie en place
  }
  async function pick(o) {
    if (o.create) {
      const id = await createCategory(o.create, getType());
      sel.innerHTML = catOptions(getType(), id);
      sel.value = id;
    } else sel.value = o.value;
    close();
    if (coarsePointer.matches) input.blur(); // referme le clavier du téléphone
  }

  input.addEventListener('focus', () => {
    input.select();
    fill('');
    // Téléphone : le champ remonte en haut de l'écran pour laisser la place à la liste au-dessus du clavier
    // (avec de l'espace ajouté sous le formulaire le temps du choix, sinon la page est trop courte pour remonter).
    if (coarsePointer.matches) {
      document.body.classList.add('picking');
      setTimeout(() => input.closest('.field').scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
    }
  });
  input.addEventListener('input', () => fill(input.value));
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  input.addEventListener('keydown', ev => {
    if (list.hidden) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); fill(''); }
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (items.length) active = (active + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      highlight();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const o = items[active] ?? items[0];
      if (o) pick(o);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  list.addEventListener('mousedown', ev => ev.preventDefault()); // le champ garde le focus
  list.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-i]');
    if (b) pick(items[+b.dataset.i]);
  });
}

function modeOptions(selected) {
  const modes = [...(store.data?.modes ?? store.DEFAULT_MODES)];
  if (selected && !modes.includes(selected)) modes.push(selected);
  return '<option value="">—</option>'
    + modes.map(m => `<option ${m === selected ? 'selected' : ''}>${esc(m)}</option>`).join('');
}

function accOptions(selected) {
  return [...store.idx.acc.values()]
    .filter(a => !a.closed || a.id === selected)
    .sort((a, b) => a.pos - b.pos)
    .map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

// Catégorie de même nom dans l'autre sens (dépense ↔ recette) : les deux moitiés d'un virement s'annulent dans les statistiques.
function twinCat(id) {
  const c = id && store.idx.cat.get(id);
  if (!c) return '';
  const name = norm(catLabel(id));
  return [...store.idx.cat.values()].find(x => x.type !== c.type && norm(catLabel(x.id)) === name)?.id ?? id;
}

// Reconnaissance vocale du navigateur (Chrome) : absente ailleurs, le 🎤 n'est alors pas affiché.
const Speech = window.SpeechRecognition ?? window.webkitSpeechRecognition;

const keyOrSettings = () => {
  if (ticket.getKey()) return true;
  toast("Ajoutez d'abord votre clé Gemini dans les Réglages.");
  location.hash = '#/reglages';
  return false;
};

// Barre de saisie par IA (formulaire et page d'un compte) : une phrase tapée ou dictée, ou la photo d'un ticket
// (prise sur le moment, ou une image déjà sur l'appareil : capture d'écran, photo de la galerie).
// Champ vide : 🎤, appareil photo et image ; champ rempli : 🎤 et envoi.
const aiBar = () => `<div class="ai-bar" id="ai-bar">
    <span class="ai-ico">${ICONS.sparkle}</span>
    <input id="say" placeholder="Ex. : 12 € pain hier" enterkeyhint="go" autocomplete="off" aria-label="Décrire l'opération en une phrase">
    ${Speech ? `<button type="button" class="ai-btn ai-mic" id="mic" aria-label="Dicter l'opération" aria-pressed="false">${ICONS.mic}</button>` : ''}
    <button type="button" class="ai-btn ai-cam" id="photo-btn" aria-label="Photo du ticket">${ICONS.camera}</button>
    <button type="button" class="ai-btn ai-cam" id="pick-btn" aria-label="Choisir une image : capture d'écran, photo déjà prise">${ICONS.image}</button>
    <button type="button" class="ai-btn ai-send" id="say-go" aria-label="Remplir d'après la phrase">${ICONS.send}</button>
  </div>`;

// Branche la barre : onSentence(texte) pour une phrase tapée (Entrée, envoi) ou dictée.
function wireAiBar(onSentence) {
  const bar = $('#ai-bar'), say = $('#say');
  const sync = () => bar.classList.toggle('has-text', !!say.value.trim());
  const send = () => { const text = say.value.trim(); if (text) onSentence(text); else say.focus(); };
  say.addEventListener('input', sync);
  say.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); send(); } });
  $('#say-go').addEventListener('click', send);
  const mic = $('#mic');
  mic?.addEventListener('click', () => dictate(mic, text => { say.value = text; sync(); }, onSentence));
  return { say, sync };
}

// Dictée par la reconnaissance vocale du navigateur ; le bouton est rouge pendant l'écoute (un appui l'arrête).
// onPartial reçoit le texte au fil de l'eau, onDone la phrase finale.
let listening = null;
function dictate(btn, onPartial, onDone) {
  if (listening) return listening.stop();
  if (!keyOrSettings()) return;
  const rec = new Speech();
  rec.lang = 'fr-FR';
  rec.interimResults = true;
  let heard = '', failed = false;
  rec.onresult = ev => { heard = [...ev.results].map(x => x[0].transcript).join(''); onPartial(heard); };
  rec.onerror = ev => {
    failed = true;
    if (ev.error === 'aborted') return;
    toast(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'Micro refusé : autorisez-le pour ce site dans Chrome.'
      : ev.error === 'no-speech' ? 'Rien entendu : réessayez.'
        : ev.error === 'network' ? 'Dictée impossible sans connexion.' : `Dictée impossible (${ev.error}).`);
  };
  rec.onend = () => {
    listening = null;
    btn.classList.remove('on');
    btn.setAttribute('aria-pressed', 'false');
    if (!failed && heard.trim() && btn.isConnected) onDone(heard.trim());
  };
  try { rec.start(); } catch { return toast('Dictée impossible.'); }
  listening = rec;
  onPartial('');
  btn.classList.add('on');
  btn.setAttribute('aria-pressed', 'true');
}

function viewEntryForm(id, accId) {
  const e = id ? store.idx.entry.get(id) : null;
  if (id && !e) return location.replace('#/');
  const p = e?.pair ? store.idx.entry.get(e.pair) : null; // autre moitié d'un virement
  const acc = e ? e.acc : accId;
  if (!store.idx.acc.has(acc)) return location.replace('#/');
  setHeader(e ? "Modifier l'opération" : 'Nouvelle opération', true);
  const type = e && e.amt > 0 ? 'R' : 'D';
  const defaultMode = (store.data?.modes ?? []).includes('Carte') ? 'Carte' : '';

  view.innerHTML = `
    <form id="f" class="form card cols2" autocomplete="off" novalidate>
      ${e ? '' : `<div class="ai-block">
        ${aiBar()}
        <input type="file" id="photo" accept="image/*" capture="environment" hidden>
        <input type="file" id="pick" accept="image/*" hidden>
        <div id="photo-report"></div>
      </div>`}
      <div class="seg" role="radiogroup" aria-label="Type d'opération">
        <label><input type="radio" name="type" value="D" ${type === 'D' ? 'checked' : ''}><span>Dépense</span></label>
        <label><input type="radio" name="type" value="R" ${type === 'R' ? 'checked' : ''}><span>Recette</span></label>
      </div>
      <div class="field">
        <label for="f-title">Libellé</label>
        <input id="f-title" name="title" required maxlength="120" value="${esc(e?.title)}" ${e ? '' : 'autofocus'}>
        <div class="sugg" id="sugg" hidden></div>
      </div>
      <label class="field"><span>Montant</span>
        <input name="amt" inputmode="decimal" required value="${e ? amountInput(e.amt) : ''}" placeholder="0,00"></label>
      <div class="grid2">
        <label class="field"><span>Date</span><input type="date" name="date" required value="${e?.date ?? store.todayStr()}"></label>
        <label class="field"><span>Mode</span><select name="mode">${modeOptions(e ? e.mode : defaultMode)}</select></label>
      </div>
      ${catField(catOptions(type, e?.cat, true))}
      <label class="field"><span>Compte</span><select name="acc">${accOptions(acc)}</select></label>
      <label class="field"><span>Virement avec le compte <em>(facultatif : crée l'opération inverse sur ce compte)</em></span>
        <select name="pair"><option value="">— Aucun —</option>${accOptions(p?.acc)}</select></label>
      <label class="field"><span>Référence <em>(facultatif)</em></span><input name="ref" value="${esc(e?.ref)}"></label>
      <label class="check"><input type="checkbox" name="chk" ${e?.chk ? 'checked' : ''}> Opération pointée</label>
      <div class="actions">
        <button class="btn primary" type="submit">Enregistrer</button>
        ${e ? '<button class="btn danger" type="button" id="del">Supprimer</button>' : ''}
      </div>
    </form>`;

  const f = $('#f');
  const F = f.elements;
  const box = $('#sugg');
  let picks = [];

  const currentType = () => f.querySelector('input[name=type]:checked').value;
  f.querySelectorAll('input[name=type]').forEach(r => r.addEventListener('change', () => {
    F.cat.innerHTML = catOptions(currentType(), F.cat.value);
  }));
  wireCatField(F.cat, currentType);
  F.pair.addEventListener('change', () => {
    if (F.pair.value && [...F.mode.options].some(o => o.value === 'Virement')) F.mode.value = 'Virement';
  });

  function applySuggestion(t) {
    const last = t.last;
    F.title.value = t.title;
    const ty = last.amt > 0 ? 'R' : 'D';
    f.querySelector(`input[name=type][value=${ty}]`).checked = true;
    F.cat.innerHTML = catOptions(ty, last.cat ?? '');
    if (last.mode) F.mode.innerHTML = modeOptions(last.mode);
    F.amt.placeholder = `dernier : ${amountInput(last.amt)}`;
    box.hidden = true;
    if (!F.amt.value) F.amt.focus();
  }

  F.title.addEventListener('input', () => {
    picks = suggest(F.title.value);
    box.hidden = !picks.length;
    box.innerHTML = picks.map((t, i) => `<button type="button" data-i="${i}">
      <span>${esc(t.title)}</span><small>${esc(catLabel(t.last.cat))} · ${signed(t.last.amt)}</small></button>`).join('');
  });
  box.addEventListener('mousedown', ev => ev.preventDefault());
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-i]');
    if (b) applySuggestion(picks[+b.dataset.i]);
  });
  F.title.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
  F.title.addEventListener('keydown', ev => { if (ev.key === 'Escape') box.hidden = true; });

  // Saisie par photo : Gemini lit le ticket, le formulaire est pré-rempli, l'utilisateur vérifie et enregistre.
  const photoBtn = $('#photo-btn'), pickBtn = $('#pick-btn');
  async function readPhoto(file) {
    const report = $('#photo-report');
    report.innerHTML = `<div class="report photo-report"><img src="${URL.createObjectURL(file)}" alt="Photo du ticket"><span>Lecture du ticket…</span></div>`;
    const msg = report.querySelector('span');
    photoBtn.disabled = pickBtn.disabled = true;
    try {
      msg.textContent = fillFromTicket(await ticket.readTicket(file, ticketContext()));
    } catch (err) {
      report.firstElementChild.classList.add('error');
      msg.textContent = err.message;
    } finally {
      photoBtn.disabled = pickBtn.disabled = false;
    }
  }
  function fillFromTicket(r) {
    if (r.lisible === false) return "Ticket illisible : réessayez avec une photo plus nette.";
    const known = r.libelle_connu && getTitleIndex().find(t => t.key === norm(r.libelle_connu));
    if (known) {
      applySuggestion(known);
    } else {
      if (r.commercant) F.title.value = String(r.commercant).slice(0, 120);
      const cat = r.categorie && [...store.idx.cat.values()].find(c => norm(catLabel(c.id)) === norm(r.categorie));
      if (cat) {
        f.querySelector(`input[name=type][value=${cat.type}]`).checked = true;
        F.cat.innerHTML = catOptions(cat.type, cat.id);
      }
    }
    if (r.remboursement && currentType() !== 'R') {
      f.querySelector('input[name=type][value=R]').checked = true;
      F.cat.innerHTML = catOptions('R', F.cat.value, true);
    }
    if (r.mode && (store.data?.modes ?? []).includes(r.mode)) F.mode.innerHTML = modeOptions(r.mode);
    const cents = Math.round(Math.abs(Number(r.montant) || 0) * 100);
    if (cents > 0) F.amt.value = amountInput(cents);
    if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      const days = (Date.now() - new Date(`${r.date}T12:00`)) / 864e5;
      if (days > -2 && days < 400) F.date.value = r.date;
    }
    const missing = [!(cents > 0) && 'le montant', !F.title.value.trim() && 'le libellé'].filter(Boolean);
    return missing.length
      ? `Rempli d'après la photo, sauf ${missing.join(' et ')} : complétez, puis Enregistrer.`
      : "Rempli d'après la photo : vérifiez le montant et la date, puis Enregistrer.";
  }
  if (photoBtn) {
    // 📷 ouvre l'appareil photo (capture), 🖼️ le choix d'une image déjà sur l'appareil.
    for (const [btn, input] of [[photoBtn, $('#photo')], [pickBtn, $('#pick')]]) {
      btn.addEventListener('click', () => {
        if (!ticket.getKey()) {
          toast("Ajoutez d'abord votre clé Gemini dans les Réglages.");
          location.hash = '#/reglages';
          return;
        }
        input.click();
      });
      input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file) readPhoto(file);
      });
    }
    if (pendingPhoto) {
      const file = pendingPhoto;
      pendingPhoto = null;
      if (ticket.getKey()) readPhoto(file); else toast("Ajoutez d'abord votre clé Gemini dans les Réglages.");
    } else if (autoPhoto) {
      const btn = autoPhoto === 'pick' ? pickBtn : photoBtn;
      autoPhoto = false;
      btn.click();
    }
  }

  // Saisie par phrase, tapée ou dictée : Gemini la lit et reconnaît le libellé habituel,
  // puis l'historique de ce libellé complète le reste (catégorie, mode, compte, montant non dit).
  const say = $('#say');
  async function readSentence() {
    const text = say.value.trim();
    if (!text) return say.focus();
    if (!keyOrSettings()) return;
    const report = $('#photo-report');
    report.innerHTML = '<div class="report"><span>Lecture de la phrase…</span></div>';
    const msg = report.querySelector('span');
    $('#say-go').disabled = true;
    try {
      msg.textContent = fillFromSentence(await ticket.readSentence(text, sentenceContext()));
    } catch (err) {
      report.firstElementChild.classList.add('error');
      msg.textContent = err.message;
    } finally {
      $('#say-go').disabled = false;
    }
  }
  function fillFromSentence(r) {
    if (r.comprise === false) return 'Phrase non comprise : dites au moins le montant et ce qui a été payé ou reçu.';
    // La phrase décrit toute l'opération : on repart d'un formulaire vierge (utile quand on redicte).
    f.querySelector('input[name=type][value=D]').checked = true;
    F.title.value = F.amt.value = F.pair.value = '';
    F.amt.placeholder = '0,00';
    F.date.value = store.todayStr();
    F.mode.innerHTML = modeOptions(defaultMode);
    F.cat.innerHTML = catOptions('D', '');
    F.acc.value = acc;
    const known = r.libelle_connu && getTitleIndex().find(t => t.key === norm(r.libelle_connu));
    const said = r.sens === 'recette' ? 'R' : r.sens === 'depense' ? 'D' : null;
    let cents = Math.round(Math.abs(Number(r.montant) || 0) * 100);
    const fromLast = !(cents > 0) && !!known;
    if (fromLast) cents = Math.abs(known.last.amt);
    if (cents > 0) F.amt.value = amountInput(cents);
    if (known) {
      applySuggestion(known);
    } else {
      if (r.libelle) F.title.value = String(r.libelle).slice(0, 120);
      const ty = said ?? 'D';
      const cats = r.categorie ? [...store.idx.cat.values()].filter(c => norm(catLabel(c.id)) === norm(r.categorie)) : [];
      const cat = cats.find(c => c.type === ty) ?? cats[0];
      f.querySelector(`input[name=type][value=${cat?.type ?? ty}]`).checked = true;
      F.cat.innerHTML = catOptions(cat?.type ?? ty, cat?.id ?? '');
    }
    if (said && said !== currentType()) {
      f.querySelector(`input[name=type][value=${said}]`).checked = true;
      F.cat.innerHTML = catOptions(said, twinCat(F.cat.value), true);
    }
    if (r.mode && (store.data?.modes ?? []).includes(r.mode)) F.mode.innerHTML = modeOptions(r.mode);
    const open = id => (id && store.idx.acc.has(id) && !store.idx.acc.get(id).closed ? id : null);
    const named = n => (n ? [...store.idx.acc.values()].find(a => !a.closed && norm(a.name) === norm(n))?.id ?? null : null);
    const where = named(r.compte) ?? open(known?.last.acc);
    if (where) F.acc.value = where;
    const other = named(r.virement_avec) ?? open(known?.last.pair && store.idx.entry.get(known.last.pair)?.acc);
    F.pair.value = other && other !== F.acc.value ? other : '';
    F.pair.dispatchEvent(new Event('change'));
    if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      const days = (Date.now() - new Date(`${r.date}T12:00`)) / 864e5;
      if (Math.abs(days) < 400) F.date.value = r.date;
    }
    const missing = [!(cents > 0) && 'le montant', !F.title.value.trim() && 'le libellé'].filter(Boolean);
    return missing.length ? `Rempli d'après la phrase, sauf ${missing.join(' et ')} : complétez, puis Enregistrer.`
      : fromLast ? "Rempli d'après la phrase, avec le montant de la dernière fois : vérifiez, puis Enregistrer."
        : "Rempli d'après la phrase : vérifiez, puis Enregistrer.";
  }
  if (say) {
    const { sync } = wireAiBar(() => readSentence());
    if (pendingSentence) { // phrase saisie ou dictée depuis la page d'un compte
      say.value = pendingSentence;
      pendingSentence = null;
      sync();
      readSentence();
    }
  }

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const title = F.title.value.trim();
    const cents = parseAmount(F.amt.value);
    if (!title) { toast('Indiquez un libellé.'); return F.title.focus(); }
    if (!(cents > 0)) { toast('Montant invalide.'); return F.amt.focus(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(F.date.value)) { toast('Date invalide.'); return F.date.focus(); }
    if (F.pair.value && F.pair.value === F.acc.value) { toast('Le virement doit concerner un autre compte.'); return F.pair.focus(); }
    const rec = { ...(e ?? { id: store.newId() }) };
    rec.acc = F.acc.value;
    rec.date = F.date.value;
    rec.amt = (currentType() === 'R' ? 1 : -1) * cents;
    rec.title = title;
    for (const k of ['mode', 'cat', 'ref']) {
      const v = F[k].value.trim();
      if (v) rec[k] = v; else delete rec[k];
    }
    if (F.chk.checked) rec.chk = true; else delete rec.chk;

    // Nouvelle opération : alerte si elle semble déjà saisie (ou déjà créée par une récurrente), sur ce compte
    // comme sur celui du virement.
    if (!e) {
      const twins = [...lookalikes(rec.acc, rec.amt, rec.date), ...(F.pair.value ? lookalikes(F.pair.value, -rec.amt, rec.date) : [])];
      if (twins.length && !confirm(`Cette opération ressemble à ${twins.length > 1 ? 'des opérations déjà saisies' : 'une opération déjà saisie'} :\n`
        + twins.slice(0, 4).map(x => `• ${dayMonth(x.date)} · ${x.title || '(sans libellé)'} · ${signed(x.amt)} (${store.idx.acc.get(x.acc)?.name ?? ''})`).join('\n')
        + '\n\nL\'enregistrer quand même ?')) return;
    }

    const items = [['entries', rec]];
    if (F.pair.value) {
      // L'autre moitié reprend libellé, date, mode et référence ; elle garde sa catégorie et son pointage.
      const q = { ...(p ?? { id: store.newId() }) };
      if (!p) { const c = twinCat(rec.cat); if (c) q.cat = c; }
      if (p && p.acc !== F.pair.value) delete q.chk; // passée sur un autre compte : à repointer
      q.acc = F.pair.value;
      q.date = rec.date;
      q.amt = -rec.amt;
      q.title = rec.title;
      for (const k of ['mode', 'ref']) { if (rec[k]) q[k] = rec[k]; else delete q[k]; }
      q.pair = rec.id;
      rec.pair = q.id;
      items.push(['entries', q]);
    } else {
      delete rec.pair;
      if (p) items.push(['entries', { id: p.id, del: true }]);
    }
    await store.upsertMany(items);
    try { localStorage.setItem(LAST_ACC, rec.acc); } catch { /* stockage indisponible : sans importance */ }
    toast(e ? '✏️ Opération modifiée' : F.pair.value ? '✅ Virement ajouté' : '✅ Opération ajoutée');
    goBack(`#/compte/${rec.acc}`);
  });

  $('#del')?.addEventListener('click', async () => {
    const other = p && store.idx.acc.get(p.acc)?.name;
    if (!confirm(`Supprimer l'opération « ${e.title} » (${signed(e.amt)})${p ? ` et l'opération inverse sur ${other}` : ''} ?`)) return;
    const items = [['entries', { id: e.id, del: true }]];
    if (p) items.push(['entries', { id: p.id, del: true }]);
    await store.upsertMany(items);
    toast('🗑️ Opération supprimée');
    goBack(`#/compte/${e.acc}`);
  });
}

// Opérations d'un compte qui ressemblent à une nouvelle saisie : même montant, même jour ou un jour d'écart.
function lookalikes(acc, amt, date) {
  const t = Date.parse(date);
  return (store.idx.byAcc.get(acc) ?? []).filter(x => x.amt === amt && Math.abs(Date.parse(x.date) - t) <= 86400000);
}

// Ce que Gemini doit connaître pour reprendre les habitudes de saisie : libellés récents, catégories, modes.
function ticketContext() {
  const titles = getTitleIndex().filter(t => t.last.amt < 0).slice(0, 150)
    .map(t => `${t.title} | ${catLabel(t.last.cat) || '-'} | ${t.last.mode || '-'}`);
  const categories = [...new Set([...store.idx.cat.values()].map(c => catLabel(c.id)))].sort((a, b) => a.localeCompare(b, 'fr'));
  return { today: store.todayStr(), titles, categories, modes: store.data?.modes ?? store.DEFAULT_MODES };
}

// Pour une phrase : libellés récents dépenses ET recettes, avec leur compte, et la liste des comptes ouverts.
function sentenceContext() {
  const ctx = ticketContext();
  const accName = id => store.idx.acc.get(id)?.name ?? '-';
  ctx.titles = getTitleIndex().slice(0, 200)
    .map(t => `${t.title} | ${t.last.amt > 0 ? 'recette' : 'dépense'} | ${catLabel(t.last.cat) || '-'} | ${accName(t.last.acc)}`);
  ctx.accounts = [...store.idx.acc.values()].filter(a => !a.closed).sort((a, b) => a.pos - b.pos).map(a => a.name);
  ctx.todayLong = new Date(`${ctx.today}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return ctx;
}

// Photo reçue par le menu « Partager » d'Android (mise de côté par le service worker) : nouvelle opération pré-remplie.
async function viewSharedPhoto() {
  setHeader('Photo du ticket', true);
  view.innerHTML = '<p class="empty">Ouverture de la photo…</p>';
  let file = null;
  try {
    const cache = await caches.open('comptes-partage');
    const res = await cache.match('photo');
    if (res) {
      file = new File([await res.blob()], 'ticket', { type: res.headers.get('Content-Type') || 'image/jpeg' });
      await cache.delete('photo');
    }
  } catch { /* pas de photo en attente */ }
  const acc = defaultAccId();
  if (!file || !acc) return location.replace('#/');
  pendingPhoto = file;
  location.replace(`#/nouvelle-operation/${acc}`);
}

// ---------- Écran : pointage à partir de captures de l'appli de la banque ----------
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

// Rapproche chaque ligne de la banque d'une opération du compte : même montant, à 10 jours près (la date
// de débit diffère souvent de celle du ticket). La plus proche en date l'emporte, à écart égal une non pointée.
function matchStatement(accId, lines) {
  const entries = (store.idx.byAcc.get(accId) ?? []).filter(e => !e.init);
  const today = store.todayStr();
  const used = new Set();
  const find = (line, amt) => {
    let best = null, bestScore = Infinity;
    for (const e of entries) {
      if (e.amt !== amt || used.has(e.id)) continue;
      const gap = Math.abs(dayDiff(e.date, line.date ?? today));
      if (gap > (line.date ? 10 : 45)) continue;
      const score = gap * 2 + (e.chk ? 1 : 0);
      if (score < bestScore) { best = e; bestScore = score; }
    }
    return best;
  };
  return lines.map(line => {
    const cents = Math.round(Number(line.montant) * 100);
    // Si Gemini s'est trompé de signe, la ligne est retrouvée avec le signe inverse.
    const entry = cents ? find(line, cents) ?? find(line, -cents) : null;
    if (entry) used.add(entry.id);
    const status = !entry ? 'absent' : entry.chk ? 'deja' : line.en_cours ? 'en_cours' : 'a_pointer';
    return { line, cents, entry, status };
  });
}

async function viewStatement(acc) {
  const a = store.idx.acc.get(acc);
  const job = pendingStatement;
  pendingStatement = null;
  if (!a || job?.acc !== acc) return location.replace(`#/compte/${acc}`);
  setHeader('📷 Pointage', true);
  const hash = currentHash;
  const lines = [], seen = new Map();
  let bank = null;
  for (const [k, file] of job.files.entries()) {
    view.innerHTML = `<p class="empty">📷 Lecture de la capture ${k + 1} sur ${job.files.length}…</p>`;
    let r;
    try {
      r = await ticket.readStatement(file, store.todayStr());
    } catch (err) {
      if (currentHash !== hash) return;
      view.innerHTML = `<p class="report error">${esc(err.message)}</p>
        <a class="btn ghost block" href="#/compte/${acc}">Retour au compte</a>`;
      return;
    }
    if (currentHash !== hash) return; // l'utilisateur est parti entre-temps
    if (r.lisible === false) continue;
    if (bank === null && typeof r.solde === 'number') bank = Math.round(r.solde * 100);
    // Deux captures successives se chevauchent souvent : une ligne identique vue sur une autre capture est un doublon.
    for (const l of r.lignes ?? []) {
      const key = `${l.date}|${l.montant}|${norm(l.libelle)}`;
      if (seen.has(key) && seen.get(key) !== k) continue;
      seen.set(key, k);
      lines.push(l);
    }
  }
  if (!lines.length) {
    view.innerHTML = `<p class="empty">Aucune opération lue sur ${job.files.length > 1
      ? "ces captures. Vérifiez qu'elles montrent" : "cette capture. Vérifiez qu'elle montre"} la liste des opérations du compte.</p>
      <a class="btn ghost block" href="#/compte/${acc}">Retour au compte</a>`;
    return;
  }
  renderStatement(a, matchStatement(acc, lines), bank, job.files.length);
}

function renderStatement(a, rows, bank, shots) {
  const GROUPS = [
    ['a_pointer', '✅ À pointer', true],
    ['en_cours', '⏳ En cours à la banque', true],
    ['deja', '☑️ Déjà pointées', false],
    ['absent', '❓ Introuvables dans l\'appli', false],
  ];
  const row = (r, i, selectable) => `
    <label class="stmt-row">
      ${selectable ? `<input type="checkbox" data-i="${i}" ${r.status === 'a_pointer' ? 'checked' : ''}>` : '<span class="stmt-dot" aria-hidden="true"></span>'}
      <span class="stmt-main">
        <span class="stmt-title">${esc(r.line.libelle || '(sans libellé)')}</span>
        <span class="sub">${r.line.date ? fullDate(r.line.date) : 'date non lue'}${r.entry
          ? ` · ↳ ${esc(r.entry.title || '(sans libellé)')} du ${dayMonth(r.entry.date)}` : ''}</span>
      </span>
      <span class="amt ${(r.entry?.amt ?? r.cents) > 0 ? 'pos' : ''}">${signed(r.entry?.amt ?? r.cents)}</span>
    </label>`;
  view.innerHTML = `
    <section class="card">
      <h2>${esc(a.name)}</h2>
      <p class="muted">${plural(rows.length, 'opération lue', 'opérations lues')} sur ${plural(shots, 'capture', 'captures')}.
        Cochez celles à pointer : rien n'est modifié d'autre.</p>
      <div id="stmt-check"></div>
    </section>
    ${GROUPS.map(([status, title, selectable]) => {
      const list = rows.map((r, i) => [r, i]).filter(([r]) => r.status === status);
      return list.length ? `<h2 class="section-title">${title} <small>${list.length}</small></h2>
        <div class="list">${list.map(([r, i]) => row(r, i, selectable)).join('')}</div>` : '';
    }).join('')}
    <div class="actions stmt-actions">
      <button class="btn primary" type="button" id="stmt-ok"></button>
      <a class="btn ghost" href="#/compte/${a.id}">Annuler</a>
    </div>`;

  const selected = () => [...view.querySelectorAll('.stmt-row input:checked')].map(cb => rows[+cb.dataset.i].entry);
  const update = () => {
    const chosen = selected();
    const ok = $('#stmt-ok');
    ok.textContent = chosen.length ? `Pointer ${plural(chosen.length, 'opération', 'opérations')}` : 'Rien à pointer';
    ok.disabled = !chosen.length;
    // Contrôle : solde pointé après validation, comparé au solde affiché par la banque.
    const after = store.balances(a.id).chk + sum(chosen.map(e => e.amt));
    $('#stmt-check').innerHTML = bank === null ? ''
      : after === bank
        ? `<p class="report">✅ Solde pointé après validation : ${money(after)}, identique au solde affiché par la banque.</p>`
        : `<p class="report error">⚠️ Solde pointé après validation : ${money(after)}, la banque affiche ${money(bank)} (écart de ${signed(bank - after)}).</p>`;
  };
  view.querySelectorAll('.stmt-row input').forEach(cb => cb.addEventListener('change', update));
  update();
  $('#stmt-ok').addEventListener('click', async () => {
    const chosen = selected();
    if (!chosen.length) return;
    await store.upsertMany(chosen.map(e => ['entries', { ...e, chk: true }]));
    toast(`✅ ${plural(chosen.length, 'opération pointée', 'opérations pointées')}`);
    location.replace(`#/compte/${a.id}`);
  });
}

// ---------- Écrans : opérations récurrentes ----------
const FREQS = [[1, 'Tous les mois'], [2, 'Tous les 2 mois'], [3, 'Tous les 3 mois'], [6, 'Tous les 6 mois'], [12, 'Tous les ans']];
const fullDate = d => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const rhythm = o => {
  const f = o.freq || 1;
  return `le ${o.day}${f === 1 ? ' de chaque mois' : f === 12 ? ', tous les ans' : `, tous les ${f} mois`}`;
};

const ordersUi = { q: '' };

function viewOrders() {
  setHeader('Opérations récurrentes', true);
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" id="q" placeholder="Filtrer : libellé, compte, catégorie, montant…" value="${esc(ordersUi.q)}" aria-label="Filtrer les opérations récurrentes">
    </div>
    <p class="hint">Le jour de l'échéance, l'opération est ajoutée au compte. Corrigez-la ensuite si la date ou le montant réel diffère.</p>
    <div id="orders"></div>
    <a class="fab" href="#/nouvelle-recurrente" aria-label="Nouvelle opération récurrente">${ICON_PLUS}</a>`;
  renderOrders();
  let t;
  $('#q').addEventListener('input', ev => {
    clearTimeout(t);
    t = setTimeout(() => { ordersUi.q = ev.target.value; renderOrders(); }, 150);
  });
}

function renderOrders() {
  const all = recur.activeOrders().filter(o => store.idx.acc.has(o.acc));
  const byId = new Map(all.map(o => [o.id, o]));
  // Filtre : comme la recherche d'un compte, plus le nom du compte (et celui de l'autre compte d'un virement).
  const q = norm(ordersUi.q.trim());
  const accName = id => norm(store.idx.acc.get(id)?.name);
  const orders = q
    ? all.filter(o => matches(o, q) || accName(o.acc).includes(q) || (o.pair && byId.has(o.pair) && accName(byId.get(o.pair).acc).includes(q)))
    : all;
  const next = new Map(orders.map(o => [o.id, recur.nextDue(o)]));
  const thisYear = store.todayStr().slice(0, 4);
  const row = o => {
    const p = o.pair && byId.get(o.pair);
    const meta = [rhythm(o), p && `virement avec ${store.idx.acc.get(p.acc)?.name}`, catLabel(o.cat), o.mode].filter(Boolean).map(esc).join(' · ');
    const n = next.get(o.id);
    return `<a class="acc" href="#/recurrente/${o.id}">
      <span class="acc-main"><span class="acc-name">${esc(o.title || '(sans libellé)')}</span><span class="acc-bank">${meta}</span></span>
      <span class="acc-bal"><span class="amt ${o.amt > 0 ? 'pos' : ''}">${signed(o.amt)}</span>
        <span class="sub nowrap">${n ? `prochaine : ${n.slice(0, 4) === thisYear ? dayMonth(n) : fullDate(n)}` : `terminée${o.end ? ` le ${fullDate(o.end)}` : ''}`}</span></span>
    </a>`;
  };
  const byAccount = list => [...store.idx.acc.values()].sort((a, b) => a.pos - b.pos)
    .map(a => {
      const mine = list.filter(o => o.acc === a.id).sort((x, y) => x.day - y.day);
      return mine.length ? `<h3 class="month nocap">${esc(a.name)}</h3>${mine.map(row).join('')}` : '';
    }).join('');
  const running = orders.filter(o => next.get(o.id));
  const ended = orders.filter(o => !next.get(o.id));
  $('#orders').innerHTML = q && !orders.length ? '<p class="empty">🔍 Aucune opération récurrente ne correspond.</p>' : `
    ${running.length ? `<div class="list">${byAccount(running)}</div>` : `<p class="empty">Aucune opération récurrente en cours${q ? ' ne correspond' : ''}.</p>`}
    ${ended.length ? `<details class="closed" ${q ? 'open' : ''}><summary>Terminées (${ended.length})</summary><div class="list">${byAccount(ended)}</div></details>` : ''}`;
}

function viewOrderForm(id) {
  const byId = new Map(recur.activeOrders().map(o => [o.id, o]));
  const o = id ? byId.get(id) : null;
  if (id && !o) return location.replace('#/recurrentes');
  const p = o?.pair ? byId.get(o.pair) : null;
  const acc = o?.acc ?? [...store.idx.acc.values()].filter(a => !a.closed).sort((a, b) => a.pos - b.pos)[0]?.id;
  if (!acc) return location.replace('#/');
  setHeader(o ? 'Modifier la récurrente' : 'Nouvelle récurrente', true);
  const type = o && o.amt > 0 ? 'R' : 'D';
  const today = store.todayStr();
  const next = o && recur.nextDue(o);

  view.innerHTML = `
    <form id="f" class="form card cols2" autocomplete="off" novalidate>
      <div class="seg" role="radiogroup" aria-label="Type d'opération">
        <label><input type="radio" name="type" value="D" ${type === 'D' ? 'checked' : ''}><span>Dépense</span></label>
        <label><input type="radio" name="type" value="R" ${type === 'R' ? 'checked' : ''}><span>Recette</span></label>
      </div>
      <label class="field"><span>Libellé</span><input name="title" required maxlength="120" value="${esc(o?.title)}"></label>
      <label class="field"><span>Montant</span>
        <input name="amt" inputmode="decimal" required value="${o ? amountInput(o.amt) : ''}" placeholder="0,00"></label>
      <label class="field"><span>Compte</span><select name="acc">${accOptions(acc)}</select></label>
      <label class="field"><span>Virement avec le compte <em>(facultatif : crée l'opération inverse sur ce compte)</em></span>
        <select name="pair"><option value="">— Aucun —</option>${accOptions(p?.acc)}</select></label>
      <div class="grid2">
        <label class="field"><span>Jour du mois</span>
          <input type="number" name="day" min="1" max="31" inputmode="numeric" required value="${o?.day ?? +today.slice(8, 10)}"></label>
        <label class="field"><span>Fréquence</span><select name="freq">
          ${FREQS.map(([n, label]) => `<option value="${n}" ${n === (o?.freq || 1) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Début</span><input type="date" name="start" required value="${o?.start ?? today}"></label>
        <label class="field"><span>Fin <em>(facultatif)</em></span><input type="date" name="end" value="${o?.end ?? ''}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Mode</span><select name="mode">${modeOptions(o?.mode ?? '')}</select></label>
        <label class="field"><span>Référence <em>(facultatif)</em></span><input name="ref" value="${esc(o?.ref)}"></label>
      </div>
      ${catField(catOptions(type, o?.cat, true))}
      <label class="check"><input type="checkbox" name="chk" ${o?.chk ? 'checked' : ''}> Pointer automatiquement les opérations créées</label>
      <p class="hint">${o ? (next ? `Prochaine échéance : ${fullDate(next)}.` : 'Terminée : plus aucune échéance à venir.')
        : 'Les échéances déjà passées depuis la date de début seront créées à l\'enregistrement.'}
        Les mois plus courts, l'échéance tombe le dernier jour du mois. Les opérations déjà créées ne sont pas modifiées.</p>
      <div class="actions">
        <button class="btn primary" type="submit">Enregistrer</button>
        ${o ? '<button class="btn danger" type="button" id="del">Supprimer</button>' : ''}
      </div>
    </form>`;

  const f = $('#f');
  const F = f.elements;
  const currentType = () => f.querySelector('input[name=type]:checked').value;
  f.querySelectorAll('input[name=type]').forEach(r => r.addEventListener('change', () => {
    F.cat.innerHTML = catOptions(currentType(), F.cat.value);
  }));
  wireCatField(F.cat, currentType);

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const title = F.title.value.trim();
    const cents = parseAmount(F.amt.value);
    const day = Number(F.day.value);
    if (!title) { toast('Indiquez un libellé.'); return F.title.focus(); }
    if (!(cents > 0)) { toast('Montant invalide.'); return F.amt.focus(); }
    if (!Number.isInteger(day) || day < 1 || day > 31) { toast('Jour du mois invalide (1 à 31).'); return F.day.focus(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(F.start.value)) { toast('Date de début invalide.'); return F.start.focus(); }
    if (F.end.value && F.end.value < F.start.value) { toast('La fin est avant le début.'); return F.end.focus(); }
    if (F.pair.value && F.pair.value === F.acc.value) { toast('Le virement doit concerner un autre compte.'); return F.pair.focus(); }

    // Champs communs aux deux moitiés d'un virement.
    const common = r => {
      r.title = title;
      r.day = day;
      r.freq = Number(F.freq.value);
      r.start = F.start.value;
      if (F.end.value) r.end = F.end.value; else delete r.end;
      for (const k of ['mode', 'ref']) { const v = F[k].value.trim(); if (v) r[k] = v; else delete r[k]; }
      if (F.chk.checked) r.chk = true; else delete r.chk;
      return r;
    };
    const rec = common({ ...(o ?? { id: store.newId(), last: '' }) });
    rec.acc = F.acc.value;
    rec.amt = (currentType() === 'R' ? 1 : -1) * cents;
    const cat = F.cat.value;
    if (cat) rec.cat = cat; else delete rec.cat;

    const items = [['orders', rec]];
    if (F.pair.value) {
      // L'autre moitié garde sa propre catégorie ; une nouvelle moitié reprend là où en est la récurrente.
      const q = common({ ...(p ?? { id: store.newId(), last: o ? recur.lastDone(o) : '' }) });
      q.acc = F.pair.value;
      q.amt = -rec.amt;
      q.pair = rec.id;
      rec.pair = q.id;
      items.push(['orders', q]);
    } else {
      delete rec.pair;
      if (p) items.push(['orders', { id: p.id, del: true }]);
    }
    await store.upsertMany(items);
    toast(o ? '✏️ Récurrente modifiée' : '✅ Récurrente créée');
    goBack('#/recurrentes');
    runRecurrences();
  });

  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer la récurrente « ${o.title} »${p ? ' et l\'opération inverse sur l\'autre compte' : ''} ?\nLes opérations déjà créées sont conservées.`)) return;
    const items = [['orders', { id: o.id, del: true }]];
    if (p) items.push(['orders', { id: p.id, del: true }]);
    await store.upsertMany(items);
    toast('🗑️ Récurrente supprimée');
    goBack('#/recurrentes');
  });
}

// Création des échéances arrivées à date. Seulement sur des données à jour (synchro faite, ou pas de Drive) :
// un appareil en retard pourrait sinon recréer une échéance déjà créée puis corrigée sur un autre.
async function runRecurrences() {
  if (drive.configured() && drive.status.state !== 'ok') return;
  const n = await recur.generateDue();
  if (!n) return;
  toast(`🔁 ${plural(n, 'opération récurrente ajoutée', 'opérations récurrentes ajoutées')}`);
  refreshListView();
}

// ---------- Écran : statistiques ----------
const statsUi = { tab: 'cat', period: {}, acc: '', cat: '' };
const STATS_TABS = [['cat', '🏷️ Catégories'], ['mois', '📅 Par mois'], ['one', '🔎 Une catégorie'], ['soldes', '📈 Soldes'], ['int', '💰 Intérêts']];
const DEFAULT_PERIOD = { cat: 'm12', mois: 'm12', one: 'm36', soldes: 'all', int: 'all' };
const NO_CAT = 'sans'; // « sans catégorie » dans l'adresse
const shortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const pct = (v, total) => (total ? `${Math.round(v * 100 / total)} %` : '');
const catName = k => (k ? store.idx.cat.get(k)?.name ?? '?' : 'Sans catégorie');
const sum = arr => arr.reduce((s, v) => s + v, 0);
// Une émoticône par grande catégorie, d'après son nom (l'ordre compte : « Prêt auto » est un prêt, pas une voiture).
const CAT_EMOJI = [
  [/pret|banque|frais bancaires/, '🏦'], [/aliment|courses/, '🛒'], [/restaurant|bar/, '🍽️'], [/maison/, '🏠'], [/deco/, '🛋️'],
  [/sante/, '🩺'], [/vetement|chaussure/, '👕'], [/voyage|vacance/, '✈️'], [/enfant/, '🧸'], [/ecole/, '🎓'], [/sport/, '⚽'],
  [/loisir/, '🎬'], [/cadeau/, '🎁'], [/esthetique/, '💅'], [/telephon/, '📱'], [/impot/, '🧾'], [/parking/, '🅿️'],
  [/peugeot|audi|seat|tesla|voiture|auto|carbur/, '🚗'], [/assurance/, '🛡️'], [/revenu|salaire/, '💼'], [/allocation/, '👨‍👩‍👧'],
  [/interet/, '📈'], [/vente/, '🏷️'], [/rembours/, '↩️'], [/odr/, '🎟️'], [/economie|epargne|livret/, '🐷'],
  [/approvisionnement|virement/, '🔄'], [/retrait|especes/, '💵'], [/crypto/, '🪙'], [/invest/, '📊'], [/carte/, '💳'], [/divers/, '📦'],
];
const catEmoji = name => CAT_EMOJI.find(([re]) => re.test(norm(name)))?.[1] ?? '🏷️';
const catTitle = k => `${catEmoji(catName(k))} ${catName(k)}`;
let statsArgs = null;

function firstEntryDate() {
  let min = store.todayStr();
  for (const list of store.idx.byAcc.values()) if (list.length && list[0].date < min) min = list[0].date;
  return min;
}

function periodOptions(tab) {
  const today = store.todayStr();
  const Y = +today.slice(0, 4), M = +today.slice(5, 7);
  const monthStart = back => store.todayStr(new Date(Y, M - 1 - back, 1));
  const first = firstEntryDate();
  const opts = [];
  if (tab === 'cat') {
    opts.push({ id: 'cur', label: 'Ce mois-ci', from: monthStart(0), to: today, unit: 'month' });
    opts.push({ id: 'prev', label: 'Le mois dernier', from: monthStart(1), to: store.todayStr(new Date(Y, M - 1, 0)), unit: 'month' });
  }
  opts.push({ id: 'm12', label: '12 derniers mois', from: monthStart(11), to: today, unit: 'month' });
  if (tab === 'one' || tab === 'soldes') opts.push({ id: 'm36', label: '3 dernières années', from: monthStart(35), to: today, unit: 'month' });
  for (let y = Y; y >= +first.slice(0, 4); y--) {
    opts.push({ id: `y${y}`, label: `Année ${y}`, from: `${y}-01-01`, to: y === Y ? today : `${y}-12-31`, unit: 'month' });
  }
  opts.push({ id: 'all', label: 'Depuis le début', from: first, to: today, unit: tab === 'soldes' ? 'month' : 'year' });
  return opts;
}

const bucketCats = bks => bks.map(b => (b.key.length === 4
  ? { key: b.key, short: b.key, long: b.key }
  : { key: b.key, short: shortMonth.format(new Date(+b.key.slice(0, 4), +b.key.slice(5, 7) - 1, 1)), long: monthLabel(b.from) }));

const tiles = list => `<div class="tiles">${list.map(([label, html]) => `
  <div class="tile"><span class="label">${esc(label)}</span><span class="val">${html}</span></div>`).join('')}</div>`;

// Tableau dépliable. Les colonnes de montants perdent leur « € », rappelé dans l'en-tête : plus étroit sur un téléphone.
const tableView = (head, rows) => {
  const euro = head.map((_, j) => rows.length > 0 && rows.every(r => /\s€$/.test(r[j])));
  const cell = (c, j) => (euro[j] ? String(c).replace(/\s€$/, '') : c);
  return `<details class="viz-table"><summary>Voir le tableau</summary><div class="table-wrap"><table>
  <thead><tr>${head.map((h, j) => `<th scope="col">${esc(h)}${euro[j] ? ' (€)' : ''}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((c, j) => `<td>${esc(cell(c, j))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
};

// Barres classées : rows = [{ key, mag (centimes, positif), cls ('in' | 'out'), name, text, href? }].
function rankCard(title, rows, total) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(r => r.mag)) || 1; // lignes pas forcément triées par montant (années)
  return `<section class="card"><h2>${esc(title)}</h2><div class="rank">${rows.map(r => {
    const tag = r.href ? 'a' : 'div';
    return `<${tag} class="rank-row"${r.href ? ` href="${r.href}"` : ''}>
      <span class="rank-head"><span class="rank-name">${esc(r.name)}</span><span class="rank-val">${esc(r.text)}<small> · ${pct(r.mag, total)}</small></span></span>
      <span class="rank-track"><span class="rank-bar ${r.cls}" style="width:${Math.max(0.5, r.mag * 100 / max).toFixed(2)}%"></span></span>
    </${tag}>`;
  }).join('')}</div></section>`;
}

function topExpenseCat(accIds, reps) {
  const p = periodOptions('one').find(o => o.id === 'm12');
  const net = stats.sumBy(stats.pick(accIds, p.from, p.to), e => stats.groupKey(e.cat));
  let best = '', min = 0;
  for (const [k, v] of net) if (k && v < min) { min = v; best = k; }
  return reps.get(best) || [...reps.values()][0] || '';
}

function viewStats(drill) {
  if (!store.idx.acc.size) return location.replace('#/');
  const key = drill === NO_CAT ? '' : drill;
  if (key && !store.idx.cat.has(key)) return location.replace('#/statistiques');
  const tab = drill == null ? statsUi.tab : 'cat';
  setHeader(drill == null ? 'Statistiques' : catTitle(key), true);
  view.innerHTML = `
    ${drill == null ? `<div class="toolbar">${STATS_TABS.map(([id, label]) => `
      <button type="button" class="chip ${tab === id ? 'on' : ''}" data-action="stats-tab" data-tab="${id}" aria-pressed="${tab === id}">${label}</button>`).join('')}</div>` : ''}
    <div class="toolbar filters" id="st-filters"></div>
    <div id="st-body"></div>`;
  renderStats(tab, drill == null ? null : key);
}

function renderStats(tab = statsArgs[0], key = statsArgs[1]) {
  statsArgs = [tab, key];
  const opts = periodOptions(tab);
  const p = opts.find(o => o.id === (statsUi.period[tab] ?? DEFAULT_PERIOD[tab])) ?? opts.find(o => o.id === DEFAULT_PERIOD[tab]);
  const accs = [...store.idx.acc.values()].sort((a, b) => a.pos - b.pos);
  if (statsUi.acc && !store.idx.acc.has(statsUi.acc)) statsUi.acc = '';
  const accIds = statsUi.acc ? [statsUi.acc] : accs.map(a => a.id);
  const reps = stats.groupReps();
  if (tab === 'one') {
    statsUi.cat = store.idx.cat.has(statsUi.cat) ? reps.get(stats.groupKey(statsUi.cat, 'sub')) : topExpenseCat(accIds, reps);
  }

  const cats = [...reps.values()].map(id => store.idx.cat.get(id)).sort((a, b) => catLabel(a.id).localeCompare(catLabel(b.id), 'fr'));
  $('#st-filters').innerHTML = `
    <select id="st-period" aria-label="Période">${opts.map(o => `<option value="${o.id}" ${o.id === p.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
    <select id="st-acc" aria-label="Comptes"><option value="">Tous les comptes</option>${accs.map(a => `
      <option value="${a.id}" ${a.id === statsUi.acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    ${tab === 'one' ? `<select id="st-cat" aria-label="Catégorie">${[['D', 'Dépenses'], ['R', 'Recettes']].map(([t, label]) => `
      <optgroup label="${label}">${cats.filter(c => c.type === t).map(c => `
        <option value="${c.id}" ${c.id === statsUi.cat ? 'selected' : ''}>${esc(catLabel(c.id))}</option>`).join('')}</optgroup>`).join('')}</select>` : ''}`;
  $('#st-period').onchange = ev => { statsUi.period[tab] = ev.target.value; renderStats(); };
  $('#st-acc').onchange = ev => { statsUi.acc = ev.target.value; renderStats(); };
  if (tab === 'one') $('#st-cat').onchange = ev => { statsUi.cat = ev.target.value; renderStats(); };

  const body = $('#st-body');
  const scope = `${p.label} · ${statsUi.acc ? store.idx.acc.get(statsUi.acc).name : 'tous les comptes'}`;
  if (key != null) return statsDrill(body, key, p, accIds, scope, reps);
  ({ cat: statsCategories, mois: statsMonths, one: statsOneCat, soldes: statsBalances, int: statsInterests })[tab](body, p, accIds, scope, reps);
}

// Intérêts reçus : recettes de la catégorie « Intérêts » (ou d'une de ses sous-catégories), sur tous les comptes, épargne ou non.
function statsInterests(body, p, accIds) {
  const isInterest = e => store.idx.cat.get(e.cat)?.type === 'R' && /interet/.test(norm(catLabel(e.cat)));
  const ents = stats.pick(accIds, p.from, p.to).filter(isInterest);
  if (!ents.length) { body.innerHTML = '<p class="empty">Aucun intérêt reçu sur cette période.</p>'; return; }
  const total = sum(ents.map(e => e.amt));
  const byAcc = [...stats.sumBy(ents, e => e.acc)].sort((a, b) => b[1] - a[1]);
  const byYear = [...stats.sumBy(ents, e => e.date.slice(0, 4))].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const accRows = byAcc.map(([id, v]) => ({ key: id, mag: v, cls: 'in', name: store.idx.acc.get(id)?.name ?? '?', text: money(v), href: `#/compte/${id}` }));
  const yearRows = byYear.map(([y, v]) => ({ key: y, mag: v, cls: 'in', name: y, text: money(v) }));
  body.innerHTML = `
    ${tiles([['Intérêts reçus', `<span class="amt pos">${money(total)}</span>`], ['Comptes concernés', String(byAcc.length)]])}
    ${rankCard('Intérêts par compte', accRows, total)}
    ${byYear.length > 1 ? rankCard('Intérêts par année', yearRows, total) : ''}
    <p class="hint">Opérations de la catégorie « Intérêts » : pour qu'un versement d'intérêts soit compté, donnez-lui cette catégorie. Touchez un compte pour l'ouvrir.</p>`;
}

function statsCategories(body, p, accIds, scope, reps) {
  const entries = stats.pick(accIds, p.from, p.to);
  if (!entries.length) { body.innerHTML = '<p class="empty">Aucune opération sur cette période.</p>'; return; }
  const net = [...stats.sumBy(entries, e => stats.groupKey(e.cat))];
  const row = ([k, v]) => {
    const id = reps.get(k) ?? '';
    return { key: k, mag: Math.abs(v), cls: v < 0 ? 'out' : 'in', name: catTitle(id), text: money(Math.abs(v)), href: `#/statistiques/categorie/${id || NO_CAT}` };
  };
  const outs = net.filter(([, v]) => v < 0).map(row).sort((a, b) => b.mag - a.mag);
  const ins = net.filter(([, v]) => v > 0).map(row).sort((a, b) => b.mag - a.mag);
  const tOut = sum(outs.map(r => r.mag)), tIn = sum(ins.map(r => r.mag));
  body.innerHTML = `
    ${tiles([['Recettes nettes', money(tIn)], ['Dépenses nettes', money(tOut)], ['Différence', `<span class="amt ${negClass(tIn - tOut)}">${signed(tIn - tOut)}</span>`]])}
    ${rankCard('Dépenses nettes par catégorie', outs, tOut)}
    ${rankCard('Recettes nettes par catégorie', ins, tIn)}
    <p class="hint">Montants nets : remboursements déduits, virements entre vos comptes annulés. Touchez une catégorie pour le détail.</p>`;
}

function statsDrill(body, key, p, accIds, scope, reps) {
  const gk = stats.groupKey(key);
  const ents = stats.pick(accIds, p.from, p.to).filter(e => stats.groupKey(e.cat) === gk)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const net = sum(ents.map(e => e.amt));
  const subKey = e => { const s = stats.groupKey(e.cat, 'sub'); return s === gk ? '' : s; };
  const subs = [...stats.sumBy(ents, subKey)]
    .map(([k, v]) => ({ key: k, mag: Math.abs(v), cls: v < 0 ? 'out' : 'in', text: signed(v),
      name: k ? catName(reps.get(k)) : key ? `${catName(key)} (sans sous-catégorie)` : 'Sans catégorie' }))
    .sort((a, b) => b.mag - a.mag);
  const LIMIT = 200;
  body.innerHTML = `
    <section class="card">
      <span class="label">${esc(scope)}</span>
      <span class="amt big ${negClass(net)}">${signed(net)}</span>
      ${key ? `<div class="stack"><button type="button" class="btn ghost" data-action="stats-cat-time" data-cat="${key}">Voir mois par mois</button></div>` : ''}
    </section>
    ${subs.length > 1 ? rankCard('Par sous-catégorie', subs, sum(subs.map(r => r.mag))) : ''}
    <h2>${plural(ents.length, 'opération', 'opérations')}</h2>
    ${ents.length ? `<div class="list">${ents.slice(0, LIMIT).map(e => `
      <a class="acc" href="#/operation/${e.id}">
        <span class="acc-main"><span class="acc-name">${esc(e.title || '(sans libellé)')}</span>
          <span class="acc-bank">${esc([fullDate(e.date), store.idx.acc.get(e.acc)?.name, subKey(e) ? catName(e.cat) : ''].filter(Boolean).join(' · '))}</span></span>
        <span class="acc-bal"><span class="amt ${e.amt > 0 ? 'pos' : ''}">${signed(e.amt)}</span></span>
      </a>`).join('')}</div>` : '<p class="empty">Aucune opération sur cette période.</p>'}
    ${ents.length > LIMIT ? `<p class="hint">Seules les ${LIMIT} plus récentes sont affichées.</p>` : ''}`;
}

function statsMonths(body, p, accIds, scope) {
  const bks = stats.buckets(p.from, p.to, p.unit);
  const byBucket = new Map(bks.map(b => [b.key, []]));
  for (const e of stats.pick(accIds, p.from, p.to)) byBucket.get(stats.bucketKey(e.date, p.unit))?.push(e);
  const io = bks.map(b => stats.inOut(byBucket.get(b.key)));
  const ins = io.map(x => x.in), outs = io.map(x => x.out);
  const cats = bucketCats(bks);
  const per = p.unit === 'year' ? 'année' : 'mois';
  body.innerHTML = `
    ${tiles([['Recettes nettes', money(sum(ins))], ['Dépenses nettes', money(sum(outs))], ['Différence', `<span class="amt ${negClass(sum(ins) - sum(outs))}">${signed(sum(ins) - sum(outs))}</span>`]])}
    <section class="card">
      <h2>Recettes et dépenses nettes par ${per}</h2>
      <p class="muted">${esc(scope)}</p>
      <div class="legend"><span><i class="in"></i>Recettes</span><span><i class="out"></i>Dépenses</span></div>
      <div class="viz" id="viz"></div>
      ${tableView([per === 'mois' ? 'Mois' : 'Année', 'Recettes', 'Dépenses', 'Différence'], cats.map((c, i) => [c.long, money(ins[i]), money(outs[i]), signed(ins[i] - outs[i])]))}
    </section>`;
  stats.renderColumns($('#viz'), {
    cats, fmt: money, label: `Recettes et dépenses nettes par ${per}`,
    series: [{ name: 'Recettes', cls: 's-in', color: '--viz-in', values: ins }, { name: 'Dépenses', cls: 's-out', color: '--viz-out', values: outs }],
  });
}

function statsOneCat(body, p, accIds, scope) {
  const c = store.idx.cat.get(statsUi.cat);
  if (!c) { body.innerHTML = '<p class="empty">Aucune catégorie.</p>'; return; }
  const isRoot = stats.rootOf(c.id) === c.id;
  const gk = stats.groupKey(c.id, 'sub');
  const sign = c.type === 'R' ? 1 : -1;
  const bks = stats.buckets(p.from, p.to, p.unit);
  const totals = new Map(bks.map(b => [b.key, 0]));
  for (const e of stats.pick(accIds, p.from, p.to)) {
    if (stats.groupKey(e.cat, isRoot ? 'root' : 'sub') !== gk) continue;
    const k = stats.bucketKey(e.date, p.unit);
    if (totals.has(k)) totals.set(k, totals.get(k) + sign * e.amt);
  }
  const values = bks.map(b => totals.get(b.key));
  const cats = bucketCats(bks);
  const per = p.unit === 'year' ? 'année' : 'mois';
  const what = c.type === 'R' ? 'Recettes nettes' : 'Dépenses nettes';
  body.innerHTML = `
    ${tiles([['Total', money(sum(values))], [`Moyenne par ${per}`, money(Math.round(sum(values) / values.length))]])}
    <section class="card">
      <h2>${esc(catLabel(c.id))}</h2>
      <p class="muted">${what} par ${per} · ${esc(scope)}</p>
      <div class="viz" id="viz"></div>
      ${tableView([per === 'mois' ? 'Mois' : 'Année', what], cats.map((x, i) => [x.long, money(values[i])]))}
    </section>`;
  stats.renderColumns($('#viz'), {
    cats, fmt: money, label: `${catLabel(c.id)} : ${what.toLowerCase()} par ${per}`,
    series: [{ name: what, cls: c.type === 'R' ? 's-in' : 's-out', color: c.type === 'R' ? '--viz-in' : '--viz-out', values }],
  });
}

function statsBalances(body, p, accIds, scope) {
  const bks = stats.buckets(p.from, p.to, 'month');
  const values = stats.balanceSeries(accIds, bks);
  const d = new Date(+p.from.slice(0, 4), +p.from.slice(5, 7) - 1, +p.from.slice(8, 10) - 1);
  const start = stats.balanceSeries(accIds, [{ to: store.todayStr(d) }])[0];
  const last = values[values.length - 1];
  const cats = bucketCats(bks);
  body.innerHTML = `
    ${tiles([[`Solde au ${fullDate(p.to)}`, `<span class="amt ${negClass(last)}">${money(last)}</span>`], ['Évolution sur la période', `<span class="amt ${negClass(last - start)}">${signed(last - start)}</span>`]])}
    <section class="card">
      <h2>Solde en fin de mois</h2>
      <p class="muted">${esc(scope)}</p>
      <div class="viz" id="viz"></div>
      ${tableView(['Mois', 'Solde'], cats.map((c, i) => [c.long, money(values[i])]))}
    </section>`;
  stats.renderLine($('#viz'), { cats, values, fmt: money, name: 'Solde', label: 'Solde en fin de mois' });
}

// Les graphiques sont dessinés à la largeur de l'écran : on les redessine quand elle change.
let lastWidth = innerWidth, resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    if (statsArgs && $('#viz')) renderStats();
  }, 200);
});

// ---------- Écran : création / modification d'un compte ----------
function viewAccountForm(id) {
  const a = id ? store.idx.acc.get(id) : null;
  if (id && !a) return location.replace('#/');
  setHeader(a ? 'Modifier le compte' : 'Nouveau compte', true);
  const n = a ? (store.idx.byAcc.get(a.id)?.length ?? 0) : 0;
  view.innerHTML = `
    <form id="f" class="form card" autocomplete="off" novalidate>
      <label class="field"><span>Nom du compte</span><input name="name" required value="${esc(a?.name)}"></label>
      <label class="field"><span>Banque</span><input name="bank" value="${esc(a?.bank)}"></label>
      <label class="field"><span>Type de compte</span><select name="kind">
        <option value="courant" ${a && accKind(a) === 'courant' ? 'selected' : ''}>💳 Compte courant</option>
        <option value="epargne" ${a && accKind(a) === 'epargne' ? 'selected' : ''}>🐷 Épargne</option>
      </select></label>
      <label class="field" id="alert-field" ${a && accKind(a) === 'epargne' ? 'hidden' : ''}>
        <span>Seuil d'alerte <em>(⚠️ si le solde prévu en fin de mois passe dessous ; 0 si vide, négatif si découvert)</em></span>
        <input name="alert" inputmode="decimal" placeholder="0,00" value="${a?.alert ? (a.alert < 0 ? '-' : '') + amountInput(a.alert) : ''}"></label>
      <label class="check"><input type="checkbox" name="top" ${a?.top ? 'checked' : ''}> Toujours en haut de sa section sur l'accueil</label>
      ${a ? `<label class="check"><input type="checkbox" name="closed" ${a.closed ? 'checked' : ''}> Compte clôturé (rangé à part dans la liste)</label>`
        : '<label class="field"><span>Solde initial <em>(facultatif, négatif si découvert)</em></span><input name="init" inputmode="decimal" placeholder="0,00"></label>'}
      <div class="actions">
        <button class="btn primary" type="submit">Enregistrer</button>
        ${a ? `<button class="btn danger" type="button" id="del">${n ? `Supprimer avec ses ${plural(n, 'opération', 'opérations')}` : 'Supprimer'}</button>` : ''}
      </div>
      ${a && n ? '<p class="hint">Supprimer efface aussi ses opérations, y compris des statistiques. Pour seulement le ranger à part, cochez « clôturé ».</p>' : ''}
    </form>`;
  const f = $('#f');
  const F = f.elements;
  F.kind.addEventListener('change', () => { $('#alert-field').hidden = F.kind.value !== 'courant'; });
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = F.name.value.trim();
    if (!name) { toast('Indiquez un nom.'); return F.name.focus(); }
    let alertAmt = 0;
    if (F.alert.value.trim()) {
      alertAmt = parseAmount(F.alert.value);
      if (Number.isNaN(alertAmt)) { toast("Seuil d'alerte invalide."); return F.alert.focus(); }
      if (F.alert.value.trim().startsWith('-')) alertAmt = -alertAmt;
    }
    let init = 0;
    if (!a && F.init.value.trim()) {
      init = parseAmount(F.init.value);
      if (Number.isNaN(init)) { toast('Solde initial invalide.'); return F.init.focus(); }
      if (F.init.value.trim().startsWith('-')) init = -init;
    }
    const maxPos = Math.max(-1, ...[...store.idx.acc.values()].map(x => x.pos));
    const rec = { ...(a ?? { id: store.newId(), pos: maxPos + 1 }), name, bank: F.bank.value.trim(), kind: F.kind.value };
    if (a) { if (F.closed.checked) rec.closed = true; else delete rec.closed; }
    if (F.top.checked) rec.top = true; else delete rec.top;
    if (alertAmt) rec.alert = alertAmt; else delete rec.alert;
    await store.upsert('accounts', rec);
    if (init) {
      await store.upsert('entries', { id: store.newId(), acc: rec.id, date: store.todayStr(), amt: init, title: 'SOLDE INITIAL', init: true, chk: true });
    }
    toast(a ? '✏️ Compte modifié' : '🎉 Compte créé');
    if (a) goBack(`#/compte/${rec.id}`); else location.replace(`#/compte/${rec.id}`);
  });
  $('#del')?.addEventListener('click', async () => {
    const msg = n
      ? `Supprimer le compte « ${a.name} » et ses ${plural(n, 'opération', 'opérations')} ?\n`
        + 'Elles disparaîtront aussi des statistiques, et ses opérations récurrentes seront supprimées. C\'est irréversible.'
      : `Supprimer le compte « ${a.name} » ?`;
    if (!confirm(msg)) return;
    // Ses opérations, ses récurrentes (avec l'autre moitié de ses virements récurrents), puis le compte lui-même.
    const orders = recur.activeOrders();
    const exists = new Set(orders.map(o => o.id));
    const orderIds = new Set(orders.filter(o => o.acc === a.id).flatMap(o => [o.id, o.pair]).filter(oid => exists.has(oid)));
    await store.upsertMany([
      ...(store.idx.byAcc.get(a.id) ?? []).map(e => ['entries', { id: e.id, del: true }]),
      ...[...orderIds].map(oid => ['orders', { id: oid, del: true }]),
      ['accounts', { id: a.id, del: true }],
    ]);
    toast('🗑️ Compte supprimé');
    location.replace('#/');
  });
}

// ---------- Écran : réglages ----------
const SYNC_TEXT = {
  local: 'Non configurée',
  login: 'Connexion Google nécessaire',
  syncing: 'Synchronisation en cours…',
  ok: 'À jour',
  offline: 'Hors ligne : les modifications seront envoyées au retour du réseau',
  error: 'Erreur',
};

function renderSyncCard() {
  const card = $('#sync-card');
  if (!card) return;
  const s = store.syncState;
  const st = drive.status;
  card.innerHTML = `
    <h2>☁️ Synchronisation Google Drive</h2>
    ${drive.configured() ? `
      <p>État : <strong>${esc(SYNC_TEXT[st.state] ?? st.state)}</strong>${st.message && st.state === 'error' ? ` — ${esc(st.message)}` : ''}</p>
      <p class="muted">Dernière synchronisation : ${s.lastSync ? dateTime(s.lastSync) : 'jamais'}${store.isDirty() ? ' · des modifications attendent d\'être envoyées' : ''}</p>
      <div class="stack">
        ${st.state === 'login' ? '<button class="btn primary" data-action="drive-login">Se connecter à Google</button>'
          : '<button class="btn ghost" data-action="drive-sync">Synchroniser maintenant</button><button class="btn ghost" data-action="drive-logout">Se déconnecter</button>'}
      </div>`
    : `<p class="muted">Pas encore configurée : vos données sont enregistrées dans ce navigateur uniquement.
        Il faut renseigner l'identifiant Google dans <code>js/config.js</code>.</p>`}`;
}

function renderDataCard() {
  const card = $('#data-card');
  if (!card) return;
  const counts = store.data
    ? `${plural(store.idx.acc.size, 'compte', 'comptes')} · ${plural(store.idx.entry.size, 'opération', 'opérations')} · ${plural(store.idx.cat.size, 'catégorie', 'catégories')} · ${plural(store.data.orders.filter(o => !o.del).length, 'opération récurrente', 'opérations récurrentes')}`
    : 'Aucune donnée.';
  card.innerHTML = `
    <h2>💾 Données et copie de sauvegarde</h2>
    <p class="muted">${counts}</p>
    <button class="btn ghost" data-action="export" ${store.data ? '' : 'disabled'}>Télécharger une copie (JSON)</button>`;
}

function renderTicketCard() {
  const card = $('#ticket-card');
  if (!card) return;
  const key = ticket.getKey();
  card.innerHTML = `
    <h2>📸 Lecture des tickets (Gemini)</h2>
    <p class="muted">Pour remplir une opération à partir d'une photo de ticket ou d'une capture d'écran.
      Créez une clé gratuite, sans carte bancaire, sur
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>
      (« Create API key »), puis collez-la ici. Elle reste sur cet appareil ; la photo est envoyée à Google pour être lue.</p>
    ${key
      ? `<p>Clé enregistrée sur cet appareil (elle se termine par <code>${esc(key.slice(-4))}</code>).</p>
        <button class="btn ghost" data-action="ticket-key-del">Supprimer la clé</button>`
      : `<form id="key-form" class="stack" autocomplete="off">
          <input name="key" type="password" placeholder="Clé API Gemini" aria-label="Clé API Gemini" autocomplete="off" spellcheck="false">
          <button class="btn primary" type="submit">Enregistrer la clé</button>
        </form>`}`;
  $('#key-form')?.addEventListener('submit', ev => {
    ev.preventDefault();
    const value = ev.target.elements.key.value.trim();
    if (!value) return;
    ticket.setKey(value);
    toast('Clé enregistrée');
    renderTicketCard();
  });
}

function viewSettings() {
  setHeader('Réglages', true);
  view.innerHTML = `
    <section class="card" id="sync-card"></section>
    <section class="card" id="ticket-card"></section>
    <section class="card">
      <h2>📥 Importer une sauvegarde</h2>
      <p class="muted">Sauvegarde JSON de MaxiComptes, ou copie téléchargée depuis cette appli. <strong>Remplace toutes les données actuelles</strong>, ici et sur le Drive.</p>
      <input type="file" id="imp" accept=".json,application/json" aria-label="Fichier de sauvegarde">
      <div id="imp-report"></div>
    </section>
    <section class="card" id="data-card"></section>`;
  renderSyncCard();
  renderTicketCard();
  renderDataCard();

  $('#imp').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const out = $('#imp-report');
    if (store.idx.entry.size && !confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) {
      ev.target.value = '';
      return;
    }
    out.innerHTML = '<p class="report">Import en cours…</p>';
    try {
      const { data, report } = convertBackup(parseBackupText(await file.text()));
      await store.replaceAll(data);
      out.innerHTML = `<div class="report"><strong>Import terminé.</strong><br>
        ${plural(report.accounts, 'compte', 'comptes')}, ${plural(report.categories, 'catégorie', 'catégories')},
        ${plural(report.entries, 'opération', 'opérations')}, ${plural(report.orders, 'opération récurrente', 'opérations récurrentes')}.
        ${report.ignoredEntries ? `<br>Ignorées : ${plural(report.ignoredEntries, 'opération', 'opérations')} de comptes supprimés dans MaxiComptes.` : ''}
        ${report.ignoredSplits ? `<br>${plural(report.ignoredSplits, 'opération ventilée', 'opérations ventilées')} : seule la première catégorie est gardée.` : ''}</div>`;
    } catch (err) {
      out.innerHTML = `<p class="report error">Import impossible : ${esc(err.message)}</p>`;
    }
    ev.target.value = '';
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(store.data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `comptes-${store.todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Actions (délégation des clics) ----------
const actions = {
  async chk(el) {
    const e = store.idx.entry.get(el.closest('[data-id]').dataset.id);
    if (!e) return;
    const rec = { ...e };
    if (rec.chk) delete rec.chk; else rec.chk = true;
    await store.upsert('entries', rec);
    el.classList.toggle('on', !!rec.chk);
    el.setAttribute('aria-pressed', String(!!rec.chk));
    el.setAttribute('aria-label', rec.chk ? 'Dépointer' : 'Pointer');
    renderSummary(rec.acc);
  },
  'toggle-unchk'(el) {
    const ui = acctUi[currentAccId];
    ui.unchk = !ui.unchk;
    ui.limit = PAGE;
    el.classList.toggle('on', ui.unchk);
    el.setAttribute('aria-pressed', String(ui.unchk));
    renderOps(currentAccId);
  },
  more() {
    acctUi[currentAccId].limit += 200;
    renderOps(currentAccId);
  },
  'search-more'() {
    searchUi.limit += 200;
    renderSearch();
  },
  fold(el) {
    const { folded } = acctUi[currentAccId];
    const m = el.dataset.m;
    const topH = $('.top').offsetHeight;
    const stuck = el.getBoundingClientRect().top <= topH + 1; // en-tête collé en haut : on était au milieu du mois
    if (!folded.delete(m)) folded.add(m);
    renderOps(currentAccId);
    const b = $(`.month[data-m="${m}"]`);
    b.focus({ preventScroll: true });
    // Replié depuis le milieu du mois : on remonte à son en-tête plutôt que de se retrouver plus loin dans la liste.
    if (stuck) {
      b.style.position = 'static';
      const y = b.getBoundingClientRect().top + scrollY;
      b.style.position = '';
      scrollTo(0, y - topH);
    }
  },
  select() {
    opSel = opSel ? null : { acc: currentAccId, ids: new Set(), shown: [] };
    const chip = $('.chip[data-action="select"]');
    chip.classList.toggle('on', !!opSel);
    chip.setAttribute('aria-pressed', String(!!opSel));
    renderOps(currentAccId);
  },
  sel(el) {
    const id = el.dataset.id;
    const on = !opSel.ids.has(id);
    if (on) opSel.ids.add(id); else opSel.ids.delete(id);
    el.classList.toggle('picked', on);
    el.setAttribute('aria-checked', String(on));
    renderSelBar();
  },
  // « Tout » coche les opérations affichées (celles de la recherche ou du filtre en cours) ; « Aucune » les décoche.
  'sel-all'() {
    const all = opSel.shown.every(id => opSel.ids.has(id));
    for (const id of opSel.shown) { if (all) opSel.ids.delete(id); else opSel.ids.add(id); }
    renderOps(currentAccId);
  },
  async 'sel-delete'() {
    const list = [...opSel.ids].map(id => store.idx.entry.get(id)).filter(Boolean);
    if (!list.length) return;
    // Comme pour une seule opération : l'autre moitié d'un virement est supprimée avec elle.
    const ids = new Set(list.map(e => e.id));
    let pairs = 0;
    for (const e of list) {
      if (e.pair && store.idx.entry.has(e.pair) && !ids.has(e.pair)) { ids.add(e.pair); pairs++; }
    }
    const total = list.reduce((s, e) => s + e.amt, 0);
    if (!confirm(`Supprimer ${plural(list.length, 'opération', 'opérations')} (total ${signed(total)}) ?`
      + (pairs ? `\n${plural(pairs, 'virement', 'virements')} : l'opération inverse sur l'autre compte sera supprimée aussi.` : ''))) return;
    await store.upsertMany([...ids].map(id => ['entries', { id, del: true }]));
    opSel = null;
    toast(`🗑️ ${plural(list.length, 'opération supprimée', 'opérations supprimées')}`);
    viewAccount(currentAccId);
  },
  'stats-tab'(el) {
    statsUi.tab = el.dataset.tab;
    viewStats(null);
  },
  'stats-cat-time'(el) {
    statsUi.tab = 'one';
    statsUi.cat = el.dataset.cat;
    location.hash = '#/statistiques';
  },
  statement() {
    if (!ticket.getKey()) {
      toast("Ajoutez d'abord votre clé Gemini dans les Réglages.");
      location.hash = '#/reglages';
      return;
    }
    $('#stmt').click();
  },
  'home-tab'(el) {
    homeTab = el.dataset.tab;
    try { localStorage.setItem(HOME_TAB, homeTab); } catch { /* stockage indisponible : l'onglet ne sera pas retenu */ }
    viewAccounts();
  },
  'ticket-key-del'() {
    if (!confirm('Supprimer la clé Gemini de cet appareil ?')) return;
    ticket.setKey('');
    renderTicketCard();
  },
  'drive-login': () => drive.signIn().catch(err => toast(err.message)),
  'drive-sync': () => drive.sync(),
  'drive-logout': () => drive.signOut(),
  export: () => exportJson(),
};

view.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  ev.preventDefault();
  actions[el.dataset.action](el, ev);
});
// Au clavier, Espace ou Entrée coche la ligne d'opération qui a le focus.
view.addEventListener('keydown', ev => {
  if ((ev.key === ' ' || ev.key === 'Enter') && ev.target.matches('.op[data-action="sel"]')) {
    ev.preventDefault();
    actions.sel(ev.target);
  }
});

// ---------- Pastille de synchronisation ----------
const PILL = {
  login: 'Se connecter', syncing: 'Synchro…', ok: 'Synchronisé', pending: 'En attente',
  offline: 'Hors ligne', error: 'Erreur de synchro',
};
function updatePill() {
  const pill = $('#sync');
  let st = drive.status.state;
  if (st === 'ok' && store.isDirty()) st = 'pending';
  pill.hidden = st === 'local';
  pill.dataset.state = st;
  pill.textContent = PILL[st] ?? '';
}
$('#sync').addEventListener('click', () => {
  if (drive.status.state === 'login') drive.signIn().catch(err => toast(err.message));
  else location.hash = '#/reglages';
});

// ---------- Démarrage ----------
async function start() {
  try {
    await store.load();
  } catch {
    view.innerHTML = '<p class="empty">Ce navigateur ne permet pas d\'enregistrer les données (navigation privée ?).</p>';
    return;
  }
  store.onChange(kind => {
    titleIndex = null;
    if (kind === 'local' || kind === 'replace') drive.scheduleSync(kind === 'replace' ? 0 : 2000);
    if (kind === 'remote' || kind === 'replace') refreshListView();
    renderSide();
    updatePill();
  });
  drive.onStatus(s => {
    updatePill();
    renderSyncCard();
    if (!store.idx.acc.size && /^#\/?$/.test(currentHash)) render();
    if (s.state === 'ok') runRecurrences();
  });
  render();
  drive.init();
  updatePill();
  if (!drive.configured()) runRecurrences();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
