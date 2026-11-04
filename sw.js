// Fonctionnement hors ligne : réseau d'abord, copie en cache si le réseau manque.
const CACHE = 'comptes-v5';
const SHARE_CACHE = 'comptes-partage'; // photo reçue par le menu « Partager » d'Android, le temps que la page la reprenne
const ASSETS = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/import.js', 'js/drive.js', 'js/config.js', 'js/recur.js', 'js/stats.js', 'js/ticket.js', 'js/banks.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Partage d'une image depuis une autre appli : on la garde, puis on ouvre l'écran qui la lit.
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/partage')) {
    e.respondWith((async () => {
      const file = (await req.formData()).get('image');
      if (file && typeof file !== 'string') {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put('photo', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } }));
      }
      return Response.redirect(new URL('./#/photo', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
