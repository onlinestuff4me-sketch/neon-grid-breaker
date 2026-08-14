// TIME SHATTER service worker — network-first so updates always arrive when
// online (fixes the stale home-screen web app); the cache is only a fallback
// for offline play.
// Bumped when the game moved to timeshatter.app. A cache keyed to the old
// origin must never be served on the new one.
const CACHE = 'timeshatter-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin
  e.respondWith(
    // cache:'no-cache' forces revalidation past the CDN's 10-minute TTL, so
    // index.html and main.js can never arrive as a mismatched pair
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || Response.error()))
  );
});
