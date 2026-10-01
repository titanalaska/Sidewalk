const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/history');

// Afternoon times (after 9 AM), so shiftDate() is the calendar date.
const moves = [
  { id: 'm1', at: '2025-11-02T14:00:00-09:00', worker: 'C03', to_route: 'N1', role: 'member' },
  { id: 'm2', at: '2025-11-02T14:01:00-09:00', worker: 'C01', to_route: 'N1', role: 'lead' },
  { id: 'm3', at: '2026-01-14T15:00:00-09:00', worker: 'C03', to_route: 'N4', role: 'member' },
  { id: 'm4', at: '2026-01-20T15:00:00-09:00', worker: 'C03', to_route: null, role: null },
];
const callouts = [
  { shift: 'night-2026-01-10', roster: { N1: { lead: 'C01', members: ['C03'] } } },
  { shift: 'day-2026-01-11', roster: { D1: { lead: 'C01', members: [] } } },
  { shift: 'night-2026-01-13', roster: { N1: { lead: 'C01', members: [] }, N4: { lead: 'C07', members: ['C08'] } } },
];

test('placed: ranges close on the next move', () => {
  assert.deepEqual(H.placedRanges(moves, 'C03'), [
    { route: 'N1', from: '2025-11-02', to: '2026-01-14' }, { route: 'N4', from: '2026-01-14', to: '2026-01-20' }]);
});
test('placed: a move at 3 AM dates to the night it started', () => {
  const m = [{ id: 'x', at: '2026-01-15T03:00:00-09:00', worker: 'C08', to_route: 'N4', role: 'member' }];
  assert.deepEqual(H.placedRanges(m, 'C08'), [{ route: 'N4', from: '2026-01-14', to: null }]);
});
test('shifts worked: split night and day, and per route', () => {
  // Alex: lead on night 1/10, day 1/11, night 1/13 -> 2 nights, 1 day; N1 x2, D1 x1.
  assert.deepEqual(H.shiftsWorked(callouts, 'C01'), { night: 2, day: 1, byRoute: { N1: 2, D1: 1 } });
  // Jordan: only night 1/10 (removed from the 1/13 callout as a no-show).
  assert.deepEqual(H.shiftsWorked(callouts, 'C03'), { night: 1, day: 0, byRoute: { N1: 1 } });
  assert.deepEqual(H.shiftsWorked([], 'C03'), { night: 0, day: 0, byRoute: {} });
});
test('route on a shift: the callout first, then the board as of that date', () => {
  assert.equal(H.routeOn(callouts, moves, 'C08', 'night-2026-01-13'), 'N4');
  assert.equal(H.routeOn(callouts, moves, 'C03', 'night-2026-01-16'), 'N4'); // no callout: placed on N4 since 1/14
  assert.equal(H.routeOn(callouts, moves, 'C03', 'night-2026-01-21'), null);  // unassigned 1/20
});
