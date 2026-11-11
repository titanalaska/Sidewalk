// Times (Matt, 11/11/26), the reader audit: the server now writes five site-level Log states with zone_id '*'
// (arrived, left, typed, arrived_undone, left_undone), and a typed row carries time_in / time_out. Every phone reader of
// Log rows meets them. A mark is not work: no walk, pass, problem, Touched, count, "last tap", Undo target or snow
// clock may change because one is in the log. Each reader below is run on a log WITH one of each state (and on each
// state alone), the marks sitting between and after the real rows (seqs 15, 25, ... against taps at 10, 20, ...), and
// must say what it says without them, which is also worked out on paper.
const test = require('node:test');
const assert = require('node:assert/strict');
const Log = require('../lib/shiftlog.js');
const LiveSum = require('../lib/livesum.js');
const Note = require('../lib/btnote.js');
const Overview = require('../lib/snowmap.js');

const ST = 'ST-1', SHIFT = 'night-2026-12-04';
const LATE = '2026-12-04T22:00:00-09:00';   // later than every real tap below: a misread mark shows as the "last tap"
// Real rows keep their old ids (L-1 .. L-6) and take seq = 10 * n, so a mark can sit between any two of them.
const tap = (n, site, zone, state, extra) => Object.assign({ id: 'L-' + n, seq: 10 * n, storm_id: ST, shift_id: SHIFT, site_id: site, zone_id: zone,
  state, note: '', by_name: 'Alex Test', at: '2026-12-04T19:' + String(n * 10).padStart(2, '0') + ':00-09:00', snowing_warned: false, undoes: null }, extra || {});
const BASE = [tap(1, 'S1', 'Z1', 'cleared'), tap(2, 'S1', 'Z2', 'cleared'), tap(3, 'S2', 'Z3', 'problem', { note: 'ice' }),
  tap(4, 'S2', 'Z3', 'none', { undoes: 'L-3' }), tap(5, 'S3', 'Z4', 'problem', { note: 'drift' }), tap(6, 'S3', '*', 'depth', { depth_in: 2 })];
const ZONES = [
  { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z2', site_id: 'S1', type: 'sidewalk', name: 'Side walk', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z3', site_id: 'S2', type: 'sidewalk', name: 'Front', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z4', site_id: 'S3', type: 'sidewalk', name: 'Back', ring: [[0, 0], [0, 1], [1, 1]] },
];
const ROUTES = [{ id: 'R1', siteIds: ['S1', 'S2'] }, { id: 'R2', siteIds: ['S2', 'S3'] }, { id: 'R3', siteIds: ['S2'] }];

const mark = (seq, site, state, extra) => Object.assign({ id: 'M-' + seq, seq, storm_id: ST, shift_id: SHIFT, site_id: site, zone_id: '*', state,
  note: '', by_name: 'Alex Test', at: LATE, snowing_warned: false, undoes: null }, extra || {});
// One of each new state; S1 gets the newest row of all (seq 95), S2 and S3 get marks between real rows.
const MARKS = {
  arrived: [mark(15, 'S1', 'arrived'), mark(35, 'S2', 'arrived'), mark(55, 'S3', 'arrived')],
  left: [mark(25, 'S1', 'left'), mark(45, 'S2', 'left'), mark(95, 'S1', 'left')],
  typed: [mark(65, 'S3', 'typed', { time_in: '2026-12-04T19:05', time_out: '2026-12-04T21:45' }), mark(75, 'S2', 'typed', { time_in: '', time_out: '2026-12-04T21:00' })],
  arrived_undone: [mark(15, 'S1', 'arrived'), mark(85, 'S1', 'arrived_undone', { undoes: 'M-15' })],
  left_undone: [mark(25, 'S1', 'left'), mark(86, 'S1', 'left_undone', { undoes: 'M-25' })],
};
const ALL = [mark(15, 'S1', 'arrived'), mark(25, 'S1', 'left'), mark(35, 'S2', 'arrived'), mark(45, 'S2', 'left'),
  mark(65, 'S3', 'typed', { time_in: '2026-12-04T19:05', time_out: '2026-12-04T21:45' }), mark(85, 'S1', 'arrived_undone', { undoes: 'M-15' }),
  mark(86, 'S1', 'left_undone', { undoes: 'M-25' }), mark(95, 'S2', 'arrived', { id: 'M-95' })];
const WITH = Object.entries(MARKS).map(([name, rows]) => [name, BASE.concat(rows)]).concat([['all five together', BASE.concat(ALL)]]);
const clone = (x) => JSON.parse(JSON.stringify(x));

test('the audit fixture really holds one of each new state, and a time_in / time_out row', () => {
  assert.deepEqual([...new Set(ALL.map((r) => r.state))].sort(), ['arrived', 'arrived_undone', 'left', 'left_undone', 'typed']);
  assert.ok(ALL.every((r) => r.zone_id === '*' && Log.isSiteMark(r)), 'every one is a site mark');
  assert.ok(ALL.some((r) => r.time_in === '2026-12-04T19:05' && r.time_out === '2026-12-04T21:45'));
});

test('the live summary: done, Touched, problems, last tap and routes started do not move for a mark', () => {
  // Paper (the live view's own fixture): S1 done (both walks cleared); S2's Problem was undone, so none; S3 has an open Problem.
  // The newest REAL tap is L-5 at 19:50 (L-6 is a reading, L-4 an undo); R1 (S1) and R2 (S3) started, R3 (S2 alone) did not.
  const want = { sitesDone: 1, sitesTouched: 0, sitesTotal: 3, problems: 1, lastTapAt: '2026-12-04T19:50:00-09:00', routesStarted: 2, routesTotal: 3 };
  assert.deepEqual(LiveSum.liveSummary({ routes: ROUTES, zones: ZONES, log: BASE, stormId: ST }), want);
  WITH.forEach(([name, log]) => assert.deepEqual(LiveSum.liveSummary({ routes: ROUTES, zones: ZONES, log: clone(log), stormId: ST }), want, name));
});

test('walk states, open Problems, the pass, Clean again and Touched see only the real taps', () => {
  const states = Log.walkStates(clone(BASE), ST);
  // Paper: four walks have a row (Z1, Z2 at S1, Z3 at S2, Z4 at S3); the depth reading and every mark are not walks.
  assert.deepEqual(Object.keys(states).sort(), ['S1|Z1', 'S1|Z2', 'S2|Z3', 'S3|Z4']);
  WITH.forEach(([name, log]) => {
    const l = clone(log), s = Log.walkStates(l, ST);
    assert.deepEqual(s, states, name);
    assert.deepEqual(Object.keys(s).sort(), ['S1|Z1', 'S1|Z2', 'S2|Z3', 'S3|Z4'], name);
    ['S1', 'S2', 'S3'].forEach((site) => {
      assert.deepEqual(Log.openProblems(l, ST, site, s), Log.openProblems(clone(BASE), ST, site, states), name + ' problems ' + site);
      assert.deepEqual(Log.passInfo(l, ST, site), { n: 1, again: null, sinceSeq: 0 }, name + ' pass ' + site);
      assert.equal(Log.siteDone(site, ZONES, s), Log.siteDone(site, ZONES, states), name + ' done ' + site);
      assert.equal(Log.siteTouched(site, ZONES, s), Log.siteTouched(site, ZONES, states), name + ' touched ' + site);
      assert.deepEqual(Log.siteWords(site, ZONES, s), Log.siteWords(site, ZONES, states), name + ' words ' + site);
      assert.deepEqual(Log.passSegments(l, ST, site, SHIFT).map((p) => p.rows.map((r) => r.id)),
        Log.passSegments(clone(BASE), ST, site, SHIFT).map((p) => p.rows.map((r) => r.id)), name + ' segments ' + site);
    });
    assert.deepEqual(Log.routeProgress(['S1', 'S2', 'S3'], ZONES, s), Log.routeProgress(['S1', 'S2', 'S3'], ZONES, states), name);
    // S3 has an open Problem (drift), S1 none: a mark changes neither.
    assert.equal(Log.openProblems(l, ST, 'S3', s).length, 1, name);
    assert.equal(Log.openProblems(l, ST, 'S1', s).length, 0, name);
    assert.equal(Log.checkAgain(l, ST, 'S1'), null, name);
  });
});

test('a site with only marks has had no work: Clean again is refused and it started no pass', () => {
  const log = BASE.concat([mark(100, 'S9', 'arrived'), mark(101, 'S9', 'typed', { time_in: '2026-12-04T19:05', time_out: '' }), mark(102, 'S9', 'arrived_undone', { undoes: 'M-100' })]);
  assert.equal(Log.checkAgain(log, ST, 'S9'), 'Nothing to clean again yet');
  assert.deepEqual(Log.realTaps(log.filter((r) => r.site_id === 'S9')), []);
});

test('the snow clock starts at the newest real tap, not at a mark', () => {
  // Paper: at S1 the newest real tap is L-2 (seq 20, 19:20); marks sit at 15, 25 and 95 with an `at` of 22:00.
  const storms = [{ id: 'ST-1', seq: 1, kind: 'start', storm_id: ST, at: '2026-12-04T18:00:00-09:00' }];
  WITH.forEach(([name, log]) => {
    const s = Log.snowSince(clone(log), storms, ST, 'S1');
    assert.equal(s.from, '2026-12-04T19:20:00-09:00', name);
    assert.equal(s.fromSeq, 20, name);
    assert.equal(s.measured, null, name);
    // S3: the newest real tap is L-5 (seq 50); the depth reading L-6 (seq 60) comes after it and still counts.
    assert.equal(Log.snowSince(clone(log), storms, ST, 'S3').measured.id, 'L-6', name);
  });
});

test('Undo targets: a mark after a tap does not block its Undo, and a mark itself cannot be undone from the walk list', () => {
  // L-2 (seq 20) is the only row on S1|Z2: undone, it goes back to none, however many marks came after it at S1.
  WITH.forEach(([name, log]) => {
    assert.deepEqual(Log.undoTarget(clone(log), ST, 20).state, 'none', name);
    assert.equal(Log.undoTarget(clone(log), ST, 20).ok, true, name);
    log.filter((r) => Log.isSiteMark(r)).forEach((m) => assert.deepEqual(Log.undoTarget(clone(log), ST, m.seq), { ok: false, reason: 'That cannot be undone' }, name + ' ' + m.id));
  });
  // A Clean again followed only by marks is still the newest WORK at its site: its Undo is allowed.
  const again = tap(7, 'S1', '*', 'again');
  const log = BASE.concat([again], MARKS.arrived.filter((m) => m.site_id === 'S1').map((m) => Object.assign({}, m, { seq: 75 })), [mark(76, 'S1', 'left')]);
  assert.equal(Log.undoTarget(clone(log), ST, 70).ok, true);
});

test('the BuilderTrend note reads its walks, flags and times from the real taps only', () => {
  const site = { id: 'S1', name: 'PAC', units: { bobcat: '', snowrator: '' } };
  const zones = [{ id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry' }, { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk' }];
  const t = (seq, zone, state, at) => ({ id: 'L-' + seq, seq, storm_id: ST, shift_id: SHIFT, site_id: 'S1', zone_id: zone, state, note: '', by_name: 'Alex Test', at, snowing_warned: false });
  const log = [t(10, 'Z1', 'cleared', '2026-12-04T23:55:00.000-09:00'), t(30, 'Z2', 'checked', '2026-12-05T00:53:00.000-09:00')];
  // Paper: first tap 11:55 PM, last 12:53 AM; the marks (early at 6:00 PM, late at 3:00 AM) must not move either time.
  const early = mark(5, 'S1', 'arrived', { at: '2026-12-04T18:00:00.000-09:00' }), late = mark(40, 'S1', 'left', { at: '2026-12-05T03:00:00.000-09:00' });
  const typed = mark(20, 'S1', 'typed', { at: '2026-12-05T00:10:00.000-09:00', time_in: '2026-12-04T18:00', time_out: '2026-12-05T03:00' });
  const undone = mark(41, 'S1', 'left_undone', { undoes: 'M-40', at: '2026-12-05T03:01:00.000-09:00' });
  const want = Note.btNote({ site, zones, storm_id: ST, log, visits: [] }, SHIFT);
  assert.equal(want.timeIn, '11:55 PM');
  assert.equal(want.timeOut, '12:53 AM');
  assert.equal(want.text.split('\n')[0], 'Cleared: Main entry. Checked: Heated walk.');
  [[early], [late], [typed], [undone], [early, typed, late, undone]].forEach((marks) => {
    assert.deepEqual(Note.btNote({ site, zones, storm_id: ST, log: log.concat(marks), visits: [] }, SHIFT), want, marks.map((m) => m.state).join(','));
  });
});

test('measured depths come from depth rows only', () => {
  const visits = [];
  // Paper: one reading, L-6 at S3 (2 inches); no mark is a reading, even one carrying a depth_in field.
  const want = { S3: { inches: 2, at: '2026-12-04T20:00:00-09:00', by_name: 'Alex Test' } };
  const base = BASE.map((r) => (r.id === 'L-6' ? Object.assign({}, r, { at: '2026-12-04T20:00:00-09:00' }) : r));
  assert.deepEqual(Overview.measuredDepths(base, visits, ST), want);
  WITH.forEach(([name, log]) => {
    const l = log.map((r) => (r.id === 'L-6' ? Object.assign({}, r, { at: '2026-12-04T20:00:00-09:00' }) : r)).map((r) => (Log.isSiteMark(r) ? Object.assign({}, r, { depth_in: 9 }) : r));
    assert.deepEqual(Overview.measuredDepths(l, visits, ST), want, name);
  });
});
