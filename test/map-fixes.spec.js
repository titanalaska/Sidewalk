// Two site-map fixes (10/9/26), each on the real page over file:// with the real MapLibre.
//
// 1. A map whose style is still unparsed. MapLibre parses an inline style on the NEXT
//    ANIMATION FRAME, and frames stop while the page is off screen (the phone's screen off,
//    the app behind another, the desktop pane's window hidden). SnowMap.open still hands the
//    map over after its 8 s fallback, so code can run against a style that is not parsed
//    yet, where addSource / setLayoutProperty throw "Style is not done loading" and
//    getSource('zones') is undefined. 139ee5c fixed the editor's draft layer; these cover the
//    zone redraw after a save (SnowMap.setZones) and the photo switch.
// 2. The Import from Bootprint preview coloured every outline white: Matt read a 4-ft curb
//    ring as a sidewalk. The preview now carries each outline's import type and the draft
//    layer colours by it, from the one type table the legend and the zones use.
//
// The fake backend here answers only what these screens ask (bootstrap, saveZone); every
// other action is refused with a reason, never silently ok. The site is a made-up one at
// the Performing Arts Center's corner, as test/ui.spec.js uses: no customer data.
const { test, expect } = require('@playwright/test');
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
const lastCall = (calls, action) => calls.filter((c) => c.body.action === action).at(-1);

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const tilesAnswer = (page) => page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) => route.fulfill({ contentType: 'image/png', body: PNG1 }));
const tilesHang = (page) => page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), () => { /* never answered */ });

// Frames are held from the tap on the site until the test lets them go; MapLibre looks
// requestAnimationFrame up on each call, so the page's own copy is what it gets. The stub
// stays in place and passes frames through once released: Playwright's own in-page script
// keeps a bound copy of whatever it first found there, and polls its waits with it.
const holdFrames = (page) => page.evaluate(() => {
  const real = window.requestAnimationFrame.bind(window), held = [];
  let holding = true;
  window.requestAnimationFrame = (cb) => (holding ? (held.push(cb), 0) : real(cb));
  window.__frames = { release: () => { holding = false; held.splice(0).forEach((cb) => real(cb)); } };
});
const releaseFrames = (page) => page.evaluate(() => window.__frames.release());
const styleParsed = (page) => page.evaluate(() => !!(window.SnowMapView && window.SnowMapView.getSource('zones')));
const zoneSource = (page) => page.evaluate(() => {
  const s = window.SnowMapView.getSource('zones');
  return s && s._data ? s._data.features.map((f) => ({ id: f.properties.id, type: f.properties.type })) : null;
});

// Matt opens the site with frames held and the aerial tiles never answered, as the night
// at Fire Station #10: the 8 s fallback hands the map over with its style still unparsed.
async function unparsedMap(page, errors, state) {
  page.on('pageerror', (e) => errors.push(String(e)));
  await tilesHang(page);
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(state || mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await holdFrames(page);
  await page.click('[data-map="S1"]');
  await expect(page.locator('#mapedit')).toBeEnabled({ timeout: 12000 });
  expect(await styleParsed(page)).toBe(false);
  return calls;
}

// Corners are clicked at whole pixels west of the canvas centre (PAC): every zone in
// mapWorld starts at PAC's longitude and runs east, so this ground is clear.
const CORNERS = [[-150, -60], [-40, -60], [-40, 20], [-150, 20]];
const mapInView = (page) => page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
async function tapCorners(page, px) {
  for (const [x, y] of px) {
    await mapInView(page);
    const r = await page.evaluate(() => { const b = window.SnowMapView.getCanvas().getBoundingClientRect(); return { l: b.left + b.width / 2, t: b.top + b.height / 2 }; });
    await page.mouse.click(Math.round(r.l + x), Math.round(r.t + y));
  }
}

// ---------- 1a. the zone redraw after a save ----------
// With Edit map remembered the editor opens on the unparsed map (139ee5c); Matt draws a
// zone and saves it before a frame comes. The save lands on the server; the redraw
// (SnowMap.setZones) used to die on getSource('zones') being undefined, which left the
// form open with no "Zone saved", and the new zone off this map for good: the parse
// builds the zones source from the list the map opened with.
test('a zone saved on a map whose style is still unparsed closes its form, and is drawn once the style parses', async ({ page }) => {
  const errors = [];
  await page.addInitScript(() => localStorage.setItem('titan-snow-editing', '1'));
  const calls = await unparsedMap(page, errors);
  await expect(page.locator('#ed_new')).toBeVisible();
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('[data-ztype="hand"]');
  await page.fill('#z_name', 'Side door');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Zone saved');
  expect(lastCall(calls, 'saveZone').body.record).toMatchObject({ site_id: 'S1', type: 'hand', name: 'Side door', rev: 0 });
  expect(await styleParsed(page)).toBe(false); // still no frame: the save did not wait for one
  expect(errors).toEqual([]);
  await releaseFrames(page);
  await page.waitForFunction(() => window.SnowMapView.getSource('zones'));
  // The three the map opened with and the one just saved (the fake's first new id is X91).
  await expect.poll(() => zoneSource(page)).toEqual([
    { id: 'Z1', type: 'sidewalk' }, { id: 'Z2', type: 'heated' }, { id: 'Z3', type: 'no_touch' }, { id: 'X91', type: 'hand' }]);
  expect(errors).toEqual([]);
});

// ---------- 1b. the photo switch ----------
// One tap flips the city photo off (Esri stays underneath). On an unparsed style
// setLayoutProperty threw: the tap did nothing the eye could see, the label stayed on
// City 2024, and the switch's own flag flipped anyway, so the next tap put things back
// and the one after that finally flipped the photo (three taps for one change). The
// label now says what Matt chose, and the layer takes it the moment the style is parsed.
test('the photo switch tapped on a map whose style is still unparsed takes effect once the style parses', async ({ page }) => {
  const errors = [];
  await unparsedMap(page, errors);
  const moa = () => page.evaluate(() => window.SnowMapView.getLayoutProperty('moa', 'visibility') || 'visible');
  await expect(page.locator('#photoswitch')).toHaveText('Photo: City 2024');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toHaveText('Photo: Esri');
  expect(errors).toEqual([]);
  expect(await styleParsed(page)).toBe(false);
  await releaseFrames(page);
  await page.waitForFunction(() => window.SnowMapView.getSource('zones'));
  await expect.poll(moa).toBe('none'); // the choice made before the parse, applied by it
  // The next tap, on the parsed style, flips straight back.
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toHaveText('Photo: City 2024');
  expect(await moa()).toBe('visible');
  expect(errors).toEqual([]);
});

// ---------- 2. the Import from Bootprint preview, coloured by type ----------
// The preview drew every outline as one white dashed line, and Matt read a 4-ft curb ring
// (hand work) as a sidewalk. Each previewed outline now carries the type it will import as,
// and the draft layer colours by it from the one table the zones and the legend use
// (SnowMap.TYPES, Bootprint's colours). The dash stays: these are not saved yet. The
// outline being drawn carries no type and keeps the white fallback.
const mPin = (x, y) => ({ lat: PAC[1] + y / RE / DEGR, lng: PAC[0] + x / (RE * Math.cos(PAC[1] * DEGR)) / DEGR, accuracy: 0 });
const bpRect = (x, y) => [mPin(x, y), mPin(x + 10, y), mPin(x + 10, y + 5), mPin(x, y + 5)];
const bpExport = () => Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [
  { id: 'NEAR', name: 'Near PAC', zones: [
    { id: 1, name: 'Front walk', mode: 'area', surface: 'walk', pins: bpRect(-80, -20), widthFt: '' },
    { id: 2, name: 'Curb 4 ft', mode: 'area', surface: 'hand', pins: bpRect(-80, -40), widthFt: '' },
    { id: 3, name: 'Snow pile 1', mode: 'area', surface: 'storage', pins: bpRect(-80, -60), widthFt: '' },
  ] }] }));
// A match expression's type -> colour pairs, as an object; null for anything else.
const matchPairs = (expr) => {
  if (!Array.isArray(expr) || expr[0] !== 'match' || JSON.stringify(expr[1]) !== '["get","type"]') return null;
  const out = {};
  for (let i = 2; i < expr.length - 1; i += 2) out[expr[i]] = expr[i + 1];
  return { pairs: out, fallback: expr[expr.length - 1] };
};

test('the import preview carries each outline\'s type, and the draft layer colours by the zones\' own table', async ({ page }) => {
  await tilesAnswer(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await page.click('#mapedit');
  await page.setInputFiles('#ed_bpfile', { name: 'bootprint-library-2026-10-09.json', mimeType: 'application/json', buffer: bpExport() });
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('2 walks · 1 snow pile to add');
  // Each previewed outline says what it will import as: walk -> sidewalk, hand -> hand, storage -> storage.
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getSource('draft')._data.features.map((f) => f.properties.type)))
    .toEqual(['sidewalk', 'hand', 'storage']);
  const paint = await page.evaluate(() => ({
    line: window.SnowMapView.getPaintProperty('draft-line', 'line-color'),
    dash: window.SnowMapView.getPaintProperty('draft-line', 'line-dasharray'),
    fill: window.SnowMapView.getPaintProperty('draft-fill', 'fill-color'),
    zones: window.SnowMapView.getPaintProperty('zones-line', 'line-color'),
    table: Object.fromEntries(Object.keys(window.SnowMap.TYPES).map((k) => [k, window.SnowMap.TYPES[k].color])),
  }));
  // Bootprint's colours (Matt, 10/4/26), read off the table the legend is drawn from.
  expect(paint.table).toMatchObject({ sidewalk: '#1c6fb0', hand: '#d98c00', storage: '#7d5ba6', no_touch: '#e0218a' });
  const line = matchPairs(paint.line);
  expect(line).not.toBeNull();
  expect(line.pairs).toEqual(paint.table);            // every type, its own colour
  expect(line.fallback).toBe('#ffffff');               // no type (the outline being drawn): white, as before
  expect(line.pairs).toEqual(matchPairs(paint.zones).pairs); // the same table as the saved zones
  expect(matchPairs(paint.fill).pairs).toEqual(paint.table);
  expect(paint.dash).toEqual([2, 1]);                  // still marked as not saved
});
