// Crew cards (Matt, 11/24/26): the Crew tab. Crew and leads get it after Sites, admins after Roster. A card shows a face (or the initials),
// the name, seasons, a line the person wrote, Nights worked and Team sq ft; a tap flips it to a back with the phone as a tel: link, and
// the person's own back has Edit your card. The rules and words are lib/crewcards.js (node tests there); this file is the PAGE: the real
// page over file://, its own small fake backend answering cards-1, made-up names only.
//
// Worked on paper. The reply (counted 2026-12-06 06:14 Alaska time, season 2026-27):
//   C01 Abel Stone   seasons 2     line "Plow before sunrise"  nights 9  team 1,214,300 sq ft  -> 1214300/57600 = 21.08 -> "about 21 football fields"
//   C02 Ana Brook    seasons 1     no line                      nights 3  team 4,000 sq ft      -> 4000/57600 = 0.07 -> no football line; "Rookie"
//   C03 Zed Young    seasons null  a blank line                 nights 0  team 0 sq ft          -> no seasons line, no line, "0"
//   C05 Cy Dock      seasons 0     no line                      nights 1  team 100 sq ft        -> "Rookie" (0 is a slip of the thumb for 1)
// Abel signed in: Abel, then Ana, Cy, Zed. Matt (no card of his own): Abel, Ana, Cy, Zed too, none of them his.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-12-06T10:00:00-09:00';
const PNG64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = 'data:image/png;base64,' + PNG64;
const KEY = 'snow-crew-cards';
const NO_SIGNAL = "No signal. Your crew's cards come back when you do.";

test.use({ timezoneId: 'America/Anchorage' });

const person = (id, name, extra) => ({ id, name, rev: 1, phone: '', is_lead: false, photo_thumb: null, ...extra });
const CARD = (id, name, seasons, line, nights, sqft) => ({ id, name, seasons, card_line: line, nights_worked: nights, team_sqft: sqft });
const REPLY = () => ({
  season: '2026-27', counted_at: '2026-12-06T06:14:00-09:00',
  cards: [CARD('C03', 'Zed Young', null, '   ', 0, 0), CARD('C01', 'Abel Stone', 2, 'Plow before sunrise', 9, 1214300), CARD('C05', 'Cy Dock', 0, null, 1, 100),
    CARD('C02', 'Ana Brook', 1, null, 3, 4000)],
});
function world() {
  return {
    crew: [person('C01', 'Abel Stone', { photo_thumb: PNG, phone: '907-555-0101' }), person('C02', 'Ana Brook', { phone: '907-555-0102' }),
      person('C03', 'Zed Young'), person('C05', 'Cy Dock', { phone: '907-555-0105' }), person('C04', 'New Card', { pending: true })],
    reply: REPLY(), asks: 0, hold: null, offline: false,
  };
}
const WHO = { 'tok-matt': { name: 'Matthew', role: 'admin', crew_id: null }, 'tok-abel': { name: 'Abel Stone', role: 'crew', crew_id: 'C01' } };
const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
const selfView = (c) => ({ id: c.id, name: c.name, pending: c.pending === true, ...Object.fromEntries(SELF.map((k) => [k, c[k] === undefined ? null : c[k]])) });

function fakeSnow(state) {
  return async (body) => {
    const v = { version: 'cards-1', action: body.action };
    const me = WHO[body.token];
    if (!me) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const admin = me.role === 'admin';
    const own = state.crew.find((c) => c.id === me.crew_id);
    const crewFor = () => admin ? state.crew : state.crew.filter((c) => !c.pending).map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: false }));
    if (body.action === 'bootstrap') {
      const out = { ok: true, me, sites: [], routes: [], zones: [], crew: crewFor(), post: null, ...v };
      if (admin) Object.assign(out, { moves: [], callouts: [], gear: [] }); else out.card = selfView(own);
      return out;
    }
    if (body.action === 'getCrew') return { ok: true, crew: crewFor(), ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'getCrewCards') {
      state.asks++;
      if (state.hold) await state.hold;
      if (state.offline) return 'abort';
      return { ok: true, ...state.reply, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, token, o = {}) {
  await page.setViewportSize({ width: o.width || 390, height: 700 });
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(isSnow, async (route) => {
    const out = await fake(JSON.parse(route.request().postData() || '{}'));
    if (out === 'abort') return route.abort('failed');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [] }) }));
  await page.addInitScript(([t, copy, key]) => {
    localStorage.setItem('titan-snow-token', t);
    if (copy && !sessionStorage.getItem('seeded')) { localStorage.setItem(key, copy); sessionStorage.setItem('seeded', '1'); }
  }, [token, o.copy ? JSON.stringify(o.copy) : '', KEY]);
  await page.goto(PAGE);
  if (o.tab !== false) await page.click('nav [data-tab="crew"]');
  return errors;
}
const names = (page) => page.locator('.ccard .cc-front .cc-name').allInnerTexts();
const front = (page, id) => page.locator('.ccard[data-card="' + id + '"] .cc-front');
const tabsOf = (page) => page.locator('nav [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.tab));

test('crew cards: a crew phone has Crew after Sites, Matt has it after Roster', async ({ page, browser }) => {
  await open(page, world(), 'tok-abel', { tab: false });
  await expect(page.locator('nav [data-tab="sites"]')).toBeVisible();
  expect(await tabsOf(page)).toEqual(['storm', 'tonight', 'routes', 'sites', 'crew']);
  await expect(page.locator('nav [data-tab="crew"]')).toHaveText('Crew');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await open(page2, world(), 'tok-matt', { tab: false });
  await expect(page2.locator('nav [data-tab="roster"]')).toBeVisible();
  expect(await tabsOf(page2)).toEqual(['storm', 'routes', 'sites', 'board', 'log', 'roster', 'crew']);
  await ctx2.close();
});

test('crew cards: own card first, then A to Z; nights and Team sq ft drawn', async ({ page }) => {
  const w = world();
  const errors = await open(page, w, 'tok-abel');
  await expect(page.locator('.ccard')).toHaveCount(4);
  expect(await names(page)).toEqual(['Abel Stone', 'Ana Brook', 'Cy Dock', 'Zed Young']);   // the reply came Zed, Abel, Cy, Ana
  await expect(page.locator('.ccard.mine')).toHaveCount(1);
  await expect(page.locator('.ccard').first()).toHaveClass(/mine/);
  const abel = await front(page, 'C01').locator('.cc-nums tr').evaluateAll((trs) => trs.map((tr) => [tr.children[0].innerText, tr.children[1].innerText]));
  expect(abel).toEqual([['Nights worked', '9'], ['Team sq ft', '1,214,300']]);
  await expect(front(page, 'C01').locator('.cc-fields')).toHaveText('about 21 football fields');
  await expect(front(page, 'C02').locator('.cc-fields')).toHaveCount(0);   // 0.07 of a field says nothing
  await expect(front(page, 'C01').locator('.cc-seasons')).toHaveText('2 seasons');
  expect(w.asks).toBe(1);
  expect(errors).toEqual([]);
});

test('crew cards: Rookie at 1, no seasons line when unset, no line when blank', async ({ page }) => {
  await open(page, world(), 'tok-abel');
  await expect(front(page, 'C02').locator('.cc-seasons')).toHaveText('Rookie');     // 1
  await expect(front(page, 'C05').locator('.cc-seasons')).toHaveText('Rookie');     // 0
  await expect(front(page, 'C03').locator('.cc-seasons')).toHaveCount(0);           // null
  await expect(front(page, 'C03').locator('.cc-line')).toHaveCount(0);              // '   '
  await expect(front(page, 'C02').locator('.cc-line')).toHaveCount(0);              // null
  await expect(front(page, 'C01').locator('.cc-line')).toHaveText('Plow before sunrise');
  await expect(front(page, 'C03').locator('.cc-nums')).toContainText('0');
});

test('crew cards: a person with no picture gets their initials', async ({ page }) => {
  const w = world();
  w.reply.cards.push(CARD('C99', 'Gus Walker', 3, null, 2, 500));   // a card this phone's crew list does not have
  const errors = await open(page, w, 'tok-abel');
  await expect(page.locator('.ccard')).toHaveCount(5);
  await expect(front(page, 'C01').locator('img.av')).toHaveCount(1);
  await expect(front(page, 'C02').locator('span.av')).toHaveText('AB');
  await expect(front(page, 'C99').locator('span.av')).toHaveText('GW');
  await expect(page.locator('.ccard img[src=""]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('crew cards: the header reads "Winter 2026–27 · counted at 6:14 AM"', async ({ page }) => {
  const w = world();
  await open(page, w, 'tok-abel');
  await expect(page.locator('#cc_when')).toHaveText('Winter 2026–27 · counted at 6:14 AM');
  await expect(page.locator('#cc_refresh')).toHaveText('Refresh');
  w.reply = { ...REPLY(), counted_at: '2026-12-06T09:30:00-09:00' };
  await page.click('#cc_refresh');
  await expect(page.locator('#cc_when')).toHaveText('Winter 2026–27 · counted at 9:30 AM');
  expect(w.asks).toBe(2);
});

test('crew cards: tap flips to the back with a tel: link; Edit your card only on your own', async ({ page }) => {
  await open(page, world(), 'tok-abel');
  const ana = page.locator('.ccard[data-card="C02"]');
  await ana.locator('.cc-front').click();
  await expect(ana.locator('.cc-back')).toBeVisible();
  await expect(ana.locator('.cc-front')).toBeHidden();
  await expect(ana.locator('a.cc-tel')).toHaveAttribute('href', 'tel:9075550102');
  await expect(ana.locator('a.cc-tel')).toHaveText('907-555-0102');
  await expect(ana.locator('[data-ccedit]')).toHaveCount(0);
  await expect(ana.locator('[data-ccshare], [data-ccshare2]')).toHaveCount(0);
  await ana.locator('.cc-back .cc-name').click();
  await expect(ana.locator('.cc-front')).toBeVisible();   // and back again
  const abel = page.locator('.ccard[data-card="C01"]');
  await abel.locator('.cc-top').click();
  await expect(abel.locator('.cc-back [data-ccedit]')).toHaveText('Edit your card');
  await expect(abel.locator('a.cc-tel')).toHaveAttribute('href', 'tel:9075550101');
  await abel.locator('[data-ccedit]').click();
  await expect(page.locator('#dlg')).toHaveJSProperty('open', true);
  await expect(page.locator('#s_save')).toBeVisible();   // the existing Your card form
});

test('crew cards: Matt sees every card and has no own card and no Share', async ({ page }) => {
  await open(page, world(), 'tok-matt');
  await expect(page.locator('.ccard')).toHaveCount(4);
  expect(await names(page)).toEqual(['Abel Stone', 'Ana Brook', 'Cy Dock', 'Zed Young']);
  await expect(page.locator('.ccard.mine')).toHaveCount(0);
  await expect(page.locator('[data-ccshare], [data-ccshare2], [data-ccedit]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Share my card');
  await page.locator('.ccard[data-card="C01"] .cc-top').click();
  await expect(page.locator('.ccard[data-card="C01"] .cc-back')).toBeVisible();
  await expect(page.locator('[data-ccedit]')).toHaveCount(0);
});

test('crew cards: your own card has Share my card; the others do not', async ({ page }) => {
  await open(page, world(), 'tok-abel');
  await expect(page.locator('[data-ccshare]')).toHaveCount(1);
  await expect(page.locator('.ccard[data-card="C01"] [data-ccshare]')).toHaveText('Share my card');
});

test('crew cards: offline with a copy shows the copy; with none shows "No signal. Your crew\'s cards come back when you do."', async ({ page, browser }) => {
  const w = world();
  w.offline = true;
  const copy = { v: 1, ...REPLY(), counted_at: '2026-12-05T21:00:00-09:00' };
  await open(page, w, 'tok-abel', { copy });
  await expect(page.locator('#cc_note')).toHaveText('No signal. Showing the last copy.');
  await expect(page.locator('#cc_when')).toHaveText('Winter 2026–27 · counted at 9:00 PM');
  await expect(page.locator('.ccard')).toHaveCount(4);
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const w2 = world();
  w2.offline = true;
  await open(page2, w2, 'tok-abel');
  await expect(page2.locator('#cc_none')).toHaveText(NO_SIGNAL);
  await expect(page2.locator('.ccard')).toHaveCount(0);
  await expect(page2.locator('#cc_refresh')).toBeVisible();
  expect(await page2.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  await ctx2.close();
});

test('crew cards: a good reply is kept, and the next opening draws it before the answer comes', async ({ page }) => {
  const w = world();
  await open(page, w, 'tok-abel');
  await expect(page.locator('.ccard')).toHaveCount(4);
  const kept = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
  expect(kept.season).toBe('2026-27');
  expect(kept.cards.length).toBe(4);
  let release; w.hold = new Promise((r) => { release = r; });
  await page.click('nav [data-tab="sites"]');
  await page.click('nav [data-tab="crew"]');
  await expect(page.locator('.ccard')).toHaveCount(4);   // the copy, while the new ask is held
  release();
});

test('crew cards: a reply held until after the tab changed draws nothing; after sign-out the key stays gone', async ({ page }) => {
  const w = world();
  let release; w.hold = new Promise((r) => { release = r; });
  await open(page, w, 'tok-abel');
  await expect(page.locator('#cc_loading')).toBeVisible();
  await page.click('nav [data-tab="sites"]');
  release();
  await expect.poll(() => w.asks).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#cc_list')).toHaveCount(0);
  await expect(page.locator('.ccard')).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();   // a reply that landed off the tab keeps nothing
  // Signed out with an ask on its way: it draws nothing and brings the key back to nobody.
  w.hold = new Promise((r) => { release = r; });
  await page.click('nav [data-tab="crew"]');
  await expect.poll(() => w.asks).toBe(2);
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  release();
  await page.waitForTimeout(300);
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('.ccard')).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('crew cards: sign-out wipes a kept copy', async ({ page }) => {
  await open(page, world(), 'tok-abel');
  await expect(page.locator('.ccard')).toHaveCount(4);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('crew cards: a 40-character unbroken line and a line with <b> fit and show as text at 320 px', async ({ page }) => {
  const w = world();
  const long = 'W'.repeat(40);
  w.reply.cards[1] = CARD('C01', 'Abel Stone', 2, long, 9, 1214300);
  w.reply.cards[2] = CARD('C05', 'Cy Dock', 0, '<b>bold</b>', 1, 100);
  await open(page, w, 'tok-abel', { width: 320 });
  await expect(page.locator('.ccard')).toHaveCount(4);
  await expect(front(page, 'C01').locator('.cc-line')).toHaveText(long);
  await expect(front(page, 'C05').locator('.cc-line')).toHaveText('<b>bold</b>');
  await expect(front(page, 'C05').locator('.cc-line b')).toHaveCount(0);
  const fit = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth <= 320,
    lines: [...document.querySelectorAll('.cc-line')].every((e) => e.scrollWidth <= e.clientWidth),
    cards: [...document.querySelectorAll('.ccard')].every((e) => e.getBoundingClientRect().right <= 320 && e.scrollWidth <= e.clientWidth),
  }));
  expect(fit).toEqual({ page: true, lines: true, cards: true });
});
