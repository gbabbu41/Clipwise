const CACHE = 'clipwise-v5';
const STATIC = [
  '/',
  '/dashboard',
  '/offline',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET, cross-origin, and API/Supabase requests.
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Next.js RSC / client-navigation payloads must stay fresh — let them hit the
  // network so client-side navigation always shows current data.
  if (url.searchParams.has('_rsc')) return;

  // Navigation (a full page load) → NETWORK-FIRST. The HTML is small and must be
  // fresh so its auth redirect AND the CURRENT hashed asset filenames are always
  // right (that's what keeps cache-first assets below from ever going stale).
  // Falls back to the cached shell / offline page only when the network is down.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(request, clone)); }
          return res;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/offline').then(o => o || caches.match('/'))))
    );
    return;
  }

  // Immutable, content-hashed build assets (JS/CSS) + same-origin static media →
  // CACHE-FIRST. This is the big app-speed win: the JS bundle is served instantly
  // from cache instead of re-downloading on every open. A new deploy ships NEW
  // filenames, so the fresh HTML references them and any not-yet-cached file is
  // fetched once and then cached — never stale, because the name changes whenever
  // the content does.
  if (url.pathname.match(/\.(js|css|woff2?|png|jpe?g|svg|ico|webp|gif)$/)) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(request, clone)); }
        return res;
      }))
    );
    return;
  }

  // Everything else: network, fall back to cache when offline.
  e.respondWith(fetch(request).catch(() => caches.match(request)));
});
