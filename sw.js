const CACHE = 'falconi-messenger-v5-short-links';
const SHELL = ['/short-links.js', '/wallet.js', '/monitor.js', '/monitor.css', '/', '/index.html', '/manifest.json', '/falconi-messenger-32.png', '/falconi-messenger-180.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/'))) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
        return response;
      })
      .catch(() => caches.match(request).then(response => response || caches.match('/index.html')))
  );
});
