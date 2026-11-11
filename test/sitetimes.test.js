// The dates behind the dispatcher's Set times form (lib/sitetimes.js). Every expected value is worked by hand.
// A NIGHT shift is named by its evening and runs to 9 AM: a time at noon or later is on the shift's own date,
// a time before noon is on the day after. A DAY shift's times are on its own date.
const test = require('node:test');
const assert = require('node:assert');
const T = require('../lib/sitetimes.js');

test('a night shift: 11:40 PM is on the shift date, 12:10 AM and 11:59 AM are the day after, 12:00 PM is on the shift date', () => {
  assert.equal(T.dateFor('night-2026-11-10', '23:40'), '2026-11-10');   // 23 >= 12: the evening
  assert.equal(T.dateFor('night-2026-11-10', '00:10'), '2026-11-11');   // 0 < 12: after midnight
  assert.equal(T.dateFor('night-2026-11-10', '11:59'), '2026-11-11');   // the last minute before noon
  assert.equal(T.dateFor('night-2026-11-10', '12:00'), '2026-11-10');   // noon itself is the evening side
});

test('a day shift: every time is on the shift date', () => {
  assert.equal(T.dateFor('day-2026-11-10', '09:15'), '2026-11-10');
  assert.equal(T.dateFor('day-2026-11-10', '16:30'), '2026-11-10');
});

test('month end, year end and February: the day after is a real date', () => {
  assert.equal(T.dateFor('night-2026-10-31', '01:00'), '2026-11-01');   // Oct has 31 days
  assert.equal(T.dateFor('night-2026-12-31', '00:30'), '2027-01-01');   // the year turns
  assert.equal(T.dateFor('night-2028-02-28', '03:00'), '2028-02-29');   // 2028 is a leap year
  assert.equal(T.dateFor('night-2027-02-28', '03:00'), '2027-03-01');   // 2027 is not
  assert.equal(T.dateFor('night-2026-12-31', '22:00'), '2026-12-31');   // the evening of the 31st stays in 2026
});

test('stamp is the YYYY-MM-DDTHH:MM the server takes; blank stays blank; a bad time is null', () => {
  assert.equal(T.stamp('night-2026-11-10', '23:40'), '2026-11-10T23:40');
  assert.equal(T.stamp('night-2026-11-10', '00:10'), '2026-11-11T00:10');
  assert.equal(T.stamp('day-2026-11-10', '09:15'), '2026-11-10T09:15');
  assert.equal(T.stamp('night-2026-11-10', ''), '');
  assert.equal(T.stamp('night-2026-11-10', '   '), '');
  assert.equal(T.stamp('night-2026-11-10', '25:00'), null);
  assert.equal(T.stamp('night-2026-11-10', '9:15'), null);
  assert.equal(T.stamp('nonsense', '09:15'), null);
});

test('onLabel reads month/day with no leading zeros', () => {
  assert.equal(T.onLabel('2026-11-10'), 'on 11/10');
  assert.equal(T.onLabel('2027-01-01'), 'on 1/1');
  assert.equal(T.onLabel(null), '');
});

test('shiftsFor: from the storm\'s first shift through the current one, newest first', () => {
  // Order of time: day-D (9 AM) < night-D (evening) < day-D+1. So from day-11-09 to night-11-10 there are four.
  assert.deepEqual(T.shiftsFor('day-2026-11-09', 'night-2026-11-10'),
    ['night-2026-11-10', 'day-2026-11-10', 'night-2026-11-09', 'day-2026-11-09']);
  assert.deepEqual(T.shiftsFor('night-2026-11-09', 'day-2026-11-10'), ['day-2026-11-10', 'night-2026-11-09']);
  assert.deepEqual(T.shiftsFor('night-2026-10-31', 'night-2026-11-01'), ['night-2026-11-01', 'day-2026-11-01', 'night-2026-10-31']);
  assert.deepEqual(T.shiftsFor('night-2026-12-31', 'day-2027-01-01'), ['day-2027-01-01', 'night-2026-12-31']);
  assert.deepEqual(T.shiftsFor('night-2026-11-10', 'night-2026-11-10'), ['night-2026-11-10']);
  assert.deepEqual(T.shiftsFor('night-2026-11-11', 'night-2026-11-10'), []);   // a first shift after now is nothing to pick
  assert.deepEqual(T.shiftsFor('junk', 'night-2026-11-10'), []);
});

// ---- the shown visit (R27): which shift a site line, Undo and Left are about ----
const row = (seq, state, shift, extra = {}) => ({ id: 'L-' + seq, seq, storm_id: 'ST-1', shift_id: shift, site_id: 'S1', zone_id: '*', state, by_name: 'Alex',
  at: '2026-10-03T08:30:00.000-08:00', undoes: null, ...extra });
const NOW = 'day-2026-10-04', PREV = 'night-2026-10-03';   // a day's shift before is the night before it
test('shiftBefore: a night is its own day, a day is the night before, across month and year ends and February', () => {
  assert.equal(T.shiftBefore('night-2026-10-03'), 'day-2026-10-03');
  assert.equal(T.shiftBefore('day-2026-10-04'), 'night-2026-10-03');
  assert.equal(T.shiftBefore('day-2026-03-01'), 'night-2026-02-28');   // 2026 is not a leap year
  assert.equal(T.shiftBefore('day-2028-03-01'), 'night-2028-02-29');
  assert.equal(T.shiftBefore('day-2027-01-01'), 'night-2026-12-31');
  assert.equal(T.shiftBefore('nonsense'), null);
});
test('visitShift: nothing anywhere, or marks in the current shift only, is the current shift', () => {
  assert.deepEqual(T.visitShift([], 'S1', NOW), { shift: NOW, earlier: false });
  assert.deepEqual(T.visitShift([row(1, 'arrived', NOW)], 'S1', NOW), { shift: NOW, earlier: false });
});
test('visitShift: an open Arrived, a closed visit, or a typed time in the shift before is shown as the earlier visit', () => {
  assert.deepEqual(T.visitShift([row(1, 'arrived', PREV)], 'S1', NOW), { shift: PREV, earlier: true });
  assert.deepEqual(T.visitShift([row(1, 'arrived', PREV), row(2, 'left', PREV)], 'S1', NOW), { shift: PREV, earlier: true });
  assert.deepEqual(T.visitShift([row(1, 'typed', PREV, { time_in: '2026-10-03T02:55', time_out: '' })], 'S1', NOW), { shift: PREV, earlier: true });
  // a night's shift before is its own day
  assert.deepEqual(T.visitShift([row(1, 'left', 'day-2026-10-03')], 'S1', 'night-2026-10-03'), { shift: 'day-2026-10-03', earlier: true });
});
test('visitShift: an undone-only shift before, marks two shifts back, and marks in both are the current shift', () => {
  assert.deepEqual(T.visitShift([row(1, 'arrived', PREV), row(2, 'arrived_undone', PREV, { undoes: 'L-1' })], 'S1', NOW), { shift: NOW, earlier: false });
  assert.deepEqual(T.visitShift([row(1, 'arrived', 'day-2026-10-03')], 'S1', NOW), { shift: NOW, earlier: false });   // two back
  assert.deepEqual(T.visitShift([row(1, 'arrived', PREV), row(2, 'arrived', NOW)], 'S1', NOW), { shift: NOW, earlier: false });
  // the current shift holding ONLY an undone mark still counts as having a visit: the earlier one is not shown over it
  assert.deepEqual(T.visitShift([row(1, 'arrived', PREV), row(2, 'arrived', NOW), row(3, 'arrived_undone', NOW, { undoes: 'L-2' })], 'S1', NOW), { shift: NOW, earlier: false });
});
test('visitShift: another site marks and walk taps are not a visit', () => {
  assert.deepEqual(T.visitShift([row(1, 'arrived', PREV, { site_id: 'S2' }), row(2, 'cleared', PREV, { zone_id: 'Z1' })], 'S1', NOW), { shift: NOW, earlier: false });
});
test('datesFor / otherDate: a shift own date and the day after, flipping between them', () => {
  assert.deepEqual(T.datesFor('night-2026-12-31'), ['2026-12-31', '2027-01-01']);
  assert.equal(T.otherDate('night-2026-12-31', '2026-12-31'), '2027-01-01');
  assert.equal(T.otherDate('night-2026-12-31', '2027-01-01'), '2026-12-31');
  assert.equal(T.otherDate('day-2026-10-02', '2026-10-02'), '2026-10-03');
});

// ---- a person's shown shift (R33) and the buttons the Clock rules allow (times plan, Task 10) ----
// Rows are the Clock tab's (lib/clock.js); NOW is a day shift, so the shift before it is the night before.
const crow = (seq, kind, shift, crew = 'C1', extra = {}) => ({ id: 'K-' + seq, seq, shift_id: shift, kind, crew_id: crew,
  at: '2026-10-03T20:00:00.000-08:00', time_in: '', time_out: '', undoes: '', by_name: 'Alex', ...extra });
const TWO_BACK = 'day-2026-10-03';   // a night's own day: two shifts before NOW (day-2026-10-04 -> night-2026-10-03 -> day-2026-10-03)

test('shiftShown (R33): no rows is the current shift; any row now is the current shift, standing or undone', () => {
  assert.deepEqual(T.shiftShown([], 'C1', NOW), { shift: NOW, earlier: false });
  assert.deepEqual(T.shiftShown([crow(1, 'start', NOW)], 'C1', NOW), { shift: NOW, earlier: false });
  // a Start taken back is still a row in the current shift: it keeps the current shift over a standing start before it
  assert.deepEqual(T.shiftShown([crow(1, 'start', PREV), crow(2, 'start', NOW), crow(3, 'start_undone', NOW, 'C1', { undoes: 'K-2' })], 'C1', NOW), { shift: NOW, earlier: false });
});
test('shiftShown (R33): the shift before shows only for a STANDING row there (tapped or typed), never two back', () => {
  assert.deepEqual(T.shiftShown([crow(1, 'start', PREV)], 'C1', NOW), { shift: PREV, earlier: true });
  assert.deepEqual(T.shiftShown([crow(1, 'typed', PREV, 'C1', { time_out: '2026-10-04T05:00' })], 'C1', NOW), { shift: PREV, earlier: true });
  // a Start taken back leaves nothing standing before: the current shift
  assert.deepEqual(T.shiftShown([crow(1, 'start', PREV), crow(2, 'start_undone', PREV, 'C1', { undoes: 'K-1' })], 'C1', NOW), { shift: NOW, earlier: false });
  // a typed row with both sides blank is no time at all (the server refuses to write one, but the rule holds)
  assert.deepEqual(T.shiftShown([crow(1, 'typed', PREV)], 'C1', NOW), { shift: NOW, earlier: false });
  assert.deepEqual(T.shiftShown([crow(1, 'start', TWO_BACK)], 'C1', NOW), { shift: NOW, earlier: false });
  // somebody else's rows are not this person's
  assert.deepEqual(T.shiftShown([crow(1, 'start', PREV, 'C2'), crow(2, 'start', NOW, 'C2')], 'C1', NOW), { shift: NOW, earlier: false });
});
test('shiftOffers: nothing yet offers Start alone; a Start now offers End and its Undo', () => {
  assert.deepEqual(T.shiftOffers([], 'C1', NOW), { shift: NOW, earlier: false, start: true, end: false, undo: null });
  assert.deepEqual(T.shiftOffers([crow(1, 'start', NOW)], 'C1', NOW), { shift: NOW, earlier: false, start: false, end: true, undo: 'start' });
});
test('shiftOffers (R2): with an End standing there is no Undo of the Start, only the Undo of the End', () => {
  const rows = [crow(1, 'start', NOW), crow(2, 'end', NOW)];
  assert.deepEqual(T.shiftOffers(rows, 'C1', NOW), { shift: NOW, earlier: false, start: false, end: false, undo: 'end' });
  // the End taken back: End and the Undo of the Start are back
  rows.push(crow(3, 'end_undone', NOW, 'C1', { undoes: 'K-2' }));
  assert.deepEqual(T.shiftOffers(rows, 'C1', NOW), { shift: NOW, earlier: false, start: false, end: true, undo: 'start' });
});
test('shiftOffers: an open start from the shift before offers End and Undo, not Start; a closed one offers Start and the Undo of its End', () => {
  assert.deepEqual(T.shiftOffers([crow(1, 'start', PREV)], 'C1', NOW), { shift: PREV, earlier: true, start: false, end: true, undo: 'start' });
  assert.deepEqual(T.shiftOffers([crow(1, 'start', PREV), crow(2, 'end', PREV)], 'C1', NOW), { shift: PREV, earlier: true, start: true, end: false, undo: 'end' });
});
test('shiftOffers: typed times have no Undo; a typed start is an open shift (End), a typed end alone is no shift to end (Start)', () => {
  assert.deepEqual(T.shiftOffers([crow(1, 'typed', PREV, 'C1', { time_in: '2026-10-03T20:00' })], 'C1', NOW), { shift: PREV, earlier: true, start: false, end: true, undo: null });
  assert.deepEqual(T.shiftOffers([crow(1, 'typed', PREV, 'C1', { time_out: '2026-10-04T05:00' })], 'C1', NOW), { shift: PREV, earlier: true, start: true, end: false, undo: null });
});
test('shiftOffers: a Start taken back now, over an open start before, offers Start (the current shift is the shown one) and nothing to End', () => {
  const rows = [crow(1, 'start', PREV), crow(2, 'start', NOW), crow(3, 'start_undone', NOW, 'C1', { undoes: 'K-2' })];
  assert.deepEqual(T.shiftOffers(rows, 'C1', NOW), { shift: NOW, earlier: false, start: true, end: false, undo: null });
});
test('routeTaps: how many people a Start or End would cover, as the server counts them (End closes the open shift: now, else the one before)', () => {
  // A started now (open); B started in the shift before (open); C nothing. Start covers B and C (no start NOW); End covers A (now) and B (before).
  const rows = [crow(1, 'start', NOW, 'A'), crow(2, 'start', PREV, 'B')];
  assert.deepEqual(T.routeTaps(rows, ['A', 'B', 'C'], NOW), { start: 2, end: 2 });
  // A also ended now: Start still B and C; End now B alone.
  rows.push(crow(3, 'end', NOW, 'A'));
  assert.deepEqual(T.routeTaps(rows, ['A', 'B', 'C'], NOW), { start: 2, end: 1 });
  // a person listed twice counts once; nobody on the route covers nobody
  assert.deepEqual(T.routeTaps(rows, ['C', 'C'], NOW), { start: 1, end: 0 });
  assert.deepEqual(T.routeTaps(rows, [], NOW), { start: 0, end: 0 });
});
