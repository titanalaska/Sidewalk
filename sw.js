// Snow app shell cache: NETWORK FIRST, cache as the fallback. Signal is rarely
// lost, so a fresh app wins; the cache only keeps the app opening when it is.
// (Cache-first would keep config.js -- the backend URL -- stale on every phone
// until someone remembered to bump a version.)
//
// titanalaska.github.io carries every Titan app on one origin, so the Cache API
// is shared: this worker only ever deletes its OWN old versions
// (titan-snow-shell-*), never wolf-*, groundwork-* or anyone else's.
var CACHE_VERSION = 'titan-snow-shell-32';
// Map code is in the shell so a map still opens with no signal (zones on a
// plain background). The aerial TILES are never cached: other origins pass by.
var SHELL = ['./', 'index.html', 'app.css', 'lib/config.js', 'lib/forms.js', 'lib/api.js', 'lib/geo.js',
  'lib/mapview.js', 'lib/bpimport.js', 'lib/mapedit.js', 'lib/time.js', 'lib/board.js', 'lib/history.js', 'lib/gear.js',
  'lib/warnings.js', 'lib/pairing.js', 'lib/boardui.js', 'lib/rosterui.js', 'lib/shiftlog.js', 'lib/livesum.js', 'lib/routesheet.js', 'lib/handoff.js', 'lib/btnote.js', 'lib/shiftlogui.js', 'lib/weather.js', 'lib/callout.js', 'lib/snowmap.js', 'lib/share.js', 'lib/app.js', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

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
  // Apps Script and every other origin: straight to the network, never cached.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE_VERSION).then(function (c) { c.put(e.request, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      return hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined);
    });
  }));
});
