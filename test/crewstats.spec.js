// Crew stats (Matt, 11/19/26): a Stats button on a person's card on the Roster tab, admins only. The rules and the words are
// lib/crewstats.js (its own node tests, shared with the server); this file is the PAGE: nothing asked until Stats is tapped, one
// read per tap, the season drawn, a failed read with Retry (never "Not saved"), no button on a waiting card, a reply that lands
// after the card closed draws nothing, and the 320 px fit. The real page over file://, a small fake backend, made-up names only.
//
// The fake answers getCrewStats with Alex's winter from test/crewstats.test.js, worked on paper there:
//   called out 2, worked 1, no-show 0, 480 min, 1,900 sq ft, Bobcat 120, help visits 0;
//   nights: Night of 12/4 on N1, 8:00, 1,600 sq ft, Bobcat 120 | Night of 11/8 on N1, called out, 300 sq ft.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-12-06T10:00:00-09:00';

const person = (id, name, extra) => ({ id, name, rev: 1, phone: '', is_lead: false, photo_thumb: null, ...extra });
const ALEX = {
  crew_id: 'C01', season: '2026-27',
  totals: { called_out: 2, worked: 1, no_show: 0, minutes: 480, open_nights: 0, sqft: 1900, machines: { bobcat: 120 }, help_visits: 0 },
  nights: [
    { shift_id: 'night-2026-12-04', route_id: 'R1', route_name: 'N1', called_out: true, worked: true, no_show: false, minutes: 480, open: false, sqft: 1600, machines: { bobcat: 120 } },
    { shift_id: 'night-2026-11-08', route_id: 'R1', route_name: 'N1', called_out: true, worked: false, no_show: false, minutes: null, open: false, sqft: 300, machines: {} },
  ],
};
// Twelve nights, for the 320 px fit: 12-1 .. 12-12 back from 11/30, each worked on "Valley Route 22" with a long machine line.
function longWinter() {
  const nights = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2026, 10, 30 - i));
    nights.push({ shift_id: 'night-' + d.toISOString().slice(0, 10), route_id: 'R2', route_name: 'Valley Route 22', called_out: true, worked: true, no_show: false,
      minutes: 600, open: false, sqft: 12345, machines: { blower: 30, snowrator: 240, bobcat: 212, sweepster: 15 } });
  }
  return { crew_id: 'C01', season: '2026-27', totals: { called_out: 12, worked: 12, no_show: 0, minutes: 7200, open_nights: 0, sqft: 148140,
    machines: { blower: 360, snowrator: 2880, bobcat: 2544, sweepster: 180 }, help_visits: 4 }, nights };
}

function world() {
  return {
    crew: [person('C01', 'Abel Stone'), person('C02', 'Ana Brook'), person('C17', 'New Card', { pending: true })],
    routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: [] }],
    asks: [], replies: [], hold: null,
  };
}

function fakeSnow(state) {
  return async (body) => {
    const v = { version: 'cards-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: [], routes: state.routes, zones: [], crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
    if (body.action === 'getCrew') return { ok: true, crew: state.crew, ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'getCrewStats') {
      state.asks.push(body.crew_id);
      if (state.hold) await state.hold;
      const r = state.replies.length ? state.replies.shift() : ALEX;
      return r === 'abort' ? r : { ok: true, ...r, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, o = {}) {
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
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#addWorker')).toBeVisible();
  return errors;
}
// A crew row is a .tile; a card waiting to be added opens from its name in the "Waiting to be added" list.
const card = async (page, id) => {
  await page.click('.tile[data-open="' + id + '"], #waitadd .pname[data-open="' + id + '"]');
  await expect(page.locator('#dlgClose')).toBeVisible();
};

test('crew stats: the card opens without asking; Stats asks once and shows the season', async ({ page }) => {
  const w = world();
  await open(page, w);
  await card(page, 'C01');
  await expect(page.locator('#w_stats')).toBeVisible();
  expect(w.asks).toEqual([]);
  await page.click('#w_stats');
  const box = page.locator('#w_statsbox');
  await expect(box).toContainText('Winter 2026-27');
  expect(w.asks).toEqual(['C01']);
  const rows = await box.locator('table.stats-tot tr').evaluateAll((trs) => trs.map((tr) => [tr.children[0].innerText, tr.children[1].innerText]));
  expect(rows).toEqual([['Nights worked', '1 (called out 2, no-show 0)'], ['Hours', '8:00'], ['Sq ft cleared', '1,900'], ['Machines', 'Bobcat 120 min'], ['Help visits', '0']]);
  // One night = two lines on a phone: the night and its route, then hours · sq ft · machines. A part with nothing to say is left out.
  const nights = await box.locator('ul.stats-nights li').evaluateAll((lis) => lis.map((li) => ['.sn-when', '.sn-route', '.sn-hours', '.sn-sqft', '.sn-mach'].map((s) => { const e = li.querySelector(s); return e ? e.innerText : ''; })));
  expect(nights).toEqual([['Night of 12/4', 'N1', '8:00', '1,600 sq ft', 'Bobcat 120'], ['Night of 11/8', 'N1', 'called out', '300 sq ft', '']]);
  await expect(page.locator('#w_stats')).toBeHidden();   // one read per opening: the button goes once the season is drawn
});

test('crew stats: a person with no nights says so', async ({ page }) => {
  const w = world();
  w.replies.push({ crew_id: 'C02', season: '2026-27', totals: { called_out: 0, worked: 0, no_show: 0, minutes: 0, open_nights: 0, sqft: 0, machines: {}, help_visits: 0 }, nights: [] });
  await open(page, w);
  await card(page, 'C02');
  await page.click('#w_stats');
  await expect(page.locator('#w_statsbox')).toContainText('No nights yet this winter.');
  await expect(page.locator('#w_statsbox table.stats-tot')).toContainText('none');
  await expect(page.locator('#w_statsbox .stats-nights')).toHaveCount(0);
});

test('crew stats: a failed read says so and Retry works', async ({ page }) => {
  const w = world();
  w.replies.push('abort');
  await open(page, w);
  await card(page, 'C01');
  await page.click('#w_stats');
  await expect(page.locator('#w_statsbox')).toContainText('Could not load the stats.');
  await expect(page.locator('#dlgIn')).not.toContainText('Not saved');
  await page.click('#w_statsretry');
  await expect(page.locator('#w_statsbox')).toContainText('Winter 2026-27');
  expect(w.asks).toEqual(['C01', 'C01']);
});

test('crew stats: a waiting card has no Stats button', async ({ page }) => {
  const w = world();
  await open(page, w);
  await card(page, 'C17');
  await expect(page.locator('#dlgIn')).toContainText('New Card');
  await expect(page.locator('#w_stats')).toHaveCount(0);
});

test('crew stats: a slow reply after the card closed draws nothing', async ({ page }) => {
  const w = world();
  let release;
  w.hold = new Promise((r) => { release = r; });
  const errors = await open(page, w);
  await card(page, 'C01');
  await page.click('#w_stats');
  await expect(page.locator('#w_statsbox')).toContainText('Loading stats');
  await page.click('#dlgClose');
  await expect(page.locator('#dlgClose')).toBeHidden();
  await card(page, 'C02');            // another person's card is open when Abel's reply lands
  release();
  await expect.poll(() => w.asks.length).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#dlgIn')).toContainText('Ana Brook');
  await expect(page.locator('#dlgIn')).not.toContainText('Winter 2026-27');
  await expect(page.locator('#w_stats')).toBeVisible();
  expect(errors).toEqual([]);
});

test('crew stats: twelve nights fit at 320 px', async ({ page }) => {
  const w = world();
  w.replies.push(longWinter());
  await open(page, w, { width: 320 });
  await card(page, 'C01');
  await page.click('#w_stats');
  await expect(page.locator('#w_statsbox ul.stats-nights li')).toHaveCount(12);
  // Each night is at most three lines tall at 320 px (the night line, and hours · sq ft · machines wrapping once).
  const tall = await page.locator('ul.stats-nights li').evaluateAll((lis) => Math.max(...lis.map((li) => li.getBoundingClientRect().height)));
  expect(tall).toBeLessThanOrEqual(3 * 22 + 14);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const wide = await page.evaluate(() => { const d = document.getElementById('dlgIn'); return d.scrollWidth - d.clientWidth; });
  expect(wide).toBeLessThanOrEqual(0);
  await page.locator('#dlgClose').scrollIntoViewIfNeeded();
  await expect(page.locator('#dlgClose')).toBeInViewport();
});

test("crew stats: the Board's person card has no Stats button (the spec: nothing on the Board's card)", async ({ page }) => {
  const w = world();
  await open(page, w);
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-act="card"]');
  await expect(page.locator('#dlgIn')).toContainText('Gear on hand');
  await expect(page.locator('#w_stats')).toHaveCount(0);
});
