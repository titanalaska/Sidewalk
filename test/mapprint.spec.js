// Print map (Matt, 11/18/26): the open map on paper, on the real page with the real MapLibre. The fake backend and
// the made-up site at PAC's corner are test/map-fixes.spec.js's (no customer data). The aerial tiles answer with a plain
// white tile that allows reading (as the real ones do), so the canvas can be copied.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const TOKENS = { 'tok-matt': 'admin', 'tok-jordan': 'crew' };

// A 30 m x 10 m walk near PAC at 61.2177 N, as test/ui.spec.js draws it.
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
const mapWorld = () => ({
  crew: [{ id: 'C03', name: 'Jordan Demo', phone: '555-0103', is_lead: false, rev: 1, profile_id: '3' }],
  sites: [{ id: 'S1', name: 'PAC', rev: 1, map: { center: PAC, zoom: 18 } }],
  routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
  zones: [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', priority: true, note: 'ADA ramp first', ring: ring(PAC[0], PAC[1], 30, 10), area_sqft: 3229, rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk', priority: false, note: '', ring: ring(PAC[0], PAC[1] + 0.0003, 20, 5), area_sqft: 1076, rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ski trail', priority: false, note: 'Do not gravel', ring: ring(PAC[0] + 0.0006, PAC[1], 10, 30), area_sqft: 3229, rev: 1 },
  ],
});

// bootstrap and saveZone with the real reply shapes (the fake in test/ui.spec.js, cut to the map).
// This fake is the backend as it is LIVE today, curbs-1: it has never heard of `slim`, so every
// reply carries the rings and no `points` key. Since 10/9/26 (outlines on demand) the phone asks
// for slim and expects outlines-1; against this backend it must still open its maps (the version
// banner shows, nothing here asserts on it). The slim path is test/ui.spec.js's and test/outlines.spec.js's.
// No `action` on these replies, on purpose: curbs-1 never sent one (outlines-1 does, on every POST reply, and the phone's
// not-saved guard in lib/api.js refuses a reply from ITS OWN version without it). A reply from another version is not
// checked, so every save in this file also shows that an older server is not refused.
function fakeSnow(state) {
  return (body) => {
    const v = { version: 'curbs-1' }, role = TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: role === 'admin' ? 'Matthew' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : 'C03' };
    if (body.action === 'bootstrap') {
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, ...v };
      if (role === 'admin') Object.assign(out, { moves: [], callouts: [], gear: [] });
      return out;
    }
    // A site map asks for its own site's zones, rings included (no `slim`): since outlines on demand
    // (10/9/26) that is where a map's outlines come from. The backend as it is live today has always answered it.
    if (body.action === 'getZones') {
      return { ok: true, zones: state.zones.filter((z) => z.archived !== true && (!body.site_id || z.site_id === body.site_id)), ...v };
    }
    if (body.action === 'saveZone') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      // A fresh id per new record, as the real backend does.
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      if (!rec.id) rec.id = 'X' + (90 + (state._made = (state._made || 0) + 1));
      state.zones = state.zones.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the map fake: ' + body.action, ...v };
  };
}

async function open(page, { token, snow }) {
  const calls = [];
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  if (token) await page.addInitScript((t) => localStorage.setItem('titan-snow-token', t), token);
  await page.goto(PAGE);
  return calls;
}

const WHITE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64');
const tiles = (page) => page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href),
  (route) => route.fulfill({ contentType: 'image/png', body: WHITE, headers: { 'Access-Control-Allow-Origin': '*' } }));

async function printed(page, token) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await tiles(page);
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  const state = mapWorld();
  state.sites[0].materials_needed = '~8 buckets sand';
  await open(page, { token, snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await expect(page.locator('#mapprint')).toBeEnabled({ timeout: 20000 });
  await page.click('#mapprint');
  await expect(page.locator('#printview[data-mapprint]')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
  return errors;
}

test('Print on a site map opens the map page and prints it once: site, picture with numbered zones, list', async ({ page }) => {
  const errors = await printed(page, 'tok-matt');
  const sheet = page.locator('#printsheets .mp-sheet');
  await expect(sheet.locator('h1')).toHaveText('PAC');
  await expect(sheet).toContainText('Materials: ~8 buckets sand');
  // Main entry is the priority zone: number 1, then Heated walk, Ski trail by name.
  await expect(sheet.locator('.mp-zones tbody tr')).toHaveCount(3);
  await expect(sheet.locator('.mp-zones tbody tr').nth(0)).toContainText('★ Main entry');
  await expect(sheet.locator('.mp-zones tbody tr').nth(1)).toContainText('Heated walk');
  // The picture: a JPEG of the map at the page's shape (not the phone's), with the gold "1" drawn on it (Main entry).
  const px = await page.evaluate(async () => {
    const img = document.querySelector('#printsheets .mp-img');
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let gold = 0, gx = 0, gy = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && Math.abs(d[i + 1] - 210) < 20 && d[i + 2] < 110) { gold++; gx += (i / 4) % c.width; gy += Math.floor(i / 4 / c.width); }
    // The gold "1" sits on Main entry: 60 px to its left is still that walk's blue.
    const dpr = window.devicePixelRatio, at = g.getImageData(Math.round(gx / gold - 60 * dpr), Math.round(gy / gold), 1, 1).data;
    const beside = [at[0], at[1], at[2]];
    return { src: img.src.slice(0, 23), w: img.naturalWidth, h: img.naturalHeight, dpr, gold, beside,
      box: getComputedStyle(document.getElementById('mapbox')).width, screen: window.SnowMapView.getCanvas().clientWidth };
  });
  expect(px.src).toBe('data:image/jpeg;base64,');
  expect(px.w).toBe(1000 * px.dpr);
  expect(px.h).toBe(746 * px.dpr);
  expect(px.gold).toBeGreaterThan(50);
  expect(px.beside[2] - px.beside[0]).toBeGreaterThan(40);
  // And the map on screen is back to its own size.
  expect(px.screen).toBeLessThan(400);
  expect(errors).toEqual([]);
});

test('Back from the map page leaves the map open, and the page Back button does too', async ({ page }) => {
  const errors = await printed(page, 'tok-jordan');
  await page.goBack();
  await expect(page.locator('#printview')).toHaveCount(0);
  await expect(page.locator('#mapbox')).toBeVisible();
  expect(await page.evaluate(() => document.body.classList.contains('printing'))).toBe(false);
  await page.click('#mapprint');
  await expect(page.locator('#printview[data-mapprint]')).toBeVisible({ timeout: 15000 });
  await page.click('#mapPrintBack');
  await expect(page.locator('#printview')).toHaveCount(0);
  await expect(page.locator('#mapbox')).toBeVisible();
  // One more Back now leaves the map.
  await page.goBack();
  await expect(page.locator('#mapbox')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---------- Print maps for a route (11/18/26) ----------
// R1 runs PAC (drawn), Bare lot (no zones) and Far site (its zones never come and none are kept here), in that order.
test('Print maps on a route prints one page per site in the route\'s order, and says which could not load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await tiles(page);
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  const state = mapWorld();
  state.sites.push({ id: 'S2', name: 'Bare lot', rev: 1 }, { id: 'S3', name: 'Far site', rev: 1 });
  state.zones.push({ id: 'Z9', site_id: 'S3', type: 'sidewalk', name: 'Front', priority: false, note: '', ring: ring(PAC[0] + 0.01, PAC[1], 20, 5), area_sqft: 1000, rev: 1 });
  state.routes[0].site_ids = ['S1', 'S2', 'S3'];
  const base = fakeSnow(state);
  await open(page, { token: 'tok-jordan', snow: (body) => (body.action === 'getZones' && body.site_id === 'S3' ? { ok: false, code: 'network', reason: 'no signal' } : base(body)) });
  await page.click('nav [data-tab="routes"]');
  await page.click('[data-printroute="R1"]');
  await expect(page.locator('#printview[data-mapprint]')).toBeVisible({ timeout: 40000 });
  await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
  const sheets = page.locator('#printsheets .mp-sheet');
  await expect(sheets).toHaveCount(3);
  await expect(sheets.nth(0).locator('h1')).toHaveText('PAC');
  await expect(sheets.nth(0).locator('img.mp-img')).toHaveCount(1);
  await expect(sheets.nth(0).locator('.mp-zones tbody tr')).toHaveCount(3);
  await expect(sheets.nth(1).locator('h1')).toHaveText('Bare lot');
  await expect(sheets.nth(1)).toContainText('No zones drawn on this site yet.');
  await expect(sheets.nth(2).locator('h1')).toHaveText('Far site');
  await expect(sheets.nth(2)).toContainText("couldn't be loaded on this phone");
  await expect(page.locator('#toast')).toContainText("1 map couldn't be made");
  // The picture is the page's shape, and nothing was left off screen.
  const w = await page.evaluate(async () => { const i = document.querySelector('.mp-img'); await i.decode(); return i.naturalWidth / window.devicePixelRatio; });
  expect(w).toBe(1000);
  expect(await page.locator('.maplibregl-map').count()).toBe(0);
  await page.goBack();
  await expect(page.locator('#printview')).toHaveCount(0);
  await expect(page.locator('[data-printroute="R1"]')).toBeEnabled();
  expect(errors).toEqual([]);
});
