// Crew cards (Matt, 11/24/26): the Crew tab. Crew and leads get it after Sites, admins after Roster. A card shows a face (or the initials),
// the name, seasons, a line the person wrote, Nights worked and Team sq ft; a tap flips it to a back with the phone as a tel: link, and
// the person's own back has Edit your card. The rules and words are lib/crewcards.js (node tests there); this file is the PAGE: the real
// page over file://, its own small fake backend answering machines-1, made-up names only.
//
// Worked on paper. The reply (counted 2026-12-06 06:14 Alaska time, season 2026-27):
//   C01 Abel Stone   seasons 2     line "Plow before sunrise"  nights 9  team 1,214,300 sq ft  -> 1214300/57600 = 21.08 -> "about 21 football fields"
//   C02 Ana Brook    seasons 1     no line                      nights 3  team 4,000 sq ft      -> 4000/57600 = 0.07 -> no football line; "Rookie"
//   C03 Zed Young    seasons null  a blank line                 nights 0  team 0 sq ft          -> no seasons line, no line, "0"
//   C05 Cy Dock      seasons 0     no line                      nights 1  team 100 sq ft        -> "Rookie" (0 is a slip of the thumb for 1)
// Abel signed in: Abel, then Ana, Cy, Zed. Matt (no card of his own): Abel, Ana, Cy, Zed too, none of them his.
const { test, expect } = require('./no-real-weather.js');
const { toScreen } = require('./crewtab.js'); // the admins' Crew tab: Crew, then the switch (bottom tabs, 11/25/26)
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
const WHO = { 'tok-matt': { name: 'Matthew', role: 'admin', crew_id: null }, 'tok-abel': { name: 'Abel Stone', role: 'crew', crew_id: 'C01' },
  'tok-ana': { name: 'Ana Brook', role: 'crew', crew_id: 'C02' }, 'tok-disp': { name: 'Ana Brook', role: 'admin', crew_id: 'C02' } };
const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area', 'card_line'];
const selfView = (c) => ({ id: c.id, name: c.name, pending: c.pending === true, ...Object.fromEntries(SELF.map((k) => [k, c[k] === undefined ? null : c[k]])) });

function fakeSnow(state) {
  return async (body) => {
    const v = { version: 'machines-1', action: body.action };
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
      if (state.fail) return { ok: false, ...state.fail, ...v };
      return { ok: true, ...state.reply, ...v };
    }
    // card_line, as the server's cleanLine / lineProblems: a string, trimmed, blank is null, 40 at most by .length after the trim; a save that
    // leaves the field out keeps what is stored. The reply's card reads the stored line on each call.
    const setLine = (rec, raw) => {
      if (raw === undefined) return null;
      const t = raw === null ? '' : String(raw).trim();
      if (t.length > 40) return 'Your line is 40 characters at most';
      rec.card_line = t === '' ? null : t;
      const hit = state.reply.cards.find((k) => k.id === rec.id); if (hit) hit.card_line = rec.card_line;
      return null;
    };
    if (body.action === 'saveMyCard') {
      state.saves = (state.saves || []).concat([body.card]);
      if (admin) return { ok: false, code: 'invalid', reason: 'An admin sign-in has no crew card', ...v };   // the server's own refusal (Code.js saveMyCard_)
      if (!own) return { ok: false, code: 'error', reason: 'Not on the crew', ...v };
      if (body.card.photo_thumb) own.photo_thumb = body.card.photo_thumb;
      if (body.card.phone !== undefined) own.phone = body.card.phone;
      const bad = setLine(own, body.card.card_line);
      if (bad) return { ok: false, code: 'invalid', reason: bad, ...v };
      return { ok: true, card: selfView(own), ...v };
    }
    if (body.action === 'saveCrew' && admin) {
      state.crewSaves = (state.crewSaves || []).concat([body.record]);
      const rec = state.crew.find((c) => c.id === body.record.id);
      const bad = setLine(rec, body.record.card_line);
      if (bad) return { ok: false, code: 'invalid', reason: bad, ...v };
      rec.rev++;
      return { ok: true, record: rec, ...v };
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
  if (o.tab !== false) await toCrew(page);
  return errors;
}
const names = (page) => page.locator('.ccard .cc-front .cc-name').allInnerTexts();
const front = (page, id) => page.locator('.ccard[data-card="' + id + '"] .cc-front');
const tabsOf = (page) => page.locator('nav [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.tab));
// The cards: a crew or lead phone's own Crew tab; for an admin, Crew then Cards in the switch (bottom tabs, 11/25/26).
async function toCrew(page) {
  await page.locator('#tabs button').first().waitFor();
  if (await page.locator('#tabs [data-tab="crew"]').count()) await page.click('#tabs [data-tab="crew"]');
  else await toScreen(page, 'crew');
}

test("crew cards: a crew phone has Crew after Sites; Matt's Crew tab holds them as Cards", async ({ page, browser }) => {
  await open(page, world(), 'tok-abel', { tab: false });
  await expect(page.locator('nav [data-tab="sites"]')).toBeVisible();
  expect(await tabsOf(page)).toEqual(['storm', 'tonight', 'routes', 'sites', 'crew']);
  await expect(page.locator('nav [data-tab="crew"]')).toHaveText('Crew');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await open(page2, world(), 'tok-matt', { tab: false });
  // Crew opens the Board. Worked by hand: no sign-in requests (profiles: []) + C04 New Card (pending, not added) = 1 waiting.
  await expect(page2.locator('nav [data-tab="board"]')).toHaveText('Crew1');
  expect(await tabsOf(page2)).toEqual(['storm', 'routes', 'sites', 'board']);
  await toScreen(page2, 'crew');
  await expect(page2.locator('#crewsw [data-tab="crew"]')).toHaveText('Cards');
  await expect(page2.locator('#crewsw [data-tab="crew"]')).toHaveAttribute('aria-current', 'page');
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
  await toCrew(page);
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
  await toCrew(page);
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

// ---------- A line for your card (Task 7) ----------
// The self form (Abel's Edit your card) and Matt's worker editor both carry the line: 40 characters at most after the trim, blank is none.
// A refusal shows INSIDE the open dialog (a toast is drawn under showModal()).
const LINE_ERR = 'Your line is 40 characters at most';
async function openOwnForm(page) {
  const top = page.locator('.ccard[data-card="C01"] .cc-top');
  if (await top.isVisible()) await top.click();   // a card still turned over after a save is already on its back
  await page.locator('[data-ccedit]').click();
  await expect(page.locator('#s_save')).toBeVisible();
}

test('crew cards: the self form carries the line; saved, the Crew tab shows it after the dialog closes', async ({ page }) => {
  const w = world();
  await open(page, w, 'tok-abel');
  await openOwnForm(page);
  await expect(page.locator('#s_card_line')).toHaveValue('');   // the bootstrap card has none yet
  await expect(page.locator('#s_card_line')).toHaveAttribute('maxlength', '40');
  await expect(page.locator('label:has-text("A line for your card")')).toHaveCount(1);
  await page.fill('#s_card_line', '  Last one on the plow  ');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  expect(w.saves.at(-1).card_line).toBe('Last one on the plow');   // trimmed on the phone
  await expect(front(page, 'C01').locator('.cc-line')).toHaveText('Last one on the plow');   // the tab asked again after the save
  // and the form opens on it next time
  await openOwnForm(page);
  await expect(page.locator('#s_card_line')).toHaveValue('Last one on the plow');
  await page.fill('#s_card_line', '   ');   // spaces only = blank = none
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  expect(w.saves.at(-1).card_line).toBe(null);
  await expect(front(page, 'C01').locator('.cc-line')).toHaveCount(0);
});

test('crew cards: a line of 41 characters is refused by the server and the words show inside the open form', async ({ page }) => {
  const w = world();
  await open(page, w, 'tok-abel');
  await openOwnForm(page);
  await page.evaluate(() => document.getElementById('s_card_line').removeAttribute('maxlength'));   // a phone that ignores maxlength
  await page.fill('#s_card_line', 'W'.repeat(41));
  await page.click('#s_save');
  await expect(page.locator('#dlg #s_err')).toHaveText(LINE_ERR);
  await expect(page.locator('#dlg')).toHaveJSProperty('open', true);
  await expect(page.locator('#s_save')).toBeEnabled();
  // 40 after the trim is fine (the rule is on the trimmed text)
  await page.fill('#s_card_line', ' ' + 'W'.repeat(40) + ' ');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  await expect(front(page, 'C01').locator('.cc-line')).toHaveText('W'.repeat(40));
});

test("crew cards: Matt's worker editor has Their line; blanking it takes the line off their card", async ({ page }) => {
  const w = world();
  w.crew[0].card_line = 'Plow before sunrise';
  await open(page, w, 'tok-matt', { tab: false });
  await toScreen(page, 'roster');
  await page.locator('[data-open="C01"]').click();
  await page.click('#w_edit');
  await expect(page.locator('label:has-text("Their line")')).toHaveCount(1);
  await expect(page.locator('#f_card_line')).toHaveValue('Plow before sunrise');
  await expect(page.locator('#f_card_line')).toHaveAttribute('maxlength', '40');
  await page.fill('#f_card_line', '   ');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  expect(w.crewSaves.at(-1).card_line).toBe(null);
  await toCrew(page);
  await expect(page.locator('.ccard')).toHaveCount(4);
  await expect(front(page, 'C01').locator('.cc-line')).toHaveCount(0);
});

test("crew cards: Matt's save of a 41-character line shows the refusal inside the editor and keeps the old line", async ({ page }) => {
  const w = world();
  w.crew[0].card_line = 'Plow before sunrise';
  await open(page, w, 'tok-matt', { tab: false });
  await toScreen(page, 'roster');
  await page.locator('[data-open="C01"]').click();
  await page.click('#w_edit');
  await page.evaluate(() => document.getElementById('f_card_line').removeAttribute('maxlength'));
  await page.fill('#f_card_line', 'W'.repeat(41));
  await page.click('#f_save');
  await expect(page.locator('#dlg #f_err')).toHaveText(LINE_ERR);
  await expect(page.locator('#dlg')).toHaveJSProperty('open', true);
  expect(w.crew[0].card_line).toBe('Plow before sunrise');
  await page.fill('#f_card_line', ' New line ');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  expect(w.crew[0].card_line).toBe('New line');
});

// Share my card (Task 8): a PNG of one's own card. The text drawn on the canvas is recorded (fillText wrapped before the page loads);
// navigator.share / canShare are stubbed to record the files they are handed. The phone number is never drawn.
// Abel (C01): "2 seasons", line "Plow before sunrise", Nights worked 9, Team sq ft 1,214,300, footer "Shovel Command · Winter 2026–27".
const SHARE_STUB = (mode) => {
  window.__fills = []; window.__shared = [];
  const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t) { window.__fills.push(String(t)); return f.apply(this, arguments); };
  if (mode === 'none') { navigator.canShare = () => false; navigator.share = undefined; return; }
  navigator.canShare = () => mode !== 'cannot';
  navigator.share = async (d) => {
    window.__shared.push((d.files || []).map((x) => ({ name: x.name, type: x.type, size: x.size })));
    if (mode === 'cancel') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
  };
};
async function openShare(page, mode) {
  await page.addInitScript(SHARE_STUB, mode);
  return open(page, world(), 'tok-abel');
}

test('share my card: one image/png file named crew-card.png goes to navigator.share', async ({ page }) => {
  const errors = await openShare(page, 'ok');
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const files = await page.evaluate(() => window.__shared[0]);
  expect(files.length).toBe(1);
  expect(files[0].name).toBe('crew-card.png');
  expect(files[0].type).toBe('image/png');
  expect(files[0].size).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('share my card: the picture carries name, seasons, line, both numbers and the footer, never the phone number', async ({ page }) => {
  await openShare(page, 'ok');
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const fills = await page.evaluate(() => window.__fills);
  for (const want of ['Abel Stone', '2 seasons', 'Plow before sunrise', 'Nights worked', '9', 'Team sq ft', '1,214,300', 'Shovel Command \u00b7 Winter 2026\u201327']) {
    expect(fills, want).toContain(want);
  }
  const all = fills.join(' | ');
  expect(all).not.toContain('555');
  expect(all).not.toContain('907');
});

test('share my card: a person with no picture is drawn as initials on a circle', async ({ page }) => {
  const w = world();
  w.crew[0].photo_thumb = null;
  await page.addInitScript(SHARE_STUB, 'ok');
  await open(page, w, 'tok-abel');
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  expect(await page.evaluate(() => window.__fills)).toContain('AS');
});

test('share my card: with canShare false a download of crew-card.png starts', async ({ page }) => {
  await openShare(page, 'cannot');
  const dl = page.waitForEvent('download');
  await page.click('[data-ccshare]');
  expect((await dl).suggestedFilename()).toBe('crew-card.png');
  expect(await page.evaluate(() => window.__shared.length)).toBe(0);
});

test('share my card: a cancelled share shows no error', async ({ page }) => {
  const errors = await openShare(page, 'cancel');
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#toast')).toBeHidden();
  expect(errors).toEqual([]);
});

test('share my card: the button on the back of your own card shares too; the back of someone else has none', async ({ page }) => {
  await openShare(page, 'ok');
  await page.locator('.ccard[data-card="C01"] .cc-top').click();
  await page.click('.ccard[data-card="C01"] [data-ccshare2]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  await page.locator('.ccard[data-card="C02"] .cc-top').click();
  await expect(page.locator('.ccard[data-card="C02"] .cc-back')).toBeVisible();
  await expect(page.locator('.ccard[data-card="C02"] [data-ccshare], .ccard[data-card="C02"] [data-ccshare2]')).toHaveCount(0);
});

// Spanish (Task 9, crew read owed): a Spanish phone reads the Crew tab in Spanish; names and the person's own line are untouched (data-no-es).
test('crew cards: a Spanish phone reads the Crew tab in Spanish, names and lines untouched', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await open(page, world(), 'tok-abel');
  await expect(page.locator('nav [data-tab="crew"]')).toHaveText('Cuadrilla');
  await expect(page.locator('main h2')).toHaveText('Cuadrilla');
  await expect(page.locator('#cc_when')).toHaveText(/^Invierno 2026–27 · contado a las 6:14/);
  await expect(page.locator('#cc_refresh')).toHaveText('Actualizar');
  const a = front(page, 'C01');
  await expect(a.locator('th').first()).toHaveText('Noches trabajadas');
  await expect(a.locator('th').nth(1)).toHaveText('Pies² del equipo');
  await expect(a.locator('.cc-seasons')).toHaveText('2 temporadas');
  await expect(a.locator('.cc-fields')).toHaveText('unos 21 campos de fútbol americano');
  await expect(a.locator('[data-ccshare]')).toHaveText('Compartir mi tarjeta');
  await expect(front(page, 'C05').locator('.cc-seasons')).toHaveText('Novato');
  expect(await names(page)).toEqual(['Abel Stone', 'Ana Brook', 'Cy Dock', 'Zed Young']);
  await expect(a.locator('.cc-line')).toHaveText('Plow before sunrise');
});

test('crew cards: a Spanish phone with no signal and no copy reads the offline sentence in Spanish', async ({ page }) => {
  const w = world(); w.offline = true;
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await open(page, w, 'tok-abel');
  await expect(page.locator('#cc_none')).toHaveText('Sin señal. Las tarjetas de tu cuadrilla vuelven cuando vuelvas.');
});

test('share my card: a Spanish phone draws the labels in Spanish, the name and the line as typed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await openShare(page, 'ok');
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const fills = await page.evaluate(() => window.__fills);
  for (const want of ['Abel Stone', '2 temporadas', 'Plow before sunrise', 'Noches trabajadas', 'Pies² del equipo', 'Shovel Command · Invierno 2026–27'])
    expect(fills, want).toContain(want);
  expect(fills.join(' | ')).not.toContain('Nights worked');
});

// ---------- Final review fixes (11/24/26) ----------
// 1. The dispatcher (an admin with a crew id) has no crew card of the self-service kind: the server refuses saveMyCard for an admin, and
// bootstrap sends no `card`. "Edit your card" opens Matt's roster editor on their own card instead; the save is the crew save.
test("final review 1: the dispatcher's Edit your card opens the roster editor on their own card and saves through saveCrew", async ({ page }) => {
  const w = world();
  await open(page, w, 'tok-disp');
  await expect(page.locator('.ccard').first().locator('.cc-name').first()).toHaveText('Ana Brook');   // own card first
  await page.locator('.ccard[data-card="C02"] .cc-top').click();
  await page.locator('.ccard[data-card="C02"] [data-ccedit]').click();
  await expect(page.locator('#f_save')).toBeVisible();
  await expect(page.locator('#s_save')).toHaveCount(0);
  await expect(page.locator('#f_name')).toHaveValue('Ana Brook');
  await expect(page.locator('#f_dispatch')).toBeDisabled();   // one's own Dispatcher mark is locked
  await page.fill('#f_card_line', 'Dispatch from the shop');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  expect((w.crewSaves || []).length).toBe(1);
  expect(w.crewSaves[0].id).toBe('C02');
  expect(w.saves || []).toEqual([]);   // saveMyCard never asked
  await expect(front(page, 'C02').locator('.cc-line')).toHaveText('Dispatch from the shop');
});

// 2. A picture added from Edit your card shows on one's own card and in the shared PNG without a reload: faces and phones are drawn from S.crew.
test('final review 2: a picture added from Edit your card shows on your own card at once', async ({ page }) => {
  const w = world();
  await open(page, w, 'tok-ana');
  await expect(front(page, 'C02').locator('img.av')).toHaveCount(0);
  await page.locator('.ccard[data-card="C02"] .cc-top').click();
  await page.locator('[data-ccedit]').click();
  await expect(page.locator('#s_save')).toBeVisible();
  await page.setInputFiles('#s_photo_file', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(PNG64, 'base64') });
  await expect(page.locator('#s_photo_msg')).toHaveText('Picture ready. Save to keep it.');
  await page.fill('#s_phone', '907-555-0199');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toHaveJSProperty('open', false);
  expect(w.saves.at(-1).photo_thumb).toMatch(/^data:image\//);
  await page.locator('.ccard[data-card="C02"] .cc-back .cc-name').click();   // back to the front, if the card is still turned over
  await expect(front(page, 'C02').locator('img.av')).toHaveCount(1);
  await page.locator('.ccard[data-card="C02"] .cc-top').click();   // the back: the new phone too
  await expect(page.locator('.ccard[data-card="C02"] a.cc-tel')).toHaveText('907-555-0199');
});

// 3. iPhone: the share sheet wants the tap's own turn. The picture is built when the card is drawn; the tap calls navigator.share at once.
const READY_STUB = (mode) => {
  window.__blobs = 0; window.__shared = []; window.__sync = false; window.__shareSync = []; window.__blobsAtClick = -1; window.__blobsAtShare = -1;
  const tb = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function () { window.__blobs++; return tb.apply(this, arguments); };
  document.addEventListener('click', () => { window.__blobsAtClick = window.__blobs; window.__sync = true; setTimeout(() => { window.__sync = false; }, 0); }, true);
  navigator.canShare = () => true;
  navigator.share = (d) => {
    window.__shared.push(d.files.length); window.__shareSync.push(window.__sync); window.__blobsAtShare = window.__blobs;
    if (mode === 'denied') { const e = new Error('expired'); e.name = 'NotAllowedError'; return Promise.reject(e); }
    return new Promise((res) => setTimeout(res, 400));
  };
};
test('final review 3: the picture is built before the tap, and the tap hands it to navigator.share in the same turn', async ({ page }) => {
  await page.addInitScript(READY_STUB, 'ok');
  await open(page, world(), 'tok-abel');
  await expect.poll(() => page.evaluate(() => window.__blobs)).toBeGreaterThan(0);   // built with no tap
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  expect(await page.evaluate(() => window.__shareSync)).toEqual([true]);
  expect(await page.evaluate(() => window.__blobsAtShare)).toBe(await page.evaluate(() => window.__blobsAtClick));   // nothing drawn between the tap and the share
});
test('final review 3: a share the phone calls expired (NotAllowedError) falls back to the download, no error toast', async ({ page }) => {
  await page.addInitScript(READY_STUB, 'denied');
  const errors = await open(page, world(), 'tok-abel');
  const dl = page.waitForEvent('download');
  await page.click('[data-ccshare]');
  expect((await dl).suggestedFilename()).toBe('crew-card.png');
  await expect(page.locator('#toast')).toBeHidden();
  expect(errors).toEqual([]);
});
test('final review 3: a second tap while a share is open does nothing', async ({ page }) => {
  await page.addInitScript(READY_STUB, 'ok');
  await open(page, world(), 'tok-abel');
  await expect.poll(() => page.evaluate(() => window.__blobs)).toBeGreaterThan(0);
  await page.evaluate(() => { const b = document.querySelector('[data-ccshare]'); b.click(); b.click(); });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__shared.length)).toBe(1);
  await expect(page.locator('#toast')).toBeHidden();
});

// 4. A tall picture is cover-cropped (the centre square), never squashed.
test('final review 4: a 120x240 picture is drawn from its centre square', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240"><rect width="120" height="240" fill="#c33"/></svg>';
  const w = world();
  w.crew[0].photo_thumb = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await page.addInitScript(() => {
    window.__draws = [];
    const d = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function () { window.__draws.push([...arguments].slice(1).map(Number)); return d.apply(this, arguments); };
  });
  await page.addInitScript(SHARE_STUB, 'ok');
  await open(page, w, 'tok-abel');
  await page.click('[data-ccshare]');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const face = (await page.evaluate(() => window.__draws)).filter((a) => a.length === 8).at(-1);   // sx, sy, sw, sh, dx, dy, dw, dh
  expect(face.slice(0, 4)).toEqual([0, 60, 120, 120]);
  expect(face[6]).toBe(face[7]);
});

// 5. Only a network failure says "No signal"; a server's own refusal shows its words.
test('final review 5: a server error shows its reason, never "No signal"', async ({ page, browser }) => {
  const w = world();
  w.fail = { code: 'error', reason: 'The crew sheet is busy. Try again soon.' };
  await open(page, w, 'tok-abel', { copy: { v: 1, ...REPLY() } });
  await expect(page.locator('#cc_note')).toHaveText('The crew sheet is busy. Try again soon.');
  await expect(page.locator('.ccard')).toHaveCount(4);
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const w2 = world();
  w2.fail = { code: 'error', reason: 'The crew sheet is busy. Try again soon.' };
  await open(page2, w2, 'tok-abel');
  await expect(page2.locator('#cc_none')).toHaveText('The crew sheet is busy. Try again soon.');
  await ctx2.close();
});
