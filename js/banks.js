// Logos des banques : icône du site de la banque (service d'icônes de Google, sans fichier dans le site).
// Un monogramme coloré s'affiche dessous : il reste visible tant que l'icône n'est pas chargée, ou hors ligne.
const BANKS = [
  [/populaire/, 'banquepopulaire.fr', '#0b4ea2'],
  [/credit mutuel/, 'creditmutuel.fr', '#cf0a2c'],
  [/societe generale/, 'sg.fr', '#e9041e'],
  [/bourso/, 'boursobank.com', '#d6006f'],
  [/bforbank/, 'bforbank.com', '#2f2f3a'],
  [/fortuneo/, 'fortuneo.fr', '#00995c'],
  [/revolut/, 'revolut.com', '#191c1f'],
  [/\bn26\b/, 'n26.com', '#2f8f7c'],
  [/deblock/, 'deblock.com', '#3a3a3a'],
  [/trade republic/, 'traderepublic.com', '#1a1a1a'],
  [/hello ?bank/, 'hellobank.fr', '#0096d6'],
  [/credit agricole/, 'credit-agricole.fr', '#00848a'],
  [/caisse d.?epargne/, 'caisse-epargne.fr', '#c4001a'],
  [/banque postale/, 'labanquepostale.fr', '#0f3c8c'],
  [/\blcl\b/, 'lcl.fr', '#003c85'],
  [/bnp/, 'mabanque.bnpparibas', '#00875a'],
  [/\bcic\b/, 'cic.fr', '#00468c'],
  [/\bing\b/, 'ing.fr', '#e05400'],
  [/hsbc/, 'hsbc.fr', '#c50010'],
  [/monabanq/, 'monabanq.com', '#008f88'],
];
const PALETTE = ['#0f766e', '#4f46e5', '#c2410c', '#be185d', '#0369a1', '#7c3aed', '#15803d', '#b45309'];

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function initials(name) {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 2 || /\d/.test(w));
  if (!words.length) return '€';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
}

// HTML du logo d'un compte (taille en px).
export function bankLogo(account, size = 40) {
  const label = account.bank || account.name || '';
  const n = norm(label);
  const hit = BANKS.find(([re]) => re.test(n)) ?? BANKS.find(([re]) => re.test(norm(account.name)));
  let color = hit?.[2];
  if (!color) {
    let h = 0;
    for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    color = PALETTE[h % PALETTE.length];
  }
  const img = hit
    ? `<img src="https://www.google.com/s2/favicons?domain=${hit[1]}&amp;sz=64" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('ok')" onerror="this.remove()">`
    : '';
  return `<span class="bank-logo" style="--logo:${size}px;--logo-bg:${color}" aria-hidden="true"><b>${esc(initials(label))}</b>${img}</span>`;
}
