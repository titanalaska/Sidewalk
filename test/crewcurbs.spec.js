// Curbs for the crew (Matt, 11/13/26): the site map, Matt's editor and the Sites tab, on the real page over file:// with the real MapLibre.
// (The Storm tab, Copy for BT and Print route lists are in test/ui.spec.js "crew curbs:", beside the world they need.)
// Worked on paper. Two made-up sites, each with one sidewalk and one curb line:
//   Birch Clinic (S1): no `crew_curbs`  -> a No site.  Z1 sidewalk "Front walk", Z3 curb line "Curb - lot" (1,200 sq ft / 4 = 300 ft).
//   Spruce Office (S2): crew_curbs true -> a Yes site. Z2 sidewalk "Front walk", Z4 curb line "Curb - lot" (1,200 sq ft = 300 ft).
//   The Sites tab line at Birch: "Curbs: 300 ft in 1 item" + " · the crew doesn't see them"; at Spruce: "Curbs: 300 ft in 1 item" alone.
//   The map at Birch draws [Z1]; with Edit map on, [Z1, Z3]; after Done, [Z1] again. At Spruce it draws [Z2, Z4] always.
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
const A = [-149.8885, 61.2177];
const world = () => ({
  crew: [], routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2'] }],
  sites: [{ id: 'S1', name: 'Birch Clinic', rev: 1, map: { center: A, zoom: 18 } }, { id: 'S2', name: 'Spruce Office', rev: 1, crew_curbs: true, map: { center: A, zoom: 18 } }],
  zones: ['S1', 'S2'].flatMap((s, i) => [
    { id: 'Z' + (i + 1), site_id: s, type: 'sidewalk', name: 'Front walk', priority: false, note: '', ring: ring(A[0], A[1], 30, 10), area_sqft: 3229, rev: 1 },
    { id: 'Z' + (i + 3), site_id: s, type: 'hand', name: 'Curb - lot', priority: false, note: '', ring: ring(A[0], A[1] + 0.0003, 20, 4), area_sqft: 1200, rev: 1 },
  ]),
});
function fakeSnow(state) {
  return (body) => {
    const v = { version: 'crewcurbs-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: state.zones.filter((z) => z.archived !== true && (!body.site_id || z.site_id === body.site_id)), ...v };
    if (body.action === 'saveSite') {
      // As the server: the field is stored true or false; a save that leaves it out keeps what is stored.
      const old = state.sites.find((s) => s.id === body.record.id) || {};
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      if (!('crew_curbs' in body.record)) rec.crew_curbs = old.crew_curbs;
      state.sites = state.sites.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function start(page, state) {
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
  return calls;
}
async function openMap(page, id) {
  await page.click('[data-map="' + id + '"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones') && window.SnowMapView.getSource('zones')._data);
  await expect(page.locator('#mapedit')).toBeEnabled();
}
const drawn = (page) => page.evaluate(() => window.SnowMapView.getSource('zones')._data.features.map((f) => f.properties.id).sort());
const saves = (calls) => calls.filter((c) => c.body.action === 'saveSite');

test('the Sites tab line says the crew does not see the curbs, at the No site only', async ({ page }) => {
  await start(page, world());
  await expect(page.locator('[data-site="S1"] .curbline')).toHaveText("Curbs: 300 ft in 1 item · the crew doesn't see them");
  await expect(page.locator('[data-site="S2"] .curbline')).toHaveText('Curbs: 300 ft in 1 item');
});

test('a No site with no curbs has no curb line at all', async ({ page }) => {
  const w = world(); w.zones = w.zones.filter((z) => z.id !== 'Z3');
  await start(page, w);
  await expect(page.locator('[data-site="S1"] .curbline')).toHaveCount(0);
});

test("the No site's map draws no curb line; the Yes site's draws it", async ({ page }) => {
  await start(page, world());
  await openMap(page, 'S1');
  expect(await drawn(page)).toEqual(['Z1']);
  await page.click('#mapback');
  await page.click('[data-map="S2"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones') && window.SnowMapView.getSource('zones')._data.features.length > 0);
  expect(await drawn(page)).toEqual(['Z2', 'Z4']);
});

test("Matt's Edit map at the No site draws the curbs and Done hides them again", async ({ page }) => {
  await start(page, world());
  await openMap(page, 'S1');
  expect(await drawn(page)).toEqual(['Z1']);
  await page.click('#mapedit');
  await expect(page.locator('#ed_done')).toBeVisible();
  await expect.poll(() => drawn(page)).toEqual(['Z1', 'Z3']);
  // The curb line is editable: tapping inside it (20 m x 4 m, from 33.4 m north) opens its sheet.
  const at = [A[0] + 0.0001, A[1] + 0.0003 + 0.00001];
  await page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
  const pt = await page.evaluate(([a, b]) => { const m = window.SnowMapView; m.jumpTo({ center: [a, b] }); const p = m.project([a, b]); const r = m.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, at);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#z_name')).toHaveValue('Curb - lot');
  await page.click('#z_cancel').catch(() => {});
  await page.click('#ed_done');
  await expect.poll(() => drawn(page)).toEqual(['Z1']);
});

test('the editor box: ticked only at a Yes site, with its hint; Save sends true or false every time', async ({ page }) => {
  const calls = await start(page, world());
  await page.click('[data-edit="site:S1"]');
  const box = page.locator('#s_crew_curbs');
  await expect(page.locator('label', { has: box })).toHaveText('Curbs for the crew');
  await expect(page.locator('#dlgIn')).toContainText("Off: the curbs stay on your map, the crew doesn't see them");
  await expect(box).not.toBeChecked();
  // Saving with the box as it is sends false, not an omission.
  await page.click('#s_save');
  await expect.poll(() => saves(calls).length).toBe(1);
  expect(saves(calls)[0].body.record.crew_curbs).toBe(false);
  // Tick it: true; the Sites line loses its suffix; reopening shows it ticked.
  await page.click('[data-edit="site:S1"]');
  await page.check('#s_crew_curbs');
  await page.click('#s_save');
  await expect.poll(() => saves(calls).length).toBe(2);
  expect(saves(calls)[1].body.record.crew_curbs).toBe(true);
  await expect(page.locator('[data-site="S1"] .curbline')).toHaveText('Curbs: 300 ft in 1 item');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_crew_curbs')).toBeChecked();
  await page.uncheck('#s_crew_curbs');
  await page.click('#s_save');
  await expect.poll(() => saves(calls).length).toBe(3);
  expect(saves(calls)[2].body.record.crew_curbs).toBe(false);
  await expect(page.locator('[data-site="S1"] .curbline')).toHaveText("Curbs: 300 ft in 1 item · the crew doesn't see them");
  // The Yes site opens ticked.
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#s_crew_curbs')).toBeChecked();
});
