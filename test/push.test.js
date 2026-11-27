// What this phone can do about snow alerts (lib/push.js). Every browser part is an injected fake that
// records its calls in order, so nothing here touches a real browser, and the ORDER of the calls is
// itself under test: an iPhone refuses a permission request that does not start inside the tap.
//
// Fixtures are deliberately untidy: a long endpoint with ':' '/' '-' '_' and mixed case, a key whose
// base64url form contains '-' and '_', a server list that names other phones' ids before ours.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const SnowPush = require('../lib/push.js');

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/AbC-123_xYz:APA91b-fake_Qq9ZzZ-LoNg_Tail-0aB';
const OTHER = 'https://web.push.apple.com/QGfake-endpoint_Zz9';
// Worked on paper: the backend's id is the FIRST 8 BYTES (16 hex characters) of SHA-256 of the UTF-8 endpoint.
function fp(endpoint) { return crypto.createHash('sha256').update(endpoint, 'utf8').digest('hex').slice(0, 16); }

// A 65-byte "public key" (0x04 then 64 bytes) whose base64url text uses '-' or '_' and has no '=' padding.
const KEY_BYTES = Buffer.alloc(65); KEY_BYTES[0] = 4;
for (let i = 1; i < 65; i++) KEY_BYTES[i] = (i * 37 + 251) % 256;
KEY_BYTES[5] = 0xfb; KEY_BYTES[6] = 0xff; KEY_BYTES[7] = 0xbe;
const KEY = KEY_BYTES.toString('base64url');
const OTHER_KEY = Buffer.from(KEY_BYTES.map((b) => b ^ 0x55)).toString('base64url');

test('fixture guard: the key text has - or _ and 65 bytes behind it', () => {
  assert.ok(KEY.includes('-') || KEY.includes('_'));
  assert.equal(Buffer.from(KEY, 'base64url').length, 65);
});

const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

// The fake phone. o: { ua, platform, touch, standaloneNav, standaloneMedia, sw, push, notif, permission,
// askResult, sub (an existing subscription's {endpoint, key}), subscribeFails (how many subscribes reject),
// newEndpoint, lang }.
function phone(o) {
  o = Object.assign({ ua: PIXEL, platform: 'Linux armv81', touch: 5, sw: true, push: true, notif: true,
    permission: 'default', askResult: 'granted', sub: null, subscribeFails: 0, lang: 'en' }, o || {});
  const calls = [];
  let current = null;
  function mkSub(endpoint, keyB64) {
    const bytes = Buffer.from(keyB64, 'base64url');
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    const s = { endpoint: endpoint, options: { applicationServerKey: ab },
      unsubscribe() { calls.push('unsubscribe'); if (current === s) current = null; return Promise.resolve(true); } };
    return s;
  }
  if (o.sub) current = mkSub(o.sub.endpoint, o.sub.key || KEY);
  const permission = { value: o.permission };
  const reg = { pushManager: {
    getSubscription() { calls.push('getSubscription'); return Promise.resolve(current); },
    subscribe(opts) {
      calls.push('subscribe');
      reg.lastSubscribe = opts;
      if (o.subscribeFails > 0) { o.subscribeFails--; return Promise.reject(new Error('InvalidStateError')); }
      current = mkSub(o.newEndpoint || ENDPOINT, Buffer.from(opts.applicationServerKey).toString('base64url'));
      return Promise.resolve(current);
    } } };
  const env = {
    navigator: { userAgent: o.ua, platform: o.platform, maxTouchPoints: o.touch, standalone: o.standaloneNav,
      serviceWorker: o.sw ? {
        getRegistration() { calls.push('getRegistration'); return Promise.resolve(reg); },
        ready: Promise.resolve(reg) } : undefined },
    PushManager: o.push ? function PushManager() {} : undefined,
    Notification: o.notif ? { get permission() { return permission.value; },
      requestPermission() { calls.push('requestPermission'); permission.value = o.askResult; return Promise.resolve(o.askResult); } } : undefined,
    matchMedia(q) { return { matches: !!o.standaloneMedia && q === '(display-mode: standalone)' }; },
    lang() { return o.lang; }
  };
  return { env, calls, reg, current: () => current };
}

// A ctx whose call() records and answers from a script.
function ctxFor(S, answers) {
  const sent = [];
  return { sent, S, toasts: [], toast(t) { this.toasts.push(t); }, render() { this.rendered = (this.rendered || 0) + 1; },
    call(action, body) {
      sent.push({ action, body });
      const a = answers[action];
      return Promise.resolve(typeof a === 'function' ? a(body) : a);
    } };
}
const S0 = (ids, key, state) => ({ push: { key: key === undefined ? KEY : key, ids: ids || [], state: state || 'off' } });

// ---------- stateOf: the spec's table, row by row ----------
const FULL = { sw: true, push: true, notif: true, ios: false, standalone: false, permission: 'default', subscribed: false, known: false };
function f(over) { return Object.assign({}, FULL, over); }

test('stateOf: every row of the table', () => {
  const rows = [
    [f({}), 'off'],                                                                          // can do it, not on yet
    [f({ permission: 'granted' }), 'off'],                                                   // granted, nothing subscribed
    [f({ permission: 'granted', subscribed: true, known: true }), 'on'],
    [f({ permission: 'granted', subscribed: true, known: false }), 'off'],                   // the server does not list this endpoint
    [f({ permission: 'granted', subscribed: false, known: true }), 'off'],                   // listed, but the browser has no subscription
    [f({ permission: 'default', subscribed: true, known: true }), 'off'],                    // permission not granted
    [f({ permission: 'denied' }), 'blocked'],
    [f({ permission: 'denied', subscribed: true, known: true }), 'blocked'],
    [f({ push: false }), 'unsupported'],                                                     // desktop without PushManager
    [f({ sw: false }), 'unsupported'],
    [f({ notif: false }), 'unsupported'],
    [f({ push: false, ios: true, standalone: false }), 'install'],                           // iPhone in a tab: no PushManager
    [f({ sw: false, ios: true }), 'install'],
    [f({ notif: false, ios: true }), 'install'],
    [f({ push: false, ios: true, standalone: true }), 'unsupported'],                        // home-screen iPhone that still cannot (old iOS)
    [f({ ios: true, standalone: false }), 'off'],                                            // iPhone in a tab that DOES have all three
    [f({ push: false, ios: false, standalone: true }), 'unsupported'],
    [f({ push: false, permission: 'denied' }), 'unsupported'],                               // cannot at all beats blocked
    [f({ push: false, ios: true, permission: 'denied' }), 'install']
  ];
  rows.forEach(([flags, want], i) => assert.equal(SnowPush.stateOf(flags), want, 'row ' + i + ' ' + JSON.stringify(flags)));
});

// ---------- fingerprint ----------
test('fingerprint is the first 8 bytes of SHA-256 of the endpoint, 16 lowercase hex', async () => {
  for (const e of [ENDPOINT, OTHER, 'é' + ENDPOINT]) {
    const got = await SnowPush.fingerprint(e);
    assert.match(got, /^[0-9a-f]{16}$/);
    assert.equal(got, fp(e));
  }
  assert.notEqual(await SnowPush.fingerprint(ENDPOINT), await SnowPush.fingerprint(OTHER));
});

// ---------- refresh ----------
test('refresh: subscribed but the server does not list the endpoint reads off', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const S = S0([fp(OTHER)]);
  assert.equal(await SnowPush.refresh(S, p.env), 'off');
  assert.equal(S.push.state, 'off');
});

test('refresh: granted + subscribed + listed (among other ids) reads on', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const S = S0([fp(OTHER), fp(ENDPOINT)]);
  assert.equal(await SnowPush.refresh(S, p.env), 'on');
  assert.equal(S.push.state, 'on');
});

test('refresh: denied is blocked; default permission with a listed subscription is off', async () => {
  const S = S0([fp(ENDPOINT)]);
  assert.equal(await SnowPush.refresh(S, phone({ permission: 'denied' }).env), 'blocked');
  assert.equal(await SnowPush.refresh(S, phone({ permission: 'default', sub: { endpoint: ENDPOINT } }).env), 'off');
});

test('refresh: an iPhone in a tab with no PushManager is install; a desktop with none is unsupported', async () => {
  const S = S0();
  assert.equal(await SnowPush.refresh(S, phone({ ua: IPHONE, push: false, sw: true }).env), 'install');
  assert.equal(await SnowPush.refresh(S, phone({ ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126', platform: 'Win32', touch: 0, push: false }).env), 'unsupported');
});

test('refresh: iPadOS reports as a Mac with touch points; a real Mac (no touch) is not an iPad', async () => {
  const S = S0();
  const ipad = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', push: false };
  assert.equal(await SnowPush.refresh(S, phone(Object.assign({}, ipad, { touch: 5 })).env), 'install');
  assert.equal(await SnowPush.refresh(S, phone(Object.assign({}, ipad, { touch: 0 })).env), 'unsupported');
  assert.equal(await SnowPush.refresh(S, phone(Object.assign({}, ipad, { touch: 1 })).env), 'unsupported');
});

test('refresh: home-screen mode by navigator.standalone or by the display-mode media query', async () => {
  const S = S0();
  assert.equal(await SnowPush.refresh(S, phone({ ua: IPHONE, push: false, standaloneNav: true }).env), 'unsupported');
  assert.equal(await SnowPush.refresh(S, phone({ ua: IPHONE, push: false, standaloneMedia: true }).env), 'unsupported');
  assert.equal(await SnowPush.refresh(S, phone({ ua: IPHONE, push: false, standaloneNav: false, standaloneMedia: false }).env), 'install');
});

test('refresh never rejects: a registration lookup that throws reads off, not an error', async () => {
  const p = phone({ permission: 'granted' });
  p.env.navigator.serviceWorker.getRegistration = () => Promise.reject(new Error('boom'));
  const S = S0();
  assert.equal(await SnowPush.refresh(S, p.env), 'off');
});

// ---------- turnOn ----------
test('turnOn asks for permission FIRST and synchronously, before anything async', async () => {
  const p = phone();
  const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
  const pending = SnowPush.turnOn(ctx, p.env);
  // Nothing has been awaited yet: the call log right now is what ran inside the tap.
  assert.deepEqual(p.calls, ['requestPermission']);
  assert.equal(ctx.sent.length, 0);
  assert.ok(typeof pending.then === 'function');
  await pending;
});

test('turnOn success: subscribe gets the key bytes, savePush gets the endpoint and lang, ids replaced, state on', async () => {
  const p = phone({ lang: 'en' });
  const S = S0([fp(OTHER)]);
  const ctx = ctxFor(S, { savePush: { ok: true, push_ids: [fp(OTHER), fp(ENDPOINT)] } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: true, state: 'on' });
  assert.equal(p.reg.lastSubscribe.userVisibleOnly, true);
  assert.ok(p.reg.lastSubscribe.applicationServerKey instanceof Uint8Array);
  assert.deepEqual(Array.from(p.reg.lastSubscribe.applicationServerKey), Array.from(KEY_BYTES));
  assert.deepEqual(ctx.sent, [{ action: 'savePush', body: { endpoint: ENDPOINT, lang: 'en' } }]);
  assert.deepEqual(S.push.ids, [fp(OTHER), fp(ENDPOINT)]);
  assert.equal(S.push.state, 'on');
});

test('turnOn sends lang es only when the app is in Spanish; anything else is en', async () => {
  for (const [lang, want] of [['es', 'es'], ['en', 'en'], ['fr', 'en'], [undefined, 'en']]) {
    const p = phone({ lang });
    const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
    await SnowPush.turnOn(ctx, p.env);
    assert.equal(ctx.sent[0].body.lang, want, String(lang));
  }
});

test('turnOn with no push_key (backend not set up): no permission prompt at all, words given, nothing saved', async () => {
  const p = phone({ permission: 'default' });
  const S = S0([], null, 'off');
  const ctx = ctxFor(S, {});
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Snow alerts are not set up yet.' });
  assert.ok(!p.calls.includes('requestPermission'));
  assert.deepEqual(p.calls, []);
  assert.equal(ctx.sent.length, 0);
});

test('turnOn denied: nothing saved, nothing subscribed, state blocked', async () => {
  const p = phone({ askResult: 'denied' });
  const S = S0([]);
  const ctx = ctxFor(S, {});
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.equal(r.ok, false);
  assert.equal(r.state, 'blocked');
  assert.equal(S.push.state, 'blocked');
  assert.equal(ctx.sent.length, 0);
  assert.ok(!p.calls.includes('subscribe'));
});

test('turnOn dismissed (default): nothing saved, state stays off', async () => {
  const p = phone({ askResult: 'default' });
  const ctx = ctxFor(S0([]), {});
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.equal(r.ok, false);
  assert.equal(r.state, 'off');
  assert.equal(ctx.sent.length, 0);
  assert.ok(!p.calls.includes('subscribe'));
});

test('turnOn: a save the server refuses unsubscribes and says Not saved: try again', async () => {
  const p = phone();
  const S = S0([fp(OTHER)]);
  const ctx = ctxFor(S, { savePush: { ok: false, code: 'bad', reason: 'no' } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.ok(p.calls.includes('unsubscribe'));
  assert.equal(p.current(), null);
  assert.deepEqual(S.push.ids, [fp(OTHER)]);   // ids untouched on a refusal
  assert.equal(S.push.state, 'off');
});

test('turnOn: a save that throws (offline) is the same: unsubscribe and Not saved', async () => {
  const p = phone();
  const ctx = ctxFor(S0([]), { savePush: () => { throw new Error('offline'); } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Not saved: try again');
  assert.ok(p.calls.includes('unsubscribe'));
});

test('turnOn: a browser endpoint the server does not list is saved as the new endpoint (existing sub, same key, reused)', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT, key: KEY } });
  const S = S0([fp(OTHER)]);
  assert.equal(await SnowPush.refresh(S, p.env), 'off');
  const ctx = ctxFor(S, { savePush: { ok: true, push_ids: [fp(OTHER), fp(ENDPOINT)] } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.equal(r.ok, true);
  assert.ok(!p.calls.includes('subscribe'), 'the matching subscription is reused, not replaced');
  assert.deepEqual(ctx.sent, [{ action: 'savePush', body: { endpoint: ENDPOINT, lang: 'en' } }]);
  assert.equal(S.push.state, 'on');
});

test('turnOn: an existing subscription made with another key is not reused; a fresh one is made and saved', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: OTHER, key: OTHER_KEY }, newEndpoint: ENDPOINT });
  const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.equal(r.ok, true);
  assert.ok(p.calls.includes('subscribe'));
  assert.equal(ctx.sent[0].body.endpoint, ENDPOINT);
});

test('turnOn: subscribe rejects once (old key): unsubscribe the old one, try subscribe once more, then save', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: OTHER, key: OTHER_KEY }, subscribeFails: 1, newEndpoint: ENDPOINT });
  const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.equal(r.ok, true);
  assert.equal(p.calls.filter((c) => c === 'subscribe').length, 2);
  assert.ok(p.calls.indexOf('unsubscribe') > p.calls.indexOf('subscribe'), 'old one dropped after the first failure');
  assert.equal(ctx.sent[0].body.endpoint, ENDPOINT);
});

test('turnOn: subscribe rejecting twice gives up with Not saved: try again and saves nothing', async () => {
  const p = phone({ subscribeFails: 5 });
  const ctx = ctxFor(S0([]), {});
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.equal(p.calls.filter((c) => c === 'subscribe').length, 2);
  assert.equal(ctx.sent.length, 0);
});

// ---------- turnOff ----------
test('turnOff unsubscribes locally BEFORE dropPush, sends the endpoint, replaces ids with the reply', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const S = S0([fp(OTHER), fp(ENDPOINT)], KEY, 'on');
  const order = [];
  const ctx = ctxFor(S, { dropPush: () => { order.push('dropPush'); return { ok: true, push_ids: [fp(OTHER)] }; } });
  const sub = p.current();
  const origUn = sub.unsubscribe;
  sub.unsubscribe = function () { order.push('unsubscribe'); return origUn.call(this); };
  const r = await SnowPush.turnOff(ctx, p.env);
  assert.deepEqual(order, ['unsubscribe', 'dropPush']);
  assert.deepEqual(ctx.sent, [{ action: 'dropPush', body: { endpoint: ENDPOINT } }]);
  assert.deepEqual(r, { ok: true, state: 'off' });
  assert.deepEqual(S.push.ids, [fp(OTHER)]);
  assert.equal(S.push.state, 'off');
});

test('turnOff: dropPush failing (refused, or thrown) is still ok and the phone is unsubscribed', async () => {
  for (const answer of [{ ok: false, code: 'x', reason: 'y' }, () => { throw new Error('offline'); }]) {
    const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
    const S = S0([fp(ENDPOINT)], KEY, 'on');
    const ctx = ctxFor(S, { dropPush: answer });
    const r = await SnowPush.turnOff(ctx, p.env);
    assert.deepEqual(r, { ok: true, state: 'off' });
    assert.ok(p.calls.includes('unsubscribe'));
    assert.equal(p.current(), null);
  }
});

test('turnOff with no subscription in the browser: ok, nothing to drop', async () => {
  const p = phone({ permission: 'granted' });
  const ctx = ctxFor(S0([fp(OTHER)], KEY, 'off'), {});
  const r = await SnowPush.turnOff(ctx, p.env);
  assert.deepEqual(r, { ok: true, state: 'off' });
  assert.equal(ctx.sent.length, 0);
});

// ---------- rememberLang ----------
function fakeCaches() {
  const log = { opened: [], puts: [] };
  return { log, api: { open(name) { log.opened.push(name); return Promise.resolve({
    put(key, res) { return res.text().then((t) => { log.puts.push({ cache: name, key: typeof key === 'string' ? key : key.url, text: t }); }); } }); } } };
}

test('rememberLang writes exactly en or es to ./prefs/lang in titan-snow-prefs', async () => {
  for (const [given, want] of [['es', 'es'], ['en', 'en'], ['fr', 'en'], [undefined, 'en']]) {
    const c = fakeCaches();
    await SnowPush.rememberLang(given, { caches: c.api, Response: Response });
    assert.deepEqual(c.log.opened, ['titan-snow-prefs']);
    assert.deepEqual(c.log.puts, [{ cache: 'titan-snow-prefs', key: './prefs/lang', text: want }]);
  }
});

test('rememberLang never throws or rejects: no Cache API, open rejects, put throws', async () => {
  await SnowPush.rememberLang('es', { caches: undefined, Response: Response });
  await SnowPush.rememberLang('es', { caches: { open: () => Promise.reject(new Error('private mode')) }, Response: Response });
  await SnowPush.rememberLang('es', { caches: { open: () => { throw new Error('sync'); } }, Response: Response });
  await SnowPush.rememberLang('es', { caches: { open: () => Promise.resolve({ put: () => { throw new Error('quota'); } }) }, Response: Response });
});

// ---------- the words ----------
const ctxState = (state) => ({ S: { push: { key: KEY, ids: [], state } }, esc: (s) => String(s) });
const INSTALL = 'To get snow alerts on an iPhone, add Shovel Command to your home screen first: Share, then Add to Home Screen.';
const BLOCKED = "Notifications are blocked for Shovel Command in this phone's settings.";

// The buttons are found by data-push, never by an id: the Tonight card and the Your card row can be on screen at the same
// time (Your card is a dialog over Tonight), and two elements must never share an id (Task 8).
test('cardHtml: off has the heading and the Turn on notifications button (data-push="on", no id)', () => {
  const h = SnowPush.cardHtml(ctxState('off'));
  assert.ok(h.includes('id="pushcard"'));
  assert.ok(h.includes('Get snow alerts on this phone'));
  assert.match(h, /<button[^>]*data-push="on"[^>]*>Turn on notifications<\/button>/);
  assert.ok(!h.includes('id="pushOn"'));
  assert.ok(!h.includes('data-no-es'));
});

test('cardHtml: install has the sentence and NO button; blocked has the sentence and NO button', () => {
  const i = SnowPush.cardHtml(ctxState('install'));
  assert.ok(i.includes(INSTALL));
  assert.ok(!i.includes('<button') && !i.includes('data-push'));
  assert.ok(!i.includes('Get snow alerts on this phone'));
  const b = SnowPush.cardHtml(ctxState('blocked'));
  assert.ok(b.includes(BLOCKED));
  assert.ok(!b.includes('<button') && !b.includes('data-push'));
  assert.ok(!b.includes(INSTALL));
});

// The spec's "Not saved: try again on the card": the last refusal is kept on S.push.note and drawn on the card AND the row,
// escaped, under the button. No note, no line.
test('cardHtml and rowHtml: a note on S.push is drawn (escaped) as the card\'s and the row\'s last line; none, no line', () => {
  const ctx = ctxState('off');
  ctx.S.push.note = 'Not saved: <try> again';
  ctx.esc = (s) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const card = SnowPush.cardHtml(ctx), row = SnowPush.rowHtml(ctx);
  for (const h of [card, row]) {
    assert.match(h, /<p class="err pushnote">Not saved: &lt;try&gt; again<\/p><\/(section|div)>$/);
    assert.ok(!h.includes('<try>'));
  }
  assert.ok(!SnowPush.cardHtml(ctxState('off')).includes('pushnote'));
  assert.ok(!SnowPush.rowHtml(ctxState('off')).includes('pushnote'));
});

test('cardHtml: unsupported and on draw no card at all', () => {
  assert.equal(SnowPush.cardHtml(ctxState('unsupported')), '');
  assert.equal(SnowPush.cardHtml(ctxState('on')), '');
  assert.equal(SnowPush.cardHtml({ S: {}, esc: String }), '');
});

test('rowHtml: on shows Turn off; off shows Turn on; install and blocked show the sentence, no button; unsupported empty', () => {
  const on = SnowPush.rowHtml(ctxState('on'));
  assert.ok(on.includes('id="pushrow"'));
  assert.ok(on.includes('Snow alerts on this phone: on'));
  assert.match(on, /<button[^>]*data-push="off"[^>]*>Turn off<\/button>/);
  assert.ok(!on.includes('data-push="on"') && !on.includes('id="pushO'));
  const off = SnowPush.rowHtml(ctxState('off'));
  assert.ok(off.includes('Snow alerts on this phone: off'));
  assert.match(off, /<button[^>]*data-push="on"[^>]*>Turn on<\/button>/);
  assert.ok(!off.includes('data-push="off"') && !off.includes('id="pushO'));
  const inst = SnowPush.rowHtml(ctxState('install'));
  assert.ok(inst.includes(INSTALL));
  assert.ok(!inst.includes('<button'));
  const blk = SnowPush.rowHtml(ctxState('blocked'));
  assert.ok(blk.includes(BLOCKED));
  assert.ok(!blk.includes('<button'));
  assert.equal(SnowPush.rowHtml(ctxState('unsupported')), '');
});

// ---------- onClick ----------
// A click on a [data-push] button (or anything inside one): closest('[data-push]') answers it, with the button's dataset.
function click(which) {
  return { target: { closest(sel) { return sel === '[data-push]' && which ? { dataset: { push: which } } : null; } } };
}
const later = () => new Promise((r) => setTimeout(r, 20));
// A tap is finished when it has drawn the screen (onClick calls render() last). Waiting on that, never on a fixed time: a tap
// still out holds onClick's one-tap-at-a-time flag, and on a loaded machine a fixed 20 ms let one test's tap leak into the next.
async function until(ok, what) { for (let i = 0; i < 400; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error('never: ' + what); }
const drawn = (ctx, n) => until(() => (ctx.rendered || 0) >= n, 'drawn ' + n + ' time(s)');

test('onClick: data-push="on" starts turnOn (permission asked inside the click) and returns true', async () => {
  const p = phone();
  const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
  const handled = SnowPush.onClick(click('on'), ctx, p.env);
  assert.equal(handled, true);
  assert.deepEqual(p.calls, ['requestPermission']);
  await drawn(ctx, 1);
  assert.equal(ctx.sent[0].action, 'savePush');
});

test('onClick: data-push="off" starts turnOff and returns true; anything else returns false and does nothing', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const ctx = ctxFor(S0([fp(ENDPOINT)], KEY, 'on'), { dropPush: { ok: true, push_ids: [] } });
  assert.equal(SnowPush.onClick(click('off'), ctx, p.env), true);
  await drawn(ctx, 1);
  assert.equal(ctx.sent[0].action, 'dropPush');
  const p2 = phone();
  const ctx2 = ctxFor(S0([]), {});
  assert.equal(SnowPush.onClick(click(null), ctx2, p2.env), false);
  assert.equal(SnowPush.onClick({ target: {} }, ctx2, p2.env), false);
  assert.equal(SnowPush.onClick({}, ctx2, p2.env), false);
  assert.deepEqual(p2.calls, []);
  assert.deepEqual(ctx2.sent, []);
});

// The spec: "Not saved: try again" ON THE CARD. A refusal's words go to S.push.note (the card and the row draw it), never a toast;
// the screen is drawn again so the line shows.
test('onClick: a refusal reason is kept on S.push.note and drawn, not toasted', async () => {
  const p = phone();
  const ctx = ctxFor(S0([], null), {});
  SnowPush.onClick(click('on'), ctx, p.env);
  await drawn(ctx, 1);
  assert.equal(ctx.S.push.note, 'Snow alerts are not set up yet.');
  assert.deepEqual(ctx.toasts, []);
  assert.equal(ctx.rendered, 1);
});

test('onClick: a failed save leaves Not saved: try again on S.push.note; the next tap clears it as it starts', async () => {
  const p = phone();
  const ctx = ctxFor(S0([]), { savePush: { ok: false, code: 'network', reason: 'no signal' } });
  SnowPush.onClick(click('on'), ctx, p.env);
  await drawn(ctx, 1);
  assert.equal(ctx.S.push.note, 'Not saved: try again');
  // the second try answers late: the note is gone the moment the tap starts, before any answer
  ctx.call = () => new Promise((r) => setTimeout(() => r({ ok: false, code: 'network' }), 10));
  SnowPush.onClick(click('on'), ctx, p.env);
  assert.equal(ctx.S.push.note, null);
  await drawn(ctx, 2);                                // let it settle, so no tap is left in flight for the next test
});

test('onClick: turned on, the toast says Snow alerts are on. and an old note goes; turned off, Snow alerts are off.', async () => {
  const p = phone();
  const S = S0([]);
  S.push.note = 'Not saved: try again';
  const ctx = ctxFor(S, { savePush: { ok: true, push_ids: [fp(ENDPOINT)] }, dropPush: { ok: true, push_ids: [] } });
  SnowPush.onClick(click('on'), ctx, p.env);
  await drawn(ctx, 1);
  assert.equal(ctx.S.push.state, 'on');
  assert.deepEqual(ctx.toasts, ['Snow alerts are on.']);
  assert.equal(ctx.S.push.note, null);
  SnowPush.onClick(click('off'), ctx, p.env);
  await drawn(ctx, 2);
  assert.equal(ctx.S.push.state, 'off');
  assert.deepEqual(ctx.toasts, ['Snow alerts are on.', 'Snow alerts are off.']);
  assert.equal(ctx.rendered, 2);
});

// Blocked in the prompt: no words at all (the card's blocked line says it), and no toast claims anything.
test('onClick: Block in the prompt gives no note and no toast; the state is blocked', async () => {
  const p = phone({ askResult: 'denied' });
  const ctx = ctxFor(S0([]), {});
  SnowPush.onClick(click('on'), ctx, p.env);
  await drawn(ctx, 1);
  assert.equal(ctx.S.push.state, 'blocked');
  assert.equal(ctx.S.push.note || null, null);
  assert.deepEqual(ctx.toasts, []);
  assert.deepEqual(ctx.sent, []);
});

// Two taps on a slow phone: the second one, while the first is still out, asks nothing and sends nothing, and still counts as
// handled (no other handler gets the click). Once the first settles, a tap works again.
test('onClick: a second tap while the first is out does nothing; after it settles a tap works again', async () => {
  const p = phone();
  let answer;
  const ctx = ctxFor(S0([]), { savePush: () => new Promise((r) => { answer = r; }) });
  assert.equal(SnowPush.onClick(click('on'), ctx, p.env), true);
  await until(() => ctx.sent.length === 1, 'the save sent');
  assert.equal(SnowPush.onClick(click('on'), ctx, p.env), true);
  assert.equal(SnowPush.onClick(click('off'), ctx, p.env), true);
  await later();
  assert.deepEqual(p.calls.filter((c) => c === 'requestPermission'), ['requestPermission']);
  assert.equal(ctx.sent.length, 1);
  answer({ ok: true, push_ids: [fp(ENDPOINT)] });
  await drawn(ctx, 1);
  SnowPush.onClick(click('off'), ctx, p.env);
  await drawn(ctx, 2);
  assert.deepEqual(ctx.sent.map((s) => s.action), ['savePush', 'dropPush']);
});

// ---------- fix round 1 ----------
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('hung: no answer in ' + ms + ' ms')), ms))]);

test('refresh: an EMPTY server list while the browser has a subscription reads off (known is membership, not "any ids")', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const S = S0([]);
  assert.equal(await SnowPush.refresh(S, p.env), 'off');
});

test('turnOff: unsubscribe rejecting still sends dropPush, answers ok, state off', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  p.current().unsubscribe = () => Promise.reject(new Error('InvalidState'));
  const S = S0([fp(ENDPOINT)], KEY, 'on');
  const ctx = ctxFor(S, { dropPush: { ok: true, push_ids: [] } });
  const r = await SnowPush.turnOff(ctx, p.env);
  assert.deepEqual(ctx.sent, [{ action: 'dropPush', body: { endpoint: ENDPOINT } }]);
  assert.equal(r.ok, true);
  assert.deepEqual(S.push.ids, []);
});

test('overlapping refreshes resolving out of order leave the NEWER answer in S.push.state', async () => {
  const slow = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const held = slow.current();
  let release;
  slow.reg.pushManager.getSubscription = () => new Promise((r) => { release = () => r(held); });
  const S = S0([fp(ENDPOINT)]);
  const older = SnowPush.refresh(S, slow.env);           // would read 'on', lands last
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await SnowPush.refresh(S, phone({ permission: 'denied' }).env), 'blocked');   // newer, lands first
  release();
  await older;
  assert.equal(S.push.state, 'blocked');
});

test('a refresh answers the push object it started with: a replaced S.push is not written by the old refresh', async () => {
  const slow = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const held = slow.current();
  let release;
  slow.reg.pushManager.getSubscription = () => new Promise((r) => { release = () => r(held); });
  const S = S0([fp(ENDPOINT)]);
  const oldObj = S.push;
  const older = SnowPush.refresh(S, slow.env);
  await new Promise((r) => setTimeout(r, 5));
  S.push = { key: KEY, ids: [], state: 'off' };           // a newer bootstrap replaced it
  release();
  await older;
  assert.equal(S.push.state, 'off');
  assert.equal(oldObj.state, 'on');
});

test('turnOn learns the answer from a callback-style requestPermission (old Safari: returns undefined)', async () => {
  for (const [answer, ok, state] of [['granted', true, 'on'], ['denied', false, 'blocked']]) {
    for (const when of ['sync', 'later']) {
      const p = phone();
      let n = 0;
      p.env.Notification.requestPermission = function (cb) {
        n++; p.calls.push('requestPermission');
        if (when === 'sync') cb(answer); else setTimeout(() => cb(answer), 5);
        return undefined;
      };
      const perm = { v: 'default' };
      Object.defineProperty(p.env.Notification, 'permission', { get: () => perm.v });
      const origCb = p.env.Notification.requestPermission;
      p.env.Notification.requestPermission = function (cb) { return origCb.call(this, (a) => { perm.v = a; cb(a); }); };
      const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
      const pending = SnowPush.turnOn(ctx, p.env);
      assert.deepEqual(p.calls, ['requestPermission'], 'first and only synchronous call');
      const r = await within(pending, 1000);
      assert.equal(n, 1, 'asked exactly once');
      assert.equal(r.ok, ok, answer + ' ' + when);
      assert.equal(r.state, state);
    }
  }
});

test('turnOn with a promise-style requestPermission that never calls the callback still works, and asks once', async () => {
  const p = phone();
  let n = 0;
  const inner = p.env.Notification.requestPermission;
  p.env.Notification.requestPermission = function () { n++; return inner.call(this); };   // ignores the callback argument
  const ctx = ctxFor(S0([]), { savePush: { ok: true, push_ids: [fp(ENDPOINT)] } });
  const r = await within(SnowPush.turnOn(ctx, p.env), 1000);
  assert.equal(r.ok, true);
  assert.equal(n, 1);
});

test('no service worker registration (file://, first load): turnOn and turnOff finish and never wait on ready', async () => {
  function noReg(over) {
    const p = phone(over);
    p.env.navigator.serviceWorker = { getRegistration() { p.calls.push('getRegistration'); return Promise.resolve(undefined); }, get ready() { throw new Error('ready must not be read'); } };
    return p;
  }
  const on = noReg();
  const ctxOn = ctxFor(S0([], KEY, 'off'), {});
  const r = await within(SnowPush.turnOn(ctxOn, on.env), 1000);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.equal(on.calls[0], 'requestPermission');
  assert.equal(ctxOn.sent.length, 0);
  const never = phone({ permission: 'granted' });
  never.env.navigator.serviceWorker = { getRegistration: () => Promise.resolve(undefined), ready: new Promise(() => {}) };
  const ctxOff = ctxFor(S0([], KEY, 'off'), {});
  assert.deepEqual(await within(SnowPush.turnOff(ctxOff, never.env), 1000), { ok: true, state: 'off' });
  const never2 = phone();
  never2.env.navigator.serviceWorker = { getRegistration: () => Promise.resolve(undefined), ready: new Promise(() => {}) };
  assert.equal((await within(SnowPush.turnOn(ctxFor(S0([], KEY, 'off'), {}), never2.env), 1000)).reason, 'Not saved: try again');
});

// ---------- fix round 2: after a failed save the state is a fresh reading, never a remembered one ----------
// Rule used for every expected value (stateOf): permission granted + NOT subscribed -> off; granted + subscribed + listed
// by the server -> on; granted + subscribed + not listed -> off; denied -> blocked.
test('failed save, previous state on: the subscription is unsubscribed, so the phone reads off (granted, not subscribed)', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const S = S0([fp(ENDPOINT)], KEY, 'on');
  const ctx = ctxFor(S, { savePush: { ok: false, code: 'bad', reason: 'no' } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.equal(S.push.state, 'off');
  assert.equal(p.current(), null);
});

test('failed save, previous state blocked but permission is now granted: off, not blocked', async () => {
  const p = phone({ permission: 'default', askResult: 'granted' });
  const S = S0([], KEY, 'blocked');
  const ctx = ctxFor(S, { savePush: { ok: false, code: 'bad', reason: 'no' } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.equal(S.push.state, 'off');
});

test('failed save and the unsubscribe REJECTS, the server still lists the endpoint: the truth is on (granted + subscribed + listed)', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  p.current().unsubscribe = () => Promise.reject(new Error('InvalidState'));
  const S = S0([fp(OTHER), fp(ENDPOINT)], KEY, 'on');
  const ctx = ctxFor(S, { savePush: { ok: false, code: 'bad', reason: 'no' } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'on', reason: 'Not saved: try again' });
  assert.equal(S.push.state, 'on');
});

test('failed save and the unsubscribe rejects, the server does NOT list the endpoint: off (subscribed but not listed)', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  p.current().unsubscribe = () => Promise.reject(new Error('InvalidState'));
  const S = S0([fp(OTHER)], KEY, 'off');
  const ctx = ctxFor(S, { savePush: { ok: false, code: 'bad', reason: 'no' } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
});

test('no registration with a stale previous state on: the answer is the fresh reading off (granted, not subscribed)', async () => {
  const p = phone({ permission: 'granted' });
  p.env.navigator.serviceWorker = { getRegistration: () => Promise.resolve(undefined), ready: new Promise(() => {}) };
  const S = S0([fp(ENDPOINT)], KEY, 'on');
  const r = await within(SnowPush.turnOn(ctxFor(S, {}), p.env), 1000);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.equal(S.push.state, 'off');
});

test('subscribe failing twice with a stale previous state on: fresh reading off', async () => {
  const p = phone({ permission: 'granted', subscribeFails: 5 });
  const S = S0([fp(ENDPOINT)], KEY, 'on');
  const r = await SnowPush.turnOn(ctxFor(S, {}), p.env);
  assert.deepEqual(r, { ok: false, state: 'off', reason: 'Not saved: try again' });
  assert.equal(S.push.state, 'off');
});

test('a bootstrap replacing S.push during turnOn: the NEW object gets the save reply ids and reads on', async () => {
  // new object starts with an EMPTY list; the reply lists the new endpoint -> granted + subscribed + listed = on
  const p = phone();
  const S = S0([]);
  const old = S.push;
  const ctx = ctxFor(S, { savePush: () => { S.push = { key: KEY, ids: [fp(OTHER)], state: 'off' }; return { ok: true, push_ids: [fp(OTHER), fp(ENDPOINT)] }; } });
  const r = await SnowPush.turnOn(ctx, p.env);
  assert.deepEqual(r, { ok: true, state: 'on' });
  assert.notEqual(S.push, old);
  assert.deepEqual(S.push.ids, [fp(OTHER), fp(ENDPOINT)]);
  assert.equal(S.push.state, 'on');
});

test('a bootstrap replacing S.push during turnOff: the NEW object gets the dropPush reply ids and reads off', async () => {
  const p = phone({ permission: 'granted', sub: { endpoint: ENDPOINT } });
  const S = S0([fp(ENDPOINT)], KEY, 'on');
  const ctx = ctxFor(S, { dropPush: () => { S.push = { key: KEY, ids: [fp(ENDPOINT)], state: 'on' }; return { ok: true, push_ids: [fp(OTHER)] }; } });
  const r = await SnowPush.turnOff(ctx, p.env);
  assert.deepEqual(r, { ok: true, state: 'off' });
  assert.deepEqual(S.push.ids, [fp(OTHER)]);
  assert.equal(S.push.state, 'off');
});

// ---------- Task 9: the dispatcher's words (lib/push.js SnowPush.words) ----------
// The lines are the spec's own (2026-11-09 spec, "What Matt and the dispatcher see"), with its singulars worked by hand. The clock
// is the app's (lib/shiftlogui.js clock); here a table: the reply's at -> the time the card prints. On paper: 03:00Z is 6:00 PM in
// Alaska (UTC-9), 02:55Z is 5:55 PM.
const W = SnowPush.words;
const CLOCK = { '2026-12-06T03:00:00.000Z': '6:00 PM', '2026-12-06T02:55:00.000Z': '5:55 PM' };
const clockOf = (iso) => CLOCK[iso];
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('words.confirm: the dialog line counts phones and people, singular at 1; nobody on is null', () => {
  assert.equal(W.confirm({ phones: 7, people: 6 }), 'Send "Snow tonight. Open Shovel Command for your route." to 7 phones (6 people)?');
  assert.equal(W.confirm({ phones: 1, people: 1 }), 'Send "Snow tonight. Open Shovel Command for your route." to 1 phone (1 person)?');
  assert.equal(W.confirm({ phones: 3, people: 1 }), 'Send "Snow tonight. Open Shovel Command for your route." to 3 phones (1 person)?');
  assert.equal(W.confirm({ phones: 0, people: 0 }), null);
  assert.equal(W.confirm(null), null);
  assert.equal(W.confirm(undefined), null);
});

test('words.sent / gone / failed: the three result lines; gone and failed are null at 0; it says Sent to, never Delivered', () => {
  assert.equal(W.sent({ sent: 7, at: '2026-12-06T03:00:00.000Z' }, clockOf), 'Sent to 7 phones at 6:00 PM.');
  assert.equal(W.sent({ sent: 1, at: '2026-12-06T03:00:00.000Z' }, clockOf), 'Sent to 1 phone at 6:00 PM.');
  assert.equal(W.sent({ sent: 0, at: '2026-12-06T03:00:00.000Z' }, clockOf), 'Sent to 0 phones at 6:00 PM.');
  assert.equal(W.gone(0), null);
  assert.equal(W.gone(1), '1 phone can no longer be reached.');
  assert.equal(W.gone(2), '2 phones can no longer be reached.');
  assert.equal(W.failed(0), null);
  assert.equal(W.failed(1), '1 phone did not accept it.');
  assert.equal(W.failed(2), '2 phones did not accept it.');
});

test('words.lastHtml: Last alert with the time, the name under data-no-es (escaped), the phones sent to; none is empty', () => {
  assert.equal(W.lastHtml({ at: '2026-12-06T03:00:00.000Z', by_name: 'Matthew', sent: 7, gone: 0, failed: 0 }, clockOf, escHtml),
    'Last alert: 6:00 PM by <span data-no-es>Matthew</span> · 7 phones.');
  assert.equal(W.lastHtml({ at: '2026-12-06T03:00:00.000Z', by_name: 'A <b>', sent: 1, gone: 2, failed: 3 }, clockOf, escHtml),
    'Last alert: 6:00 PM by <span data-no-es>A &lt;b&gt;</span> · 1 phone.');
  assert.equal(W.lastHtml(null, clockOf, escHtml), '');
});

test('words.tooSoonHtml: the gap refusal with the time and name of the first send, and its minutes', () => {
  assert.equal(W.tooSoonHtml({ code: 'too_soon', at: '2026-12-06T02:55:00.000Z', by_name: 'Jordan Demo', wait_min: 10 }, clockOf, escHtml),
    'Already sent at 5:55 PM by <span data-no-es>Jordan Demo</span>. Wait 10 minutes between alerts.');
  assert.equal(W.tooSoonHtml({ code: 'too_soon', at: '2026-12-06T02:55:00.000Z', by_name: 'Jordan Demo', wait_min: 1 }, clockOf, escHtml),
    'Already sent at 5:55 PM by <span data-no-es>Jordan Demo</span>. Wait 1 minute between alerts.');
});

test('words.crewLine: the roster card line, on (N phones) or off; a backend that sent no count says nothing', () => {
  assert.equal(W.crewLine({ push_phones: 2 }), 'Snow alerts: on (2 phones)');
  assert.equal(W.crewLine({ push_phones: 1 }), 'Snow alerts: on (1 phone)');
  assert.equal(W.crewLine({ push_phones: 0 }), 'Snow alerts: off');
  assert.equal(W.crewLine({}), null);
  assert.equal(W.crewLine({ push_phones: null }), null);
});

