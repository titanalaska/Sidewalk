// lib/api.js callAs (snow alerts, sign-out): a call bound to the token stored when it was made. Sign-out takes one for this phone's
// dropPush, then clears the token; the dropPush may answer long after, when someone else has signed in on the same phone.
// Final review (11/27/26), Minor 1: that late answer must never touch the stored token. An ordinary call's `signin` answer still
// clears it (the expired-session rule, unchanged).
//
// Worked on paper: A ('tok-a') signs out; B ('tok-b') signs in; A's dropPush answers { ok: false, code: 'signin' } (A's session had
// expired). The store must still hold tok-b, and the request must have carried tok-a.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'api.js'), 'utf8');
const KEY = 'titan-snow-token';

function api(reply) {
  const store = {}, sent = [];
  const sandbox = {
    SNOW_CONFIG: { SNOW_URL: 'https://snow.example/exec', INV_URL: 'https://inv.example/exec', EXPECTED_BACKEND: 'notify-1' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    fetch: async (u, init) => { const b = JSON.parse(init.body); sent.push(b); return { json: async () => reply(b) }; },
    AbortController, setTimeout, clearTimeout, URLSearchParams, JSON, Object, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { SnowApi: sandbox.SnowApi, store, sent };
}

test('callAs sends the token stored when it was made, whatever is stored by the time it is called', async () => {
  const { SnowApi, store, sent } = api((b) => ({ ok: true, push_ids: [], version: 'notify-1', action: b.action }));
  store[KEY] = 'tok-a';
  const asA = SnowApi.callAs();
  SnowApi.signOut();
  store[KEY] = 'tok-b';
  await asA('dropPush', { endpoint: 'https://fcm.googleapis.com/fcm/send/x' });
  assert.equal(sent[0].token, 'tok-a');
  assert.equal(store[KEY], 'tok-b');
});

test('a signin answer to a callAs call leaves the stored token alone: the next person stays signed in', async () => {
  const { SnowApi, store } = api((b) => ({ ok: false, code: 'signin', reason: 'Session expired. Sign in again.', version: 'notify-1', action: b.action }));
  store[KEY] = 'tok-a';
  const asA = SnowApi.callAs();
  SnowApi.signOut();
  store[KEY] = 'tok-b';
  const r = await asA('dropPush', { endpoint: 'https://fcm.googleapis.com/fcm/send/x' });
  assert.equal(r.code, 'signin');
  assert.equal(store[KEY], 'tok-b');
});

test('a signin answer to an ordinary call still clears the stored token', async () => {
  const { SnowApi, store } = api((b) => ({ ok: false, code: 'signin', reason: 'Session expired. Sign in again.', version: 'notify-1', action: b.action }));
  store[KEY] = 'tok-b';
  await SnowApi.call('bootstrap', {});
  assert.equal(store[KEY], undefined);
});
