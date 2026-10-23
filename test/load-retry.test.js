const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// Opening the app: one quiet second try, and a load that never says "Not saved" (Matt, 10/22/26).
//
// What happened: Google now and then fails a doPost in 0 s, before the script's code runs (3 of 22 calls on 10/22:
// 8:27:38, 8:49:25 and 12:21:01 AM/PM). Google's error page carries no CORS header, so the phone's fetch rejects and
// lib/api.js answers code 'network' with the "Not saved" sentence. On the app-open card that sentence was wrong: the
// load is a READ, nothing was being saved. And the same call a moment later answers.
//
// The rules, each worked out on paper below:
//   SnowApi.read(action, body)  = a READ given one quiet second try, 1500 ms after a failure that came back FAST
//                                 (under 10 s). Only code 'network'. A failure that took the 45 s limit is not tried
//                                 again: the person has waited a minute, the card comes.
//   SnowApi.call(action, body)  = unchanged, and NEVER retried: a write that failed may have landed (the 45 s abort), and
//                                 its words stay "Not saved".
//   A read's failure never says "Not saved": "Couldn't reach the server. Try again." (already in the Spanish rows).
//
// lib/api.js is a browser script (SnowApi on `this`): run in a vm holding just what it reads, with a fake clock and a
// setTimeout that records every wait. Delays of 10 s and up are the abort timer: recorded, never fired.
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'api.js'), 'utf8');
const EXPECTED = 'outlines-1';
const WRITE_WORDS = "Couldn't reach the server. Not saved, try again.";
const READ_WORDS = "Couldn't reach the server. Try again.";
const UNREADABLE = 'The server sent something unreadable. Try again.';

// `script`: what each successive fetch does. 'down' = the fetch rejects (offline, or Google's error page: no CORS header).
// 'html' = a reply that is not JSON. { reply } = a JSON body. Any entry may carry `took` (ms the clock moves while it runs).
// A fetch past the end of the script is a test bug: it throws.
function api(script) {
  const calls = [], waits = [], removed = [];
  const clock = { t: 1000000 };
  let i = 0;
  const sandbox = {
    SNOW_CONFIG: { SNOW_URL: 'https://snow.example/exec', INV_URL: 'https://inv.example/exec', EXPECTED_BACKEND: EXPECTED },
    localStorage: { getItem: () => 'tok', setItem: () => {}, removeItem: (k) => removed.push(k) },
    fetch: async (u, init) => {
      calls.push({ u, body: JSON.parse(init.body) });
      const step = script[i++];
      if (!step) throw new Error('the test script ran out: a fetch nobody planned');
      clock.t += step.took || 0;
      if (step === 'down' || step.down) throw new TypeError('Failed to fetch');
      if (step === 'html' || step.html) return { json: async () => { throw new SyntaxError('Unexpected token <'); } };
      return { json: async () => step.reply };
    },
    AbortController, URLSearchParams, JSON, Object, Promise,
    Date: { now: () => clock.t },
    setTimeout: (fn, ms) => { waits.push(ms); if (ms < 10000) Promise.resolve().then(fn); return waits.length; },
    clearTimeout: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const retries = () => waits.filter((ms) => ms < 10000); // the waits between tries (the abort timer is 45000)
  return { SnowApi: sandbox.SnowApi, calls, retries, removed };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const ok = (action, extra) => ({ reply: Object.assign({ ok: true, version: EXPECTED, action }, extra || {}) });

test('a read that fails fast and then answers: the answer, after one wait of 1500 ms, the same request twice', async () => {
  const { SnowApi, calls, retries } = api(['down', ok('bootstrap', { me: { name: 'Matthew' } })]);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.ok, true);
  assert.equal(r.me.name, 'Matthew');
  assert.equal(calls.length, 2);
  assert.deepEqual(retries(), [1500]);
  // The same ask both times: action, slim and the token.
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.deepEqual(calls[0].body, { slim: true, action: 'bootstrap', token: 'tok' });
});

test('two failures in a row: the failure stands, and it was ONE retry, never a loop', async () => {
  const { SnowApi, calls } = api(['down', 'down']);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'network');
  assert.equal(calls.length, 2);
});

test('a read that answers the first time waits for nothing', async () => {
  const { SnowApi, calls, retries } = api([ok('bootstrap')]);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(retries(), []);
});

test('a read\'s failure never says "Not saved": it is a load, nothing was being saved', async () => {
  const { SnowApi } = api(['down', 'down']);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.reason, READ_WORDS);
  assert.doesNotMatch(r.reason, /saved/i);
});

test('a write\'s failure keeps its words: call() says "Not saved, try again"', async () => {
  const { SnowApi } = api(['down']);
  const r = await SnowApi.call('saveZone', { record: {} });
  assert.deepEqual(plain(r), { ok: false, code: 'network', reason: WRITE_WORDS });
});

test('call() is never retried, even when the failure came back instantly: a write that failed may have landed', async () => {
  // The script holds a good answer for a second fetch. If call() ever tried again it would find it and the
  // person would be told "saved" on a request the phone sent twice.
  const { SnowApi, calls, retries } = api(['down', ok('tapZone')]);
  const r = await SnowApi.call('tapZone', { site_id: 'S1', zone_id: 'Z1', state: 'cleared' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'network');
  assert.equal(calls.length, 1);
  assert.deepEqual(retries(), []);
});

test('only a FAST failure is tried again: 9.999 s is, 10 s is not (the 45 s limit costs a minute already)', async () => {
  const fast = api([{ down: true, took: 9999 }, ok('bootstrap')]);
  const a = await fast.SnowApi.read('bootstrap', { slim: true });
  assert.equal(a.ok, true);
  assert.equal(fast.calls.length, 2);
  const slow = api([{ down: true, took: 10000 }, ok('bootstrap')]);
  const b = await slow.SnowApi.read('bootstrap', { slim: true });
  assert.equal(b.ok, false);
  assert.equal(slow.calls.length, 1);
  assert.deepEqual(slow.retries(), []);
});

test('a read that ran out the 45 s limit: no second try, the card comes with the honest words', async () => {
  const { SnowApi, calls } = api([{ down: true, took: 45000 }, ok('bootstrap')]);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(calls.length, 1);
  assert.equal(r.code, 'network');
  assert.equal(r.reason, READ_WORDS);
});

test('an unreadable reply (not JSON) is a network failure too: tried again, and its own words survive a second one', async () => {
  const again = api(['html', ok('bootstrap')]);
  assert.equal((await again.SnowApi.read('bootstrap', { slim: true })).ok, true);
  assert.equal(again.calls.length, 2);
  const twice = api(['html', 'html']);
  const r = await twice.SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.code, 'network');
  assert.equal(r.reason, UNREADABLE); // already says nothing about saving: left alone
  assert.equal(twice.calls.length, 2);
});

test('the 10/10 hiccup, the health reply handed back for a POST, is "no signal" and is tried again on a read', async () => {
  const { SnowApi, calls } = api([{ reply: { ok: true, version: EXPECTED } }, ok('bootstrap')]);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test('nothing but a network failure is tried again: refusals and answers are one request', async () => {
  const answers = [
    ['a sign-in refusal', { ok: false, code: 'signin', reason: 'Session expired. Sign in again.' }],
    ['not on the roster', { ok: false, code: 'not_on_roster', reason: 'Not on the roster.' }],
    ['a card waiting for Matt', { ok: false, code: 'pending_card', reason: 'Waiting for Matt.' }],
    ['a server error', { ok: false, code: 'error', reason: 'Something broke on the server.' }],
    ['a forbidden', { ok: false, code: 'forbidden', reason: 'Only Matt can do that.' }],
  ];
  for (const [what, body] of answers) {
    const { SnowApi, calls, retries } = api([{ reply: Object.assign({ version: EXPECTED, action: 'bootstrap' }, body) }, ok('bootstrap')]);
    const r = await SnowApi.read('bootstrap', { slim: true });
    assert.equal(r.code, body.code, what);
    assert.equal(r.reason, body.reason, what);
    assert.equal(calls.length, 1, what);
    assert.deepEqual(retries(), [], what);
  }
});

test('a sign-in refusal on a read still signs out (the token goes), with no second try', async () => {
  const { SnowApi, removed, calls } = api([{ reply: { ok: false, code: 'signin', reason: 'Sign in again.', version: EXPECTED, action: 'bootstrap' } }]);
  const r = await SnowApi.read('bootstrap', { slim: true });
  assert.equal(r.code, 'signin');
  assert.deepEqual(removed, ['titan-snow-token']);
  assert.equal(calls.length, 1);
});
