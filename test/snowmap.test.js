// The snow map (Matt, 10/6/26): a dot per site, coloured by the next 12 hours' forecast
// snowfall, taking the crews' measured depths as they come in. The pure parts, worked by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/snowmap.js');

const H = 3600000;
const T = Date.parse('2026-12-04T18:00:00-09:00');

test('pointsFor: the saved view wins, else the first outline, else the site is left off and listed', () => {
  const sites = [
    { id: 'S1', name: 'PAC', address: '621 W 6TH', map: { center: [-149.8912, 61.2167] } },
    { id: 'S2', name: 'IB', address: '4141 AMBASSADOR' },
    { id: 'S3', name: 'Gone', archived: true, map: { center: [-149.9, 61.2] } },
    { id: 'S4', name: 'Nowhere' },
  ];
  const zones = [{ id: 'Z1', site_id: 'S2', ring: [[-149.80, 61.18], [-149.80, 61.19], [-149.79, 61.19], [-149.79, 61.18]] }];
  const r = M.pointsFor(sites, zones);
  assert.deepEqual(r.points.map((p) => [p.id, p.name, p.address, p.lat, p.lon]),
    [['S1', 'PAC', '621 W 6TH', 61.22, -149.89], ['S2', 'IB', '4141 AMBASSADOR', 61.19, -149.8]]);   // two decimals, as the NWS is asked
  assert.deepEqual(r.missing, [{ id: 'S4', name: 'Nowhere' }]);
});

test('forecastInches: each period counts by the fraction inside [now, now + hours]; 25.4 mm over 6 h with 3 h inside is 0.5"', () => {
  const series = [{ start: T, end: T + 6 * H, mm: 25.4 }];
  assert.equal(M.forecastInches(series, T + 3 * H, 12), 0.5);
  assert.equal(M.forecastInches(series, T, 12), 1);          // all 6 hours inside
  assert.equal(M.forecastInches(series, T + 6 * H, 12), null); // already over: nothing in the window
  // Two periods, one straddling the end of the window: 12 h window from T; second period 10-14 h gives half.
  const two = [{ start: T, end: T + 6 * H, mm: 12.7 }, { start: T + 10 * H, end: T + 14 * H, mm: 25.4 }];
  assert.equal(M.forecastInches(two, T, 12), 1);              // 0.5 + 0.5
  // A period with no snow still counts as covered: 0, not null.
  assert.equal(M.forecastInches([{ start: T, end: T + H, mm: 0 }], T, 12), 0);
  assert.equal(M.forecastInches(null, T, 12), null);
  assert.equal(M.forecastInches([], T, 12), null);
});

test('measuredDepths: the newest reading per site, from a New snow row or a site card, this storm only', () => {
  const log = [
    { id: 'L-1', seq: 1, storm_id: 'ST-1', site_id: 'S1', zone_id: '*', state: 'depth', depth_in: 2, at: '2026-12-04T19:00:00-09:00', by_name: 'Alex' },
    { id: 'L-2', seq: 2, storm_id: 'ST-1', site_id: 'S1', zone_id: 'Z1', state: 'cleared', at: '2026-12-04T19:10:00-09:00', by_name: 'Alex' },
    { id: 'L-3', seq: 3, storm_id: 'ST-0', site_id: 'S2', zone_id: '*', state: 'depth', depth_in: 9, at: '2026-12-04T19:20:00-09:00', by_name: 'Old' },
  ];
  const visits = [
    { id: 'V-1', seq: 1, storm_id: 'ST-1', site_id: 'S1', depth_in: 3, at: '2026-12-04T19:30:00-09:00', by_name: 'Jordan' },
    { id: 'V-2', seq: 2, storm_id: 'ST-1', site_id: 'S2', depth_in: '', at: '2026-12-04T19:40:00-09:00', by_name: 'Jordan' },   // blank: no reading
    { id: 'V-3', seq: 3, storm_id: 'ST-1', site_id: 'S3', depth_in: 0, at: '2026-12-04T19:50:00-09:00', by_name: 'Casey' },   // 0 is a reading
  ];
  assert.deepEqual(M.measuredDepths(log, visits, 'ST-1'), {
    S1: { inches: 3, at: '2026-12-04T19:30:00-09:00', by_name: 'Jordan' },
    S3: { inches: 0, at: '2026-12-04T19:50:00-09:00', by_name: 'Casey' },
  });
  assert.deepEqual(M.measuredDepths(log, visits, null), {});
  // The newer New snow row beats an older card.
  const later = log.concat([{ id: 'L-4', seq: 4, storm_id: 'ST-1', site_id: 'S1', zone_id: '*', state: 'depth', depth_in: 4.5, at: '2026-12-04T20:00:00-09:00', by_name: 'Alex' }]);
  assert.deepEqual(M.measuredDepths(later, visits, 'ST-1').S1, { inches: 4.5, at: '2026-12-04T20:00:00-09:00', by_name: 'Alex' });
});

test('dotStep: the colour steps and their edges', () => {
  assert.equal(M.dotStep(null), 'nofc');
  assert.equal(M.dotStep(0), 'none');
  assert.equal(M.dotStep(0.1), 'light');
  assert.equal(M.dotStep(0.99), 'light');
  assert.equal(M.dotStep(1), 'mid');
  assert.equal(M.dotStep(2.9), 'mid');
  assert.equal(M.dotStep(3), 'heavy');
  assert.equal(M.dotStep(5.9), 'heavy');
  assert.equal(M.dotStep(6), 'severe');
  assert.equal(M.dotStep(14), 'severe');
});

test('dotLabel: a measured depth in bold words, else the forecast as a guess, else a question mark', () => {
  const clock = (iso) => 'CLOCK(' + iso + ')';
  assert.equal(M.dotLabel(2.4, null, clock), '~2.4"');
  assert.equal(M.dotLabel(2, null, clock), '~2.0"');
  assert.equal(M.dotLabel(null, null, clock), '?');
  assert.equal(M.dotLabel(2.4, { inches: 3, at: 'X', by_name: 'Alex' }, clock), '3.0" CLOCK(X) Alex');
  assert.equal(M.dotLabel(null, { inches: 0, at: 'X', by_name: '' }, clock), '0.0" CLOCK(X)');
});

test('siteStatus: Done, Problem, Touched, k of n walks, Not started (Touched: Matt, 10/8/26)', () => {
  const Log = require('../lib/shiftlog.js');
  // S1: one sidewalk and a curb line (300 ft: one "Curbs" item) -> 2 walks.
  const zones = [{ id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Walk' },
    { id: 'Z9', site_id: 'S1', type: 'hand', name: 'Curb - lot', area_sqft: 1200 }];
  const r = (seq, zone, state, note) => ({ id: 'L-' + seq, seq, storm_id: 'ST', site_id: 'S1', zone_id: zone, state, note: note || '' });
  const words = (rows) => M.siteStatus('S1', zones, Log.walkStates(rows, 'ST'));
  assert.equal(words([]), 'Not started');
  assert.equal(words([r(2, 'Z1', 'cleared')]), 'Touched');                                   // the sidewalk done, the curbs not
  assert.equal(words([r(2, 'Z1', 'cleared'), r(5, 'curbs-1', 'problem', 'car on it')]), 'Problem');
  assert.equal(words([r(2, 'Z1', 'cleared'), r(5, 'curbs-1', 'cleared')]), 'Done');
  assert.equal(words([r(5, 'curbs-1', 'cleared')]), '1 of 2 walks');                       // curbs first, sidewalk open
});
