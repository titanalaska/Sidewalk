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

// The fake, for Jordan's token only. Every reply is kept in `fake.replies` beside the request.
function fakeSnow(state) {
  const replies = [];
  const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
  const jordan = () => state.crew.find((c) => c.id === 'C03');
  const slimWanted = (body) => body.slim === true;
  const reply = (body) => {
    const v = { version: VERSION };
    if (body.token !== 'tok-jordan') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Jordan Demo', role: 'crew', crew_id: 'C03' };
    if (body.action === 'bootstrap') {
      const crew = state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: null, is_lead: !!c.is_lead }));
      const card = { id: 'C03', name: 'Jordan Demo', pending: false, ...Object.fromEntries(SELF.map((k) => [k, jordan()[k] === undefined ? null : jordan()[k]])) };
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew, post: state.post, card, ...v };
      if (slimWanted(body)) { out.points = SnowPoints.pointsFor(out.sites, out.zones); out.zones = SnowPoints.slim(out.zones); }
      return out;
    }
    if (body.action === 'getZones') {
      const zones = state.zones.filter((z) => z.archived !== true).filter((z) => !body.site_id || z.site_id === body.site_id);
      return { ok: true, zones: slimWanted(body) ? SnowPoints.slim(zones) : zones, ...v };
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
