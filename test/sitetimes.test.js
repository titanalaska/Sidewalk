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
