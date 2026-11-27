// Notify the crew (crew notifications, Task 9): the dispatcher's side. A button on Tonight's outlook card (Matt and a dispatcher,
// role admin), its dialog, the three result lines, Last alert, the 10-minute refusal, a bell on the Roster's tiles and a line on
// the person's card, and this phone's own alerts on the outlook card. The words are lib/push.js SnowPush.words (node tests in
// test/push.test.js); this file is the PAGE: the real page over file://, its own small fake backend answering with the real reply
// shapes (snow-app-script Code.js notifyCrew_ / pushAdminFields_), made-up names only.
//
// Worked on paper. Times print on this phone's Alaska clock (UTC-9 in December):
//   a send at 2026-12-06T03:00:00.000Z prints 6:00 PM; the earlier one at 02:55Z prints 5:55 PM.
//   The admin's sign-in says 7 phones on, 6 people (push_count); C01 Alex Test has 2 phones, C02 Ben Dispatch 1, C03 Jordan Demo 0.
const { test, expect } = require('./no-real-weather.js');
const { toScreen } = require('./crewtab.js');
const { fakePush } = require('./push-fake.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-12-06T02:40:00.000Z';   // 5:40 PM in Alaska: the evening heads-up
const AT = '2026-12-06T03:00:00.000Z', EARLIER = '2026-12-06T02:55:00.000Z';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/fake-Dispatch_1:APA91b-Test';
const KEY_BYTES = Buffer.alloc(65); KEY_BYTES[0] = 4;
for (let i = 1; i < 65; i++) KEY_BYTES[i] = (i * 31 + 3) % 256;
const PUSH_KEY = KEY_BYTES.toString('base64url');
const LINE = 'Snow tonight. Open Shovel Command for your route.';

test.use({ timezoneId: 'America/Anchorage' });

const WHO = { 'tok-matt': { name: 'Matthew', role: 'admin', crew_id: null }, 'tok-ben': { name: 'Ben Dispatch', role: 'admin', crew_id: 'C02' },
  'tok-alex': { name: 'Alex Test', role: 'lead', crew_id: 'C01' }, 'tok-jordan': { name: 'Jordan Demo', role: 'crew', crew_id: 'C03' } };
function world() {
  return {
    crew: [{ id: 'C01', name: 'Alex Test', rev: 1, phone: '', is_lead: true, push_phones: 2 },
      { id: 'C02', name: 'Ben Dispatch', rev: 1, phone: '', is_lead: false, dispatch: true, push_phones: 1 },
      { id: 'C03', name: 'Jordan Demo', rev: 1, phone: '', is_lead: false, push_phones: 0 }],
    sites: [{ id: 'S1', name: 'PAC', rev: 1 }], routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
    // Tonight's post (night-2026-12-05 is the night shift on offer at 5:40 PM on 12/5): Alex leads N1, so on his phone the Storm tab
    // is the live view, the same screen Matt's outlook card sits on. A lead never gets the card: that is what the lead test checks.
    post: { id: 'P1', rev: 1, shift: 'night-2026-12-05', posted_at: '2026-12-06T01:00:00.000Z',
      people: { C01: { name: 'Alex Test', phone: null, shifts: { night: 0, day: 0 } }, C03: { name: 'Jordan Demo', phone: null, shifts: { night: 0, day: 0 } } },
      routes: [{ id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'] }] },
    pushCount: { phones: 7, people: 6 }, lastNotice: null,
    notify: { ok: true, sent: 7, gone: 0, failed: 0, at: AT, by_name: 'Matthew' }, hold: null, offline: false, calls: [],
  };
}
const card = (c) => ({ id: c.id, name: c.name, pending: false, phone: c.phone || null });

function fakeSnow(state) {
  return async (body) => {
    const v = { version: 'notify-1', action: body.action };
    const me = WHO[body.token];
    if (!me) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const admin = me.role === 'admin';
    if (body.action === 'bootstrap') {
      // The crew's own copy never carries push_phones (Code.js PUBLIC_CREW_FIELDS); an admin's carries all three push fields.
      const crew = admin ? state.crew : state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: null, is_lead: c.is_lead }));
      const out = { ok: true, me, admin_name: 'Matthew', sites: state.sites, routes: state.routes, zones: [], crew, post: state.post, push_key: PUSH_KEY, push_ids: [], ...v };
      if (admin) Object.assign(out, { moves: [], callouts: [], gear: [], push_count: state.pushCount, last_notice: state.lastNotice });
      else out.card = card(state.crew.find((c) => c.id === me.crew_id));
      return out;
    }
    if (body.action === 'getPost') return { ok: true, post: state.post, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: { posts: 0 }, reset: { posts: false }, posts: [], ...v };
      ['log', 'storms', 'visits', 'trucks', 'sheets'].forEach((t) => { out[t] = []; out.cursor[t] = 0; out.reset[t] = false; });
      return out;
    }
    if (body.action === 'notifyCrew') {
      state.calls.push(body);
      if (!admin) return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      if (state.hold) await state.hold;
      if (state.offline) return 'abort';
      return { ...state.notify, ...v };
    }
    if (body.action === 'savePush' || body.action === 'dropPush') {
      state.calls.push(body);
      return { ok: true, push_ids: body.action === 'savePush' ? [require('crypto').createHash('sha256').update(body.endpoint, 'utf8').digest('hex').slice(0, 16)] : [], ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, token = 'tok-matt', o = {}) {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.clock.install({ time: new Date(CLOCK) });
  if (o.lang) await page.addInitScript((l) => localStorage.setItem('snow-lang', l), o.lang);
  await fakePush(page, o.push || { push: false }, ENDPOINT, PUSH_KEY);
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const out = await fake(JSON.parse(route.request().postData() || '{}'));
    if (out === 'abort') return route.abort('failed');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [] }) }));
  await page.addInitScript((t) => localStorage.setItem('titan-snow-token', t), token);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');   // crew and leads land on Tonight; everyone has a Storm tab
  await expect(page.locator('#stormhead')).toBeVisible();
  return errors;
}
const sends = (w) => w.calls.filter((c) => c.action === 'notifyCrew');
const box = (page) => page.locator('#outlook');

test.describe('notify:', () => {
  test('the button is on the outlook card before Check outlook is tapped', async ({ page }) => {
    await open(page, world());
    await expect(box(page).locator('#outlookCheck')).toHaveText('Check outlook');
    await expect(box(page).locator('#notifyCrew')).toBeVisible();
    await expect(box(page).locator('#notifyCrew')).toHaveText('Notify the crew');
    await expect(page.locator('#lastNotice')).toHaveCount(0);           // nothing sent yet: no Last alert line
  });

  test('the dialog asks with the phones and people; Cancel sends nothing', async ({ page }) => {
    const w = world();
    await open(page, w);
    await page.click('#notifyCrew');
    await expect(page.locator('#dlg #nt_text')).toHaveText('Send "' + LINE + '" to 7 phones (6 people)?');
    await expect(page.locator('#nt_send')).toBeVisible();
    await page.click('#nt_cancel');
    await expect(page.locator('#dlg')).toBeHidden();
    await page.waitForTimeout(200);
    expect(sends(w)).toEqual([]);
  });

  test('nobody has alerts on: the dialog says so and has no Send', async ({ page }) => {
    const w = world();
    w.pushCount = { phones: 0, people: 0 };
    await open(page, w);
    await page.click('#notifyCrew');
    await expect(page.locator('#dlg #nt_text')).toHaveText('Nobody has snow alerts turned on yet.');
    await expect(page.locator('#nt_send')).toHaveCount(0);
    await expect(page.locator('#nt_cancel')).toBeVisible();
  });

  test('Send, every phone took it: Sent to 7 phones at 6:00 PM., no gone or failed line, the Last alert line', async ({ page }) => {
    const w = world();
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyResult')).toHaveText('Sent to 7 phones at 6:00 PM.');
    await expect(page.locator('#notifyGone')).toHaveCount(0);
    await expect(page.locator('#notifyFailed')).toHaveCount(0);
    await expect(page.locator('#lastNotice')).toHaveText('Last alert: 6:00 PM by Matthew · 7 phones.');
    expect(sends(w)).toHaveLength(1);
    expect(Object.keys(sends(w)[0]).sort()).toEqual(['action', 'token']);   // the send carries nothing but who is asking
  });

  test('Send, some could not: 1 phone can no longer be reached. and 2 phones did not accept it.', async ({ page }) => {
    const w = world();
    w.notify = { ok: true, sent: 5, gone: 1, failed: 2, at: AT, by_name: 'Matthew' };
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyResult')).toHaveText('Sent to 5 phones at 6:00 PM.');
    await expect(page.locator('#notifyGone')).toBeVisible();
    await expect(page.locator('#notifyGone')).toHaveText('1 phone can no longer be reached.');
    await expect(page.locator('#notifyFailed')).toBeVisible();
    await expect(page.locator('#notifyFailed')).toHaveText('2 phones did not accept it.');
  });

  test('Send, the other plurals: 2 phones can no longer be reached. and 1 phone did not accept it.; Sent to 1 phone', async ({ page }) => {
    const w = world();
    w.notify = { ok: true, sent: 1, gone: 2, failed: 1, at: AT, by_name: 'Ben Dispatch' };
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyResult')).toHaveText('Sent to 1 phone at 6:00 PM.');
    await expect(page.locator('#notifyGone')).toHaveText('2 phones can no longer be reached.');
    await expect(page.locator('#notifyFailed')).toHaveText('1 phone did not accept it.');
    await expect(page.locator('#lastNotice')).toHaveText('Last alert: 6:00 PM by Ben Dispatch · 1 phone.');
  });

  test('a send inside the 10 minutes: Already sent at 5:55 PM by Jordan Demo. Wait 10 minutes between alerts.', async ({ page }) => {
    const w = world();
    w.notify = { ok: false, code: 'too_soon', at: EARLIER, by_name: 'Jordan Demo', wait_min: 10, reason: 'Already sent. Wait 10 minutes between alerts.' };
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyMsg')).toHaveText('Already sent at 5:55 PM by Jordan Demo. Wait 10 minutes between alerts.');
    await expect(page.locator('#notifyResult')).toHaveCount(0);
    await expect(page.locator('#notifyCrew')).toBeEnabled();
  });

  test('the button is off while the send is out, and a second tap sends nothing', async ({ page }) => {
    const w = world();
    let go; w.hold = new Promise((r) => { go = r; });
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyCrew')).toBeDisabled();
    await expect(page.locator('#notifyCrew')).toHaveText('Sending…');
    await page.locator('#notifyCrew').click({ force: true });
    await page.waitForTimeout(200);
    await expect(page.locator('#dlg')).toBeHidden();                     // no second dialog
    go();
    await expect(page.locator('#notifyResult')).toHaveText('Sent to 7 phones at 6:00 PM.');
    expect(sends(w)).toHaveLength(1);
    await expect(page.locator('#notifyCrew')).toBeEnabled();
  });

  test('not set up: it says so and the button stays usable', async ({ page }) => {
    const w = world();
    w.notify = { ok: false, code: 'not_set_up', reason: 'Snow alerts are not set up yet.' };
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyMsg')).toHaveText('Snow alerts are not set up yet.');
    await expect(page.locator('#notifyCrew')).toBeEnabled();
    await expect(page.locator('#notifyResult')).toHaveCount(0);
  });

  test('a lost signal: it says nothing was sent and the button stays usable', async ({ page }) => {
    const w = world();
    w.offline = true;
    await open(page, w);
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyMsg')).toHaveText("Couldn't reach the server. Nothing was sent.");
    await expect(page.locator('#notifyCrew')).toBeEnabled();
    await expect(page.locator('#notifyResult')).toHaveCount(0);
    // and it can be tried again once the signal is back
    w.offline = false;
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyResult')).toHaveText('Sent to 7 phones at 6:00 PM.');
    await expect(page.locator('#notifyMsg')).toHaveCount(0);
  });

  test('the Last alert line is there at sign-in from the newest send', async ({ page }) => {
    const w = world();
    w.lastNotice = { at: EARLIER, by_name: 'Jordan Demo', sent: 4, gone: 0, failed: 1 };
    await open(page, w);
    await expect(page.locator('#lastNotice')).toHaveText('Last alert: 5:55 PM by Jordan Demo · 4 phones.');
  });

  test('a dispatcher has the button', async ({ page }) => {
    await open(page, world(), 'tok-ben');
    await expect(page.locator('#notifyCrew')).toBeVisible();
  });

  for (const [who, token] of [['a Board lead', 'tok-alex'], ['a crew phone', 'tok-jordan']]) {
    test(who + ' has neither the button nor a bell nor a Last alert line on any of its tabs', async ({ page }) => {
      await open(page, world(), token);
      // The lead runs the storm: the live view (its route card) is on the Storm tab, so a missing button there means something.
      if (token === 'tok-alex') await expect(page.locator('[data-openroute="R1"]')).toBeVisible();
      for (const tab of ['storm', 'tonight', 'routes', 'sites', 'crew']) {
        await page.click('#tabs [data-tab="' + tab + '"]');
        await expect(page.locator('#tabs [data-tab="' + tab + '"]')).toHaveAttribute('aria-current', 'page');
        await page.waitForTimeout(150);
        await expect(page.locator('#notifyCrew, .bell, #lastNotice, #w_push, #ownPush')).toHaveCount(0);
      }
    });
  }

  test('the Roster: a bell on a person with phones on and none on a person with none; the card says how many', async ({ page }) => {
    await open(page, world());
    await toScreen(page, 'roster');
    await expect(page.locator('.tile[data-open="C01"] .bell')).toBeVisible();
    await expect(page.locator('.tile[data-open="C02"] .bell')).toBeVisible();
    await expect(page.locator('.tile[data-open="C03"] .bell')).toHaveCount(0);
    await page.click('.tile[data-open="C01"] .tile-name');
    await expect(page.locator('#dlg #w_push')).toHaveText('Snow alerts: on (2 phones)');
    await page.click('#dlgClose');
    await page.click('.tile[data-open="C02"] .tile-name');
    await expect(page.locator('#dlg #w_push')).toHaveText('Snow alerts: on (1 phone)');
    await page.click('#dlgClose');
    await page.click('.tile[data-open="C03"] .tile-name');
    await expect(page.locator('#dlg #w_push')).toHaveText('Snow alerts: off');
  });

  test('this phone\'s own alerts on the outlook card: Turn on, then Turn off', async ({ page }) => {
    const w = world();
    await open(page, w, 'tok-matt', { push: { permission: 'default', answer: 'granted' } });
    await expect(page.locator('#ownPush #pushrow span')).toHaveText('Snow alerts on this phone: off');
    await page.locator('#ownPush [data-push="on"]').click();
    await expect(page.locator('#ownPush #pushrow span')).toHaveText('Snow alerts on this phone: on');
    expect(w.calls.filter((c) => c.action === 'savePush')).toHaveLength(1);
    await page.locator('#ownPush [data-push="off"]').click();
    await expect(page.locator('#ownPush #pushrow span')).toHaveText('Snow alerts on this phone: off');
    expect(w.calls.filter((c) => c.action === 'dropPush')).toHaveLength(1);
  });

  test('Spanish: the button, the dialog, the results and Last alert read Spanish; the names stay as typed', async ({ page }) => {
    const w = world();
    w.notify = { ok: true, sent: 5, gone: 1, failed: 2, at: AT, by_name: 'Ben Dispatch' };
    await open(page, w, 'tok-matt', { lang: 'es' });
    await expect(page.locator('#notifyCrew')).toHaveText('Avisar a la cuadrilla');
    await page.click('#notifyCrew');
    await expect(page.locator('#nt_text')).toHaveText('¿Enviar "Nieve esta noche. Abre Shovel Command para ver tu ruta." a 7 teléfonos (6 personas)?');
    await expect(page.locator('#nt_send')).toHaveText('Enviar');
    await page.click('#nt_send');
    await expect(page.locator('#notifyResult')).toHaveText('Enviado a 5 teléfonos a las 6:00 PM.');
    await expect(page.locator('#notifyGone')).toHaveText('1 teléfono ya no se puede alcanzar.');
    await expect(page.locator('#notifyFailed')).toHaveText('2 teléfonos no lo aceptaron.');
    await expect(page.locator('#lastNotice')).toHaveText('Última alerta: 6:00 PM por Ben Dispatch · 5 teléfonos.');
  });

  test('Spanish: the refusal inside the 10 minutes and the Roster card line', async ({ page }) => {
    const w = world();
    w.notify = { ok: false, code: 'too_soon', at: EARLIER, by_name: 'Jordan Demo', wait_min: 10, reason: 'Already sent. Wait 10 minutes between alerts.' };
    await open(page, w, 'tok-matt', { lang: 'es' });
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyMsg')).toHaveText('Ya se envió a las 5:55 PM por Jordan Demo. Espera 10 minutos entre alertas.');
    await toScreen(page, 'roster');
    await expect(page.locator('.tile[data-open="C01"] .bell')).toHaveAttribute('aria-label', 'Alertas de nieve activadas');
    await page.click('.tile[data-open="C01"] .tile-name');
    await expect(page.locator('#dlg #w_push')).toHaveText('Alertas de nieve: activadas (2 teléfonos)');
    await page.click('#dlgClose');
    await page.click('.tile[data-open="C03"] .tile-name');
    await expect(page.locator('#dlg #w_push')).toHaveText('Alertas de nieve: desactivadas');
  });

  test('Spanish: nobody on', async ({ page }) => {
    const w = world();
    w.pushCount = { phones: 0, people: 0 };
    await open(page, w, 'tok-matt', { lang: 'es' });
    await page.click('#notifyCrew');
    await expect(page.locator('#nt_text')).toHaveText('Nadie tiene las alertas de nieve activadas todavía.');
    await expect(page.locator('#nt_cancel')).toHaveText('Cancelar');
  });

  test('Spanish: a lost signal, and Sending… while it is out', async ({ page }) => {
    const w = world();
    let go; w.hold = new Promise((r) => { go = r; });
    w.offline = true;
    await open(page, w, 'tok-matt', { lang: 'es' });
    await page.click('#notifyCrew');
    await page.click('#nt_send');
    await expect(page.locator('#notifyCrew')).toHaveText('Enviando…');
    go();
    await expect(page.locator('#notifyMsg')).toHaveText('No se pudo conectar con el servidor. No se envió nada.');
  });
});
