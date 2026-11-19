// Phone look (Matt, 11/19/26, for the leadership + billing demo): two presentation changes, nothing saved or sent differently.
//   A. Storm tab: every site card opens with a bold dark NAME BAR, and a site with MORE THAN 8 crew-visible walks starts FOLDED:
//      the card shows its bar, its buttons and one toggle "Show N walks" (+ " · K done" when K > 0); a tap opens the list, "Hide walks" folds it.
//      It is the SAME fold as the one a Site done leaves (openWalks / busy in lib/shiftlogui.js siteHtml).
//   B. Roster tab: a compact card per person (round 64 px photo left, name and where tonight's Board has them right); a tap on the photo opens
//      it large in the app's own dialog (Back or Close closes it); a tap anywhere else on the card still opens the person.
// The real page over file://, a small fake backend (made-up names only). Viewport 320 px wide.
//
// The world, worked on paper. Route R1 has three sites:
//   S1 Big Clinic    9 sidewalk zones Z1..Z9   -> 9 crew walks (> 8): starts FOLDED
//   S2 Mid Lot       8 sidewalk zones Y1..Y8   -> 8 crew walks (not > 8): starts OPEN
//   S3 Small Shop    3 sidewalk zones X1..X3   -> open
//   (a storage zone at S1 is never a walk: S1 would still be 9, the count is the CREW's walks, not the zones)
//   Log: S1 Z1 treated + Z2 cleared already (two done) -> the toggle reads "Show 9 walks · 2 done".
//   Site done at S1 then writes the 7 walks still to do (Z3..Z9), 2 already done: the line reads "All 9 walks done".
// Roster: 14 crew, C01 has a photo, the rest show initials. At 320 px the old grid tile was about 190 px tall (a 139 px square photo plus
//   the name and place lines); the new row is a 64 px photo plus 2 x 6 px padding = about 78 px, so each card must measure under 90 px.
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
const RING = [[-149.9, 61.2], [-149.8999, 61.2], [-149.8999, 61.2001], [-149.9, 61.2001]];
const zone = (id, site, name, type) => ({ id, site_id: site, name, type, ring: RING, priority: false, note: '', rev: 1 });
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const logRow = (n, site, zoneId, state) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02', site_id: site, zone_id: zoneId, state, note: '',
  by_key: 'C01', by_name: 'Alex Test', at: '2026-10-03T06:30:00.000-08:00', off_route: false, snowing_warned: false, undoes: null, batch: null });
// A 1 x 1 PNG: the card only needs a data:image/ thumbnail to draw.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function world() {
  const zones = [];
  for (let i = 1; i <= 9; i++) zones.push(zone('Z' + i, 'S1', 'Walk ' + i, 'sidewalk'));
  zones.push(zone('Z10', 'S1', 'Pile', 'storage'));
  for (let i = 1; i <= 8; i++) zones.push(zone('Y' + i, 'S2', 'Lot walk ' + i, 'sidewalk'));
  for (let i = 1; i <= 3; i++) zones.push(zone('X' + i, 'S3', 'Shop walk ' + i, 'sidewalk'));
  const crew = [];
  for (let i = 1; i <= 14; i++) crew.push({ id: 'C' + String(i).padStart(2, '0'), name: 'Person Number' + i, rev: 1, phone: '', is_lead: false, photo_thumb: i === 1 ? PNG : null });
  return {
    crew, moves: [], callouts: [], gear: [],
    routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2', 'S3'] }],
    sites: [{ id: 'S1', name: 'Big Clinic', rev: 1 }, { id: 'S2', name: 'Mid Lot', rev: 1 }, { id: 'S3', name: 'Small Shop', rev: 1 }],
    zones, storms: [START],
    log: [logRow(1, 'S1', 'Z1', 'treated'), logRow(2, 'S1', 'Z2', 'cleared')],
  };
}

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'boardbulk-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
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
    const refuse = (code, reason) => ({ ok: false, code, reason, ...v });
    const storm = SL.stormState(state.storms);
    const view = (r) => ({ ...r, by_profile: 'P1' });
    if (body.action === 'tapSite' || body.action === 'undoSiteTap') return { ...siteTapFake(state, body, { storm, me, stamp: STAMP, view }), ...v };
    if (body.action === 'tapZone') {
      const n = state.log.length + 1;
      const row = { ...logRow(n, body.site_id, body.zone_id, body.state), note: String(body.note || ''), by_key: 'admin', by_name: me.name, at: STAMP };
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
    }
    return refuse('error', 'not in the fake: ' + body.action);
  };
}

// o.dark: dark colour scheme; o.tapDelay: ms to hold tapZone replies; o.abortZone: drop tapZone like a lost signal; o.tab: 'storm' (default) or 'roster'.
async function open(page, w, o = {}) {
  const calls = [];
  await page.setViewportSize({ width: o.width || 320, height: 700 });
  if (o.dark) await page.emulateMedia({ colorScheme: 'dark' });
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    if (o.abortZone && body.action === 'tapZone') return route.abort();
    if (o.tapDelay && body.action === 'tapZone') await new Promise((r) => setTimeout(r, o.tapDelay));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  if ((o.tab || 'storm') === 'roster') {
    await page.click('nav [data-tab="roster"]');
    await expect(page.locator('.tile').first()).toBeVisible();
    return calls;
  }
  await page.click('nav [data-tab="storm"]');
  await page.locator('[data-openroute="R1"]').click();
  await expect(page.locator('#liveBack')).toBeVisible();
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
  return calls;
}
const walkRows = (page, site) => page.locator('[data-walkrow^="' + site + '|"]');
const toggle = (page, site) => page.locator('[data-showwalks="' + site + '"]');
const backSettled = (page) => page.waitForFunction(() => !((history.state && history.state.snow) || []).length);

// ---------- A. Storm tab ----------

test('name bar: bold, dark, readable at 320 px, light mode, inside the card, no sideways scroll', async ({ page }) => {
  await open(page, world());
  // S3: nothing marked, so its bar is the navy one. S1 has two walks done and reads amber since the status bars (Matt, 11/19/26,
  // test/statusbar.spec.js), so it is not the dark band this test is about.
  const bar = page.locator('[data-shiftsite="S3"] .site-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Small Shop');
  const m = await bar.evaluate((el) => {
    const cs = getComputedStyle(el), nm = el.querySelector('.site-name'), ns = getComputedStyle(nm);
    const card = el.closest('.shift-site').getBoundingClientRect(), b = el.getBoundingClientRect();
    return { bg: cs.backgroundColor, color: ns.color, weight: Number(ns.fontWeight), size: parseFloat(ns.fontSize), left: b.left - card.left, right: card.right - b.right,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // dark band (luminance under 0.2) with light text (over 0.8), bold, at least 18 px
  expect(m.bg).toMatch(/^rgb[(]/);                   // a solid fill: a transparent band would read as black below
  expect(lum(rgb(m.bg))).toBeLessThan(0.2);
  expect(lum(rgb(m.color))).toBeGreaterThan(0.8);
  expect(m.weight).toBeGreaterThanOrEqual(700);
  expect(m.size).toBeGreaterThanOrEqual(18);
  expect(m.left).toBeLessThanOrEqual(1); expect(m.right).toBeLessThanOrEqual(1); // the band spans the card
  expect(m.over).toBeLessThanOrEqual(0);
  // clear space above it: the gap from the previous card's bottom to this card's top is at least 12 px
  const gap = await page.evaluate(() => { const a = document.querySelector('[data-shiftsite="S1"]').getBoundingClientRect(), b = document.querySelector('[data-shiftsite="S2"]').getBoundingClientRect(); return b.top - a.bottom; });
  expect(gap).toBeGreaterThanOrEqual(12);
});

test('name bar: dark mode keeps light text on a solid band that is not the card colour', async ({ page }) => {
  await open(page, world(), { dark: true });
  const m = await page.locator('[data-shiftsite="S2"] .site-bar').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el.querySelector('.site-name')).color,
    card: getComputedStyle(el.closest('.shift-site')).backgroundColor }));
  const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  expect(m.bg).toMatch(/^rgb[(]/);
  expect(m.bg).not.toBe(m.card);
  expect(lum(rgb(m.color))).toBeGreaterThan(0.8);   // white on a saturated blue band
  expect(lum(rgb(m.bg))).toBeLessThan(0.3);
});

test('a 9-walk site starts folded: bar, buttons, "Show 9 walks · 2 done", no walk rows', async ({ page }) => {
  await open(page, world());
  await expect(page.locator('[data-shiftsite="S1"] .site-bar')).toBeVisible();
  await expect(page.locator('[data-sitetap="S1"][data-kind="done"]')).toBeVisible();
  await expect(page.locator('[data-shiftsite="S1"] [data-map="S1"]')).toBeVisible();
  await expect(toggle(page, 'S1')).toHaveText('Show 9 walks · 2 done');
  await expect(toggle(page, 'S1')).toHaveAttribute('aria-expanded', 'false');
  await expect(walkRows(page, 'S1')).toHaveCount(0);
});

test('with nothing done the toggle reads just "Show 9 walks"', async ({ page }) => {
  const w = world(); w.log = [];
  await open(page, w);
  await expect(toggle(page, 'S1')).toHaveText('Show 9 walks');
});

test('an 8-walk site starts open as today, with no toggle; a 3-walk site too', async ({ page }) => {
  await open(page, world());
  await expect(walkRows(page, 'S2')).toHaveCount(8);
  await expect(toggle(page, 'S2')).toHaveCount(0);
  await expect(walkRows(page, 'S3')).toHaveCount(3);
  await expect(toggle(page, 'S3')).toHaveCount(0);
});

test('one tap opens the list, Hide walks folds it again', async ({ page }) => {
  await open(page, world());
  await toggle(page, 'S1').click();
  await expect(walkRows(page, 'S1')).toHaveCount(9);
  await expect(toggle(page, 'S1')).toHaveText('Hide walks');
  await expect(toggle(page, 'S1')).toHaveAttribute('aria-expanded', 'true');
  await toggle(page, 'S1').click();
  await expect(walkRows(page, 'S1')).toHaveCount(0);
  await expect(toggle(page, 'S1')).toHaveText('Show 9 walks · 2 done');
});

test('a site the person opened stays open across a poll', async ({ page }) => {
  await open(page, world());
  await toggle(page, 'S1').click();
  await expect(walkRows(page, 'S1')).toHaveCount(9);
  await page.clock.runFor(45000);                       // two or more 20 s polls
  await expect(walkRows(page, 'S1')).toHaveCount(9);
  await expect(toggle(page, 'S1')).toHaveText('Hide walks');
});

test('Site done on a folded site works: ONE tapSite for the 7 walks left, the line says All 9 walks done, the list stays folded', async ({ page }) => {
  const w = world();
  const calls = await open(page, w);
  await page.locator('[data-sitetap="S1"][data-kind="done"]').click();
  await expect(page.locator('[data-siteline="S1"]')).toContainText('All 9 walks done');
  const taps = calls.filter((c) => c.body.action === 'tapSite');
  expect(taps).toHaveLength(1);
  expect(taps[0].body.site_id || taps[0].body.payload?.site_id || 'S1').toBe('S1');
  expect(w.log.length).toBe(2 + 7);                     // 2 old rows + Z3..Z9
  await expect(walkRows(page, 'S1')).toHaveCount(0);
  // one toggle only: the folded line's own (not a second one beside it)
  await expect(toggle(page, 'S1')).toHaveCount(1);
  await expect(toggle(page, 'S1')).toHaveText('Show walks');
  await toggle(page, 'S1').click();
  await expect(walkRows(page, 'S1')).toHaveCount(9);
});

test('a walk tap in flight keeps its site open even when Hide walks is tapped; it folds when the reply lands', async ({ page }) => {
  await open(page, world(), { tapDelay: 4000 });
  await toggle(page, 'S1').click();
  await page.locator('[data-walk="S1|Z5"][data-state="cleared"]').click();
  await expect(page.locator('[data-walkrow="S1|Z5"]')).toHaveAttribute('aria-busy', 'true');
  await toggle(page, 'S1').click();                     // fold asked for, the walk is out
  await expect(walkRows(page, 'S1')).toHaveCount(9);
  await page.clock.runFor(5000);
  await expect(page.locator('[data-walkrow="S1|Z5"]')).toHaveCount(0);   // reply landed: the list folds as asked
  await expect(toggle(page, 'S1')).toHaveText('Show 9 walks · 3 done');  // Z1 treated, Z2 cleared, Z5 cleared
});

test('a refused walk tap keeps its site open with the Retry on screen', async ({ page }) => {
  await open(page, world(), { abortZone: true });
  await toggle(page, 'S1').click();
  await page.locator('[data-walk="S1|Z4"][data-state="cleared"]').click();
  await expect(page.locator('[data-retry="S1|Z4"]')).toBeVisible();
  await toggle(page, 'S1').click();                     // Hide walks: the failed walk must stay
  await expect(page.locator('[data-retry="S1|Z4"]')).toBeVisible();
  await expect(walkRows(page, 'S1')).toHaveCount(9);
});

test('Spanish: the toggle reads in Spanish, the count and the site name stay', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await open(page, world());
  await expect(toggle(page, 'S1')).toHaveText('Ver 9 recorridos · 2 terminados');
  await expect(page.locator('[data-shiftsite="S1"] .site-name')).toContainText('Big Clinic');
  await toggle(page, 'S1').click();
  await expect(toggle(page, 'S1')).toHaveText('Ocultar recorridos');
});

// ---------- B. Roster tab ----------

test('roster: each card is a compact row, under 90 px at 320 px, photo 64 px round at the left, name beside it', async ({ page }) => {
  await open(page, world(), { tab: 'roster' });
  const t = page.locator('.tile').first();
  const m = await t.evaluate((el) => {
    const b = el.getBoundingClientRect(), av = el.querySelector('.av').getBoundingClientRect(), nm = el.querySelector('[data-no-es]').getBoundingClientRect();
    return { h: b.height, avW: av.width, avH: av.height, avLeft: av.left - b.left, nameLeft: nm.left, avRight: av.right, radius: getComputedStyle(el.querySelector('.av')).borderRadius };
  });
  expect(m.h).toBeLessThan(90);
  expect(m.avW).toBeGreaterThanOrEqual(60); expect(m.avW).toBeLessThanOrEqual(72);
  expect(m.avH).toBe(m.avW);
  expect(m.avLeft).toBeLessThan(14);
  expect(m.nameLeft).toBeGreaterThanOrEqual(m.avRight);    // name to the right of the photo
  expect(parseFloat(m.radius)).toBeGreaterThanOrEqual(m.avW / 2 - 1);
  // no person without a photo gets a bigger placeholder
  const ph = await page.locator('[data-open="C02"] .av').evaluate((el) => el.getBoundingClientRect().width);
  expect(ph).toBeLessThanOrEqual(72);
  // 14 people take far less room than the old grid: at least 6 cards fit in the 700 px viewport
  const fit = await page.evaluate(() => Array.from(document.querySelectorAll('.tile')).filter((e) => e.getBoundingClientRect().bottom <= window.innerHeight - 60).length);
  expect(fit).toBeGreaterThanOrEqual(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('roster at 390 px: two compact cards side by side', async ({ page }) => {
  await open(page, world(), { tab: 'roster', width: 390 });
  const tops = await page.evaluate(() => Array.from(document.querySelectorAll('.tile')).slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops[0]).toBe(tops[1]);
});

test('roster: a tap on the photo opens it large, Close closes it, Back closes it', async ({ page }) => {
  await open(page, world(), { tab: 'roster' });
  await page.locator('[data-photo="C01"]').click();
  await expect(page.locator('#dlg')).toBeVisible();
  const big = page.locator('#dlg img.bigphoto');
  await expect(big).toBeVisible();
  const w = await big.evaluate((el) => el.getBoundingClientRect().width);
  expect(w).toBeGreaterThanOrEqual(200);                // large, not the 64 px thumb
  await page.click('#photoClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  // Back closes it too
  await page.locator('[data-photo="C01"]').click();
  await expect(big).toBeVisible();
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('[data-tab="roster"][aria-current="page"]')).toBeVisible();   // still on the Roster tab
});

test('roster: a tap on the name still opens the person; a person with no photo has no photo button', async ({ page }) => {
  await open(page, world(), { tab: 'roster' });
  await expect(page.locator('[data-photo="C02"]')).toHaveCount(0);
  await page.locator('[data-open="C01"]').first().locator('[data-no-es]').first().click();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#w_edit')).toBeVisible();
  await expect(page.locator('#dlg img.bigphoto')).toHaveCount(0);
});
