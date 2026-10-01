const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/gear');

const log = [
  { date: '2026-10-05', worker: 'C06', type: 'returned', item: 'parka' },   // out of order on purpose
  { date: '2026-10-01', worker: 'C06', type: 'issued', item: 'Parka' },
  { date: '2026-10-02', worker: 'C06', type: 'issued', item: 'Bibs' },
  { date: '2026-10-02', worker: 'C03', type: 'issued', item: 'Gloves' },
];

test('gear on hand: returned item drops off', () => {
  // Sorted: 10/1 Parka in, 10/2 Bibs in, 10/5 parka back (case differs). Left: Bibs.
  assert.deepEqual(G.gearOnHand(log, 'C06'), ['Bibs']);
});
test('gear on hand: other workers are ignored', () => {
  assert.deepEqual(G.gearOnHand(log, 'C03'), ['Gloves']);
  assert.deepEqual(G.gearOnHand(log, 'C01'), []);
});

// --- final review I2: same-night issue/return must replay by time, not by db id order
test('gear on hand: same night orders by time, not log order', () => {
  // Issued 11 PM, returned 5 AM, both on the night of 10/01. Given return-first,
  // as random db ids can deliver them. By time: issued, then returned -> nothing held.
  const log = [
    { date: '2026-10-01', at: '2026-10-02T05:00:00.000-09:00', worker: 'C06', type: 'returned', item: 'Parka' },
    { date: '2026-10-01', at: '2026-10-01T23:00:00.000-09:00', worker: 'C06', type: 'issued', item: 'Parka' },
  ];
  assert.deepEqual(G.gearOnHand(log, 'C06'), []);
});

// Pairings (10/1/26): gear entries carry a plain calendar date for ordering.
// Issued on the night of 10/1, returned the next day: nothing on hand.
test('issued one night, returned the next day: nothing left on hand', () => {
  const G2 = require('../lib/gear');
  const log = [
    { date: '2026-10-02', at: '2026-10-02T10:00:00.000-08:00', worker: 'C01', type: 'returned', item: 'Parka' },
    { date: '2026-10-01', at: '2026-10-01T20:00:00.000-08:00', worker: 'C01', type: 'issued', item: 'Parka' },
  ];
  assert.deepEqual(G2.gearOnHand(log, 'C01'), []);
});
