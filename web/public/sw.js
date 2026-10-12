/* Cache only versioned UI assets. Games, accounts, API responses and page
   navigations always go to the server that owns the data. */
const cacheName = `torre-assets-v1:${self.registration.scope}`;
const scope = new URL(self.registration.scope);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin ||
      !url.pathname.startsWith(`${scope.pathname}assets/`)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const saved = await cache.match(request);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  })());
});
