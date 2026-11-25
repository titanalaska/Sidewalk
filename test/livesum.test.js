// The live view's summary line (live window, Matt 10/6/26): one line that says how the
// night is going, from the same rows the route cards replay. Worked by hand below.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/livesum.js');

// Three sites. S1 has two walks, S2 and S3 one each. S2 sits on two routes (counted once).
const zones = [
  { id: 'Z1', site_id: 'S1', type: 'sidewalk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z2', site_id: 'S1', type: 'sidewalk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z3', site_id: 'S2', type: 'sidewalk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z4', site_id: 'S3', type: 'sidewalk', ring: [[0, 0], [0, 1], [1, 1]] },
];
const routes = [{ id: 'R1', siteIds: ['S1', 'S2'] }, { id: 'R2', siteIds: ['S2', 'S3'] }, { id: 'R3', siteIds: ['S2'] }];
const ST = 'ST-1';
const row = (seq, site, zone, state, extra) => Object.assign({ id: 'L-' + seq, seq, storm_id: ST, site_id: site, zone_id: zone, state, note: '',
  at: '2026-12-04T19:' + String(seq * 10).padStart(2, '0') + ':00-09:00' }, extra || {});
// 1, 2: S1 cleared (done). 3: a Problem at S2, 4: undone (not a tap, and S2's walk goes back to none).
// 5: a Problem at S3 (open). 6: a depth reading ('*' row: never a tap).
const log = [row(1, 'S1', 'Z1', 'cleared'), row(2, 'S1', 'Z2', 'cleared'), row(3, 'S2', 'Z3', 'problem', { note: 'ice' }),
  row(4, 'S2', 'Z3', 'none', { undoes: 'L-3' }), row(5, 'S3', 'Z4', 'problem', { note: 'drift' }), row(6, 'S3', '*', 'depth', { depth_in: 2 })];

test('the summary: sites once each, done by every walk, open problems, the newest REAL tap, routes with a real tap', () => {
  const s = L.liveSummary({ routes, zones, log, stormId: ST });
  // S1 done; S2 back to none; S3 has an open Problem. The newest real tap is row 5 (row 6 is a reading, row 4 an undo).
  // R1 started (S1), R2 started (S3); R3's only site had its tap undone: not started.
  assert.deepEqual(s, { sitesDone: 1, sitesTouched: 0, sitesChecked: 0, sitesTotal: 3, problems: 1, lastTapAt: '2026-12-04T19:50:00-09:00', routesStarted: 2, routesTotal: 3 });
});

test('the summary with no storm: nothing done, nothing open, no tap, but the counts of what there is', () => {
  assert.deepEqual(L.liveSummary({ routes, zones, log, stormId: null }),
    { sitesDone: 0, sitesTouched: 0, sitesChecked: 0, sitesTotal: 3, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 3 });
});

test("the summary ignores another storm's rows", () => {
  const old = log.map((r) => Object.assign({}, r, { storm_id: 'ST-0' }));
  assert.deepEqual(L.liveSummary({ routes, zones, log: old, stormId: ST }),
    { sitesDone: 0, sitesTouched: 0, sitesChecked: 0, sitesTotal: 3, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 3 });
});

test('the summary takes the states already worked out, when the caller has them', () => {
  const CrewShiftLog = require('../lib/shiftlog.js');
  const states = CrewShiftLog.walkStates(log, ST);
  assert.deepEqual(L.liveSummary({ routes, zones, log, stormId: ST, states }), L.liveSummary({ routes, zones, log, stormId: ST }));
});

test('the summary counts Touched sites (sidewalks done, curbs left) apart from done (Matt, 10/8/26)', () => {
  // S1 gets a curb line (1,200 sq ft = 300 ft: one "Curbs" item). Rows 1, 2 clear both of S1's sidewalks,
  // so S1 is Touched, not done: 0 done, 1 touched. S2 and S3 as above (back to none; an open Problem).
  const withCurb = zones.concat([{ id: 'Z9', site_id: 'S1', type: 'hand', name: 'Curb - lot', area_sqft: 1200, ring: [[0, 0], [0, 1], [1, 1]] }]);
  const s = L.liveSummary({ routes, zones: withCurb, log, stormId: ST });
  assert.equal(s.sitesDone, 0);
  assert.equal(s.sitesTouched, 1);
});

// ---- Check night (design 11/24/26): "N of M sites checked" ----
// The paper fixture: storm ST-1 is a check night; route R6 = S1, S2, S3.
// S1 "Loussac": Z1 sidewalk, Z2 heated. S2 "Nuvision": Z3, Z4 sidewalks. S3 "MC Properties": Z5 sidewalk.
// Log: 1 S1 arrived, 2 S1 left, 3 S2 arrived, 4 S2 Z3 treated, 5 S2 left (all in night-2026-11-26).
const NIGHT = 'night-2026-11-26';
const cnZones = [
  { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Front walk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Ramp', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z3', site_id: 'S2', type: 'sidewalk', name: 'East walk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z4', site_id: 'S2', type: 'sidewalk', name: 'West walk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z5', site_id: 'S3', type: 'sidewalk', name: 'Main walk', ring: [[0, 0], [0, 1], [1, 1]] },
];
const cnRoutes = [{ id: 'R6', siteIds: ['S1', 'S2', 'S3'] }];
const cnRow = (seq, site, zone, state, at, extra) => Object.assign({ id: 'L-' + seq, seq, storm_id: ST, shift_id: NIGHT, site_id: site, zone_id: zone,
  state, note: '', at: '2026-11-26T' + at + ':00.000-09:00' }, extra || {});
const cnLog = [cnRow(1, 'S1', '*', 'arrived', '21:42'), cnRow(2, 'S1', '*', 'left', '22:05'), cnRow(3, 'S2', '*', 'arrived', '22:08'),
  cnRow(4, 'S2', 'Z3', 'treated', '22:15'), cnRow(5, 'S2', '*', 'left', '22:31')];
const cnStorms = [{ id: 'ST-1', seq: 1, kind: 'start', check: true, at: '2026-11-26T21:00:00.000-09:00', storm_id: 'ST-1' }];

test('liveSummary: sitesChecked on the paper fixture', () => {
  // S1 visited (Arrived stands): checked. S2 visited (Arrived stands, one walk tapped): checked. S3 has no row: not checked.
  // Checked = 2 (S1, S2) of 3 sites. Nothing is done: S1 has no walk tapped, S2's Z4 is untouched.
  const s = L.liveSummary({ routes: cnRoutes, zones: cnZones, log: cnLog, stormId: ST, storms: cnStorms });
  assert.equal(s.sitesChecked, 2);
  assert.equal(s.sitesTotal, 3);
  assert.equal(s.sitesDone, 0);
});

test('liveSummary: the storm-night copy has no checked sites (sitesChecked 0)', () => {
  // The same Log with the start row's check removed: not a check night, so 0 whatever was visited.
  const plain = [Object.assign({}, cnStorms[0], { check: undefined })];
  assert.equal(L.liveSummary({ routes: cnRoutes, zones: cnZones, log: cnLog, stormId: ST, storms: plain }).sitesChecked, 0);
  // And no storms handed in at all: 0.
  assert.equal(L.liveSummary({ routes: cnRoutes, zones: cnZones, log: cnLog, stormId: ST }).sitesChecked, 0);
});

test('liveSummary: a site whose only walk is done counts as checked (3 of 3)', () => {
  // S3 has one walk, Z5, cleared: done (and a real tap), so S3 counts. S1 and S2 count by their visits. 3 of 3.
  const log = cnLog.concat([cnRow(6, 'S3', 'Z5', 'cleared', '22:40')]);
  assert.equal(L.liveSummary({ routes: cnRoutes, zones: cnZones, log, stormId: ST, storms: cnStorms }).sitesChecked, 3);
});
