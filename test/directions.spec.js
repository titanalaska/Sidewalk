// Directions (Matt, 11/20/26: the crews used Google Maps alone and phoned him all night): a plain link on the Storm tab's
// site card, and in the top row of the map screen, that opens Google Maps driving directions to the site. Nothing here ever
// follows the link; a test that asked Google would fail (see "nothing asks Google").
// The real page over file://, Matt's live view, a small fake backend (made-up names only). Viewport 320 x 700.
//
// The world, worked on paper (route R1 = S1, S2, S3, S4 in that order; storm ST-1 open). Every href starts
// https://www.google.com/maps/dir/?api=1&destination= and ends &travelmode=driving. The destination is
// encodeURIComponent of "lat,lng" (latitude FIRST, 6 decimals) when there is a point, else of the typed address:
//   S1 Big Clinic  '100 Test Way'            points.S1 = [-149.86341261, 61.18195749]
//        lat 61.18195749 -> 61.181957, lng -149.86341261 -> -149.863413 -> "61.181957,-149.863413" -> 61.181957%2C-149.863413
//   S2 Mid Lot     '200 Test Way #2 & "B"'   no point (its zone is sent WITHOUT a ring, as the slim sign-in does)
//        -> the address: space %20, # %23, & %26, " %22 -> 200%20Test%20Way%20%232%20%26%20%22B%22
//   S3 Small Shop  ''                        no point, no address -> no link at all
//   S4 Side Yard   '400 Test Way'            no point sent, but map.center = [-149.9, 61.2] -> "61.200000,-149.900000" -> 61.200000%2C-149.900000
//        (the point wins over the address: '400 Test Way' is not in S4's link)
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');
const SL = require('../lib/shiftlog.js');
const siteTapFake = require('./sitetap-fake.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const STAMP = '2026-10-03T07:50:18.445-08:00';
const BASE = 'https://www.google.com/maps/dir/?api=1&destination=';
const TAIL = '&travelmode=driving';
const HREF = {
  S1: BASE + '61.181957%2C-149.863413' + TAIL,
  S2: BASE + '200%20Test%20Way%20%232%20%26%20%22B%22' + TAIL,
  S4: BASE + '61.200000%2C-149.900000' + TAIL,
};
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const END = { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:00:00.000-08:00', by_name: 'Matthew' };
// a slim zone: no ring, as the slim sign-in sends it
const zone = (id, site) => ({ id, site_id: site, name: 'Walk ' + id, type: 'sidewalk', priority: false, note: '', rev: 1 });

function world() {
  return {
    crew: [], routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2', 'S3', 'S4'] }],
    sites: [
      { id: 'S1', name: 'Big Clinic', address: '100 Test Way', rev: 1 },
      { id: 'S2', name: 'Mid Lot', address: '200 Test Way #2 & "B"', rev: 1 },
      { id: 'S3', name: 'Small Shop', address: '', rev: 1 },
      { id: 'S4', name: 'Side Yard', address: '400 Test Way', map: { center: [-149.9, 61.2] }, rev: 1 }],
    zones: [zone('Z1', 'S1'), zone('Y1', 'S2'), zone('X1', 'S3'), zone('W1', 'S4')],
    points: { S1: [-149.86341261, 61.18195749] },
    storms: [START], log: [],
  };
}

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'boardbulk-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, points: state.points || {}, crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: state.zones, ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: {}, reset: {}, posts: [], ...v };
      out.cursor.posts = 0; out.reset.posts = false;
      [['log', state.log], ['storms', state.storms], ['visits', []], ['trucks', []], ['sheets', []]].forEach(([t, rows]) => {
        const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0));
        out[t] = rows.slice(cur).map((r) => (t === 'log' ? { ...r, by_profile: 'P1' } : r));
        out.cursor[t] = rows.length; out.reset[t] = false;
      });
      return out;
    }
    const storm = SL.stormState(state.storms);
    const view = (r) => ({ ...r, by_profile: 'P1' });
    if (body.action === 'tapSite' || body.action === 'undoSiteTap') return { ...siteTapFake(state, body, { storm, me, stamp: STAMP, view }), ...v };
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, o = {}) {
  await page.setViewportSize({ width: 320, height: 700 });
  if (o.dark) await page.emulateMedia({ colorScheme: 'dark' });
  if (o.es) await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  if (o.before) await o.before(page);
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');
  await page.locator('[data-openroute="R1"]').click();
  await expect(page.locator('#liveBack')).toBeVisible();
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
}
const link = (page, site) => page.locator('[data-shiftsite="' + site + '"] a[data-directions]');

test("storm card: Directions sits right after Map and points at the site's exact point", async ({ page }) => {
  await open(page, world());
  const a = link(page, 'S1');
  await expect(a).toBeVisible();
  await expect(a).toHaveAttribute('href', HREF.S1);
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('rel', 'noopener');
  expect(await a.evaluate((el) => el.previousElementSibling.getAttribute('data-map'))).toBe('S1');
});

test('storm card: no point, the typed address, encoded; the card is not broken by the quotes', async ({ page }) => {
  await open(page, world());
  await expect(link(page, 'S2')).toHaveAttribute('href', HREF.S2);
  await expect(page.locator('[data-shiftsite="S2"] .site-addr')).toHaveText('200 Test Way #2 & "B"');
});

test('storm card: no point and no address, no Directions', async ({ page }) => {
  await open(page, world());
  await expect(page.locator('[data-shiftsite="S3"]')).toBeVisible();
  await expect(link(page, 'S3')).toHaveCount(0);
  await expect(page.locator('[data-shiftsite="S3"] [data-map="S3"]')).toBeVisible();
});

test('storm card: a saved map view is used when the server sent no point', async ({ page }) => {
  await open(page, world());
  await expect(link(page, 'S4')).toHaveAttribute('href', HREF.S4);
});

test('storm card: with no storm open the link is still there', async ({ page }) => {
  const w = world(); w.storms = [START, END];
  await open(page, w);
  await expect(link(page, 'S1')).toHaveAttribute('href', HREF.S1);
});

for (const dark of [false, true]) {
  test('storm card at 320 px' + (dark ? ' (dark)' : '') + ': the button row does not run off the card and the link is as tall as Map', async ({ page }) => {
    await open(page, world(), { dark });
    const m = await page.locator('[data-shiftsite="S1"] .route-top').first().evaluate((top) => {
      const row = top.querySelector('.row.tight');
      const a = row.querySelector('a[data-directions]'), map = row.querySelector('[data-map]');
      const ra = a.getBoundingClientRect(), rm = map.getBoundingClientRect(), rc = top.closest('.card').getBoundingClientRect();
      const maxRight = Math.max.apply(null, Array.prototype.map.call(row.children, (b) => b.getBoundingClientRect().right));
      return { maxRight, scrollW: row.scrollWidth, clientW: row.clientWidth, hA: ra.height, hM: rm.height, right: ra.right, cardRight: rc.right, deco: getComputedStyle(a).textDecorationLine };
    });
    expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
    expect(m.maxRight).toBeLessThanOrEqual(m.cardRight);   // every button inside the card, none clipped
    expect(m.hA).toBeCloseTo(m.hM, 1);
    expect(m.right).toBeLessThanOrEqual(m.cardRight);
    expect(m.deco).toBe('none');
  });
}

test('map screen: Directions in the top row', async ({ page }) => {
  await open(page, world());
  await page.locator('[data-shiftsite="S1"] [data-map="S1"]').click();
  await expect(page.locator('#mapback')).toBeVisible();
  const a = page.locator('main > .route-top a[data-directions]');
  await expect(a).toHaveCount(1);
  await expect(a).toHaveAttribute('href', HREF.S1);
  // before Print in the same row
  expect(await a.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector('#mapprint')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(await a.evaluate((el) => el.parentElement === document.querySelector('#mapprint').parentElement)).toBe(true);
});

test('Spanish: the link reads "Cómo llegar"', async ({ page }) => {
  await open(page, world(), { es: true });
  await expect(link(page, 'S1')).toHaveText('Cómo llegar');
  await expect(link(page, 'S1')).toHaveAttribute('href', HREF.S1);
});

test('lib/directions.js did not load: the Storm tab still draws, with no Directions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, world(), { before: (p) => p.route('**/lib/directions.js', (r) => r.abort()) });
  await expect(page.locator('[data-shiftsite]')).toHaveCount(4);
  await expect(page.locator('a[data-directions]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('nothing asks Google', async ({ page }) => {
  const asked = [];
  // on the context, so a popup the link opens would be seen too
  page.context().on('request', (r) => { if (r.url().includes('google.com/maps')) asked.push(r.url()); });
  await open(page, world());
  await expect(link(page, 'S1')).toHaveAttribute('href', HREF.S1);
  await page.locator('[data-shiftsite="S1"] [data-map="S1"]').click();
  await expect(page.locator('#mapback')).toBeVisible();
  expect(asked).toEqual([]);
});

// The map screen's top row (Back, name, Directions, Print, Edit map), measured at 320 px as Matt. On paper: Print and Edit map
// were pushed to the row's right edge by button.small{margin-left:auto}; the link now sits before Print, so
// `.route-top .small + .small{margin-left:4px}` would pull Print left unless the link takes the auto margin.
// So: the last button on the link's line ends at the row's right edge (within 1 px; Edit map wraps to a second line at 320 px, as it does with no link at all, measured on a site without one), the link is between the name and Print, the link is
// as tall as Print, and the row is no wider than the page (320 px).
for (const [dark, width] of [[false, 320], [true, 320], [false, 390], [false, 430]]) {
  test('map screen at ' + width + ' px' + (dark ? ' (dark)' : '') + ': Print and Edit map stay at the right edge, the link sits between the name and Print', async ({ page }) => {
    await open(page, world(), { dark });
    await page.setViewportSize({ width, height: 700 });
    await page.locator('[data-shiftsite="S1"] [data-map="S1"]').click();
    await expect(page.locator('#mapback')).toBeVisible();
    await expect(page.locator('#mapedit')).toBeVisible();
    const m = await page.locator('main > .route-top').evaluate((row) => {
      const r = (el) => el.getBoundingClientRect();
      const rr = r(row), a = r(row.querySelector('a[data-directions]')), p = r(row.querySelector('#mapprint')), e = r(row.querySelector('#mapedit'));
      const n = r(row.querySelector('.site-name'));
      return { rowRight: rr.right, rowLeft: rr.left, editRight: e.right, editTop: e.top, printTop: p.top, printRight: p.right, aTop: a.top, printLeft: p.left, aLeft: a.left, aRight: a.right, nameRight: n.right, hA: a.height, hP: p.height, scrollW: row.scrollWidth, clientW: row.clientWidth, docW: document.documentElement.scrollWidth };
    });
    // the last button ON THE LINK'S LINE ends at the row's right edge (at 320 px Edit map wraps to a second line, as it does with no link at all)
    const lastRight = Math.abs(m.editTop - m.aTop) < 1 ? m.editRight : m.printRight;
    expect(Math.abs(lastRight - m.rowRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.printTop - m.aTop)).toBeLessThan(1);   // Print stays on the link's line
    expect(m.aLeft).toBeGreaterThanOrEqual(m.nameRight - 0.5);
    expect(m.aRight).toBeLessThanOrEqual(m.printLeft + 0.5);
    expect(m.hA).toBeCloseTo(m.hP, 1);
    expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
    expect(m.docW).toBeLessThanOrEqual(width);
  });
}

// On paper: a card's button row ends at the card's inner right edge whether or not the link is there (margin-left:auto on the
// row). S1 has the link, S3 has none: their last button's right edge must be the same distance from their card's edge.
test('storm card at 320 px: the button row ends at the same right edge with and without the link', async ({ page }) => {
  await open(page, world());
  const edge = (site) => page.locator('[data-shiftsite="' + site + '"] .route-top').first().evaluate((top) => {
    const btns = top.querySelectorAll('.row.tight > *'); const last = btns[btns.length - 1].getBoundingClientRect();
    return top.getBoundingClientRect().right - last.right;
  });
  const [a, b] = [await edge('S1'), await edge('S3')];
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
});

// ---------- the Next site bar (Matt, 11/20/26: the crews phoned him all night asking where to go next) ----------
// World for the bar tests: the Task 2 world with a second walk at S1 (Z2) and S2 (Y2), so S1 has 2 walks (Z1, Z2), S2 2 (Y1, Y2),
// S3 1 (X1), S4 1 (W1). Route order S1, S2, S3, S4; night shift, so the on-screen order is the route's. A mark row is
// logRow(n, site, '*', 'arrived' | 'left'); a walk row names its zone. A site's status kind (lib/sitestatus.js): none = no mark and no
// walk done; working = a mark or a walk done; done = every walk Cleared; problem = a walk at Problem (wins). The bar shows on a card
// when its kind is done OR its latest mark is a Left, and names the first site in order whose kind is none (never the card's own).
const SHIFT = 'night-2026-10-02';
const logRow = (n, site, zoneId, state, extra) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: site, zone_id: zoneId, state, note: '',
  by_key: 'C01', by_name: 'Alex Test', at: '2026-10-03T06:30:00.000-08:00', off_route: false, snowing_warned: false, undoes: null, batch: null, ...(extra || {}) });
const nw = (...rows) => { const w = world(); w.zones.push(zone('Z2', 'S1'), zone('Y2', 'S2')); w.log.push(...rows); return w; };
const nextBars = (page) => page.locator('[data-nextsite]');
const S1_LEFT = [logRow(1, 'S1', '*', 'arrived'), logRow(2, 'S1', '*', 'left')];

// 1. Nothing marked: every kind none, nothing finished, so no card shows the bar. 0 bars.
test('next bar: nothing marked, no bar anywhere', async ({ page }) => {
  await open(page, nw());
  await expect(nextBars(page)).toHaveCount(0);
});

// 2. S1 arrived + left: S1 working with latest mark Left -> shows. S2 is the first none -> "Next: Mid Lot", then " · ", then S2's address link
// (HREF.S2). S2, S3, S4 are none with no mark -> no bar. Exactly one bar, on S1.
test('next bar: after Left it names the first site nobody has started', async ({ page }) => {
  await open(page, nw(...S1_LEFT));
  await expect(nextBars(page)).toHaveCount(1);
  const bar = page.locator('[data-shiftsite="S1"] [data-nextsite="S2"]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText('Next: Mid Lot · Directions');
  await expect(bar.locator('a[data-directions]')).toHaveAttribute('href', HREF.S2);
});

// 3. Z1 + Z2 cleared = both of S1's walks -> S1 done (green), no marks. Done shows the bar; next = S2.
test('next bar: Site done with no Left shows it too', async ({ page }) => {
  await open(page, nw(logRow(1, 'S1', 'Z1', 'cleared'), logRow(2, 'S1', 'Z2', 'cleared')));
  await expect(page.locator('[data-shiftsite="S1"] [data-status="done"]')).toHaveCount(1);
  await expect(page.locator('[data-shiftsite="S1"] [data-nextsite="S2"]')).toBeVisible();
  await expect(nextBars(page)).toHaveCount(1);
});

// 4. S1 arrived + Z1 cleared (Z2 open): working, latest mark Arrived -> showNext false. No other card is anything but none. 0 bars.
test('next bar: an Arrived with walks still open shows nothing', async ({ page }) => {
  await open(page, nw(logRow(1, 'S1', '*', 'arrived'), logRow(2, 'S1', 'Z1', 'cleared')));
  await expect(page.locator('[data-shiftsite="S1"] [data-status="working"]')).toHaveCount(1);
  await expect(nextBars(page)).toHaveCount(0);
});

// 5. S1 arr + left, S2 arr: S2 is now working so the first none is S3. S1 (latest mark Left) shows it; S2's latest mark is an Arrived with
// walks open -> none. S3 has no point and no address: no link and no " · ". Text exactly "Next: Small Shop".
test('next bar: it moves on when someone arrives at that site', async ({ page }) => {
  await open(page, nw(...S1_LEFT, logRow(3, 'S2', '*', 'arrived')));
  await expect(nextBars(page)).toHaveCount(1);
  const bar = page.locator('[data-shiftsite="S1"] [data-nextsite="S3"]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText('Next: Small Shop');
  await expect(bar.locator('a')).toHaveCount(0);
});

// 6. S1 arr + left; Y1 + Y2 cleared = S2 done. First none = S3. S1 (Left) and S2 (done) both show it. S3, S4 none. 2 bars, both S3.
test('next bar: every finished card on the route names the same next site', async ({ page }) => {
  await open(page, nw(...S1_LEFT, logRow(3, 'S2', 'Y1', 'cleared'), logRow(4, 'S2', 'Y2', 'cleared')));
  await expect(nextBars(page)).toHaveCount(2);
  await expect(page.locator('[data-shiftsite="S1"] [data-nextsite="S3"]')).toBeVisible();
  await expect(page.locator('[data-shiftsite="S2"] [data-nextsite="S3"]')).toBeVisible();
});

// 7. S2 arr + left. In order S1 (none) comes before S3: next = S1, the skipped one. Only S2's card shows (Left). 1 bar.
test('next bar: a skipped earlier site is next before a later one', async ({ page }) => {
  await open(page, nw(logRow(1, 'S2', '*', 'arrived'), logRow(2, 'S2', '*', 'left')));
  await expect(nextBars(page)).toHaveCount(1);
  await expect(page.locator('[data-shiftsite="S2"] [data-nextsite="S1"]')).toBeVisible();
});

// 8. An Arrived at every site, then S1 left: no site is none -> there is no next site, so no bar even on S1 (Left).
test('next bar: every site started, no bar', async ({ page }) => {
  await open(page, nw(logRow(1, 'S1', '*', 'arrived'), logRow(2, 'S2', '*', 'arrived'), logRow(3, 'S3', '*', 'arrived'), logRow(4, 'S4', '*', 'arrived'), logRow(5, 'S1', '*', 'left')));
  await expect(page.locator('[data-shiftsite]')).toHaveCount(4);
  await expect(nextBars(page)).toHaveCount(0);
});

// 9. Z1 problem + S1 arr + left: S1 kind problem (red); mark Left -> shows. S1 is not none, S2 is: next = S2.
test('next bar: a Problem walk and a Left still show it', async ({ page }) => {
  await open(page, nw(logRow(1, 'S1', 'Z1', 'problem', { note: 'car on it' }), logRow(2, 'S1', '*', 'arrived'), logRow(3, 'S1', '*', 'left')));
  await expect(page.locator('[data-shiftsite="S1"] [data-status="problem"]')).toHaveCount(1);
  await expect(page.locator('[data-shiftsite="S1"] [data-nextsite="S2"]')).toBeVisible();
});

// 10. Test 2's rows, then the storm ended: with no open storm no bar is drawn.
test('next bar: storm ended, no bar', async ({ page }) => {
  const w = nw(...S1_LEFT); w.storms = [START, END];
  await open(page, w);
  await expect(page.locator('[data-shiftsite]')).toHaveCount(4);
  await expect(nextBars(page)).toHaveCount(0);
});

// 12. Test 2's rows, S2's name 40 characters long, at 320 px: the bar wraps inside the card (scrollWidth <= clientWidth, right edge within the card's).
for (const dark of [false, true]) {
  test('next bar at 320 px' + (dark ? ' (dark)' : '') + ': it stays inside the card', async ({ page }) => {
    const w = nw(...S1_LEFT); w.sites[1].name = 'Northwest Parking Structure Level Two AB';
    await open(page, w, { dark });
    const bar = page.locator('[data-shiftsite="S1"] [data-nextsite="S2"]');
    await expect(bar).toBeVisible();
    const m = await bar.evaluate((el) => {
      const rb = el.getBoundingClientRect(), rc = el.closest('.card').getBoundingClientRect();
      return { sw: el.scrollWidth, cw: el.clientWidth, right: rb.right, cardRight: rc.right, left: rb.left, cardLeft: rc.left, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor, docW: document.documentElement.scrollWidth };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.right).toBeLessThanOrEqual(m.cardRight);
    expect(m.left).toBeGreaterThanOrEqual(m.cardLeft);
    expect(m.docW).toBeLessThanOrEqual(320);
    // the text colour against the BAR's own background (not the card's); a transparent bar would make this meaningless, so it must have one
    expect(m.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(m.color).not.toBe(m.bg);
  });
}

// 13. Test 2's rows in Spanish: "Next:" -> "Siguiente:", the name stays, the link reads "Cómo llegar".
test('next bar in Spanish', async ({ page }) => {
  await open(page, nw(...S1_LEFT), { es: true });
  await expect(page.locator('[data-shiftsite="S1"] [data-nextsite="S2"]')).toHaveText('Siguiente: Mid Lot · Cómo llegar');
});

// 14. lib/directions.js aborted: the cards still draw, no bar, no page error.
test('next bar: lib/directions.js did not load, no bar and no page error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, nw(...S1_LEFT), { before: (p) => p.route('**/lib/directions.js', (r) => r.abort()) });
  await expect(page.locator('[data-shiftsite]')).toHaveCount(4);
  await expect(nextBars(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
