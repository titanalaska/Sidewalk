// Restore (Matt, 10/10/26) and the "not saved" guard, on the phone, on the real page over file:// with the real MapLibre.
//
// Restore: an archived site, route or zone comes back with one tap, Matt only. The Sites and Routes tabs end in a
// closed "Archived (n)" list with a Restore button each; the map editor has an "Archived zones (n)" list for the open
// site. A tap sends { action: restoreSite | restoreRoute | restoreZone, id, rev } and nothing else. The server answers
// { ok: true, record } with the record's archived flag false and its rev moved on (a zone's record carries its ring).
//
// The guard (lib/api.js): the live app twice got the GET health reply { ok: true, version } for a POST (10/10/26). The
// phone counted it as success, so a save looked saved and was never written. Every POST reply now names the action it
// answers; one from the version this phone expects that does not is "no signal". An older server's reply is not checked.
//
// This file has its own small fake of the backend (a spec file exports nothing, and requiring another would register
// its tests twice). It answers like the real server and no better: every POST reply carries `action`; Matt's bootstrap
// and getZones include archived records and a crew member's never do; crew and leads are refused a restore with the same
// words as an archive attempt; a stale rev is a conflict; a record that is not archived, or not there, is `invalid`.
const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');
const SnowPoints = require('../lib/points.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const VERSION = 'outlines-1'; // lib/config.js EXPECTED_BACKEND
const NO_SIGNAL = "Couldn't reach the server. Not saved, try again.";
const STALE = 'Someone changed this since you opened it. Reload and try again.';

// Two sites at made-up corners, as test/outlines.spec.js draws them. The rings only need to be distinct and
// comparable: the same ring() builds the server's zone and the expected corners.
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
const TUDOR = [-149.8700, 61.2000];
const Z1_RING = ring(PAC[0], PAC[1], 30, 10);
const Z9_RING = ring(PAC[0] + 0.0006, PAC[1], 10, 30); // the archived one: east of PAC's centre
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const zone = (id, site, type, name, r, extra) => ({ id, site_id: site, type, name, priority: false, note: '', ring: r, area_sqft: 1000, rev: 1, archived: false, ...(extra || {}) });

// S3 (CLINIC-OLD, rev 4) is archived and shares PAC's customer; R3 (N9, rev 3) is an archived route; Z9 (rev 2) is an
// archived zone at PAC. Live: S1, S2, R1, R2, Z1.
const world = () => ({
  crew: [{ id: 'C03', name: 'Jordan Demo', phone: '555-0103', is_lead: false, rev: 1, profile_id: '3' }],
  sites: [
    { id: 'S1', name: 'PAC', customer: 'Hospital Co', rev: 1, archived: false, map: { center: PAC, zoom: 18 } },
    { id: 'S2', name: 'TUDOR-TRANSIT', customer: 'Transit Co', rev: 1, archived: false, map: { center: TUDOR, zoom: 18 } },
    { id: 'S3', name: 'CLINIC-OLD', address: '1 Test Way', customer: 'Hospital Co', rev: 4, archived: true },
  ],
  routes: [
    { id: 'R1', name: 'N1', rev: 1, archived: false, site_ids: ['S1'] },
    { id: 'R2', name: 'N2', rev: 1, archived: false, site_ids: ['S2'] },
    { id: 'R3', name: 'N9', rev: 3, archived: true, site_ids: ['S2', 'S3'] },
  ],
  zones: [zone('Z1', 'S1', 'sidewalk', 'Main entry', Z1_RING), zone('Z9', 'S1', 'hand', 'Old ramp', Z9_RING, { rev: 2, archived: true })],
});

// The fake: Matt (tok-matt, admin) and Jordan (tok-jordan, crew).
function fakeSnow(state) {
  const ROLES = { 'tok-matt': 'admin', 'tok-jordan': 'crew' };
  const TABLE = { restoreSite: 'sites', restoreRoute: 'routes', restoreZone: 'zones' };
  return (body) => {
    const v = { version: VERSION, action: body.action };
    const role = ROLES[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = role === 'admin' ? { name: 'Matthew', role: 'admin', crew_id: null } : { name: 'Jordan Demo', role: 'crew', crew_id: 'C03' };
    const seen = (list) => list.filter((x) => role === 'admin' || x.archived !== true); // crew never get archived records
    if (body.action === 'bootstrap') {
      const crew = role === 'admin' ? state.crew : state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: null, is_lead: !!c.is_lead }));
      const out = { ok: true, me, sites: seen(state.sites), routes: seen(state.routes), zones: seen(state.zones), crew, post: null, ...v };
      if (role === 'admin') Object.assign(out, { moves: [], callouts: [], gear: [] });
      else out.card = { id: 'C03', name: 'Jordan Demo', pending: false };
      if (body.slim === true) { out.points = SnowPoints.pointsFor(out.sites, out.zones); out.zones = SnowPoints.slim(out.zones); }
      return out;
    }
    if (body.action === 'getZones') {
      return { ok: true, zones: seen(state.zones).filter((z) => !body.site_id || z.site_id === body.site_id), ...v };
    }
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'saveZone') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1, archived: false };
      if (!rec.id) rec.id = 'X' + (90 + (state._made = (state._made || 0) + 1));
      state.zones = state.zones.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (TABLE[body.action]) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const list = state[TABLE[body.action]], cur = list.find((x) => x.id === body.id);
      if (!cur) return { ok: false, code: 'invalid', reason: 'Nothing to restore.', ...v };
      if (cur.archived !== true) return { ok: false, code: 'invalid', reason: 'That one is not archived.', ...v };
      if (cur.rev !== body.rev) return { ok: false, code: 'conflict', reason: STALE, ...v };
      const rec = { ...cur, archived: false, rev: cur.rev + 1 };
      state[TABLE[body.action]] = list.map((x) => (x.id === rec.id ? rec : x));
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the restore fake: ' + body.action, ...v };
  };
}

// The switches on the fake. holdIf(body): that call waits in ctl.waiting until ctl.release(i). rewrite(body, reply): a
// different reply goes back for a call the server DID process. instead(body): a reply that goes back with the server never
// having seen the call at all (the redirect hiccup: the POST was answered by something else), or undefined to let the fake
// answer.
function control() {
  const ctl = { waiting: [], holdIf: null, rewrite: null, instead: null };
  ctl.release = (i) => { const w = ctl.waiting.splice(i || 0, 1)[0]; w.go(); };
  return ctl;
}

// The page, signed in as `token`. Returns the calls made to the snow backend; calls.errors are the page errors.
async function openApp(page, fake, o = {}) {
  const ctl = o.ctl || control();
  const calls = [];
  calls.errors = [];
  page.on('pageerror', (e) => calls.errors.push(String(e)));
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) => route.fulfill({ contentType: 'image/png', body: PNG1 }));
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    let out = ctl.instead ? ctl.instead(body) : undefined;
    if (out === undefined) out = fake(body);
    if (ctl.rewrite) out = ctl.rewrite(body, out);
    const text = JSON.stringify(out);
    if (ctl.holdIf && ctl.holdIf(body)) await new Promise((go) => ctl.waiting.push({ body, go }));
    await route.fulfill({ contentType: 'application/json', body: text });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [] }) }));
  await page.addInitScript((token) => localStorage.setItem('titan-snow-token', token), o.token || 'tok-matt');
  await page.goto(PAGE);
  await page.waitForSelector('nav [data-tab="sites"]');
  calls.ctl = ctl;
  return calls;
}
const callsOf = (calls, action) => calls.filter((c) => c.body.action === action);
const sitesTab = (page) => page.click('nav [data-tab="sites"]');
const routesTab = (page) => page.click('nav [data-tab="routes"]');
// What the Sites tab lists, in order: the customer headings and the site names under them.
const siteLayout = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#main .site-group, #main .site-card .site-name')).map((e) => e.textContent));
const isOpen = (page, sel) => page.locator(sel).evaluate((el) => el.open);

// ---------------- Sites ----------------
test('Matt sees Archived (1) on the Sites tab, closed; Restore sends exactly the id and rev, and the site rejoins its customer group', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await sitesTab(page);
  // The live list, with the archived site left out of it.
  expect(await siteLayout(page)).toEqual(['Hospital Co', 'PAC', 'Transit Co', 'TUDOR-TRANSIT']);
  await expect(page.locator('#archivedSites summary')).toHaveText('Archived (1)');
  expect(await isOpen(page, '#archivedSites')).toBe(false); // closed until he opens it
  await page.click('#archivedSites summary');
  await expect(page.locator('#archivedSites')).toContainText('CLINIC-OLD');
  await expect(page.locator('#archivedSites')).toContainText('1 Test Way');

  await page.click('#archivedSites [data-restore="site:S3"]');
  // The site joins the live list, in the Hospital Co group, in name order (CLINIC-OLD before PAC).
  await expect.poll(() => siteLayout(page)).toEqual(['Hospital Co', 'CLINIC-OLD', 'PAC', 'Transit Co', 'TUDOR-TRANSIT']);
  await expect(page.locator('[data-site="S3"] [data-map="S3"]')).toBeVisible();
  await expect(page.locator('[data-site="S3"] [data-edit="site:S3"]')).toBeVisible();
  // Nothing archived is left, so the section is gone.
  await expect(page.locator('#archivedSites')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('Restored');
  expect(callsOf(calls, 'restoreSite').map((c) => c.body)).toEqual([{ action: 'restoreSite', id: 'S3', rev: 4, token: 'tok-matt' }]);
  expect(state.sites.find((s) => s.id === 'S3')).toMatchObject({ archived: false, rev: 5 });
  expect(calls.errors).toEqual([]);
});

test('the Restore button is disabled while its request is on the way, and the request goes once', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(world()));
  const ctl = calls.ctl; ctl.holdIf = (b) => b.action === 'restoreSite';
  await sitesTab(page);
  await page.click('#archivedSites summary');
  const btn = page.locator('#archivedSites [data-restore="site:S3"]');
  await btn.click();
  await expect(btn).toBeDisabled();
  await btn.click({ force: true }).catch(() => {}); // a second tap on a disabled button goes nowhere
  expect(ctl.waiting).toHaveLength(1);
  ctl.release();
  await expect(page.locator('#archivedSites')).toHaveCount(0);
  expect(callsOf(calls, 'restoreSite')).toHaveLength(1);
});

test('a stale rev (conflict) shows the reason, keeps the site under Archived, and the retry carries the new rev', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await sitesTab(page);
  state.sites.find((s) => s.id === 'S3').rev = 9; // someone saved it since this phone read it
  await page.click('#archivedSites summary');
  await page.click('#archivedSites [data-restore="site:S3"]');
  await expect(page.locator('#toast')).toHaveText(STALE);
  expect(callsOf(calls, 'restoreSite')[0].body.rev).toBe(4);
  // The phone reads the newest copy (as every refused save does), and the site is still archived.
  await expect.poll(() => callsOf(calls, 'bootstrap').length).toBe(2);
  await expect(page.locator('#archivedSites summary')).toHaveText('Archived (1)');
  expect(await siteLayout(page)).toEqual(['Hospital Co', 'PAC', 'Transit Co', 'TUDOR-TRANSIT']);
  expect(await isOpen(page, '#archivedSites')).toBe(true); // it stayed open through the redraw, as he left it
  await expect(page.locator('#archivedSites [data-restore="site:S3"]')).toBeEnabled(); // the tap can be tried again
  await page.click('#archivedSites [data-restore="site:S3"]');
  await expect(page.locator('#archivedSites')).toHaveCount(0);
  expect(callsOf(calls, 'restoreSite').map((c) => c.body.rev)).toEqual([4, 9]);
});

test('a refusal that is not a conflict shows the server\'s words and leaves the site under Archived', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await sitesTab(page);
  state.sites.find((s) => s.id === 'S3').archived = false; // someone restored it first, same rev
  await page.click('#archivedSites summary');
  const btn = page.locator('#archivedSites [data-restore="site:S3"]');
  await btn.click();
  await expect(page.locator('#toast')).toHaveText('That one is not archived.');
  await expect(page.locator('#archivedSites summary')).toHaveText('Archived (1)');
  await expect(btn).toBeEnabled();
  expect(calls.errors).toEqual([]);
});

// ---------------- Routes ----------------
test('Matt sees Archived (1) on the Routes tab; Restore sends restoreRoute with the id and rev, and the route comes back', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await routesTab(page);
  await expect(page.locator('.route-card')).toHaveCount(2); // N1, N2
  await expect(page.locator('[data-route="R3"]')).toHaveCount(0);
  await expect(page.locator('#archivedRoutes summary')).toHaveText('Archived (1)');
  expect(await isOpen(page, '#archivedRoutes')).toBe(false);
  await page.click('#archivedRoutes summary');
  await expect(page.locator('#archivedRoutes')).toContainText('N9');

  await page.click('#archivedRoutes [data-restore="route:R3"]');
  await expect(page.locator('.route-card[data-route="R3"]')).toBeVisible();
  await expect(page.locator('.route-card[data-route="R3"]')).toContainText('CLINIC-OLD'); // its sites, as they were
  await expect(page.locator('#archivedRoutes')).toHaveCount(0);
  expect(callsOf(calls, 'restoreRoute').map((c) => c.body)).toEqual([{ action: 'restoreRoute', id: 'R3', rev: 3, token: 'tok-matt' }]);
  expect(state.routes.find((r) => r.id === 'R3')).toMatchObject({ archived: false, rev: 4 });
  // Sites and routes are separate lists: the Sites tab still has its own archived site.
  await sitesTab(page);
  await expect(page.locator('#archivedSites summary')).toHaveText('Archived (1)');
  expect(calls.errors).toEqual([]);
});

// ---------------- Crew never see any of it ----------------
test('a crew sign-in never shows an Archived section on Sites or Routes, and no editor control on a map', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(world()), { token: 'tok-jordan', ctl: control() });
  await sitesTab(page);
  expect(await siteLayout(page)).toEqual(['Hospital Co', 'PAC', 'Transit Co', 'TUDOR-TRANSIT']);
  await expect(page.locator('#archivedSites')).toHaveCount(0);
  await expect(page.locator('[data-restore]')).toHaveCount(0);
  await routesTab(page);
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.locator('#archivedRoutes')).toHaveCount(0);
  await expect(page.locator('[data-restore]')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText('Archived');
  await sitesTab(page);
  await page.click('[data-map="S1"]');
  await expect(page.locator('#maploading')).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!window.SnowMapView)).toBe(true);
  await expect(page.locator('#mapedit')).toHaveCount(0);
  await expect(page.locator('#ed_arch')).toHaveCount(0);
  await expect(page.locator('[data-zrestore]')).toHaveCount(0);
  expect(callsOf(calls, 'bootstrap')[0].body.token).toBe('tok-jordan');
  expect(calls.errors).toEqual([]);
});

test('even if an archived record reached a crew phone, no Archived section is drawn for it', async ({ page }) => {
  // The server never sends one (the fake above does not). This is the phone's own gate: an Archived list is Matt's, so
  // it is not drawn for anyone else whatever arrives. The reply is rewritten to carry them, nothing else changed.
  const state = world();
  const ctl = control();
  ctl.rewrite = (b, reply) => (b.action === 'bootstrap' ? { ...reply, sites: state.sites, routes: state.routes } : reply);
  await openApp(page, fakeSnow(state), { token: 'tok-jordan', ctl });
  await sitesTab(page);
  await expect(page.locator('#archivedSites')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText('CLINIC-OLD');
  await routesTab(page);
  await expect(page.locator('#archivedRoutes')).toHaveCount(0);
  await expect(page.locator('[data-route="R3"]')).toHaveCount(0);
});

// ---------------- Zones, in the editor ----------------
const drawn = (page) => page.evaluate(() => {
  const m = window.SnowMapView, s = m && m.getSource('zones');
  return s && s._data ? s._data.features.map((f) => ({ id: f.properties.id, ring: f.geometry.coordinates[0].slice(0, -1) })) : null;
});
const keptNow = (page) => page.evaluate(() => { const t = localStorage.getItem('snow-outlines'); return t == null ? null : JSON.parse(t); });
// Matt opens PAC's map and turns on Edit map (it is enabled once the server's check has answered).
async function editorOn(page) {
  await sitesTab(page);
  await page.click('[data-map="S1"]');
  await expect(page.locator('#mapedit')).toBeEnabled({ timeout: 20000 });
  await page.click('#mapedit');
  await expect(page.locator('#edbar')).toBeVisible();
}

// Spanish (rebased onto the outlines release 10/16/26): the Archived lists came in with that release, after the Spanish pass
// marked every place a person's words render. A name is data, never translated: each one must sit under data-no-es, or a
// route called "N9" or a zone called "Old ramp" could come out half in Spanish on Matt's phone. Checked on the DOM itself,
// so it holds whatever the dictionary happens to contain.
const nameGuarded = (page, sel, name) => page.locator(sel).evaluate((root, n) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) if (t.textContent.trim() === n) return !!t.parentElement.closest('[data-no-es]');
  return 'name not found: ' + n;
}, name);
test('Spanish: the Archived lists keep site, route and zone names out of translation', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await sitesTab(page);
  await page.click('#archivedSites summary');
  expect(await nameGuarded(page, '#archivedSites', 'CLINIC-OLD')).toBe(true);
  await routesTab(page);
  await page.click('#archivedRoutes summary');
  expect(await nameGuarded(page, '#archivedRoutes', 'N9')).toBe(true);
  await editorOn(page);
  await page.click('#ed_arch summary');
  expect(await nameGuarded(page, '#ed_arch', 'Old ramp')).toBe(true);
  expect(calls.errors).toEqual([]);
});

test('the editor lists the site\'s archived zones; the map does not draw them; Restore draws the zone and keeps its outline', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await editorOn(page);
  // The reply to the map's own getZones carried the archived zone (Matt's does); the map drew only the live one.
  expect(callsOf(calls, 'getZones')).toHaveLength(1);
  expect(callsOf(calls, 'getZones')[0].body.site_id).toBe('S1');
  await expect.poll(() => drawn(page)).toEqual([{ id: 'Z1', ring: Z1_RING }]);
  await expect(page.locator('#ed_arch summary')).toHaveText('Archived zones (1)');
  expect(await isOpen(page, '#ed_arch')).toBe(false);
  await page.click('#ed_arch summary');
  await expect(page.locator('#ed_arch')).toContainText('Old ramp');
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING }); // the archived outline is not kept either

  await page.click('#ed_arch [data-zrestore="Z9"]');
  await expect.poll(() => drawn(page)).toEqual([{ id: 'Z1', ring: Z1_RING }, { id: 'Z9', ring: Z9_RING }]);
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING, Z9: Z9_RING }); // lands in the kept copy, as a save does
  await expect(page.locator('#ed_arch')).toBeHidden(); // none left
  await expect(page.locator('#toast')).toHaveText('Zone restored');
  expect(callsOf(calls, 'restoreZone').map((c) => c.body)).toEqual([{ action: 'restoreZone', id: 'Z9', rev: 2, token: 'tok-matt' }]);
  expect(state.zones.find((z) => z.id === 'Z9')).toMatchObject({ archived: false, rev: 3 });
  expect(calls.errors).toEqual([]);
});

test('the zone\'s Restore button is disabled while its request is on the way', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(world()));
  const ctl = calls.ctl; ctl.holdIf = (b) => b.action === 'restoreZone';
  await editorOn(page);
  await page.click('#ed_arch summary');
  const btn = page.locator('#ed_arch [data-zrestore="Z9"]');
  await btn.click();
  await expect(btn).toBeDisabled();
  expect(ctl.waiting).toHaveLength(1);
  ctl.release();
  await expect(page.locator('#ed_arch')).toBeHidden();
  expect(callsOf(calls, 'restoreZone')).toHaveLength(1);
});

test('a refused zone restore shows the server\'s words, and the map is not changed', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  await editorOn(page);
  state.zones.find((z) => z.id === 'Z9').rev = 5; // saved by someone else since this map read it
  await page.click('#ed_arch summary');
  await page.click('#ed_arch [data-zrestore="Z9"]');
  await expect(page.locator('#toast')).toHaveText(STALE);
  await expect(page.locator('#ed_arch summary')).toHaveText('Archived zones (1)');
  await expect(page.locator('#ed_arch [data-zrestore="Z9"]')).toBeEnabled();
  expect(await drawn(page)).toEqual([{ id: 'Z1', ring: Z1_RING }]);
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING });
  expect(callsOf(calls, 'restoreZone')).toHaveLength(1);
  expect(calls.errors).toEqual([]);
});

// ---------------- The not-saved guard, through the whole page ----------------
// The CORNERS are clicked west of PAC's centre, where no zone is (every zone starts at PAC and runs east).
const CORNERS = [[-150, -60], [-40, -60], [-40, 20], [-150, 20]];
async function drawZone(page, name) {
  await page.click('#ed_new');
  for (const [x, y] of CORNERS) {
    await page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    const r = await page.evaluate(() => { const b = window.SnowMapView.getCanvas().getBoundingClientRect(); return { l: b.left + b.width / 2, t: b.top + b.height / 2 }; });
    await page.mouse.click(Math.round(r.l + x), Math.round(r.t + y));
  }
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="hand"]');
  await page.fill('#z_name', name);
  await page.click('#z_save');
}

test('the health check\'s reply to a zone save is "not saved": the form stays open, the zone is not on the map, nothing is kept', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  const ctl = calls.ctl;
  // The Google redirect hiccup: the GET reply, { ok: true, version }, comes back for the POST, and the server never saw the save.
  ctl.instead = (b) => (b.action === 'saveZone' ? { ok: true, version: VERSION } : undefined);
  await editorOn(page);
  await drawZone(page, 'Side door');
  await expect(page.locator('#z_err')).toHaveText(NO_SIGNAL);
  await expect(page.locator('#zoneform')).toBeVisible(); // his corners are still there to try again
  await expect(page.locator('#toast')).not.toHaveText('Zone saved');
  expect(await drawn(page)).toEqual([{ id: 'Z1', ring: Z1_RING }]);
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING });
  expect(callsOf(calls, 'saveZone')).toHaveLength(1);
  expect(state.zones.map((z) => z.id)).toEqual(['Z1', 'Z9']); // and it was not written: the phone's word for it is the truth
  // And the try again, once the signal is back, saves it.
  ctl.instead = null;
  await page.click('#z_save');
  await expect(page.locator('#toast')).toHaveText('Zone saved');
  await expect.poll(async () => (await drawn(page)).map((z) => z.id)).toEqual(['Z1', 'X91']);
  expect(calls.errors).toEqual([]);
});

test('the health check\'s reply to a Restore tap is "not saved": the site stays under Archived and the button comes back', async ({ page }) => {
  const state = world();
  const calls = await openApp(page, fakeSnow(state));
  calls.ctl.instead = (b) => (b.action === 'restoreSite' ? { ok: true, version: VERSION } : undefined);
  await sitesTab(page);
  await page.click('#archivedSites summary');
  const btn = page.locator('#archivedSites [data-restore="site:S3"]');
  await btn.click();
  await expect(page.locator('#toast')).toHaveText(NO_SIGNAL);
  await expect(page.locator('#archivedSites summary')).toHaveText('Archived (1)');
  await expect(btn).toBeEnabled();
  expect(await siteLayout(page)).toEqual(['Hospital Co', 'PAC', 'Transit Co', 'TUDOR-TRANSIT']);
  expect(state.sites.find((s) => s.id === 'S3')).toMatchObject({ archived: true, rev: 4 });
  expect(calls.errors).toEqual([]);
});

test('an older server\'s reply (curbs-1, no action) is not refused by the guard: the zone saves', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(world()));
  // The same reply, as a curbs-1 server sends it: another version, and no `action` on it.
  calls.ctl.rewrite = (b, reply) => { if (b.action !== 'saveZone') return reply; const { action: _a, ...old } = reply; return { ...old, version: 'curbs-1' }; };
  await editorOn(page);
  await drawZone(page, 'Side door');
  await expect(page.locator('#toast')).toHaveText('Zone saved');
  await expect.poll(async () => (await drawn(page)).map((z) => z.id)).toEqual(['Z1', 'X91']);
  await expect(page.locator('#z_err')).toHaveCount(0);
  expect(calls.errors).toEqual([]);
});
