// Parakh service worker: makes the app installable and lets it open offline.
// Pages: network first (always the latest deploy), cached copy when offline.
// Built assets (hashed file names): cache first; other files: network first. The AI endpoint is never cached.
const CACHE = 'parakh-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put('./', c)); return res; })
      .catch(() => caches.match('./').then((r) => r || caches.match(req))));
    return;
  }
  const put = (res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return res; };
  // Hashed build files never change: cache first. Everything else (samples, icons): network first.
  if (url.pathname.includes('/assets/')) e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
  else e.respondWith(fetch(req).then(put).catch(() => caches.match(req)));
});
