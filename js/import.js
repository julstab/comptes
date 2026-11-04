// Conversion d'une sauvegarde JSON de MaxiComptes (ou d'une copie exportée par l'appli) vers le format de l'appli.
import { newId, DEFAULT_MODES } from './store.js';

const day = s => String(s ?? '').slice(0, 10);
const cents = n => Math.round((Number(n) || 0) * 100);

export function parseBackupText(text) {
  return JSON.parse(text.replace(/^﻿/, ''));
}

export function convertBackup(raw) {
  if (raw?.format === 'comptes') return convertOwnCopy(raw);
  return convertMaxiComptes(raw);
}

function convertOwnCopy(raw) {
  for (const c of ['accounts', 'categories', 'entries', 'orders']) {
    if (!Array.isArray(raw[c])) throw new Error('Copie de sauvegarde incomplète.');
  }
  const live = arr => arr.filter(r => !r.del).length;
  return {
    data: raw,
    report: {
      accounts: live(raw.accounts), categories: live(raw.categories),
      entries: live(raw.entries), orders: live(raw.orders), ignoredEntries: 0, ignoredSplits: 0,
    },
  };
}

export function convertMaxiComptes(raw) {
  if (!Array.isArray(raw?.bankaccount) || !Array.isArray(raw?.bankaccountingentry)) {
    throw new Error("Ce fichier n'est pas une sauvegarde JSON de MaxiComptes.");
  }
  // MaxiComptes ne supprime rien physiquement : on ignore tout ce qui est marqué supprimé.
  const live = arr => (arr ?? []).filter(r => !r.Deleted);
  const ids = new Map();
  const idOf = guid => {
    let id = ids.get(guid);
    if (!id) ids.set(guid, (id = newId()));
    return id;
  };

  const accRows = live(raw.bankaccount).sort((a, b) => a.Pos - b.Pos);
  const accSet = new Set(accRows.map(r => r.IdKey));
  const accounts = accRows.map((r, i) => ({
    id: idOf(r.IdKey), name: r.Title || r.Name || 'Compte', bank: r.Name || '', pos: i,
  }));

  // ItemType 1 = dépense, 2 = recette ; IdItem = catégorie parente (égal à IdKey pour une catégorie racine).
  const catRows = live(raw.bankitem);
  const catSet = new Set(catRows.map(r => r.IdKey));
  const categories = catRows
    .sort((a, b) => a.ItemType - b.ItemType || a.Pos - b.Pos)
    .map(r => {
      const c = { id: idOf(r.IdKey), name: r.Title, type: r.ItemType === 2 ? 'R' : 'D', pos: r.Pos };
      if (r.IdItem && r.IdItem !== r.IdKey && catSet.has(r.IdItem)) c.parent = idOf(r.IdItem);
      return c;
    });

  // Catégorie de chaque opération (table de ventilation ; une seule catégorie par opération en pratique).
  const catOfEntry = new Map();
  const itemCount = new Map();
  for (const it of live(raw.bankaccountingentryitems)) {
    if (!catSet.has(it.IdItem)) continue;
    itemCount.set(it.IdEntry, (itemCount.get(it.IdEntry) ?? 0) + 1);
    if (!catOfEntry.has(it.IdEntry)) catOfEntry.set(it.IdEntry, idOf(it.IdItem));
  }

  const orderRows = live(raw.bankorder).filter(r => accSet.has(r.IdBank));
  const orderSet = new Set(orderRows.map(r => r.IdKey));

  let ignoredEntries = 0, ignoredSplits = 0;
  const entryRows = [];
  for (const r of live(raw.bankaccountingentry)) {
    if (accSet.has(r.IdBank)) entryRows.push(r); else ignoredEntries++;
  }
  entryRows.sort((a, b) => day(a.DateOfEntry).localeCompare(day(b.DateOfEntry)) || String(a.AddDate).localeCompare(String(b.AddDate)));
  const entries = entryRows.map(r => {
    const e = { id: newId(), acc: idOf(r.IdBank), date: day(r.DateOfEntry), amt: cents(r.Amount), title: String(r.Title ?? '').trim() };
    if (r.EntryType) e.mode = r.EntryType;
    if (r.Reference && r.Reference !== r.Title) e.ref = r.Reference;
    const cat = catOfEntry.get(r.IdKey);
    if (cat) e.cat = cat;
    if ((itemCount.get(r.IdKey) ?? 0) > 1) ignoredSplits++;
    if (r.Checked) e.chk = true;
    if (r.IsBalance) e.init = true;
    if (r.IdOrder && orderSet.has(r.IdOrder)) e.ord = idOf(r.IdOrder);
    if (r.Comment) e.note = r.Comment;
    return e;
  });

  // Opérations récurrentes : OrderType 1 = débit, 2 = crédit ; IdOrder relie les deux moitiés d'un virement interne.
  const orders = orderRows.map(r => {
    const o = {
      id: idOf(r.IdKey), acc: idOf(r.IdBank), title: r.Title || '',
      amt: (r.OrderType === 2 ? 1 : -1) * Math.abs(cents(r.EntryAmount)),
      day: r.TermDay, freq: r.MonthFrequency || 1, start: day(r.BeginDate), end: day(r.EndDate),
    };
    if (r.EntryType) o.mode = r.EntryType;
    if (r.EntryReference) o.ref = r.EntryReference;
    if (catSet.has(r.IdItem)) o.cat = idOf(r.IdItem);
    if (r.EntryChecked) o.chk = true;
    if (r.IdOrder && orderSet.has(r.IdOrder)) o.pair = idOf(r.IdOrder);
    return o;
  });

  const comboModes = String(raw.combodata?.[0]?.EntryType ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const data = {
    format: 'comptes', version: 1, dsid: newId(), created: new Date().toISOString(),
    source: { app: raw.backup?.appName ?? 'MaxiCompte', date: raw.backup?.backupDate ?? null },
    accounts, categories, entries, orders,
    modes: comboModes.length ? comboModes : [...DEFAULT_MODES],
  };
  return {
    data,
    report: {
      accounts: accounts.length, categories: categories.length, entries: entries.length,
      orders: orders.length, ignoredEntries, ignoredSplits,
    },
  };
}
