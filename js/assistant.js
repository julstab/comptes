// Assistant : conversation avec Gemini sur les comptes, en lecture seule.
// Gemini ne reçoit pas les données d'avance : il appelle les fonctions ci-dessous, exécutées ici sur les données de
// l'appareil, et ne reçoit que leurs résultats. Les montants sont donc calculés par l'appli, pas par Gemini.
import * as store from './store.js';
import * as stats from './stats.js';
import * as recur from './recur.js';
import { generate } from './ticket.js';

// Gemini 4 Hydrogen : nouvelle génération, offre gratuite, meilleur raisonnement que Flash-Lite (gardé pour les tickets).
const MODEL = 'gemini-4-hydrogen';

let h = null; // fonctions de l'appli : catLabel, accKind, monthEnd
export const init = helpers => { h = helpers; };

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const eur = c => Math.round(c) / 100; // centimes → euros
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

// Comptes dont le nom ou la banque contient le texte donné ; erreur explicite (avec la liste) si aucun.
function pickAccounts(name) {
  const all = [...store.idx.acc.values()].sort((a, b) => a.pos - b.pos);
  if (!name) return all;
  const q = norm(name);
  const hit = all.filter(a => norm(a.name).includes(q) || norm(a.bank).includes(q));
  if (!hit.length) throw new Error(`Aucun compte ne correspond à « ${name} ». Comptes : ${all.map(a => a.name).join(', ')}.`);
  return hit;
}

const opOut = e => ({
  date: e.date, compte: store.idx.acc.get(e.acc)?.name, libelle: e.title || '(sans libellé)',
  categorie: h.catLabel(e.cat) || undefined, mode: e.mode || undefined, montant: eur(e.amt), pointee: !!e.chk,
});

const TOOLS = {
  lister_comptes: {
    description: "Liste les comptes avec leurs soldes : pointé (celui de la banque), du jour (opérations saisies non pointées comprises), avec les opérations à venir, et fin du mois prévue (comptes courants : opérations et récurrentes encore à venir ce mois-ci).",
    parameters: { type: 'object', properties: {} },
    run() {
      const today = store.todayStr();
      return {
        aujourdhui: today,
        comptes: pickAccounts().map(a => {
          const b = store.balances(a.id, today), kind = h.accKind(a);
          return {
            nom: a.name, banque: a.bank || undefined, type: kind === 'epargne' ? 'épargne' : 'courant', cloture: a.closed || undefined,
            solde_pointe: eur(b.chk), solde_du_jour: eur(b.now), solde_avec_operations_a_venir: eur(b.all),
            ...(kind === 'courant' && !a.closed ? { fin_du_mois_prevue: eur(h.monthEnd(a, today).total) } : {}),
          };
        }),
      };
    },
  },

  chercher_operations: {
    description: "Cherche des opérations, les plus récentes d'abord. Renvoie le nombre et les totaux de toutes celles qui correspondent, et le détail des premières.",
    parameters: {
      type: 'object',
      properties: {
        texte: { type: 'string', description: 'Mots cherchés dans le libellé, la catégorie, le mode de paiement ou la référence (tous doivent y être).' },
        compte: { type: 'string', description: 'Nom (ou partie du nom) du compte ou de sa banque.' },
        categorie: { type: 'string', description: 'Nom (ou partie) de la catégorie, au format « Catégorie › Sous-catégorie ».' },
        du: { type: 'string', description: 'Date de début incluse, AAAA-MM-JJ.' },
        au: { type: 'string', description: 'Date de fin incluse, AAAA-MM-JJ.' },
        sens: { type: 'string', enum: ['depense', 'recette'] },
        montant_min: { type: 'number', description: 'Montant minimal en euros, sans signe.' },
        montant_max: { type: 'number', description: 'Montant maximal en euros, sans signe.' },
        pointee: { type: 'boolean', description: 'true : seulement les opérations pointées ; false : seulement les non pointées.' },
        limite: { type: 'integer', description: "Nombre d'opérations détaillées : 30 par défaut, 100 au plus." },
      },
    },
    run(a) {
      const words = norm(a.texte).split(/\s+/).filter(Boolean);
      const cat = norm(a.categorie);
      const min = a.montant_min != null ? Math.round(a.montant_min * 100) : null;
      const max = a.montant_max != null ? Math.round(a.montant_max * 100) : null;
      const found = [];
      for (const acc of pickAccounts(a.compte)) {
        for (const e of store.idx.byAcc.get(acc.id) ?? []) {
          if (e.init) continue;
          if (isDay(a.du) && e.date < a.du) continue;
          if (isDay(a.au) && e.date > a.au) continue;
          if (a.sens === 'depense' && e.amt >= 0) continue;
          if (a.sens === 'recette' && e.amt <= 0) continue;
          if (min != null && Math.abs(e.amt) < min) continue;
          if (max != null && Math.abs(e.amt) > max) continue;
          if (a.pointee != null && !!e.chk !== !!a.pointee) continue;
          if (cat && !norm(h.catLabel(e.cat)).includes(cat)) continue;
          if (words.length) {
            const text = norm(`${e.title} ${h.catLabel(e.cat)} ${e.mode ?? ''} ${e.ref ?? ''}`);
            if (!words.every(w => text.includes(w))) continue;
          }
          found.push(e);
        }
      }
      found.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
      const limit = Math.min(100, Math.max(1, a.limite ?? 30));
      const out = found.filter(e => e.amt < 0).reduce((s, e) => s - e.amt, 0);
      const inn = found.filter(e => e.amt > 0).reduce((s, e) => s + e.amt, 0);
      return {
        nombre: found.length, total: eur(inn - out), total_depenses: eur(out), total_recettes: eur(inn),
        operations: found.slice(0, limit).map(opOut),
        ...(found.length > limit ? { note: `${found.length - limit} autres opérations non détaillées` } : {}),
      };
    },
  },

  totaux: {
    description: "Totaux nets des opérations d'une période, regroupés par catégorie, sous-catégorie, mois, année, compte ou libellé. Nets : les remboursements viennent en déduction ; quand tous les comptes sont inclus, les virements entre comptes s'annulent.",
    parameters: {
      type: 'object',
      properties: {
        du: { type: 'string', description: 'Date de début incluse, AAAA-MM-JJ.' },
        au: { type: 'string', description: 'Date de fin incluse, AAAA-MM-JJ.' },
        regrouper_par: { type: 'string', enum: ['categorie', 'sous_categorie', 'mois', 'annee', 'compte', 'libelle'] },
        compte: { type: 'string', description: 'Limiter à un compte (nom ou partie du nom). Tous les comptes sinon.' },
        categorie: { type: 'string', description: 'Limiter à une catégorie (nom ou partie).' },
        sens: { type: 'string', enum: ['depense', 'recette'], description: "Limiter aux dépenses ou aux recettes (montants bruts, sans compensation)." },
      },
      required: ['du', 'au', 'regrouper_par'],
    },
    run(a) {
      if (!isDay(a.du) || !isDay(a.au)) throw new Error('Dates attendues au format AAAA-MM-JJ.');
      const reps = stats.groupReps();
      const cat = norm(a.categorie);
      let ents = stats.pick(pickAccounts(a.compte).map(x => x.id), a.du, a.au);
      if (cat) ents = ents.filter(e => norm(h.catLabel(e.cat)).includes(cat));
      if (a.sens === 'depense') ents = ents.filter(e => e.amt < 0);
      if (a.sens === 'recette') ents = ents.filter(e => e.amt > 0);
      const name = k => (k ? h.catLabel(reps.get(k)) || k : 'Sans catégorie');
      const by = {
        categorie: e => [stats.groupKey(e.cat), k => name(k)],
        sous_categorie: e => [stats.groupKey(e.cat, 'sub'), k => name(k)],
        mois: e => [e.date.slice(0, 7)],
        annee: e => [e.date.slice(0, 4)],
        compte: e => [e.acc, k => store.idx.acc.get(k)?.name ?? k],
        libelle: e => [norm(e.title), () => e.title || '(sans libellé)'],
      }[a.regrouper_par];
      if (!by) throw new Error('regrouper_par inconnu.');
      const groups = new Map();
      for (const e of ents) {
        const [k, label] = by(e);
        const g = groups.get(k) ?? { groupe: label ? label(k) : k, net: 0, depenses: 0, recettes: 0, nombre: 0 };
        g.net += e.amt; g.nombre++;
        if (e.amt < 0) g.depenses -= e.amt; else g.recettes += e.amt;
        groups.set(k, g);
      }
      const chrono = a.regrouper_par === 'mois' || a.regrouper_par === 'annee';
      const list = [...groups.entries()].sort(chrono ? (x, y) => (x[0] < y[0] ? -1 : 1) : (x, y) => Math.abs(y[1].net) - Math.abs(x[1].net))
        .map(([, g]) => ({ groupe: g.groupe, net: eur(g.net), depenses: eur(g.depenses), recettes: eur(g.recettes), nombre: g.nombre }));
      const out = ents.filter(e => e.amt < 0).reduce((s, e) => s - e.amt, 0);
      const inn = ents.filter(e => e.amt > 0).reduce((s, e) => s + e.amt, 0);
      return {
        du: a.du, au: a.au, nombre: ents.length, total_net: eur(inn - out), total_depenses: eur(out), total_recettes: eur(inn),
        groupes: list.slice(0, 80), ...(list.length > 80 ? { note: `${list.length - 80} autres groupes non détaillés` } : {}),
      };
    },
  },

  solde_a_date: {
    description: "Solde d'un ou plusieurs comptes à la fin d'une date : toutes les opérations saisies jusqu'à cette date, pointées ou non.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'AAAA-MM-JJ.' },
        compte: { type: 'string', description: 'Nom (ou partie du nom) du compte. Tous les comptes ouverts sinon.' },
      },
      required: ['date'],
    },
    run(a) {
      if (!isDay(a.date)) throw new Error('Date attendue au format AAAA-MM-JJ.');
      const accs = pickAccounts(a.compte).filter(x => a.compte || !x.closed);
      return {
        date: a.date,
        comptes: accs.map(x => ({ nom: x.name, solde: eur((store.idx.byAcc.get(x.id) ?? []).filter(e => e.date <= a.date).reduce((s, e) => s + e.amt, 0)) })),
      };
    },
  },

  lister_recurrentes: {
    description: "Liste les opérations récurrentes (abonnements, prélèvements, salaires…) avec leur montant, leur rythme et leur prochaine échéance, et le coût mensuel moyen de celles en cours.",
    parameters: { type: 'object', properties: {} },
    run() {
      const list = recur.activeOrders().filter(o => store.idx.acc.has(o.acc)).map(o => {
        const next = recur.nextDue(o);
        return {
          libelle: o.title, compte: store.idx.acc.get(o.acc).name, montant: eur(o.amt), jour_du_mois: o.day,
          tous_les_n_mois: o.freq || 1, prochaine_echeance: next || undefined, terminee: next ? undefined : true,
          fin: o.end || undefined, categorie: h.catLabel(o.cat) || undefined, mode: o.mode || undefined,
        };
      });
      const monthly = list.filter(o => !o.terminee).reduce((s, o) => s + o.montant / o.tous_les_n_mois, 0);
      return { recurrentes: list, moyenne_mensuelle_en_cours: Math.round(monthly * 100) / 100 };
    },
  },

  lister_categories: {
    description: 'Liste les catégories de dépenses et de recettes, au format « Catégorie › Sous-catégorie ».',
    parameters: { type: 'object', properties: {} },
    run() {
      const cats = [...store.idx.cat.values()].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
      return {
        depenses: cats.filter(c => c.type === 'D').map(c => h.catLabel(c.id)),
        recettes: cats.filter(c => c.type === 'R').map(c => h.catLabel(c.id)),
      };
    },
  },
};

const DECLARATIONS = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, parameters: t.parameters }));

// Ce qu'affiche l'appli pendant que Gemini consulte les données.
const STEPS = {
  lister_comptes: 'Je regarde vos comptes…', chercher_operations: 'Je cherche les opérations…', totaux: 'Je calcule les totaux…',
  solde_a_date: 'Je calcule le solde…', lister_recurrentes: 'Je regarde les opérations récurrentes…', lister_categories: 'Je regarde les catégories…',
};

function instructions() {
  const today = store.todayStr();
  const long = new Date(`${today}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Tu es l'assistant de « Comptes », l'application où l'utilisateur suit ses comptes bancaires personnels. Nous sommes le ${long} (${today}).
- Réponds en français, brièvement, en Markdown simple : gras, listes, et au besoin un petit tableau de 3 colonnes au plus.
- Pour tout chiffre, appelle les fonctions : n'invente jamais un montant, une date ni une opération. Les fonctions donnent des montants en euros ; négatif = dépense, positif = recette. Écris les montants à la française : 1 234,56 €.
- Le « solde » d'un compte est son solde pointé, celui que la banque affiche. Le solde du jour compte aussi les opérations saisies pas encore pointées ; la fin du mois prévue ajoute ce qui reste à passer ce mois-ci.
- Les catégories ont la forme « Catégorie › Sous-catégorie » : en cas de doute sur un nom, appelle lister_categories. Les totaux par catégorie sont nets (remboursements déduits, virements entre comptes annulés).
- Si la question est ambiguë (période, compte), prends l'hypothèse la plus naturelle, dis-la en une phrase et réponds.
- Tu ne peux rien modifier. Si on te demande de saisir, modifier ou supprimer quelque chose, dis que l'assistant ne fait que consulter, et que cela se fait dans l'appli (bouton ＋ pour saisir, ou la page du compte).`;
}

// Pose une question. history : la conversation au format de Gemini (complétée ici, remise en l'état en cas d'erreur).
// onStep(texte) : étape en cours (« Je cherche les opérations… »). Renvoie la réponse de Gemini (Markdown).
export async function ask(history, question, onStep) {
  const start = history.length;
  history.push({ role: 'user', parts: [{ text: question }] });
  try {
    for (let round = 0; round < 8; round++) {
      const res = await generate({
        systemInstruction: { parts: [{ text: instructions() }] },
        contents: history,
        tools: [{ functionDeclarations: DECLARATIONS }],
      }, MODEL);
      const content = res?.candidates?.[0]?.content;
      if (!content?.parts?.length) {
        const why = res?.candidates?.[0]?.finishReason ?? res?.promptFeedback?.blockReason;
        throw new Error(`Gemini n'a pas répondu${why ? ` (${why})` : ''} : reformulez la question.`);
      }
      // Tel quel, avec les « signatures de pensée » que Gemini 3 exige de retrouver dans la suite de la conversation.
      history.push({ role: 'model', ...content });
      const calls = content.parts.filter(p => p.functionCall);
      if (!calls.length) {
        return content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim()
          || "Je n'ai pas trouvé de réponse : reformulez la question.";
      }
      const parts = calls.map(({ functionCall: fc }) => {
        onStep?.(STEPS[fc.name] ?? 'Je consulte vos comptes…');
        let response;
        try {
          response = TOOLS[fc.name] ? TOOLS[fc.name].run(fc.args ?? {}) : { erreur: `Fonction inconnue : ${fc.name}` };
        } catch (err) {
          response = { erreur: err.message };
        }
        return { functionResponse: { name: fc.name, response, ...(fc.id ? { id: fc.id } : {}) } };
      });
      history.push({ role: 'user', parts });
    }
    throw new Error("Gemini n'a pas abouti : reformulez la question plus simplement.");
  } catch (err) {
    history.length = start; // la question sans réponse ne reste pas dans la conversation
    throw err;
  }
}
