// Statistiques : agrégats (montants nets par catégorie, par mois, soldes) et graphiques SVG.
// Montants en centimes. « Net » : pour chaque catégorie racine, recettes moins dépenses ;
// les virements entre comptes suivis s'annulent, les remboursements viennent en déduction.
import * as store from './store.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const pad = n => String(n).padStart(2, '0');

// ---------- Agrégats ----------
export function rootOf(id) {
  const c = id && store.idx.cat.get(id);
  if (!c) return '';
  return c.parent && store.idx.cat.has(c.parent) ? c.parent : c.id;
}

// Les catégories de MaxiComptes sont typées : « Santé » ou « Approvisionnement » existent en dépense ET en recette,
// avec deux identifiants. Les montants nets regroupent donc les catégories par nom :
// level 'root' → nom de la racine ; level 'sub' → « racine › sous-catégorie » (ou la racine seule).
const normName = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
export function groupKey(id, level = 'root') {
  const c = id && store.idx.cat.get(id);
  if (!c) return '';
  const r = store.idx.cat.get(rootOf(id));
  return level === 'root' || r.id === c.id ? normName(r.name) : `${normName(r.name)} › ${normName(c.name)}`;
}

// Une catégorie représentative par groupe (celle de dépense en priorité) : clé 'sub' → identifiant.
export function groupReps() {
  const reps = new Map();
  for (const c of store.idx.cat.values()) {
    const k = groupKey(c.id, 'sub');
    const cur = reps.get(k);
    if (!cur || (store.idx.cat.get(cur).type === 'R' && c.type === 'D')) reps.set(k, c.id);
  }
  return reps;
}

// Opérations des comptes choisis entre from et to inclus (hors soldes initiaux, sauf withInit).
export function pick(accIds, from, to, withInit = false) {
  const out = [];
  for (const id of accIds) {
    for (const e of store.idx.byAcc.get(id) ?? []) {
      if (e.date >= from && e.date <= to && (withInit || !e.init)) out.push(e);
    }
  }
  return out;
}

export function sumBy(entries, keyFn) {
  const m = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    m.set(k, (m.get(k) ?? 0) + e.amt);
  }
  return m;
}

// Dépenses et recettes nettes : chaque groupe de catégories compte du côté de son solde.
export function inOut(entries) {
  let out = 0, inn = 0;
  for (const v of sumBy(entries, e => groupKey(e.cat)).values()) {
    if (v < 0) out -= v; else inn += v;
  }
  return { in: inn, out };
}

// Découpage de [from, to] en mois ou en années ; le premier et le dernier seau sont coupés aux bornes.
export function buckets(from, to, unit) {
  const out = [];
  if (unit === 'year') {
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) out.push({ key: String(y), from: `${y}-01-01`, to: `${y}-12-31` });
  } else {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    for (;;) {
      const key = `${y}-${pad(m)}`;
      if (key > to.slice(0, 7)) break;
      out.push({ key, from: `${key}-01`, to: `${key}-${pad(new Date(y, m, 0).getDate())}` });
      if (++m > 12) { m = 1; y++; }
    }
  }
  for (const b of out) {
    if (b.from < from) b.from = from;
    if (b.to > to) b.to = to;
  }
  return out;
}

export const bucketKey = (date, unit) => (unit === 'year' ? date.slice(0, 4) : date.slice(0, 7));

// Solde des comptes choisis à la fin de chaque seau (soldes initiaux compris).
export function balanceSeries(accIds, bks) {
  const all = [];
  for (const id of accIds) for (const e of store.idx.byAcc.get(id) ?? []) all.push(e);
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let i = 0, sum = 0;
  return bks.map(b => {
    while (i < all.length && all[i].date <= b.to) sum += all[i++].amt;
    return sum;
  });
}

// ---------- Graphiques ----------
const compact = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// Graduations rondes : pas de 1, 2, 2,5 ou 5 × 10^n.
function niceScale(lo, hi, count = 4) {
  if (lo === hi) { lo = Math.min(lo, 0); hi = Math.max(hi, 100); }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  const big = Math.max(Math.abs(min), Math.abs(max)) >= 1000000; // 10 000 € et plus : notation compacte
  return { min, max, ticks, fmt: v => (big ? compact : whole).format(v / 100) };
}

// Libellés de l'axe horizontal : au plus un tous les ~38 px. Au-delà de 13 mois, seuls les mois de janvier portent l'année.
function xLabels(cats, plotW) {
  if (cats.length > 13 && cats[0].key.length === 7) {
    const jans = cats.filter(c => c.key.endsWith('-01')).length || 1;
    const step = Math.max(1, Math.ceil(jans * 38 / plotW));
    return cats.map(c => (c.key.endsWith('-01') && +c.key.slice(0, 4) % step === 0 ? c.key.slice(0, 4) : ''));
  }
  const every = Math.max(1, Math.ceil(cats.length * 38 / plotW));
  return cats.map((c, i) => (i % every === 0 ? c.short : ''));
}

function frame(el, scale, height) {
  const W = Math.max(240, el.clientWidth || 300), H = height;
  const labels = scale.ticks.map(scale.fmt);
  const M = { t: 14, r: 8, b: 26, l: 10 + Math.max(...labels.map(s => s.length)) * 6.3 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const y = v => M.t + ph * (scale.max - v) / (scale.max - scale.min);
  let svg = '';
  scale.ticks.forEach((t, i) => {
    svg += `<line class="${t === 0 ? 'base' : 'grid'}" x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}"/>`
      + `<text class="tick" x="${M.l - 6}" y="${y(t) + 4}" text-anchor="end">${esc(labels[i])}</text>`;
  });
  return { W, H, M, pw, ph, y, svg };
}

// Barre à bout arrondi (4 px) côté valeur, carrée côté ligne de base.
function barPath(x, w, y0, y1) {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

// Infobulle : la valeur d'abord, le nom de la série ensuite (textContent : les noms sont des données).
function tooltip(el, title, rows) {
  const tip = el.querySelector('.viz-tip');
  tip.replaceChildren();
  const b = document.createElement('b');
  b.textContent = title;
  tip.append(b);
  for (const r of rows) {
    const line = document.createElement('div');
    const key = document.createElement('i');
    key.style.background = `var(${r.color})`;
    const v = document.createElement('strong');
    v.textContent = r.value;
    const n = document.createElement('span');
    n.textContent = r.name;
    line.append(key, v, n);
    tip.append(line);
  }
  tip.hidden = false;
  return tip;
}

// Survol, toucher et clavier (flèches) : sélectionne la position i la plus proche.
function bindHover(el, n, xOf, onShow) {
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.viz-tip');
  let cur = n - 1;
  const show = i => {
    cur = Math.max(0, Math.min(n - 1, i));
    el.classList.add('hover');
    onShow(cur);
    const cx = xOf(cur), w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(el.clientWidth - w, cx - w / 2))}px`;
  };
  const hide = () => { el.classList.remove('hover'); tip.hidden = true; onShow(-1); };
  const fromPointer = ev => {
    const x = ev.clientX - svg.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i;
    show(best);
  };
  svg.addEventListener('pointermove', fromPointer);
  svg.addEventListener('pointerdown', fromPointer);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(cur));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft') show(cur - 1);
    else if (ev.key === 'ArrowRight') show(cur + 1);
    else return;
    ev.preventDefault();
  });
}

// Colonnes groupées. cats : [{ key, short, long }] ; series : [{ name, cls, color, values }] ; fmt : montant complet.
export function renderColumns(el, { cats, series, fmt, label, height = 230 }) {
  const all = series.flatMap(s => s.values);
  const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all));
  const f = frame(el, scale, height);
  const n = cats.length, k = series.length, band = f.pw / n;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - (k - 1) * 2) / k));
  const groupW = k * barW + (k - 1) * 2;
  const xOf = i => f.M.l + band * i + band / 2;
  let svg = f.svg;
  for (let i = 0; i < n; i++) {
    const x0 = xOf(i) - groupW / 2;
    svg += `<g class="bar" data-i="${i}">`;
    series.forEach((s, j) => {
      const d = barPath(x0 + j * (barW + 2), barW, f.y(0), f.y(s.values[i]));
      if (d) svg += `<path class="${s.cls}" d="${d}"/>`;
    });
    svg += '</g>';
  }
  xLabels(cats, f.pw).forEach((t, i) => {
    if (t) svg += `<text class="tick" x="${xOf(i)}" y="${f.H - 8}" text-anchor="middle">${esc(t)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" height="${f.H}" role="img" tabindex="0" aria-label="${esc(label)}">${svg}</svg><div class="viz-tip" hidden></div>`;
  const groups = el.querySelectorAll('g.bar');
  bindHover(el, n, xOf, i => {
    groups.forEach((g, gi) => g.classList.toggle('hl', gi === i));
    if (i >= 0) tooltip(el, cats[i].long, series.map(s => ({ color: s.color, value: fmt(s.values[i]), name: s.name })));
  });
}

// Courbe d'une seule série, avec un voile à 10 % et la dernière valeur écrite au bout.
export function renderLine(el, { cats, values, fmt, label, name, height = 230 }) {
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const f = frame(el, scale, height);
  const n = values.length;
  const xOf = i => (n === 1 ? f.M.l + f.pw / 2 : f.M.l + f.pw * i / (n - 1));
  const pts = values.map((v, i) => `${xOf(i).toFixed(1)},${f.y(v).toFixed(1)}`);
  const base = f.y(Math.max(scale.min, Math.min(0, scale.max)));
  let svg = f.svg;
  svg += `<path class="area" d="M${xOf(0)},${base}L${pts.join('L')}L${xOf(n - 1)},${base}Z"/>`;
  svg += `<path class="line" d="M${pts.join('L')}"/>`;
  svg += `<line class="cross" x1="0" x2="0" y1="${f.M.t}" y2="${f.M.t + f.ph}" visibility="hidden"/>`;
  svg += `<circle class="dot cursor" r="4" cx="0" cy="0" visibility="hidden"/>`;
  const lx = xOf(n - 1), ly = f.y(values[n - 1]);
  svg += `<circle class="dot" r="4" cx="${lx}" cy="${ly}"/>`;
  svg += `<text class="end" x="${lx}" y="${Math.max(12, ly - 10)}" text-anchor="end">${esc(fmt(values[n - 1]))}</text>`;
  xLabels(cats, f.pw).forEach((t, i) => {
    if (t) svg += `<text class="tick" x="${xOf(i)}" y="${f.H - 8}" text-anchor="middle">${esc(t)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" height="${f.H}" role="img" tabindex="0" aria-label="${esc(label)}">${svg}</svg><div class="viz-tip" hidden></div>`;
  const cross = el.querySelector('.cross'), cursor = el.querySelector('.cursor');
  bindHover(el, n, xOf, i => {
    const vis = i >= 0 ? 'visible' : 'hidden';
    cross.setAttribute('visibility', vis);
    cursor.setAttribute('visibility', vis);
    if (i < 0) return;
    cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i));
    cursor.setAttribute('cx', xOf(i)); cursor.setAttribute('cy', f.y(values[i]));
    tooltip(el, cats[i].long, [{ color: '--viz-in', value: fmt(values[i]), name }]);
  });
}
