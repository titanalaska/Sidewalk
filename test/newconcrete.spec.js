// New concrete (Matt, 11/12/26): a zone marked "new concrete" takes lime stripes over its own colour, the legend says so, and
// the editor's checkbox sets it. These run the real page over file:// with the real MapLibre, as test/map-fixes.spec.js does.
//   - the stripe layer: its id, filter, image, and where it sits in the stack (above every zone fill, below the lines)
//   - the feature carries new_concrete; the legend has the row
//   - the editor: tick -> the save request says true; reopen shows it ticked; untick -> false; retyping a striped heated zone
//     to sidewalk keeps true (Review Focus 2)
// The fade of a done striped zone is in test/ui.spec.js beside the other map-tap tests (it needs the Storm tab's world).
// The fake answers crewcurbs-1 and echoes `action` on every reply, like the server (lib/api.js refuses a same-version reply that does not). Made-up site, no customer data. The fake backend echoes the saved record, so what the page sent is what it gets back.
const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
// Z1 a plain sidewalk 0-30 m east, 0-10 m north; Z2 a striped heated walk 20 m x 5 m, from 33.4 m north.
const world = () => ({
  crew: [], routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
  sites: [{ id: 'S1', name: 'Demo plaza', rev: 1, map: { center: PAC, zoom: 18 } }],
  zones: [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', priority: false, note: '', ring: ring(PAC[0], PAC[1], 30, 10), area_sqft: 3229, rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk', priority: false, note: '', new_concrete: true, ring: ring(PAC[0], PAC[1] + 0.0003, 20, 5), area_sqft: 1076, rev: 1 },
  ],
});
function fakeSnow(state) {
  return (body) => {
    const v = { version: 'crewcurbs-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: state.zones.filter((z) => z.archived !== true && (!body.site_id || z.site_id === body.site_id)), ...v };
    if (body.action === 'saveZone') {
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      state.zones = state.zones.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function openMap(page, state) {
  const calls = [];
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) => route.fulfill({ contentType: 'image/png', body: PNG1 }));
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fakeSnow(state)(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => localStorage.setItem('titan-snow-token', 'tok-matt'));
  await page.goto(PAGE);
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  return calls;
}
const saves = (calls) => calls.filter((c) => c.body.action === 'saveZone');
const mapInView = (page) => page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
const tapAt = async (page, [lng, lat]) => {
  await mapInView(page);
  const pt = await page.evaluate(([a, b]) => { const m = window.SnowMapView; m.jumpTo({ center: [a, b] }); const p = m.project([a, b]); const r = m.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lng, lat]);
  await page.mouse.click(pt.x, pt.y);
};
const IN_Z1 = [PAC[0] + 0.00025, PAC[1] + 0.00004];     // 13.4 m east, 4.5 m north: inside Z1
const IN_Z2 = [PAC[0] + 0.0001, PAC[1] + 0.00032];      // 6.7 m east, 35.6 m north: inside Z2 (33.4-38.4 m)

test('the stripe layer: a fill of the stripe image for new_concrete true only, above every zone fill and below the lines', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openMap(page, world());
  const info = await page.evaluate(() => {
    const m = window.SnowMapView, ids = m.getStyle().layers.map((l) => l.id), l = m.getLayer('zones-new-concrete');
    return { ids, type: l && l.type, filter: m.getFilter('zones-new-concrete'), pattern: m.getPaintProperty('zones-new-concrete', 'fill-pattern') };
  });
  expect(info.type).toBe('fill');
  expect(info.filter).toEqual(['==', ['get', 'new_concrete'], true]);
  expect(info.pattern).toBe('new-concrete-stripes');
  // Above the zone fill, below the zone line (and so below the labels, which are page markers).
  const at = (id) => info.ids.indexOf(id);
  expect(at('zones-new-concrete')).toBeGreaterThan(at('zones-fill'));
  expect(at('zones-new-concrete')).toBeLessThan(at('zones-line'));
  // The features carry the flag; only Z2 is striped.
  const flags = await page.evaluate(() => Object.fromEntries(window.SnowMapView.getSource('zones')._data.features.map((f) => [f.properties.id, f.properties.new_concrete])));
  expect(flags).toEqual({ Z1: false, Z2: true });
  expect(errors).toEqual([]);
});

test('the stripe image MapLibre holds is lime #b5e61d with clear pixels between the stripes', async ({ page }) => {
  await openMap(page, world());
  // MapLibre asks for the image when the layer first draws a striped feature; wait for it.
  await page.waitForFunction(() => window.SnowMapView.hasImage('new-concrete-stripes'));
  const img = await page.evaluate(() => { const i = window.SnowMapView.getImage('new-concrete-stripes'); return { w: i.data.width, h: i.data.height, px: Array.from(i.data.data) }; });
  expect([img.w, img.h]).toEqual([12, 12]);
  const px = (x, y) => img.px.slice((y * 12 + x) * 4, (y * 12 + x) * 4 + 4);
  // (0,0) is on a stripe: lime, alpha 230. (6,0) is between stripes: clear.
  expect(px(0, 0)).toEqual([181, 230, 29, 230]);
  expect(px(6, 0)[3]).toBe(0);
});

test('the legend has the striped row, in words', async ({ page }) => {
  await openMap(page, world());
  const row = page.locator('#maplegend span').last();
  await expect(row).toBeVisible();
  await expect(row).toHaveText('New concrete: sand only, no salt');
  await expect(row.locator('i.stripes')).toBeVisible();
});

test('editor: ticking New concrete saves true, reopening shows it ticked, unticking saves false', async ({ page }) => {
  const calls = await openMap(page, world());
  await page.click('#mapedit');
  await tapAt(page, IN_Z1);
  await expect(page.locator('#z_new_concrete')).toBeVisible();
  await expect(page.locator('label.inline', { has: page.locator('#z_new_concrete') })).toHaveText('New concrete: sand only, no salt');
  await expect(page.locator('#z_new_concrete')).not.toBeChecked();          // Z1 is plain
  // The box sits right under Priority.
  const under = await page.evaluate(() => document.getElementById('z_priority').closest('label').nextElementSibling.querySelector('#z_new_concrete') !== null);
  expect(under).toBe(true);
  await page.check('#z_new_concrete');
  await page.click('#z_save');
  await expect(page.locator('#toast')).toContainText('Zone saved');
  expect(saves(calls).at(-1).body.record).toMatchObject({ id: 'Z1', type: 'sidewalk', new_concrete: true });
  // Reopen: ticked. Untick: the next save says false (a boolean, not an omission).
  await tapAt(page, IN_Z1);
  await expect(page.locator('#z_new_concrete')).toBeChecked();
  await page.uncheck('#z_new_concrete');
  await page.click('#z_save');
  await expect(page.locator('#toast')).toContainText('Zone saved');
  expect(saves(calls).at(-1).body.record.new_concrete).toBe(false);
  expect(saves(calls)).toHaveLength(2);
});

test('editor: a striped heated zone retyped to sidewalk keeps its stripes (the flag is not a type)', async ({ page }) => {
  const calls = await openMap(page, world());
  await page.click('#mapedit');
  await tapAt(page, IN_Z2);
  await expect(page.locator('#z_new_concrete')).toBeChecked();
  await page.click('[data-ztype="sidewalk"]');
  await page.click('#z_save');
  await expect(page.locator('#toast')).toContainText('Zone saved');
  expect(saves(calls).at(-1).body.record).toMatchObject({ id: 'Z2', type: 'sidewalk', new_concrete: true });
  // And the map redraws it striped with its new type.
  await expect.poll(() => page.evaluate(() => { const f = window.SnowMapView.getSource('zones')._data.features.find((x) => x.properties.id === 'Z2'); return [f.properties.type, f.properties.new_concrete]; })).toEqual(['sidewalk', true]);
});

// Final review (11/13/26): a map opened from Sites carries the words too. Z2 striped (heated), Z1 plain. The card shows the
// line once for the striped zone; the plain zone's card has none. (The Storm-tab card, which gets it from walkHtml, is in ui.spec.js.)
test('the Sites-map card of a striped zone says Sand only, no salt once; a plain zone card says nothing of it', async ({ page }) => {
  await openMap(page, world());
  await tapAt(page, IN_Z2);
  await expect(page.locator('#zonesheet h2')).toContainText('Heated walk');
  await expect(page.locator('#zonesheet .walk-nosalt')).toHaveCount(1);
  await expect(page.locator('#zonesheet .walk-nosalt')).toHaveText('Sand only, no salt');
  await tapAt(page, IN_Z1);
  await expect(page.locator('#zonesheet h2')).toContainText('Main entry');
  await expect(page.locator('#zonesheet .walk-nosalt')).toHaveCount(0);
  await expect(page.locator('#zonesheet')).not.toContainText('Sand only');
});

