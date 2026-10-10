// Outlines on demand (Matt, 10/9/26), on the phone: what the page does with the slim replies and its
// own kept copy of the outlines (lib/outlines.js, localStorage['snow-outlines']).
//
// This file has its own small fake of the snow backend rather than ui.spec.js's: a spec file exports
// nothing, and requiring one from another would register its tests twice. The fake answers `slim` the
// way snow-app-script's Code.js does, with the SAME lib/points.js (byte for byte the server's): on
// `slim === true` and nothing else, the points are worked out from the outlines the zones still have,
// then the rings are dropped. ui.spec.js pins the same behaviour on its bigger fake.
const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');
const SnowPoints = require('../lib/points.js');
const STORM_FIELDS = require('./storm-fields.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const VERSION = 'outlines-1'; // lib/config.js EXPECTED_BACKEND: a different one would show the version banner

// 7:30 AM Alaska on 10/3: the night shift of 10/2 (before the 9 AM cutover), a storm open since 6 AM.
const STORM_CLOCK = '2026-10-03T07:30:00-08:00';
const START_ROW = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };

// Jordan Demo (crew, C03) is a member of route N1, which walks PAC (S1). TUDOR-TRANSIT (S2) is on N2.
const world = () => ({
  crew: [{ id: 'C01', name: 'Alex Test', phone: '555-0101', is_lead: true, rev: 1, profile_id: '2' },
    { id: 'C03', name: 'Jordan Demo', phone: '555-0103', is_lead: false, rev: 1, profile_id: '3' }],
  sites: [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 }],
  routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }],
  zones: [],
  storms: [START_ROW],
  post: { id: 'P1', rev: 1, shift: 'night-2026-10-02', posted_at: '2026-10-02T00:12:00.000Z',
    routes: [{ id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [] },
      { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'] }],
    people: { C01: { name: 'Alex Test', phone: '555-0101', shifts: { night: 3, day: 1 } },
      C03: { name: 'Jordan Demo', phone: '555-0103', shifts: { night: 2, day: 0 } } } },
});

// The fake: Jordan (crew, tok-jordan) and Matt (admin, tok-matt). Every reply is kept in `fake.replies`
// beside the request.
function fakeSnow(state) {
  const replies = [];
  const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
  const jordan = () => state.crew.find((c) => c.id === 'C03');
  const slimWanted = (body) => body.slim === true;
  const ROLES = { 'tok-jordan': 'crew', 'tok-matt': 'admin' };
  const reply = (body) => {
    const v = { version: VERSION };
    const role = ROLES[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = role === 'admin' ? { name: 'Matthew', role: 'admin', crew_id: null } : { name: 'Jordan Demo', role: 'crew', crew_id: 'C03' };
    if (body.action === 'bootstrap') {
      // Matt gets the crew whole and his own lists; Jordan the public crew view and his own card.
      const crew = role === 'admin' ? state.crew : state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: null, is_lead: !!c.is_lead }));
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew, post: state.post, ...v };
      if (role === 'admin') Object.assign(out, { moves: [], callouts: [], gear: [] });
      else out.card = { id: 'C03', name: 'Jordan Demo', pending: false, ...Object.fromEntries(SELF.map((k) => [k, jordan()[k] === undefined ? null : jordan()[k]])) };
      if (slimWanted(body)) { out.points = SnowPoints.pointsFor(out.sites, out.zones); out.zones = SnowPoints.slim(out.zones); }
      return out;
    }
    // As the real getZones: Matt's replies carry archived zones too, everyone else's the live ones.
    if (body.action === 'getZones') {
      const zones = state.zones.filter((z) => role === 'admin' || z.archived !== true).filter((z) => !body.site_id || z.site_id === body.site_id);
      return { ok: true, zones: slimWanted(body) ? SnowPoints.slim(zones) : zones, ...v };
    }
    // saveZone, Matt only: the record comes back with its rev moved on and a fresh id if it had none.
    if (body.action === 'saveZone') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      if (!rec.id) rec.id = 'X' + (90 + (state._made = (state._made || 0) + 1));
      state.zones = state.zones.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'getPost') return { ok: true, post: state.post, ...v };
    if (body.action === 'getShiftLog') {
      // Crew see storm rows through the server's allow-list (test/storm-fields.js).
      const tables = { log: [], visits: [], trucks: [], sheets: [], posts: [], storms: state.storms.map((row) => Object.fromEntries(STORM_FIELDS.map((k) => [k, row[k] === undefined ? null : row[k]]))) };
      const out = { ok: true, cursor: {}, reset: {}, ...v };
      Object.keys(tables).forEach((t) => {
        const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0));
        out[t] = tables[t].slice(cur);
        out.cursor[t] = tables[t].length;
        out.reset[t] = false;
      });
      return out;
    }
    return { ok: false, code: 'error', reason: 'unknown action ' + body.action, ...v };
  };
  const f = (body) => { const r = reply(body); replies.push({ body, reply: r }); return r; };
  f.replies = replies;
  return f;
}

// The National Weather Service, as ui.spec.js's nws() answers it: the one points URL it knows, then the
// hourly forecast. The hours start at 7 AM, so at 7:30 the run of snow ends at the 10 AM period.
const NWS_HOURLY = 'https://api.weather.gov/gridpoints/ZZZ/1,1/forecast/hourly';
const NWS_PERIODS = ['Light Snow', 'Snow', 'Snow Showers', ...Array(9).fill('Mostly Cloudy')].map((t, i) => ({
  startTime: '2026-10-03T' + String(7 + i).padStart(2, '0') + ':00:00-08:00', shortForecast: t }));
async function nws(page, pointsUrl) {
  const seen = [];
  const cors = { 'access-control-allow-origin': '*' };
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => {
    const u = route.request().url();
    seen.push(u);
    if (u === pointsUrl) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { forecastHourly: NWS_HOURLY } }) });
    if (u === NWS_HOURLY) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { periods: NWS_PERIODS } }) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return seen;
}

// Jordan signs in with `kept` (a string, or nothing) already in localStorage['snow-outlines'] and lands
// on the Storm tab. Returns the calls the phone made to the snow backend.
async function openStorm(page, fake, kept) {
  const calls = [];
  await page.clock.install({ time: new Date(STORM_CLOCK) });
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [] }) }));
  await page.addInitScript(([token, kept]) => {
    localStorage.setItem('titan-snow-token', token);
    if (kept) localStorage.setItem('snow-outlines', kept);
  }, ['tok-jordan', kept || null]);
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');
  return calls;
}
const callsOf = (calls, action) => calls.filter((c) => c.body.action === action);
const walkRow = (page, key) => page.locator('[data-walkrow="' + key + '"]');
// Another visibilitychange = the app coming back on screen = the zones read again (and a poll).
const pollNow = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

// ---------------- The forecast point, last resort: this phone's kept copy ----------------
// A site's forecast point comes from, in order: its saved map view; the server's point for it (the slim
// sign-in's `points`); a ring the server sent (an old backend); and only then, this phone's kept copy of
// the site's outlines. That last step is reachable in one real case. A site had no zone at sign-in, so
// the server had no point for it and `points` has no key for it. Its first zone is drawn afterwards
// (here: by the time the phone is back on screen), and the Storm tab's slim zone refresh brings that
// zone WITHOUT its ring and does not bring `points` again. The only outline left on the phone is the
// kept copy, written when a map was last opened or saved here.
//
// The kept zone: Main entry (Z1 at PAC), a 2-thousandth by 2-thousandth rectangle (lng -149.9040 to
// -149.9020, lat 61.1695 to 61.1715). A rectangle's centroid is its centre: lng (-149.9040 + -149.9020) / 2
// = -149.9030, lat (61.1695 + 61.1715) / 2 = 61.1705. The NWS is asked for the point rounded to two
// decimals: 61.1705 * 100 = 6117.05 -> 6117 -> 61.17; -149.9030 * 100 = -14990.30 -> -14990 -> -149.9.
// So the one URL it must be asked is /points/61.17,-149.9. No saved view, no `points` entry and no
// ring in S.zones can have given any other.
const KEPT_RING = [[-149.9040, 61.1695], [-149.9020, 61.1695], [-149.9020, 61.1715], [-149.9040, 61.1715]];
const KEPT_POINTS = 'https://api.weather.gov/points/61.17,-149.9';
const KEPT = JSON.stringify({ v: 1, sites: { S1: { at: '2026-10-08T12:00:00.000Z', rings: { Z1: KEPT_RING } } } });

test('a site whose first zone is drawn after sign-in gets its forecast point from this phone\'s kept outline', async ({ page }) => {
  const seen = await nws(page, KEPT_POINTS);
  const state = world(); // S1 has no zone yet; the kept copy already holds Z1's outline
  const fake = fakeSnow(state);
  const calls = await openStorm(page, fake, KEPT);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');

  // The premise, from what the server sent: a slim sign-in whose `points` has no S1 key.
  const boot = fake.replies.find((r) => r.body.action === 'bootstrap');
  expect(boot.body.slim).toBe(true);
  expect(boot.reply.points).toEqual({});
  expect(boot.reply.zones).toEqual([]);
  // Nothing to ask the NWS about: the kept outline is for a zone this phone does not know of yet,
  // and the kept copy is read only through the zones the phone has.
  expect(seen).toEqual([]);
  await expect(page.locator('#stormhint')).toHaveCount(0);

  // Matt draws Main entry (the server holds the ring). Jordan's phone comes back on screen: the slim
  // zone refresh brings the zone with NO ring, and no points.
  state.zones.push({ id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', rev: 1, ring: KEPT_RING });
  await pollNow(page);
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
  const refresh = callsOf(calls, 'getZones');
  expect(refresh).toHaveLength(1);
  expect(refresh[0].body.slim).toBe(true);
  const sent = fake.replies.filter((r) => r.body.action === 'getZones').map((r) => r.reply);
  expect(sent).toHaveLength(1);
  expect(sent[0].zones.map((z) => z.id)).toEqual(['Z1']);
  expect(JSON.stringify(sent[0])).not.toContain('"ring"');
  expect(sent[0].points).toBeUndefined();
  expect(callsOf(calls, 'bootstrap')).toHaveLength(1); // no second sign-in read that could have brought a point

  // The forecast point is the kept outline's centre, rounded: 61.17, -149.9.
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toEqual([KEPT_POINTS, NWS_HOURLY]);
});

// ---------------- Maps from kept copies (outlines on demand, Task 5) ----------------
// Tapping Map draws what THIS PHONE kept of the site's outlines at once (SnowOutlines, localStorage
// 'snow-outlines'), and asks the server for the site's zones in the background (getZones with site_id: the
// rings are in that reply, never in sign-in). The reply is kept for the next open, and redraws the map only if
// it differs from what the map is showing. A site with zones and nothing kept shows "Loading map…" until the
// reply, or says it needs signal. These run on the real page over file:// with the real MapLibre, against
// this file's fake, which can HOLD a getZones reply (ctl.holdIf, then ctl.release) or drop it as a lost
// signal does (ctl.abortIf).
//
// Two sites at made-up corners, as test/ui.spec.js draws them. A 30 m x 10 m walk at 61.2177 N is worked by
// hand there; here the rings only need to be distinct and comparable, and the numbers come from the same
// ring() helper on both sides of every check (the fake's server and the expected corners), so nothing here
// reads a value back out of the page and pastes it in.
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
const TUDOR = [-149.8700, 61.2000];
const Z1_RING = ring(PAC[0], PAC[1], 30, 10);
const Z2_RING = ring(PAC[0], PAC[1] + 0.0003, 20, 5);
const Z3_RING = ring(PAC[0] + 0.0006, PAC[1], 10, 30); // the archived one
const Z4_RING = ring(TUDOR[0], TUDOR[1], 25, 8);
// Z1 with its THIRD corner 0.0001 deg further north (about 11 m): one corner moved, the rest as they were.
const Z1_MOVED = Z1_RING.map((p, i) => (i === 2 ? [p[0], p[1] + 0.0001] : p));
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SEED_AT = '2026-10-08T12:00:00.000Z';
const zone = (id, site, type, name, r) => ({ id, site_id: site, type, name, priority: false, note: '', ring: r, area_sqft: 1000, rev: 1 });

// No storm open and nothing posted: these are the Sites tab's maps. S1 and S2 both carry a saved view, so
// each map opens on its own zones. S1 has Z1 and Z2, S2 has Z4.
const mapWorld = () => {
  const w = world();
  w.storms = []; w.post = null;
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1, map: { center: PAC, zoom: 18 } }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1, map: { center: TUDOR, zoom: 18 } }];
  w.zones = [zone('Z1', 'S1', 'sidewalk', 'Main entry', Z1_RING), zone('Z2', 'S1', 'heated', 'Heated walk', Z2_RING), zone('Z4', 'S2', 'hand', 'Back lot', Z4_RING)];
  return w;
};

// What the map is drawing: the zones source's features, as { id, ring }, in the order drawn.
const drawn = (page) => page.evaluate(() => {
  const m = window.SnowMapView, s = m && m.getSource('zones');
  return s && s._data ? s._data.features.map((f) => ({ id: f.properties.id, ring: f.geometry.coordinates[0].slice(0, -1) })) : null;
});
const expectDrawn = (page, want) => expect.poll(() => drawn(page), { timeout: 20000 }).toEqual(want);
const mapOpen = (page) => page.evaluate(() => !!window.SnowMapView);
const keptNow = (page) => page.evaluate(() => { const t = localStorage.getItem('snow-outlines'); return t == null ? null : JSON.parse(t); });
const keptText = (page) => page.evaluate(() => localStorage.getItem('snow-outlines'));
// { S1: { Z1: ring } } -> the text of localStorage['snow-outlines']
const keptJson = (sites, at) => JSON.stringify({ v: 1, sites: Object.fromEntries(Object.entries(sites).map(([id, rings]) => [id, { at: at || SEED_AT, rings }])) });
const SEED_S1 = keptJson({ S1: { Z1: Z1_RING, Z2: Z2_RING } });

// Every call to SnowMap.setZones, as the zone ids it was handed: the map redrawn from a list.
const spySetZones = (page) => page.evaluate(() => {
  window.__setZones = [];
  const real = window.SnowMap.setZones;
  window.SnowMap.setZones = function (m, zones) { window.__setZones.push(zones.map((z) => z.id)); return real.apply(this, arguments); };
});
const setZonesCalls = (page) => page.evaluate(() => window.__setZones);

const isSiteZones = (b) => b.action === 'getZones' && !!b.site_id;
const isSave = (b) => b.action === 'saveZone';

// The switches on the fake. holdIf(body): that call waits in ctl.waiting until ctl.release(i). abortIf(body):
// that call is dropped like a lost signal. rewrite(body, reply): a different reply goes back. ctl.served
// counts the calls that have been answered, so a test can wait for "the reply has gone" before it asserts
// that nothing happened because of it.
function control() {
  const ctl = { waiting: [], served: [], holdIf: null, abortIf: null, rewrite: null };
  ctl.release = (i) => { const w = ctl.waiting.splice(i || 0, 1)[0]; w.go(); };
  return ctl;
}

// The page, signed in as `token` (Jordan by default) on a phone whose localStorage holds `kept` already.
// Returns the calls made to the snow backend; calls.errors are the page errors.
async function openApp(page, fake, o = {}) {
  const ctl = o.ctl || control();
  const calls = [];
  calls.errors = [];
  page.on('pageerror', (e) => calls.errors.push(String(e)));
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) => route.fulfill({ contentType: 'image/png', body: PNG1 }));
  (o.without || []).forEach((file) => page.route((u) => u.href.endsWith(file), (route) => route.abort()));
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    if (ctl.abortIf && ctl.abortIf(body)) return route.abort();
    let out = fake(body);
    if (ctl.rewrite) out = ctl.rewrite(body, out);
    const text = JSON.stringify(out); // the server answered when it was asked, whatever the phone hears later
    if (ctl.holdIf && ctl.holdIf(body)) await new Promise((go) => ctl.waiting.push({ body, go }));
    await route.fulfill({ contentType: 'application/json', body: text });
    ctl.served.push(body);
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [] }) }));
  await page.addInitScript(([token, kept, lang, editing, refuse]) => {
    localStorage.setItem('titan-snow-token', token);
    if (kept) localStorage.setItem('snow-outlines', kept);
    if (lang) localStorage.setItem('snow-lang', lang);
    if (editing) localStorage.setItem('titan-snow-editing', '1');
    // A full store: this key is refused (the accessor and every other key still work).
    if (refuse) {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'snow-outlines') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    }
  }, [o.token || 'tok-jordan', o.kept || null, o.lang || null, !!o.editing, !!o.refuse]);
  await page.goto(PAGE);
  await page.waitForSelector('nav [data-tab="sites"]');
  await spySetZones(page);
  calls.ctl = ctl;
  return calls;
}
const toMap = async (page, id) => {
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="' + id + '"]');
};
// Gives the page time to act on a reply it has just been sent (a macrotask or two), before a test asserts
// that it did NOT.
const settle = (page, ctl, n) => expect.poll(() => ctl.served.filter(isSiteZones).length).toBe(n).then(() => page.waitForTimeout(400));

test('a kept copy draws the map at once, while the check for news is still on its way', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { kept: SEED_S1 });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  // The reply is held, and the map already draws Z1 and Z2 from the phone's own copy.
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  expect(ctl.waiting.map((w) => w.body.site_id)).toEqual(['S1']);
  await expect(page.locator('#maploading')).toBeHidden();
  await expect(page.locator('#mapnosignal')).toBeHidden();
  expect((await keptNow(page)).sites.S1.at).toBe(SEED_AT); // nothing has been kept yet
  // The check asked for THIS site's zones, with no slim: the rings are what it is for.
  expect(calls.filter((c) => isSiteZones(c.body)).map((c) => c.body)).toEqual([expect.objectContaining({ action: 'getZones', site_id: 'S1' })]);
  expect(calls.filter((c) => isSiteZones(c.body))[0].body.slim).toBeUndefined();

  // The reply lands with the same outlines: kept again (the time moves), and the map is not redrawn.
  ctl.release();
  await expect.poll(async () => (await keptNow(page)).sites.S1.at).not.toBe(SEED_AT);
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING, Z2: Z2_RING });
  expect(await setZonesCalls(page)).toEqual([]);
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
});

test('a reply with one corner moved redraws the map and is what the phone keeps', async ({ page }) => {
  const w = mapWorld(); w.zones[0] = zone('Z1', 'S1', 'sidewalk', 'Main entry', Z1_MOVED); // the server has the moved corner
  const calls = await openApp(page, fakeSnow(w), { kept: SEED_S1 });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]); // the old corner, while it is held
  ctl.release();
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_MOVED }, { id: 'Z2', ring: Z2_RING }]);
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_MOVED, Z2: Z2_RING });
  expect(await setZonesCalls(page)).toEqual([['Z1', 'Z2']]); // one redraw
});

test('a site with zones and nothing kept says "Loading map…" until the reply, then draws', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()));
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expect(page.locator('#maploading')).toBeVisible();
  await expect(page.locator('#maploading')).toHaveText('Loading map…');
  await expect(page.locator('#mapnosignal')).toBeHidden();
  expect(await mapOpen(page)).toBe(false); // nothing to show yet
  expect(ctl.waiting).toHaveLength(1);
  expect(await keptText(page)).toBeNull();

  ctl.release();
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect(page.locator('#maploading')).toBeHidden();
  await expect(page.locator('#mapnosignal')).toBeHidden();
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING, Z2: Z2_RING });
  expect(await setZonesCalls(page)).toEqual([]); // opened from the reply: nothing to redraw
});

test('nothing kept and no signal: the map says it needs signal the first time', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()));
  calls.ctl.abortIf = isSiteZones;
  await toMap(page, 'S1');
  await expect(page.locator('#mapnosignal')).toBeVisible();
  await expect(page.locator('#mapnosignal')).toHaveText("This map hasn't been opened on this phone yet. It needs signal the first time.");
  await expect(page.locator('#maploading')).toBeHidden(); // not still loading: it failed
  expect(await mapOpen(page)).toBe(false);
  expect(await keptText(page)).toBeNull();
  expect(calls.errors).toEqual([]);

  // Leaving and coming back with signal: the message goes, the map draws.
  calls.ctl.abortIf = null;
  await page.click('#mapback');
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect(page.locator('#mapnosignal')).toBeHidden();
});

test('nothing kept and a reply that is not zones: the same message, and nothing is kept', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()));
  calls.ctl.rewrite = (b, reply) => (isSiteZones(b) ? { ok: true, zones: 'Z1', version: VERSION } : reply);
  await toMap(page, 'S1');
  await expect(page.locator('#mapnosignal')).toBeVisible();
  expect(await mapOpen(page)).toBe(false);
  expect(await keptText(page)).toBeNull();
});

test('a kept copy and no signal: the map is drawn, quiet, and the copy is exactly as it was', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { kept: SEED_S1 });
  const ctl = calls.ctl; ctl.abortIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect.poll(() => calls.filter((c) => isSiteZones(c.body)).length).toBe(1); // it did ask
  await page.waitForTimeout(400);
  await expect(page.locator('#mapnosignal')).toBeHidden();
  await expect(page.locator('#maploading')).toBeHidden();
  expect(await keptText(page)).toBe(SEED_S1); // a reply that never came wiped nothing
  expect(calls.errors).toEqual([]);
});

// R9: a failed or malformed reply must never wipe the copy the map draws offline.
for (const [label, bad] of [
  ['an error reply', () => ({ ok: false, code: 'error', reason: 'boom', version: VERSION })],
  ['an ok reply with no zones list', () => ({ ok: true, version: VERSION })],
  ['an ok reply whose zones are not a list', () => ({ ok: true, zones: 'Z1', version: VERSION })],
  ['an ok reply of zones that carry no outline (a slim reply)', (reply) => ({ ...reply, zones: reply.zones.map(({ ring: _ring, ...rest }) => rest) })],
]) {
  test('a kept copy survives ' + label, async ({ page }) => {
    const calls = await openApp(page, fakeSnow(mapWorld()), { kept: SEED_S1 });
    const ctl = calls.ctl;
    ctl.rewrite = (b, reply) => (isSiteZones(b) ? bad(reply) : reply);
    await toMap(page, 'S1');
    await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
    await settle(page, ctl, 1);
    expect(await keptText(page)).toBe(SEED_S1);
    expect(await setZonesCalls(page)).toEqual([]);
    await expect(page.locator('#mapnosignal')).toBeHidden();
    expect(calls.errors).toEqual([]);
  });
}

test('Matt: Edit map stays disabled until the reply has landed', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { token: 'tok-matt', kept: SEED_S1 });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]); // the map is up from the kept copy...
  await expect(page.locator('#mapedit')).toBeVisible();
  await expect(page.locator('#mapedit')).toBeDisabled(); // ...and he cannot edit what may be stale
  ctl.release();
  await expect(page.locator('#mapedit')).toBeEnabled();
});

test('Matt: with Edit map left on, the editor bar waits for the reply too', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { token: 'tok-matt', kept: SEED_S1, editing: true });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await page.waitForTimeout(500); // long enough for an auto-start that did not wait
  await expect(page.locator('#ed_new')).toHaveCount(0);
  await expect(page.locator('#mapedit')).toBeDisabled();
  ctl.release();
  await expect(page.locator('#ed_new')).toBeVisible(); // the reply is in: the bar comes up by itself
});

test('Matt: with a copy showing and no signal, Edit map stays off (he would be editing what may be stale)', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { token: 'tok-matt', kept: SEED_S1 });
  calls.ctl.abortIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect.poll(() => calls.filter((c) => isSiteZones(c.body)).length).toBe(1);
  await page.waitForTimeout(400);
  await expect(page.locator('#mapedit')).toBeDisabled();
  await expect(page.locator('#mapnosignal')).toBeHidden();
});

test('Matt\'s reply carries an archived zone: it is never drawn or kept, and a second open does not redraw', async ({ page }) => {
  const w = mapWorld();
  w.zones.push({ ...zone('Z3', 'S1', 'no_touch', 'Ski trail', Z3_RING), archived: true }); // Matt\'s replies include it, with its outline
  const calls = await openApp(page, fakeSnow(w), { token: 'tok-matt' });
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]); // no Z3
  const first = await keptNow(page);
  expect(Object.keys(first.sites.S1.rings)).toEqual(['Z1', 'Z2']); // no ring for Z3
  expect(await setZonesCalls(page)).toEqual([]);

  // Again: the copy is up at once; the same reply (Z3 in it again) changes nothing, so no redraw.
  await page.click('#mapback');
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect.poll(async () => (await keptNow(page)).sites.S1.at).not.toBe(first.sites.S1.at); // the second reply was kept
  await page.waitForTimeout(300);
  expect(Object.keys((await keptNow(page)).sites.S1.rings)).toEqual(['Z1', 'Z2']);
  expect(await setZonesCalls(page)).toEqual([]);
});

test('a reply that lands after Back is kept, and draws nothing on the map that is open', async ({ page }) => {
  // The server has S1's Z1 moved; the phone kept the old corner for S1, and S2 as the server has it.
  const w = mapWorld(); w.zones[0] = zone('Z1', 'S1', 'sidewalk', 'Main entry', Z1_MOVED);
  const calls = await openApp(page, fakeSnow(w), { kept: keptJson({ S1: { Z1: Z1_RING, Z2: Z2_RING }, S2: { Z4: Z4_RING } }) });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  // Open S1 (held), Back, open S2 (held).
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await page.click('#mapback');
  await toMap(page, 'S2');
  await expectDrawn(page, [{ id: 'Z4', ring: Z4_RING }]);
  expect(ctl.waiting.map((x) => x.body.site_id)).toEqual(['S1', 'S2']);

  // S1's reply lands now: S1's copy is updated, and S2's map is exactly as it was.
  ctl.release(0);
  await expect.poll(async () => (await keptNow(page)).sites.S1.rings.Z1).toEqual(Z1_MOVED);
  await page.waitForTimeout(400);
  await expectDrawn(page, [{ id: 'Z4', ring: Z4_RING }]);
  expect(await setZonesCalls(page)).toEqual([]);
  expect((await keptNow(page)).sites.S2.rings).toEqual({ Z4: Z4_RING }); // S2's copy is untouched
  ctl.release(0);
});

test('Back while "Loading map…" is up: the reply is still kept, and no map opens', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()));
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expect(page.locator('#maploading')).toBeVisible();
  await page.click('#mapback');
  ctl.release();
  await expect.poll(async () => (await keptNow(page) || { sites: {} }).sites.S1).toBeTruthy();
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING, Z2: Z2_RING });
  await page.waitForTimeout(300);
  expect(await mapOpen(page)).toBe(false);
  expect(await setZonesCalls(page)).toEqual([]);
});

test('a map opened twice before the first reply lands is judged by what IT shows, not by what was kept meanwhile', async ({ page }) => {
  // Open S1 (held), Back, open S1 again (held): both draw the old corner. The first reply lands and is kept.
  // The second reply then matches the COPY on disk, but not the second map, which is still showing the old
  // corner: it must redraw.
  const w = mapWorld(); w.zones[0] = zone('Z1', 'S1', 'sidewalk', 'Main entry', Z1_MOVED);
  const calls = await openApp(page, fakeSnow(w), { kept: SEED_S1 });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await page.click('#mapback');
  await toMap(page, 'S1');
  await expect.poll(() => ctl.waiting.length).toBe(2);
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);

  ctl.release(0); // the first map's reply: kept; that map is gone, so nothing is drawn
  await expect.poll(async () => (await keptNow(page)).sites.S1.rings.Z1).toEqual(Z1_MOVED);
  await page.waitForTimeout(300);
  expect(await setZonesCalls(page)).toEqual([]);
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);

  ctl.release(0); // the second map's reply
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_MOVED }, { id: 'Z2', ring: Z2_RING }]);
  expect(await setZonesCalls(page)).toEqual([['Z1', 'Z2']]);
});

// ---- Matt's editor on a map that came from a kept copy ----
// CORNERS: pixel offsets from the canvas centre (PAC), all west of it, where no zone is.
const CORNERS = [[-150, -60], [-40, -60], [-40, 20], [-150, 20]];
const mapInView = (page) => page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
async function tapCorners(page, px) {
  for (const [x, y] of px) {
    await mapInView(page);
    const r = await page.evaluate(() => { const b = window.SnowMapView.getCanvas().getBoundingClientRect(); return { l: b.left + b.width / 2, t: b.top + b.height / 2 }; });
    await page.mouse.click(Math.round(r.l + x), Math.round(r.t + y));
  }
}
async function drawZone(page, name) {
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="heated"]');
  await page.fill('#z_name', name);
  await page.click('#z_save');
}
const savedRing = (calls) => calls.filter((c) => isSave(c.body)).at(-1).body.record.ring;

test('Matt saves a zone: the map keeps every other zone, and the phone keeps the saved outline', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { token: 'tok-matt', kept: SEED_S1 });
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await drawZone(page, 'Back steps');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ring4 = savedRing(calls);
  expect(ring4).toHaveLength(4);
  // The new zone comes from the server with a fresh id (X91); Z1 and Z2 are still on the map, rings and all.
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }, { id: 'X91', ring: ring4 }]);
  expect((await keptNow(page)).sites.S1.rings).toEqual({ Z1: Z1_RING, Z2: Z2_RING, X91: ring4 });
});

test('Matt saves a zone on a phone whose storage is full: the map still keeps every zone', async ({ page }) => {
  // The kept copy cannot be written, so it cannot be the place the redraw reads from.
  const calls = await openApp(page, fakeSnow(mapWorld()), { token: 'tok-matt', refuse: true });
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]); // from the reply
  expect(await keptText(page)).toBeNull();
  await drawZone(page, 'Back steps');
  await expect(page.locator('#zoneform')).toBeHidden();
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }, { id: 'X91', ring: savedRing(calls) }]);
  expect(calls.errors).toEqual([]);
});

// ---- sign-out, and a full store ----
test('signing out clears the kept outlines', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { kept: SEED_S1 });
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect.poll(() => keptNow(page)).not.toBeNull();
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  expect(await keptText(page)).toBeNull();
  expect(calls.errors).toEqual([]);
});

test('a reply that lands after sign-out writes nothing', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { kept: SEED_S1 });
  const ctl = calls.ctl; ctl.holdIf = isSiteZones;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  expect(await keptText(page)).toBeNull();
  ctl.release();
  await settle(page, ctl, 1);
  expect(await keptText(page)).toBeNull(); // the person is signed out: no outline may be written now
});

test('a zone save that lands after sign-out writes nothing', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { token: 'tok-matt', kept: SEED_S1 });
  const ctl = calls.ctl;
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect(page.locator('#mapedit')).toBeEnabled();
  ctl.holdIf = isSave;
  await drawZone(page, 'Back steps');
  await expect.poll(() => ctl.waiting.length).toBe(1); // the save is on its way
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  expect(await keptText(page)).toBeNull();
  ctl.release();
  await expect.poll(() => ctl.served.filter(isSave).length).toBe(1);
  await page.waitForTimeout(400);
  expect(await keptText(page)).toBeNull();
});

test('a full store: the map still opens from the reply, with no page error', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { refuse: true });
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await expect(page.locator('#maploading')).toBeHidden();
  expect(await keptText(page)).toBeNull(); // nothing could be kept
  // And the next open still works: it simply has to wait for the reply again.
  await page.click('#mapback');
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  expect(calls.errors).toEqual([]);
});

test('without lib/outlines.js the app still opens a map from the reply, and signs out', async ({ page }) => {
  const calls = await openApp(page, fakeSnow(mapWorld()), { without: ['/lib/outlines.js'] });
  expect(await page.evaluate(() => typeof SnowOutlines)).toBe('undefined'); // the block really held
  await toMap(page, 'S1');
  await expectDrawn(page, [{ id: 'Z1', ring: Z1_RING }, { id: 'Z2', ring: Z2_RING }]);
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  expect(calls.errors).toEqual([]);
});
