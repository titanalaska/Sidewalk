const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/time');

// Matt, 10/1/26: day shift starts 9 AM; anything before belongs to the night before.
test('8:59 AM still belongs to the night before', () => assert.equal(T.shiftDate('2026-10-02T08:59:00-08:00'), '2026-10-01'));
test('9:00 AM is the new day', () => assert.equal(T.shiftDate('2026-10-02T09:00:00-08:00'), '2026-10-02'));
test('3 AM belongs to the night before', () => assert.equal(T.shiftDate('2026-01-14T03:10:00-09:00'), '2026-01-13'));
test('11:30 PM is its own night', () => assert.equal(T.shiftDate('2026-01-13T23:30:00-09:00'), '2026-01-13'));
test('crosses a month boundary (2026 is not a leap year)', () => assert.equal(T.shiftDate('2026-03-01T02:00:00-09:00'), '2026-02-28'));
test('crosses a year boundary', () => assert.equal(T.shiftDate('2026-01-01T05:00:00-09:00'), '2025-12-31'));
test('localIso keeps the wall clock, milliseconds and offset', () => {
  const d = new Date(2026, 0, 14, 3, 10, 5, 123);
  const iso = T.localIso(d);
  assert.match(iso, /^2026-01-14T03:10:05\.123[+-]\d{2}:\d{2}$/);
  assert.equal(Date.parse(iso), d.getTime());
});
test('daysBetween counts calendar days', () => {
  assert.equal(T.daysBetween('2026-10-15', '2026-10-20'), 5);
  assert.equal(T.daysBetween('2026-10-21', '2026-10-20'), -1);
});
test('shift ids and labels', () => {
  assert.equal(T.shiftId('night', '2026-10-01'), 'night-2026-10-01');
  assert.deepEqual(T.parseShift('day-2026-10-02'), { kind: 'day', date: '2026-10-02' });
  assert.equal(T.shiftLabel('night-2026-10-01'), 'Night of 10/1');
  assert.equal(T.shiftLabel('day-2026-12-25'), 'Day of 12/25');
  assert.equal(T.parseShift('nonsense'), null);
});
test('choices before 9 AM: the night on now, today, tonight', () => {
  assert.deepEqual(T.shiftChoices('2026-10-02T02:00:00-08:00'), ['night-2026-10-01', 'day-2026-10-02', 'night-2026-10-02']);
  assert.deepEqual(T.shiftChoices('2026-10-02T08:59:59-08:00'), ['night-2026-10-01', 'day-2026-10-02', 'night-2026-10-02']);
});
test('choices from 9 AM: today and tonight', () => {
  assert.deepEqual(T.shiftChoices('2026-10-02T09:00:00-08:00'), ['day-2026-10-02', 'night-2026-10-02']);
  assert.deepEqual(T.shiftChoices('2026-10-01T23:00:00-08:00'), ['day-2026-10-01', 'night-2026-10-01']);
});
test('shift order: day before night on a date, both before the next date', () => {
  assert.ok(T.shiftKey('day-2026-10-01') < T.shiftKey('night-2026-10-01'));
  assert.ok(T.shiftKey('night-2026-10-01') < T.shiftKey('day-2026-10-02'));
});
test('stale: a post is stale only when it is older than every shift on offer', () => {
  assert.equal(T.isStale('night-2026-10-01', '2026-10-02T02:00:00-08:00'), false); // the night on now
  assert.equal(T.isStale('day-2026-10-01', '2026-10-02T02:00:00-08:00'), true);
  assert.equal(T.isStale('night-2026-10-01', '2026-10-02T09:00:00-08:00'), true);
  assert.equal(T.isStale('night-2026-10-01', '2026-10-01T08:00:00-08:00'), false); // morning post for tonight
  assert.equal(T.isStale(null, '2026-10-01T08:00:00-08:00'), true);
});
