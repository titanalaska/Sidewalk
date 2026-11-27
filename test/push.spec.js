// Snow alerts, the crew's side (crew notifications, Task 8): the Tonight card, the Your card row, Turn on / Turn off, and off at
// sign-out. lib/push.js is node-tested on its own (test/push.test.js); this file is the PAGE: the real page over file://, a fake
// push system put in before the app's scripts run, and its own small fake backend answering with the real reply shapes
// (snow-app-script Code.js savePush_ / dropPush_ / pushFor_). Made-up names only.
//
// Worked on paper:
//   the push address is ENDPOINT below; the server's id for it is the first 16 hex of SHA-256 over its UTF-8 bytes (fp()).
//   "on" = permission granted + a subscription in the browser + its id in the server's push_ids. Anything short of all three is
//   "off" (the card), except denied (the blocked line), an iPhone in a browser tab with no PushManager (the install line) and a
//   browser with no push at all (nothing).
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { fakePush: fakePushIn } = require('./push-fake.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/fake-Phone_1:APA91b-Test';
const fp = (e) => crypto.createHash('sha256').update(e, 'utf8').digest('hex').slice(0, 16);
// A 65-byte made-up public key (0x04 then 64 bytes), base64url with no padding: 87 characters, as the server's push_key.
const KEY_BYTES = Buffer.alloc(65); KEY_BYTES[0] = 4;
for (let i = 1; i < 65; i++) KEY_BYTES[i] = (i * 29 + 7) % 256;
const PUSH_KEY = KEY_BYTES.toString('base64url');

const EN = {
  head: 'Get snow alerts on this phone', on: 'Turn on notifications',
  install: 'To get snow alerts on an iPhone, add Shovel Command to your home screen first: Share, then Add to Home Screen.',
  blocked: "Notifications are blocked for Shovel Command in this phone's settings.",
  rowOn: 'Snow alerts on this phone: on', rowOff: 'Snow alerts on this phone: off',
};

const WHO = { 'tok-jordan': { name: 'Jordan Demo', role: 'crew', crew_id: 'C03' }, 'tok-alex': { name: 'Alex Test', role: 'lead', crew_id: 'C01' } };
const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area', 'card_line'];
const selfView = (c) => ({ id: c.id, name: c.name, pending: false, ...Object.fromEntries(SELF.map((k) => [k, c[k] === undefined ? null : c[k]])) });
// The server's endpoint rule (push.js endpointProblem), as much of it as these tests reach.
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)\//;

// state.push: the Push tab, one record per phone. state.calls: every snow call, in order. state.offline: every snow call is dropped.
// state.refuseSave: savePush answers this refusal.
function world(o = {}) {
  return {
    crew: [{ id: 'C01', name: 'Alex Test', rev: 1, phone: '', is_lead: true }, { id: 'C03', name: 'Jordan Demo', rev: 1, phone: '', is_lead: false, photo_thumb: 'data:image/png;base64,iVBORw0KGgo=' }],
    push: o.listed ? [{ by_key: 'C03', endpoint: ENDPOINT, lang: 'en', archived: false }] : [],
    pushKey: o.noKey ? null : PUSH_KEY, calls: [], offline: false, refuseSave: null,
  };
}
const idsFor = (state, key) => state.push.filter((p) => !p.archived && p.by_key === key).map((p) => fp(p.endpoint));

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'notify-1', action: body.action };
    const me = WHO[body.token];
    if (!me) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const own = state.crew.find((c) => c.id === me.crew_id);
    if (body.action === 'bootstrap') {
      return { ok: true, me, admin_name: 'Matthew', sites: [], routes: [], zones: [], post: null, card: selfView(own),
        crew: state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: c.is_lead })),
        push_key: state.pushKey, push_ids: idsFor(state, me.crew_id), ...v };
    }
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'savePush') {
      if (state.refuseSave) return { ok: false, ...state.refuseSave, ...v };
      if (typeof body.endpoint !== 'string' || body.endpoint.length > 1000 || !PUSH_HOSTS.test(body.endpoint)) return { ok: false, code: 'invalid', reason: 'That is not a push service address', ...v };
      if (body.lang !== 'en' && body.lang !== 'es') return { ok: false, code: 'invalid', reason: 'Pick English or Spanish', ...v };
      const had = state.push.find((p) => !p.archived && p.endpoint === body.endpoint);
      if (had) Object.assign(had, { by_key: me.crew_id, lang: body.lang });   // the same phone saved again (or handed on) is one record
      else state.push.push({ by_key: me.crew_id, endpoint: body.endpoint, lang: body.lang, archived: false });
      return { ok: true, push_ids: idsFor(state, me.crew_id), ...v };
    }
    if (body.action === 'dropPush') {
      state.push.forEach((p) => { if (!p.archived && p.by_key === me.crew_id && p.endpoint === body.endpoint) p.archived = true; });
      return { ok: true, push_ids: idsFor(state, me.crew_id), ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

// The phone's push system, faked in the page (test/push-fake.js): this phone's address is ENDPOINT, an existing subscription is
// made with PUSH_KEY.
const fakePush = (page, o) => fakePushIn(page, o, ENDPOINT, PUSH_KEY);

async function open(page, state, { token = 'tok-jordan', push = {}, lang } = {}) {
  await page.setViewportSize({ width: 390, height: 760 });
  const fake = fakeSnow(state);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.calls.push(body);
    if (state.offline) return route.abort('failed');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [{ id: 3, name: 'Jordan Demo', status: 'approved', hasPin: true }] }) }));
  await fakePush(page, push);
  await page.addInitScript(([t, l]) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('titan-snow-token', t); if (l) localStorage.setItem('snow-lang', l); sessionStorage.setItem('seeded', '1'); }
  }, [token, lang || '']);
  await page.goto(PAGE);
  await expect(page.locator('#tabs [data-tab="tonight"]')).toBeVisible();
  return errors;
}
const pushCalls = (state) => state.calls.filter((c) => c.action === 'savePush' || c.action === 'dropPush');
const P = (page) => page.evaluate(() => window.__push);
const card = (page) => page.locator('#pushcard');
async function yourCard(page) {
  await page.click('#yourCard');
  await expect(page.locator('#dlg #s_save')).toBeVisible();
}

test.describe('push:', () => {
  test('Tonight, a phone that can and is not on: the card above the post, with Turn on notifications', async ({ page }) => {
    const errors = await open(page, world(), { push: { permission: 'default' } });
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('h2')).toHaveText(EN.head);
    await expect(card(page).locator('[data-push="on"]')).toHaveText(EN.on);
    // above the post: the card comes before the "Not posted yet" card in the page
    const order = await page.evaluate(() => {
      const secs = Array.from(document.querySelectorAll('#main section'));
      return { push: secs.indexOf(document.getElementById('pushcard')), post: secs.findIndex((s) => /Not posted yet/.test(s.textContent)) };
    });
    expect(order.post).toBeGreaterThan(order.push);
    expect(order.push).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('an iPhone in a browser tab: the add-to-home-screen line and no button', async ({ page }) => {
    await open(page, world(), { push: { ios: true, push: false } });
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveText(EN.install);
    await expect(card(page).locator('button')).toHaveCount(0);
  });

  test('blocked in the settings: the blocked line and no button', async ({ page }) => {
    await open(page, world(), { push: { permission: 'denied' } });
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveText(EN.blocked);
    await expect(card(page).locator('button')).toHaveCount(0);
  });

  test('alerts already on (granted, subscribed, listed): no card on Tonight; Your card reads on with Turn off', async ({ page }) => {
    await open(page, world({ listed: true }), { push: { permission: 'granted', subscribed: true } });
    await yourCard(page);
    await expect(page.locator('#pushrow span')).toHaveText(EN.rowOn);   // the refresh has settled on "on"
    await expect(page.locator('#pushrow [data-push="off"]')).toHaveText('Turn off');
    await expect(card(page)).toHaveCount(0);
  });

  test('a subscription the server does not list (dropped as gone) reads off: the card offers Turn on', async ({ page }) => {
    await open(page, world({ listed: false }), { push: { permission: 'granted', subscribed: true } });
    await expect(card(page).locator('[data-push="on"]')).toBeVisible();
  });

  test('a browser with no push at all: no card and no row', async ({ page }) => {
    await open(page, world(), { push: { push: false } });
    await yourCard(page);
    await expect(page.locator('#dlg #s_cancel')).toBeVisible();
    await expect(page.locator('#pushrow')).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
  });

  test('Turn on: asked inside the tap, then subscribe, then savePush { endpoint, lang: en }; the card goes; the toast; Your card on', async ({ page }) => {
    const w = world();
    await open(page, w, { push: { permission: 'default', answer: 'granted' } });
    await card(page).locator('[data-push="on"]').click();
    await expect(page.locator('#toast')).toHaveText('Snow alerts are on.');
    await expect(card(page)).toHaveCount(0);
    const p = await P(page);
    expect(p.askedInClick).toEqual([true]);
    expect(p.calls).toEqual(['requestPermission', 'subscribe']);
    const saves = pushCalls(w);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toEqual({ action: 'savePush', endpoint: ENDPOINT, lang: 'en', token: 'tok-jordan' });
    await yourCard(page);
    await expect(page.locator('#pushrow span')).toHaveText(EN.rowOn);
    await expect(page.locator('#pushrow [data-push="off"]')).toBeVisible();
  });

  test('Block in the prompt: nothing saved, nothing subscribed, the blocked line', async ({ page }) => {
    const w = world();
    await open(page, w, { push: { permission: 'default', answer: 'denied' } });
    await card(page).locator('[data-push="on"]').click();
    await expect(card(page)).toHaveText(EN.blocked);
    await expect(card(page).locator('button')).toHaveCount(0);
    expect(pushCalls(w)).toEqual([]);
    expect((await P(page)).calls).toEqual(['requestPermission']);
  });

  test('the save refused: Not saved: try again on the card, the phone unsubscribed, Turn on still offered', async ({ page }) => {
    const w = world();
    w.refuseSave = { code: 'invalid', reason: 'That is not a push service address' };
    await open(page, w, { push: { permission: 'default', answer: 'granted' } });
    await card(page).locator('[data-push="on"]').click();
    await expect(card(page).locator('.pushnote')).toBeVisible();
    await expect(card(page).locator('.pushnote')).toHaveText('Not saved: try again');
    expect((await P(page)).unsubs).toBe(1);
    await expect(card(page).locator('[data-push="on"]')).toBeVisible();
    await expect(page.locator('#toast')).toBeHidden();                  // no toast claims anything
    // a later tap that works takes the line away
    w.refuseSave = null;
    await card(page).locator('[data-push="on"]').click();
    await expect(card(page)).toHaveCount(0);
  });

  test('Turn off from Your card: dropPush with the endpoint, the row reads off at once, the Tonight card is back', async ({ page }) => {
    const w = world({ listed: true });
    await open(page, w, { push: { permission: 'granted', subscribed: true } });
    await yourCard(page);
    await expect(page.locator('#pushrow span')).toHaveText(EN.rowOn);
    await page.locator('#pushrow [data-push="off"]').click();
    await expect(page.locator('#pushrow span')).toHaveText(EN.rowOff);   // the open dialog's row is drawn again
    await expect(page.locator('#pushrow [data-push="on"]')).toHaveText('Turn on');
    await expect(page.locator('#toast')).toHaveText('Snow alerts are off.');
    expect(pushCalls(w)).toEqual([{ action: 'dropPush', endpoint: ENDPOINT, token: 'tok-jordan' }]);
    expect((await P(page)).unsubs).toBe(1);
    await page.click('#s_cancel');
    await expect(card(page).locator('[data-push="on"]')).toBeVisible();
  });

  test('sign-out with alerts on: dropPush goes with the token it had, the phone unsubscribes, the sign-in screen', async ({ page }) => {
    const w = world({ listed: true });
    await open(page, w, { push: { permission: 'granted', subscribed: true } });
    await yourCard(page);
    await expect(page.locator('#pushrow span')).toHaveText(EN.rowOn);
    await page.click('#s_cancel');
    await page.click('#signout');
    await expect(page.locator('#signin')).toBeVisible();
    await expect.poll(() => pushCalls(w).length).toBe(1);
    expect(pushCalls(w)[0]).toEqual({ action: 'dropPush', endpoint: ENDPOINT, token: 'tok-jordan' });
    expect((await P(page)).unsubs).toBe(1);
    expect(w.push.filter((p) => !p.archived)).toEqual([]);
  });

  test('sign-out with no signal at all: still signed out, still unsubscribed, and nothing claims alerts are on', async ({ page }) => {
    const w = world({ listed: true });
    await open(page, w, { push: { permission: 'granted', subscribed: true } });
    await yourCard(page);
    await expect(page.locator('#pushrow span')).toHaveText(EN.rowOn);
    await page.click('#s_cancel');
    w.offline = true;
    await page.click('#signout');
    await expect(page.locator('#signin')).toBeVisible();
    await expect.poll(async () => (await P(page)).unsubs).toBe(1);
    // nothing on screen claims anything (the closed Your card dialog still holds its row, hidden)
    await expect(page.locator('#pushcard')).toHaveCount(0);
    await expect(page.locator('#pushrow:visible')).toHaveCount(0);
    await expect(page.locator('#toast')).not.toHaveText(/Snow alerts are on/);
  });

  test('a second tap while the prompt is still up asks once and saves once', async ({ page }) => {
    const w = world();
    await open(page, w, { push: { permission: 'default', answer: 'granted', askMs: 600 } });
    const btn = card(page).locator('[data-push="on"]');
    await btn.click();
    await btn.click();
    await expect(card(page)).toHaveCount(0);
    expect((await P(page)).calls.filter((c) => c === 'requestPermission')).toHaveLength(1);
    expect(pushCalls(w)).toHaveLength(1);
  });

  test('Spanish: the card and the row read Spanish, the save says lang es, no English is left', async ({ page }) => {
    const w = world();
    await open(page, w, { push: { permission: 'default', answer: 'granted' }, lang: 'es' });
    await expect(card(page).locator('h2')).toHaveText('Recibe alertas de nieve en este teléfono');
    await expect(card(page).locator('[data-push="on"]')).toHaveText('Activar notificaciones');
    await yourCard(page);
    await expect(page.locator('#pushrow span')).toHaveText('Alertas de nieve en este teléfono: desactivadas');
    await expect(page.locator('#pushrow [data-push="on"]')).toHaveText('Activar');
    await page.locator('#pushrow [data-push="on"]').click();
    await expect(page.locator('#pushrow span')).toHaveText('Alertas de nieve en este teléfono: activadas');
    expect((await P(page)).askedInClick).toEqual([true]);   // the Your card row asks inside the tap, as the Tonight card does
    await expect(page.locator('#pushrow [data-push="off"]')).toHaveText('Desactivar');
    await expect(page.locator('#toast')).toHaveText('Alertas de nieve activadas.');
    expect(pushCalls(w)[0]).toEqual({ action: 'savePush', endpoint: ENDPOINT, lang: 'es', token: 'tok-jordan' });
    const left = await page.locator('#pushrow, #toast').allInnerTexts();
    for (const t of left) expect(t).not.toMatch(/\b(Snow|alerts|Turn|phone|on|off)\b/);
  });

  test('Spanish: the iPhone line and the blocked line', async ({ page }) => {
    await open(page, world(), { push: { ios: true, push: false }, lang: 'es' });
    await expect(card(page)).toHaveText('Para recibir alertas de nieve en un iPhone, primero agrega Shovel Command a tu pantalla de inicio: Compartir y luego Agregar a inicio.');
  });

  test('Spanish: a refused save reads No se guardó: inténtalo de nuevo on the card', async ({ page }) => {
    const w = world();
    w.refuseSave = { code: 'invalid', reason: 'That is not a push service address' };
    await open(page, w, { push: { permission: 'default', answer: 'granted' }, lang: 'es' });
    await card(page).locator('[data-push="on"]').click();
    await expect(card(page).locator('.pushnote')).toHaveText('No se guardó: inténtalo de nuevo');
  });

  test('Spanish: the blocked line', async ({ page }) => {
    await open(page, world(), { push: { permission: 'denied' }, lang: 'es' });
    await expect(card(page)).toHaveText('Las notificaciones de Shovel Command están bloqueadas en la configuración de este teléfono.');
  });
});
