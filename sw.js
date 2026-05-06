const CACHE = 'pbc-v7';
const _timers = new Map();

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => clients.claim())
));

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(r => r || fetch(e.request).then(res => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }))
    )
  );
});

/* Recibe la lista de notificaciones programadas desde la página.
   Usa setTimeout en el SW + waitUntil para seguir vivo en background. */
self.addEventListener('message', e => {
  if (e.data?.type !== 'SCHEDULE_NOTIFS') return;

  _timers.forEach(id => clearTimeout(id));
  _timers.clear();

  const now     = Date.now();
  const pending = [];

  for (const n of (e.data.list || [])) {
    const delay = n.at - now;
    if (delay < -60000) continue;

    const p = new Promise(resolve => {
      const id = setTimeout(async () => {
        const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        try {
          await self.registration.showNotification(n.title, {
            body:               n.body,
            tag:                n.tag,
            requireInteraction: false,
          });
          for (const c of cs) c.postMessage({ type: 'NOTIF_FIRED', title: n.title, body: n.body });
        } catch (err) {
          for (const c of cs) c.postMessage({ type: 'NOTIF_ERROR', message: String(err) });
        }
        resolve();
      }, Math.max(0, delay));
      _timers.set(n.tag, id);
    });
    pending.push(p);
  }

  if (pending.length) e.waitUntil(Promise.all(pending));
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
