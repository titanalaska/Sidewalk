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
  assert.deepEqual(s, { sitesDone: 1, sitesTotal: 3, problems: 1, lastTapAt: '2026-12-04T19:50:00-09:00', routesStarted: 2, routesTotal: 3 });
});

test('the summary with no storm: nothing done, nothing open, no tap, but the counts of what there is', () => {
  assert.deepEqual(L.liveSummary({ routes, zones, log, stormId: null }),
    { sitesDone: 0, sitesTotal: 3, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 3 });
});

test("the summary ignores another storm's rows", () => {
  const old = log.map((r) => Object.assign({}, r, { storm_id: 'ST-0' }));
  assert.deepEqual(L.liveSummary({ routes, zones, log: old, stormId: ST }),
    { sitesDone: 0, sitesTotal: 3, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 3 });
});

test('the summary takes the states already worked out, when the caller has them', () => {
  const CrewShiftLog = require('../lib/shiftlog.js');
  const states = CrewShiftLog.walkStates(log, ST);
  assert.deepEqual(L.liveSummary({ routes, zones, log, stormId: ST, states }), L.liveSummary({ routes, zones, log, stormId: ST }));
});
