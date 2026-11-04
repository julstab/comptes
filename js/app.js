// Interface : liste des comptes, opérations d'un compte, saisie, réglages.
import * as store from './store.js';
import * as drive from './drive.js';
import { convertBackup, parseBackupText } from './import.js';
import * as recur from './recur.js';

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
  [/^#\/recurrentes$/, () => viewOrders()],
  [/^#\/recurrente\/(\w+)$/, id => viewOrderForm(id)],
  [/^#\/nouvelle-recurrente$/, () => viewOrderForm(null)],
  [/^#\/reglages$/, () => viewSettings()],
];

function render() {
  const hash = location.hash || '#/';
  const route = routes.find(([re]) => re.test(hash));
  if (!route) return location.replace('#/');
  route[1](...hash.match(route[0]).slice(1));
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
  render();
});
$('#back').addEventListener('click', () => goBack());

// Re-dessine l'écran courant (après une synchro) s'il ne contient pas de formulaire en cours.
function refreshListView() {
  if (currentHash === '#/reglages') return renderDataCard();
  if (/^#\/?$|^#\/compte\/\w+$|^#\/recurrentes$/.test(currentHash)) {
    scrollMem.set(currentHash, scrollY);
    render();
  }
}

// ---------- Écran : liste des comptes ----------
function viewAccounts() {
  setHeader('Comptes', false);
  if (!store.idx.acc.size) {
    view.innerHTML = `
      <section class="empty-state">
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
  const accs = [...store.idx.acc.values()].sort((a, b) => a.pos - b.pos);
  const card = a => {
    const b = store.balances(a.id, today);
    return `<a class="acc" href="#/compte/${a.id}">
      <span class="acc-main"><span class="acc-name">${esc(a.name)}</span><span class="acc-bank">${esc(a.bank)}</span></span>
      <span class="acc-bal"><span class="amt ${negClass(b.now)}">${money(b.now)}</span>
        ${b.all !== b.now ? `<span class="sub">à venir : ${money(b.all)}</span>` : ''}</span>
    </a>`;
  };
  const open = accs.filter(a => !a.closed);
  const closed = accs.filter(a => a.closed);
  const total = open.reduce((s, a) => s + store.balances(a.id, today).now, 0);
  const running = recur.activeOrders().filter(o => store.idx.acc.has(o.acc) && recur.nextDue(o)).length;
  view.innerHTML = `
    <section class="total"><span class="label">Total des comptes ouverts</span><span class="amt big ${negClass(total)}">${money(total)}</span></section>
    <div class="list">${open.map(card).join('')}</div>
    <div class="list"><a class="acc" href="#/recurrentes">
      <span class="acc-main"><span class="acc-name">Opérations récurrentes</span><span class="acc-bank">${plural(running, 'en cours', 'en cours')}</span></span>
      <span class="acc-bal sub" aria-hidden="true">›</span>
    </a></div>
    ${closed.length ? `<details class="closed"><summary>Comptes clôturés (${closed.length})</summary><div class="list">${closed.map(card).join('')}</div></details>` : ''}
    <a class="btn ghost block" href="#/nouveau-compte">+ Nouveau compte</a>`;
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
  view.innerHTML = `
    <section class="summary" id="summary"></section>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Rechercher : libellé, catégorie, montant…" value="${esc(ui.q)}" aria-label="Rechercher">
      <button type="button" class="chip ${ui.unchk ? 'on' : ''}" data-action="toggle-unchk" aria-pressed="${ui.unchk}">Non pointées</button>
      <a class="chip" href="#/compte/${id}/modifier">Modifier le compte</a>
    </div>
    <div id="ops"></div>
    <a class="fab" href="#/nouvelle-operation/${id}" aria-label="Nouvelle opération">${ICON_PLUS}</a>`;
  renderSummary(id);
  renderOps(id);
  let t;
  $('#q').addEventListener('input', ev => {
    clearTimeout(t);
    t = setTimeout(() => { ui.q = ev.target.value; ui.limit = PAGE; renderOps(id); }, 150);
  });
}

function renderSummary(id) {
  const b = store.balances(id);
  $('#summary').innerHTML = `
    <span class="label">Solde aujourd'hui</span><span class="amt big ${negClass(b.now)}">${money(b.now)}</span>
    <div class="row2">
      <div><span class="label">Solde pointé</span><span class="amt ${negClass(b.chk)}">${money(b.chk)}</span></div>
      <div><span class="label">Avec les opérations à venir</span><span class="amt ${negClass(b.all)}">${money(b.all)}</span></div>
    </div>`;
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
  const shown = rows.slice(0, ui.limit);
  const today = store.todayStr();

  let html = '';
  let month = '';
  for (const e of shown) {
    const m = e.date.slice(0, 7);
    if (m !== month) { month = m; html += `<h3 class="month">${monthLabel(e.date)}</h3>`; }
    const meta = [dayMonth(e.date), catLabel(e.cat), e.mode].filter(Boolean).map(esc).join(' · ');
    html += `<div class="op ${e.date > today ? 'future' : ''}" data-id="${e.id}">
      <button type="button" class="chk ${e.chk ? 'on' : ''}" data-action="chk" aria-pressed="${!!e.chk}" aria-label="${e.chk ? 'Dépointer' : 'Pointer'}"></button>
      <a class="op-main" href="#/operation/${e.id}">
        <span class="op-title">${esc(e.title || '(sans libellé)')}</span>
        <span class="op-meta">${e.date > today ? '<span class="tag">À venir</span> · ' : ''}${meta}</span>
      </a>
      <span class="op-amt"><span class="amt ${e.amt > 0 ? 'pos' : ''}">${signed(e.amt)}</span><span class="sub">${money(running.get(e.id))}</span></span>
    </div>`;
  }
  $('#ops').innerHTML = rows.length
    ? `<div class="list">${html}</div>${rows.length > shown.length
      ? `<button type="button" class="btn ghost block" data-action="more">Afficher plus (${plural(rows.length - shown.length, 'restante', 'restantes')})</button>` : ''}`
    : `<p class="empty">${q || ui.unchk ? 'Aucune opération ne correspond.' : 'Aucune opération sur ce compte.'}</p>`;
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

function viewEntryForm(id, accId) {
  const e = id ? store.idx.entry.get(id) : null;
  if (id && !e) return location.replace('#/');
  const acc = e ? e.acc : accId;
  if (!store.idx.acc.has(acc)) return location.replace('#/');
  setHeader(e ? "Modifier l'opération" : 'Nouvelle opération', true);
  const type = e && e.amt > 0 ? 'R' : 'D';
  const defaultMode = (store.data?.modes ?? []).includes('Carte') ? 'Carte' : '';

  view.innerHTML = `
    <form id="f" class="form card" autocomplete="off" novalidate>
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
      <label class="field"><span>Catégorie</span><select name="cat">${catOptions(type, e?.cat, true)}</select></label>
      <label class="field"><span>Compte</span><select name="acc">${accOptions(acc)}</select></label>
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

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const title = F.title.value.trim();
    const cents = parseAmount(F.amt.value);
    if (!title) { toast('Indiquez un libellé.'); return F.title.focus(); }
    if (!(cents > 0)) { toast('Montant invalide.'); return F.amt.focus(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(F.date.value)) { toast('Date invalide.'); return F.date.focus(); }
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
    await store.upsert('entries', rec);
    toast(e ? 'Opération modifiée' : 'Opération ajoutée');
    goBack(`#/compte/${rec.acc}`);
  });

  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer l'opération « ${e.title} » (${signed(e.amt)}) ?`)) return;
    await store.remove('entries', e.id);
    toast('Opération supprimée');
    goBack(`#/compte/${e.acc}`);
  });
}

// ---------- Écrans : opérations récurrentes ----------
const FREQS = [[1, 'Tous les mois'], [2, 'Tous les 2 mois'], [3, 'Tous les 3 mois'], [6, 'Tous les 6 mois'], [12, 'Tous les ans']];
const fullDate = d => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const rhythm = o => {
  const f = o.freq || 1;
  return `le ${o.day}${f === 1 ? ' de chaque mois' : f === 12 ? ', tous les ans' : `, tous les ${f} mois`}`;
};

function viewOrders() {
  setHeader('Opérations récurrentes', true);
  const orders = recur.activeOrders().filter(o => store.idx.acc.has(o.acc));
  const byId = new Map(orders.map(o => [o.id, o]));
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
  view.innerHTML = `
    <p class="hint">Le jour de l'échéance, l'opération est ajoutée au compte. Corrigez-la ensuite si la date ou le montant réel diffère.</p>
    ${running.length ? `<div class="list">${byAccount(running)}</div>` : '<p class="empty">Aucune opération récurrente en cours.</p>'}
    ${ended.length ? `<details class="closed"><summary>Terminées (${ended.length})</summary><div class="list">${byAccount(ended)}</div></details>` : ''}
    <a class="fab" href="#/nouvelle-recurrente" aria-label="Nouvelle opération récurrente">${ICON_PLUS}</a>`;
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
    <form id="f" class="form card" autocomplete="off" novalidate>
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
      <label class="field"><span>Catégorie</span><select name="cat">${catOptions(type, o?.cat, true)}</select></label>
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
    toast(o ? 'Récurrente modifiée' : 'Récurrente créée');
    goBack('#/recurrentes');
    runRecurrences();
  });

  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer la récurrente « ${o.title} »${p ? ' et l\'opération inverse sur l\'autre compte' : ''} ?\nLes opérations déjà créées sont conservées.`)) return;
    const items = [['orders', { id: o.id, del: true }]];
    if (p) items.push(['orders', { id: p.id, del: true }]);
    await store.upsertMany(items);
    toast('Récurrente supprimée');
    goBack('#/recurrentes');
  });
}

// Création des échéances arrivées à date. Seulement sur des données à jour (synchro faite, ou pas de Drive) :
// un appareil en retard pourrait sinon recréer une échéance déjà créée puis corrigée sur un autre.
async function runRecurrences() {
  if (drive.configured() && drive.status.state !== 'ok') return;
  const n = await recur.generateDue();
  if (!n) return;
  toast(plural(n, 'opération récurrente ajoutée', 'opérations récurrentes ajoutées'));
  refreshListView();
}

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
      ${a ? `<label class="check"><input type="checkbox" name="closed" ${a.closed ? 'checked' : ''}> Compte clôturé (rangé à part dans la liste)</label>`
        : '<label class="field"><span>Solde initial <em>(facultatif, négatif si découvert)</em></span><input name="init" inputmode="decimal" placeholder="0,00"></label>'}
      <div class="actions">
        <button class="btn primary" type="submit">Enregistrer</button>
        ${a && !n ? '<button class="btn danger" type="button" id="del">Supprimer</button>' : ''}
      </div>
      ${a && n ? `<p class="hint">Ce compte contient ${plural(n, 'opération', 'opérations')} : il ne peut pas être supprimé. Cochez « clôturé » pour le ranger à part.</p>` : ''}
    </form>`;
  const f = $('#f');
  const F = f.elements;
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = F.name.value.trim();
    if (!name) { toast('Indiquez un nom.'); return F.name.focus(); }
    let init = 0;
    if (!a && F.init.value.trim()) {
      init = parseAmount(F.init.value);
      if (Number.isNaN(init)) { toast('Solde initial invalide.'); return F.init.focus(); }
      if (F.init.value.trim().startsWith('-')) init = -init;
    }
    const maxPos = Math.max(-1, ...[...store.idx.acc.values()].map(x => x.pos));
    const rec = { ...(a ?? { id: store.newId(), pos: maxPos + 1 }), name, bank: F.bank.value.trim() };
    if (a) { if (F.closed.checked) rec.closed = true; else delete rec.closed; }
    await store.upsert('accounts', rec);
    if (init) {
      await store.upsert('entries', { id: store.newId(), acc: rec.id, date: store.todayStr(), amt: init, title: 'SOLDE INITIAL', init: true, chk: true });
    }
    toast(a ? 'Compte modifié' : 'Compte créé');
    if (a) goBack(`#/compte/${rec.id}`); else location.replace(`#/compte/${rec.id}`);
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer le compte « ${a.name} » ?`)) return;
    await store.remove('accounts', a.id);
    toast('Compte supprimé');
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
    <h2>Synchronisation Google Drive</h2>
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
    <h2>Données et copie de sauvegarde</h2>
    <p class="muted">${counts}</p>
    <button class="btn ghost" data-action="export" ${store.data ? '' : 'disabled'}>Télécharger une copie (JSON)</button>`;
}

function viewSettings() {
  setHeader('Réglages', true);
  view.innerHTML = `
    <section class="card" id="sync-card"></section>
    <section class="card">
      <h2>Importer une sauvegarde</h2>
      <p class="muted">Sauvegarde JSON de MaxiComptes, ou copie téléchargée depuis cette appli. <strong>Remplace toutes les données actuelles</strong>, ici et sur le Drive.</p>
      <input type="file" id="imp" accept=".json,application/json" aria-label="Fichier de sauvegarde">
      <div id="imp-report"></div>
    </section>
    <section class="card" id="data-card"></section>`;
  renderSyncCard();
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
