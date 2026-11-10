// The service worker's push and tap handling (sw.js). Run in a vm against a fake self / caches / clients.
// Words are the Global Constraints' (crew notifications plan): title "Shovel Command" in both languages;
// en body "Snow tonight. Open Shovel Command for your route."; es body "Nieve esta noche. Abre Shovel Command
// para ver tu ruta."; one tag "snow-notice" with renotify. The push carries no payload: every word comes from the worker.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const EN_BODY = 'Snow tonight. Open Shovel Command for your route.';
const ES_BODY = 'Nieve esta noche. Abre Shovel Command para ver tu ruta.';

// opts.stored: {cacheName: {requestKey: text}}; opts.fail: 'open' | 'match' | 'text' makes the PREFS cache misbehave.
function load(opts) {
  opts = opts || {};
  var stored = opts.stored || {};
  var listeners = {};
  var shown = [];
  var deleted = [];
  var cachesApi = {
    open: function (name) {
      if (opts.fail === 'open' && name === 'titan-snow-prefs') return Promise.reject(new Error('open failed'));
      return Promise.resolve({
        match: function (key) {
          if (opts.fail === 'match') return Promise.reject(new Error('match failed'));
          var hit = stored[name] && stored[name][key];
          if (hit === undefined) return Promise.resolve(undefined);
          return Promise.resolve({ text: function () { return opts.fail === 'text' ? Promise.reject(new Error('text failed')) : Promise.resolve(hit); } });
        }
      });
    },
    keys: function () { return Promise.resolve(Object.keys(stored)); },
    delete: function (name) { deleted.push(name); delete stored[name]; return Promise.resolve(true); }
  };
  var clientsApi = {
    claim: function () { return Promise.resolve(); },
    list: opts.clients || [],
    opened: [],
    matchAll: function (o) { clientsApi.matchArgs = o; return Promise.resolve(clientsApi.list); },
    openWindow: function (u) { clientsApi.opened.push(u); return Promise.resolve({}); }
  };
  var self = {
    location: { origin: 'https://example.test' },
    clients: clientsApi,
    registration: { showNotification: function (title, o) { shown.push({ title: title, o: o }); return Promise.resolve(); } },
    skipWaiting: function () {},
    addEventListener: function (type, fn) { listeners[type] = fn; }
  };
  vm.runInNewContext(SRC, { self: self, caches: cachesApi, clients: clientsApi, Promise: Promise, URL: URL, fetch: function () {} });
  return { listeners: listeners, shown: shown, deleted: deleted, stored: stored, clients: clientsApi };
}

// Fire an event and hand back the promises given to waitUntil.
function fire(env, type, extra) {
  var waited = [];
  var ev = Object.assign({ waitUntil: function (p) { waited.push(p); } }, extra || {});
  env.listeners[type](ev);
  return waited;
}

test('a push with no data shows the English alert, and the event waits for it', async () => {
  const env = load();
  const waited = fire(env, 'push', { data: null });
  assert.equal(waited.length, 1, 'waitUntil was handed one promise');
  assert.equal(env.shown.length, 0, 'nothing shown before the language is read (the read is async)');
  await waited[0];
  assert.equal(env.shown.length, 1, 'the promise settles only after showNotification');
  assert.equal(env.shown[0].title, 'Shovel Command');
  assert.equal(env.shown[0].o.body, EN_BODY);
  assert.equal(env.shown[0].o.tag, 'snow-notice');
  assert.equal(env.shown[0].o.renotify, true);
  assert.equal(env.shown[0].o.icon, './icon-192.png');
});

test('the words never come from the push body', async () => {
  const env = load();
  const waited = fire(env, 'push', { data: { text: function () { return 'EVIL'; }, json: function () { return { body: 'EVIL' }; } } });
  await waited[0];
  assert.equal(env.shown[0].o.body, EN_BODY);
  assert.equal(env.shown[0].title, 'Shovel Command');
});

test('es in the prefs cache gives the Spanish body, same title, same tag; a trailing newline is fine', async () => {
  for (const stored of ['es', 'es\n']) {
    // an unrelated cache sits beside the prefs cache and holds a different answer under the same key
    const env = load({ stored: { 'titan-snow-shell-46': { './prefs/lang': 'en' }, 'titan-snow-prefs': { './prefs/lang': stored } } });
    await fire(env, 'push')[0];
    assert.equal(env.shown[0].o.body, ES_BODY, JSON.stringify(stored));
    assert.equal(env.shown[0].title, 'Shovel Command');
    assert.equal(env.shown[0].o.tag, 'snow-notice');
    assert.equal(env.shown[0].o.renotify, true);
  }
});

test('anything but es is English: fr, empty, uppercase, wrong key, missing entry, es in another cache', async () => {
  const cases = [
    { 'titan-snow-prefs': { './prefs/lang': 'fr' } },
    { 'titan-snow-prefs': { './prefs/lang': '' } },
    { 'titan-snow-prefs': { './prefs/lang': 'ES' } },
    { 'titan-snow-prefs': { './prefs/other': 'es' } },
    { 'titan-snow-prefs': {} },
    { 'titan-snow-shell-46': { './prefs/lang': 'es' } }
  ];
  for (const stored of cases) {
    const env = load({ stored: stored });
    await fire(env, 'push')[0];
    assert.equal(env.shown.length, 1, JSON.stringify(stored));
    assert.equal(env.shown[0].o.body, EN_BODY, JSON.stringify(stored));
  }
});

test('a prefs cache that throws (open, match or text) still shows the English alert', async () => {
  for (const fail of ['open', 'match', 'text']) {
    const env = load({ fail: fail, stored: { 'titan-snow-prefs': { './prefs/lang': 'es' } } });
    await fire(env, 'push')[0];
    assert.equal(env.shown.length, 1, fail);
    assert.equal(env.shown[0].o.body, EN_BODY, fail);
    assert.equal(env.shown[0].title, 'Shovel Command', fail);
  }
});

test('tapping closes the notification and focuses the first window that can focus', async () => {
  let closed = 0;
  const focused = [];
  const clients = [
    { url: 'a' },
    { url: 'b', focus: function () { focused.push('b'); return Promise.resolve(); } },
    { url: 'c', focus: function () { focused.push('c'); return Promise.resolve(); } }
  ];
  const env = load({ clients: clients });
  const waited = fire(env, 'notificationclick', { notification: { close: function () { closed++; } } });
  assert.equal(closed, 1, 'close was called');
  assert.equal(waited.length, 1);
  await waited[0];
  assert.deepEqual(focused, ['b']);
  assert.deepEqual(env.clients.opened, []);
  assert.deepEqual(env.clients.matchArgs, { type: 'window', includeUncontrolled: true });
});

test('tapping with no focusable window opens ./', async () => {
  let closed = 0;
  const env = load({ clients: [{ url: 'x' }] });
  await fire(env, 'notificationclick', { notification: { close: function () { closed++; } } })[0];
  assert.equal(closed, 1);
  assert.deepEqual(env.clients.opened, ['./']);
  const env2 = load({ clients: [] });
  await fire(env2, 'notificationclick', { notification: { close: function () {} } })[0];
  assert.deepEqual(env2.clients.opened, ['./']);
});

test('activation deletes the old shell 45 but leaves the prefs cache and other apps alone', async () => {
  const env = load({ stored: {
    'titan-snow-shell-45': {}, 'titan-snow-shell-46': {}, 'titan-snow-prefs': { './prefs/lang': 'es' },
    'wolf-beds-v2': {}, 'groundwork-shell-v34': {}
  } });
  await fire(env, 'activate')[0];
  assert.deepEqual(env.deleted, ['titan-snow-shell-45']);
  assert.ok(env.stored['titan-snow-prefs'], 'prefs survive activation');
  assert.ok(env.stored['titan-snow-shell-46'], 'the live shell survives');
});
