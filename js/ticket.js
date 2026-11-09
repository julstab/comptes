// Lecture d'un ticket (photo ou capture d'écran) ou d'une phrase par l'API Gemini, offre gratuite.
// La clé API est propre à chaque appareil : elle reste dans le navigateur, jamais dans le code ni sur le Drive.
const KEY_STORE = 'comptes.geminiKey';
const MODEL = 'gemini-3.5-flash-lite';
const FALLBACK = 'gemini-3.1-flash-lite';
const endpoint = model => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// Gemini surchargé (erreur 5xx) : on réessaie seul, le même modèle après une pause, puis un autre modèle gratuit, qui a son propre quota.
const TRIES = [[MODEL, 0], [MODEL, 1500], [FALLBACK, 0], [FALLBACK, 3000]];

export const getKey = () => localStorage.getItem(KEY_STORE) ?? '';
export const setKey = k => (k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE));

const SCHEMA = {
  type: 'object',
  properties: {
    lisible: { type: 'boolean' },
    montant: { type: ['number', 'null'] },
    date: { type: ['string', 'null'] },
    commercant: { type: ['string', 'null'] },
    libelle_connu: { type: ['string', 'null'] },
    categorie: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'] },
    remboursement: { type: 'boolean' },
  },
  required: ['lisible', 'montant', 'date', 'commercant', 'libelle_connu', 'categorie', 'mode', 'remboursement'],
};

function prompt({ today, titles, categories, modes }) {
  return `Tu lis la photo d'un ticket de caisse, d'un ticket de carte bancaire, ou la capture d'écran d'un paiement.
Réponds uniquement par un objet JSON avec ces champs :
- lisible : false si l'image n'est pas un ticket ou une preuve de paiement lisible, sinon true.
- montant : le montant total payé en euros, nombre positif avec un point décimal (sur un ticket de carte bancaire : la ligne MONTANT). null si illisible.
- date : la date de l'opération au format AAAA-MM-JJ. Nous sommes le ${today} ; une année sur deux chiffres est en 20xx. null si absente.
- commercant : le nom du commerçant, écrit simplement (« CARREFOUR MARKET STRASBOURG » devient « Carrefour Market »). null si illisible.
- libelle_connu : si le commerçant correspond à l'un des libellés habituels ci-dessous, recopie ce libellé exactement ; sinon null.
- categorie : si libelle_connu est null, la catégorie la plus probable, recopiée exactement depuis la liste des catégories ; sinon null.
- mode : le moyen de paiement, recopié exactement parmi : ${modes.join(', ')}. Un ticket de carte bancaire, c'est « Carte » s'il figure dans la liste. null si inconnu.
- remboursement : true s'il s'agit d'un remboursement, d'un avoir ou d'un crédit ; sinon false.

Libellés habituels (libellé | catégorie | mode) :
${titles.join('\n')}

Catégories :
${categories.join('\n')}`;
}

// Photo réduite à 1600 px de côté en JPEG : envoi rapide en 4G, lecture tout aussi bonne.
async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch { /* format que le navigateur ne sait pas décoder : envoyé tel quel */ }
  return file;
}

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function call(body, key) {
  let last;
  for (const [model, wait] of TRIES) {
    if (wait) await new Promise(resolve => setTimeout(resolve, wait + Math.random() * 500));
    try {
      return await callModel(model, body, key);
    } catch (err) {
      if (!(err.status >= 500)) throw err;
      last = err;
    }
  }
  throw last;
}

async function callModel(model, body, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try {
    res = await fetch(endpoint(model), {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Gemini ne répond pas, réessayez.' : 'Pas de connexion à Internet.');
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return res.json();
  const msg = (await res.json().catch(() => null))?.error?.message ?? '';
  const err = new Error(
    res.status === 429 ? 'Quota gratuit Gemini atteint, réessayez plus tard.'
      : res.status === 503 ? 'Gemini est surchargé en ce moment, réessayez dans une minute.'
      : /api key/i.test(msg) || res.status === 401 || res.status === 403 ? 'Clé Gemini refusée : vérifiez-la dans les Réglages.'
        : `Gemini : erreur ${res.status}${msg ? ` (${msg})` : ''}`,
  );
  err.status = res.status;
  err.keyError = /api key/i.test(msg) || res.status === 401 || res.status === 403;
  throw err;
}

function parse(response) {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  if (!text) throw new Error("Gemini n'a rien renvoyé.");
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error('Réponse de Gemini illisible, réessayez.');
  }
}

// Envoie une consigne à Gemini, précédée d'une image s'il y en a une, et renvoie l'objet JSON décrit par le schéma.
async function ask(file, text, schema, maxSide) {
  const key = getKey();
  if (!key) throw new Error('Ajoutez votre clé Gemini dans les Réglages.');
  const parts = [{ text }];
  if (file) {
    const image = await shrink(file, maxSide);
    parts.unshift({ inlineData: { mimeType: image.type || 'image/jpeg', data: await toBase64(image) } });
  }
  const contents = [{ role: 'user', parts }];
  let response;
  try {
    response = await call({ contents, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema } }, key);
  } catch (err) {
    // Schéma refusé par cette version de l'API : on redemande du JSON simple, la consigne décrit déjà les champs.
    if (err.status !== 400 || err.keyError) throw err;
    response = await call({ contents, generationConfig: { responseMimeType: 'application/json' } }, key);
  }
  return parse(response);
}

// Requête libre (assistant) : renvoie la réponse brute de Gemini, avec les mêmes relances que la lecture des tickets.
export async function generate(body) {
  const key = getKey();
  if (!key) throw new Error('Ajoutez votre clé Gemini dans les Réglages.');
  return call(body, key);
}

// Lit un ticket et renvoie les champs du schéma. context : { today, titles, categories, modes } (listes de textes).
export const readTicket = (file, context) => ask(file, prompt(context), SCHEMA, 1600);

// ---------- Phrase tapée ou dictée (« 12 € boulangerie hier ») ----------
const SENTENCE_SCHEMA = {
  type: 'object',
  properties: {
    comprise: { type: 'boolean' },
    libelle_connu: { type: ['string', 'null'] },
    libelle: { type: ['string', 'null'] },
    montant: { type: ['number', 'null'] },
    sens: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    compte: { type: ['string', 'null'] },
    virement_avec: { type: ['string', 'null'] },
    categorie: { type: ['string', 'null'] },
    mode: { type: ['string', 'null'] },
  },
  required: ['comprise', 'libelle_connu', 'libelle', 'montant', 'sens', 'date', 'compte', 'virement_avec', 'categorie', 'mode'],
};

function sentencePrompt(text, { today, todayLong, titles, accounts, categories, modes }) {
  return `Tu transformes une phrase, tapée ou dictée (donc parfois mal transcrite), en une opération à saisir dans mes comptes bancaires.
Nous sommes le ${todayLong} (${today}).
Phrase : « ${text} »

Réponds uniquement par un objet JSON avec ces champs :
- comprise : false si la phrase ne décrit pas une dépense, une recette ou un virement, sinon true.
- libelle_connu : si l'opération correspond à l'un de mes libellés habituels ci-dessous (même commerçant, même organisme, même objet, même dit autrement, abrégé ou mal transcrit), recopie ce libellé exactement ; sinon null. En cas d'hésitation entre plusieurs, prends le premier de la liste (le plus récent).
- libelle : si libelle_connu est null, un libellé court écrit simplement (« la boulangerie Paul » devient « Boulangerie Paul ») ; sinon null.
- montant : le montant en euros, nombre positif avec un point décimal (« 12 euros 50 » = 12.5). null s'il n'est pas dit.
- sens : "recette" pour de l'argent reçu (salaire, remboursement, virement reçu), "depense" pour de l'argent payé ou envoyé ; null si la phrase ne le dit pas.
- date : au format AAAA-MM-JJ. « hier », « lundi », « le 3 » : la date passée la plus récente, sauf si la phrase parle d'une opération à venir. null si la phrase ne dit pas de date.
- compte : si la phrase cite un de mes comptes (par son nom, sa banque ou sa carte), recopie exactement son nom depuis la liste des comptes ; sinon null.
- virement_avec : pour un virement entre deux de mes comptes, recopie exactement le nom du compte qui reçoit l'argent ; compte est alors celui d'où il part et sens vaut "depense". Sinon null.
- categorie : si libelle_connu est null, la catégorie la plus probable, recopiée exactement depuis la liste des catégories ; sinon null.
- mode : seulement si la phrase dit le moyen de paiement (« carte », « chèque », « espèces », « prélèvement »…), recopié exactement parmi : ${modes.join(', ')}. Sinon null.

Mes libellés habituels, du plus récent au plus ancien (libellé | sens | catégorie | compte) :
${titles.join('\n')}

Mes comptes :
${accounts.join('\n')}

Catégories :
${categories.join('\n')}`;
}

// Lit une phrase. context : { today, todayLong, titles, accounts, categories, modes } (listes de textes).
export const readSentence = (text, context) => ask(null, sentencePrompt(text, context), SENTENCE_SCHEMA);

// ---------- Capture d'écran de l'appli de la banque (pointage) ----------
const STATEMENT_SCHEMA = {
  type: 'object',
  properties: {
    lisible: { type: 'boolean' },
    solde: { type: ['number', 'null'] },
    lignes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: ['string', 'null'] },
          libelle: { type: 'string' },
          montant: { type: 'number' },
          en_cours: { type: 'boolean' },
        },
        required: ['date', 'libelle', 'montant', 'en_cours'],
      },
    },
  },
  required: ['lisible', 'solde', 'lignes'],
};

const statementPrompt = today => `Tu lis la capture d'écran de l'application d'une banque qui montre la liste des opérations d'un compte.
Réponds uniquement par un objet JSON avec ces champs :
- lisible : false si l'image ne montre pas une liste d'opérations bancaires, sinon true.
- solde : le solde du compte s'il est affiché (nombre avec un point décimal, négatif si le compte est débiteur), sinon null.
- lignes : chaque opération visible, de haut en bas, avec :
  - date : au format AAAA-MM-JJ. Nous sommes le ${today}. Les dates sont souvent des titres de groupe (« Aujourd'hui », « Hier », « Lundi 3 novembre ») : applique-les aux opérations du groupe. Une date sans année est la plus récente qui ne dépasse pas aujourd'hui. null si aucune date n'est visible.
  - libelle : le libellé tel qu'il est affiché.
  - montant : nombre avec un point décimal, NÉGATIF pour un débit (dépense, prélèvement, paiement par carte), POSITIF pour un crédit (virement reçu, remboursement). Indices : un signe « - » ou un montant rouge ou noir est un débit ; un « + » ou un montant vert est un crédit.
  - en_cours : true si l'opération est marquée « en cours », « à venir », « en attente » ou « non débitée », sinon false.
N'invente aucune ligne. Ignore une ligne coupée en haut ou en bas de l'image.`;

// Lit une capture de compte. Résolution plus haute que pour un ticket : les listes bancaires sont écrites petit.
export const readStatement = (file, today) => ask(file, statementPrompt(today), STATEMENT_SCHEMA, 2200);
