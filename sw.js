/* Subir este número en CADA cambio de index.html o sw.js: así el celular
   descarta la copia vieja guardada. */
const CACHE = 'pbc-v8';

/* Si la red tarda más que esto, se muestra la copia guardada mientras tanto. */
const ESPERA_RED_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => clients.claim())
));

/* Red primero: siempre se intenta la versión nueva y se guarda una copia.
   Sin conexión (o con red muy lenta) se usa la última copia guardada. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const deLaRed = fetch(e.request).then(res => {
    if (res.ok) {
      const copia = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
    }
    return res;
  });

  const conLimite = Promise.race([
    deLaRed,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('red lenta')), ESPERA_RED_MS)),
  ]);

  e.respondWith(
    conLimite.catch(() =>
      caches.match(e.request).then(guardada => guardada || deLaRed)
    )
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const c = cs.find(w => w.url && w.focus);
      return c ? c.focus() : clients.openWindow(self.registration.scope);
    })
  );
});
