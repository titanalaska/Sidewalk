// Crew pictures (Matt, 11/24/26): "the whole point was to put a face to the name". A bar under the header for crew and leads whose own
// card has no picture (it blocks nothing), a line on the waiting screen, Add to crew refused for a waiting card with no picture, and
// "No picture" on Matt's Roster with a count in the Crew bar. The rules are lib/rosterui.js hasPicture / needsPicture (node tests in
// test/rosterui.test.js); this file is the PAGE. The real page over file://, a small fake backend, made-up names only.
//
// The world. Crew: C01 Abel Stone (picture), C02 Jordan Demo (no picture; signs in as crew), C03 Lena Park (no picture),
// C04 Old Link (photo_thumb is a web address: old data, NOT a picture), C05 Ben Dispatch (no picture; signs in as an admin with crew id C05),
// C06 Nina Nursery (pending, no picture; signs in and gets pending_card), C07 Pat Waiting (pending, picture).
// Matt's Roster lists the live, added cards: Abel, Ben, Jordan, Lena, Old Link = 5; no picture: Ben, Jordan, Lena, Old Link = 4.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-11-24T19:30:00-09:00';
const PNG64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = 'data:image/png;base64,' + PNG64;
const BAR = 'No picture on your card yet. Add one so the dispatcher knows who you are.';

const person = (id, name, extra) => ({ id, name, rev: 1, phone: '', is_lead: false, photo_thumb: null, ...extra });
function world() {
  return {
    crew: [
      person('C01', 'Abel Stone', { photo_thumb: PNG }), person('C02', 'Jordan Demo', { profile_id: 3 }), person('C03', 'Lena Park'),
      person('C04', 'Old Link', { photo_thumb: 'http://example.com/a.jpg' }), person('C05', 'Ben Dispatch', { profile_id: 5, dispatch: true }),
      person('C06', 'Nina Nursery', { profile_id: 4, pending: true }), person('C07', 'Pat Waiting', { pending: true, photo_thumb: PNG }),
    ],
    moves: [], routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: [] }], sites: [{ id: 'S1', name: 'Big Clinic', rev: 1 }],
  };
}

const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
const selfView = (c) => ({ id: c.id, name: c.name, pending: c.pending === true, ...Object.fromEntries(SELF.map((k) => [k, c[k] === undefined ? null : c[k]])) });
const WHO = { 'tok-matt': { name: 'Matthew', role: 'admin', crew_id: null }, 'tok-jordan': { name: 'Jordan Demo', role: 'crew', crew_id: 'C02' },
  'tok-ben': { name: 'Ben Dispatch', role: 'admin', crew_id: 'C05' }, 'tok-nina': { name: 'Nina Nursery', role: 'crew', crew_id: 'C06' } };

function fakeSnow(state, calls) {
  return (body) => {
    calls.push(body);
    const v = { version: 'checknight-1', action: body.action };
    const me = WHO[body.token];
    if (!me) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const own = state.crew.find((c) => c.id === me.crew_id);
    if (body.action === 'saveMyCard') {
      Object.assign(own, Object.fromEntries(SELF.filter((k) => body.card[k] !== undefined).map((k) => [k, body.card[k]])), { rev: own.rev + 1 });
      return { ok: true, card: selfView(own), pending: own.pending === true, ...v };
    }
    if (own && own.pending) return { ok: false, code: 'pending_card', name: own.name, reason: 'Your card is in. Matt will add you to the crew.', card: selfView(own), ...v };
    const admin = me.role === 'admin';
    const crewFor = () => admin ? state.crew : state.crew.filter((c) => !c.pending).map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: false }));
    if (body.action === 'bootstrap') {
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: [], crew: crewFor(), post: null, ...v };
      if (admin) Object.assign(out, { moves: state.moves, callouts: [], gear: [] }); else out.card = selfView(own);
      return out;
    }
    if (body.action === 'getCrew') return { ok: true, crew: crewFor(), ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'saveCrew' && admin) {
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      state.crew = state.crew.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

// o.token: who is signed in; o.width: viewport width; o.lang: 'es' for a Spanish phone.
async function open(page, w, o = {}) {
  const calls = [];
  await page.setViewportSize({ width: o.width || 390, height: 760 });
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w, calls);
  await page.route(isSnow, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(JSON.parse(route.request().postData() || '{}'))) }));
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [{ id: 1, name: 'Matthew', status: 'approved', hasPin: true }] }) }));
  const token = o.token || 'tok-matt', lang = o.lang || '';
  await page.addInitScript(([t, l]) => { localStorage.setItem('titan-snow-token', t); if (l) localStorage.setItem('snow-lang', l); }, [token, lang]);
  await page.goto(PAGE);
  return calls;
}
const pickPicture = (page, sel) => page.setInputFiles(sel, { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(PNG64, 'base64') });
const sent = (calls, action) => calls.filter((c) => c.action === action);

// ---------- the bar ----------
test('bar: a crew member with no picture sees it under the header on Tonight and on Sites, with Add picture', async ({ page }) => {
  await open(page, world(), { token: 'tok-jordan' });
  await expect(page.locator('#tabs [data-tab="tonight"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#picwarn')).toBeVisible();
  await expect(page.locator('#picwarn span')).toHaveText(BAR);
  await expect(page.locator('#picAdd')).toHaveText('Add picture');
  // it sits between the header and the page, on every tab
  expect(await page.evaluate(() => document.getElementById('picwarn').previousElementSibling.id)).toBe('verwarn');
  await page.click('#tabs [data-tab="sites"]');
  await expect(page.locator('#picwarn')).toBeVisible();
});

test('bar: Add picture opens Your card; a save with a picture takes the bar away at once, no reload', async ({ page }) => {
  const calls = await open(page, world(), { token: 'tok-jordan' });
  await page.click('#tabs [data-tab="sites"]');
  await page.click('#picAdd');
  await expect(page.locator('#dlg #s_save')).toBeVisible();
  await expect(page.locator('#dlg #s_title')).toHaveText('Jordan Demo');
  await pickPicture(page, '#s_photo_file');
  await expect(page.locator('#s_photo_msg')).toHaveText('Picture ready. Save to keep it.');
  await page.click('#s_save');
  await expect(page.locator('#picwarn')).toBeHidden();
  const saves = sent(calls, 'saveMyCard');
  expect(saves).toHaveLength(1);
  expect(saves[0].card.photo_thumb).toMatch(/^data:image\//);
  expect(sent(calls, 'bootstrap')).toHaveLength(1);               // no reload: the bar went on the reply alone
  await expect(page.locator('#tabs [data-tab="sites"]')).toHaveAttribute('aria-current', 'page'); // still on the tab they were on
});

test('bar: a save WITHOUT a picture leaves it up; Cancel leaves it up', async ({ page }) => {
  await open(page, world(), { token: 'tok-jordan' });
  await page.click('#picAdd');
  await page.click('#s_cancel');
  await expect(page.locator('#picwarn')).toBeVisible();
  await page.click('#picAdd');
  await page.fill('#s_phone', '907-555-0102');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).not.toHaveAttribute('open', '');
  await expect(page.locator('#picwarn')).toBeVisible();
});

test('bar: never for a crew member with a picture, for Matt, or for a dispatcher with no picture', async ({ browser }) => {
  const w = world(); w.crew.find((c) => c.id === 'C02').photo_thumb = PNG;
  for (const [token, w2, landed] of [['tok-jordan', w, '#tabs [data-tab="tonight"]'], ['tok-matt', world(), '#tabs [data-tab="roster"]'], ['tok-ben', world(), '#tabs [data-tab="roster"]']]) {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await open(page, w2, { token });
    await expect(page.locator(landed)).toBeVisible();
    await expect(page.locator('#picwarn'), token).toBeHidden();
    await ctx.close();
  }
});

test('bar: old data (a web address, not a picture) still asks for one', async ({ page }) => {
  const w = world(); w.crew.find((c) => c.id === 'C02').photo_thumb = 'http://example.com/me.jpg';
  await open(page, w, { token: 'tok-jordan' });
  await expect(page.locator('#picwarn')).toBeVisible();
});

test('bar: Spanish phone reads it in Spanish', async ({ page }) => {
  await open(page, world(), { token: 'tok-jordan', lang: 'es' });
  await expect(page.locator('#picwarn')).toBeVisible();            // toHaveText alone passes on a hidden bar
  await expect(page.locator('#picwarn span')).toHaveText('Tu tarjeta todavía no tiene foto. Agrega una para que el despachador sepa quién eres.');
  await expect(page.locator('#picAdd')).toHaveText('Agregar foto');
});

test('bar: at 320 px the words wrap, the button is a whole glove-size target on screen, no sideways scroll', async ({ page }) => {
  await open(page, world(), { token: 'tok-jordan', width: 320 });
  await expect(page.locator('#picwarn')).toBeVisible();
  const m = await page.evaluate(() => {
    const b = document.getElementById('picAdd').getBoundingClientRect();
    return { left: b.left, right: b.right, h: b.height, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(320);
  expect(m.h).toBeGreaterThanOrEqual(44);
  expect(m.sw).toBeLessThanOrEqual(m.cw);
});

// ---------- the waiting screen ----------
test('waiting: a card in with no picture says Matt needs it; a picture saved from Edit your card takes the line away', async ({ page }) => {
  await open(page, world(), { token: 'tok-nina' });
  await expect(page.locator('#pendingcard')).toBeVisible();
  await expect(page.locator('#needpic')).toHaveText('Matt needs your picture before he can add you.');
  await expect(page.locator('#picwarn')).toBeHidden();             // the waiting screen says it; no bar on top of it
  await page.click('#editCard');
  await pickPicture(page, '#s_photo_file');
  await expect(page.locator('#s_photo_msg')).toHaveText('Picture ready. Save to keep it.');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  await expect(page.locator('#needpic')).toHaveCount(0);
});

test('waiting: Spanish phone reads the line in Spanish', async ({ page }) => {
  await open(page, world(), { token: 'tok-nina', lang: 'es' });
  await expect(page.locator('#needpic')).toHaveText('Matt necesita tu foto antes de poder agregarte.');
});

// ---------- the Add gate ----------
test('gate: in the waiting list, no picture = "Add a picture first", off; a picture = Add to crew', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('#tabs [data-tab="roster"]');
  const nina = page.locator('#waitadd .person', { hasText: 'Nina Nursery' }), pat = page.locator('#waitadd .person', { hasText: 'Pat Waiting' });
  await expect(nina.locator('button')).toHaveText('Add a picture first');
  await expect(nina.locator('button')).toBeDisabled();
  await expect(nina.locator('[data-addcrew]')).toHaveCount(0);
  await expect(pat.locator('[data-addcrew]')).toHaveText('Add to crew');
  // the off button must not LOOK like Add to crew (a disabled primary button kept the same blue fill: seen in the 11/24 screenshot)
  const fill = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await fill(nina.locator('button'))).not.toBe(await fill(pat.locator('[data-addcrew]')));
  await nina.locator('button').click({ force: true });           // a tap on the off button does nothing
  expect(sent(calls, 'saveCrew')).toHaveLength(0);
  await pat.locator('[data-addcrew]').click();
  await expect.poll(() => sent(calls, 'saveCrew').length).toBe(1);
  expect(sent(calls, 'saveCrew')[0].record).toMatchObject({ id: 'C07', pending: false, photo_thumb: PNG });
});

test('gate: in the card too; Matt adds a picture from Edit, saves, and Add to crew comes back and adds them', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('#tabs [data-tab="roster"]');
  await page.locator('#waitadd .pname', { hasText: 'Nina Nursery' }).click();
  await expect(page.locator('#dlgIn [data-addcrew-nopic]')).toHaveText('Add a picture first');
  await expect(page.locator('#dlgIn [data-addcrew-nopic]')).toBeDisabled();
  await page.click('#w_edit');
  await pickPicture(page, '#f_photo');
  await expect(page.locator('#f_photo_msg')).toHaveText('Photo ready. Save to keep it.');
  await page.click('#f_save');
  await expect.poll(() => sent(calls, 'saveCrew').length).toBe(1);
  expect(sent(calls, 'saveCrew')[0].record).toMatchObject({ id: 'C06', pending: true });   // Save alone never adds them
  expect(sent(calls, 'saveCrew')[0].record.photo_thumb).toMatch(/^data:image\//);
  const nina = page.locator('#waitadd .person', { hasText: 'Nina Nursery' });
  await expect(nina.locator('[data-addcrew]')).toHaveText('Add to crew');
  await page.locator('#waitadd .pname', { hasText: 'Nina Nursery' }).click();
  await expect(page.locator('#dlgIn [data-addcrew]')).toHaveText('Add to crew');
  await page.locator('#dlgIn [data-addcrew]').click();
  await expect.poll(() => sent(calls, 'saveCrew').length).toBe(2);
  expect(sent(calls, 'saveCrew')[1].record).toMatchObject({ id: 'C06', pending: false });
  await expect(page.locator('#waitadd')).toHaveCount(1);         // Pat still waits
  await expect(page.locator('#waitadd')).not.toContainText('Nina Nursery');
});

test('gate: Add worker (a card Matt makes by hand) is not gated: it saves with no picture', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('#tabs [data-tab="roster"]');
  await page.click('#addWorker');
  await page.fill('#f_name', 'Hand Made');
  await page.click('#f_save');
  await expect.poll(() => sent(calls, 'saveCrew').length).toBe(1);
  expect(sent(calls, 'saveCrew')[0].record.name).toBe('Hand Made');
});

// ---------- Matt's Roster ----------
const tile = (page, id) => page.locator('#roster_list .tile[data-open="' + id + '"]');
test('roster: each tile with no picture says so, the Crew bar counts them, and the count follows the search', async ({ page }) => {
  await open(page, world());
  await page.click('#tabs [data-tab="roster"]');
  await expect(page.locator('#roster_list .grp-count')).toHaveText('5');
  await expect(page.locator('#roster_list .grp-nopic')).toHaveText('4 no picture');
  await expect(tile(page, 'C01').locator('.nopic')).toHaveCount(0);
  for (const id of ['C02', 'C03', 'C04', 'C05']) await expect(tile(page, id).locator('.nopic'), id).toHaveText('No picture');
  await page.fill('#roster_q', 'abel');
  await expect(page.locator('#roster_list .grp-count')).toHaveText('1');
  await expect(page.locator('#roster_list .grp-nopic')).toHaveCount(0);   // the one showing has a picture: no chip
  await page.fill('#roster_q', 'lena');
  await expect(page.locator('#roster_list .grp-nopic')).toHaveText('1 no picture');
});

test('roster: everyone with a picture: no chip and no markers', async ({ page }) => {
  const w = world(); w.crew.forEach((c) => { c.photo_thumb = PNG; });
  await open(page, w, { width: 320 });
  await page.click('#tabs [data-tab="roster"]');
  await expect(page.locator('#roster_list .grp-count')).toHaveText('5');
  await expect(page.locator('#roster_list .grp-nopic')).toHaveCount(0);
  await expect(page.locator('#roster_list .nopic')).toHaveCount(0);
});

test('roster: at 320 px the Crew bar with its chip fits, no sideways scroll', async ({ page }) => {
  await open(page, world(), { width: 320 });
  await page.click('#tabs [data-tab="roster"]');
  await expect(page.locator('#roster_list .grp-nopic')).toBeVisible();
  const m = await page.evaluate(() => {
    const bar = document.querySelector('#roster_list .grp-bar').getBoundingClientRect(), c = document.querySelector('#roster_list .grp-count').getBoundingClientRect();
    return { barRight: bar.right, cRight: c.right, cTop: c.top, barTop: bar.top, barH: bar.height, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  expect(m.cRight).toBeLessThanOrEqual(m.barRight);
  expect(m.barH).toBeLessThan(60);                                  // one line, not a wrapped tower
  expect(m.sw).toBeLessThanOrEqual(m.cw);
});
