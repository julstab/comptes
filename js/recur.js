// Opérations récurrentes : calcul des échéances et création des opérations arrivées à échéance.
// Une récurrente o : { id, acc, title, amt, day, freq (en mois), start, end?, mode?, ref?, cat?, chk?, pair?, last? }
// last = date de la dernière échéance traitée ('' : aucune). Les opérations créées portent ord = o.id.
import * as store from './store.js';

const pad = n => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const ym = d => d.slice(0, 7);

export const activeOrders = () => (store.data?.orders ?? []).filter(o => !o.del);

// Échéances de o jusqu'à `until` inclus. Le jour est ramené au dernier jour des mois plus courts.
function* dueDates(o, until) {
  let y = +o.start.slice(0, 4), m = +o.start.slice(5, 7);
  for (;;) {
    const d = `${y}-${pad(m)}-${pad(Math.min(o.day, daysIn(y, m)))}`;
    if (d > until || (o.end && d > o.end)) return;
    if (d >= o.start) yield d;
    m += o.freq || 1;
    while (m > 12) { m -= 12; y++; }
  }
}

// Dernière échéance déjà traitée. Les récurrentes importées de MaxiComptes n'ont pas de champ last :
// MaxiComptes avait traité (créé, ou créé puis supprimé) toutes les échéances jusqu'à la date de la sauvegarde.
export function lastDone(o) {
  if (o.last !== undefined) return o.last;
  const upTo = store.data?.source?.date?.slice(0, 10);
  let last = '';
  if (upTo) for (const d of dueDates(o, upTo)) last = d;
  return last;
}

// Prochaine échéance à traiter, ou null si la récurrente est terminée.
export function nextDue(o) {
  const done = ym(lastDone(o));
  for (const d of dueDates(o, '9999-12-31')) if (ym(d) > done) return d;
  return null;
}

export const endOfMonth = d => `${d.slice(0, 8)}${pad(daysIn(+d.slice(0, 4), +d.slice(5, 7)))}`;

// Échéances du compte jusqu'à `until` dont l'opération n'est pas encore créée
// (y compris celles déjà passées, si la création n'a pas encore eu lieu sur cet appareil).
export function upcoming(accId, until) {
  const out = [];
  for (const o of activeOrders()) {
    if (o.acc !== accId) continue;
    const done = ym(lastDone(o));
    for (const d of dueDates(o, until)) {
      if (ym(d) > done && !store.idx.entry.has(o.id + d.slice(0, 7).replace('-', ''))) out.push({ date: d, title: o.title, amt: o.amt });
    }
  }
  return out;
}

// Crée les opérations des échéances passées (date <= aujourd'hui) pas encore traitées.
// L'identifiant de l'opération dépend de la récurrente et du mois : deux appareils qui créeraient
// la même échéance produisent le même enregistrement, sans doublon après fusion.
let running = null;
export function generateDue() {
  running ??= doGenerate().finally(() => (running = null));
  return running;
}

async function doGenerate() {
  const today = store.todayStr();
  const items = [];
  let created = 0;
  for (const o of activeOrders()) {
    if (!store.idx.acc.has(o.acc)) continue;
    const done = lastDone(o);
    let last = done;
    for (const d of dueDates(o, today)) {
      if (ym(d) <= ym(done)) continue;
      const id = o.id + d.slice(0, 7).replace('-', '');
      if (!store.idx.entry.has(id)) {
        const e = { id, acc: o.acc, date: d, amt: o.amt, title: o.title, ord: o.id };
        for (const k of ['mode', 'ref', 'cat']) if (o[k]) e[k] = o[k];
        if (o.chk) e.chk = true;
        items.push(['entries', e]);
        created++;
      }
      last = d;
    }
    if (last !== o.last && last !== '') items.push(['orders', { ...o, last }]);
  }
  if (items.length) await store.upsertMany(items);
  return created;
}
