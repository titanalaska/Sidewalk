// Snow app shell cache. Bump CACHE_VERSION in the SAME commit as any shell
// change, or installed phones keep serving the old app.
//
// titanalaska.github.io carries every Titan app on one origin, so the Cache API
// is shared: this worker only ever deletes its OWN old versions
// (titan-snow-shell-*), never wolf-*, groundwork-* or anyone else's.
var CACHE_VERSION = 'titan-snow-shell-1';
var SHELL = ['index.html', 'app.css', 'lib/config.js', 'lib/forms.js', 'lib/api.js', 'lib/app.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_VERSION).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('titan-snow-shell-') === 0 && k !== CACHE_VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // Apps Script and every other origin go straight to the network, never the cache.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || fetch(e.request); }));
});
