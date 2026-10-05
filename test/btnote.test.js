// The "Copy for BT" note (Matt, 10/3/26): the app writes the text, the lead posts
// it in BuilderTrend as themselves. Claude and the app never touch BT.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/btnote.js');

const ZONES = [
  { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry' },
  { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk' },
  { id: 'Z3', site_id: 'S1', type: 'sidewalk', name: 'Back stairs' },
  { id: 'Z9', site_id: 'S1', type: 'no_touch', name: 'Ski trail' },
];
const SITE = { id: 'S1', name: 'PAC', units: { bobcat: 'BCT7', snowrator: '' } };
const row = (seq, zone, state, extra = {}) => ({ id: 'L-' + seq, seq, storm_id: 'ST-1', shift_id: 'night-2026-12-04', site_id: 'S1',
  zone_id: zone, state, note: '', by_name: 'Alex Test', at: '2026-12-04T23:55:00.000-09:00', snowing_warned: false, ...extra });
const card = (seq, key, extra = {}) => ({ id: 'V-' + seq, seq, storm_id: 'ST-1', shift_id: 'night-2026-12-04', site_id: 'S1', by_key: key,
  by_name: key, depth_in: '', materials_used: '', equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, ...extra });

const base = () => ({ site: SITE, zones: ZONES, storm_id: 'ST-1', log: [], visits: [] });

test('walks are grouped by state; untouched walks say not done; no_touch never appears', () => {
  // Z1 cleared (seq 1), Z2 checked (seq 2), Z3 untouched -> not done. Z9 is no_touch: never listed.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked', { at: '2026-12-05T00:20:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.text.split('\n')[0], 'Cleared: Main entry. Checked: Heated walk. Not done: Back stairs.');
  assert.ok(!/Ski trail/.test(n.text));
});

test('a problem carries its note; the newest row wins, an undo counts as not done', () => {
  // Z1: cleared (1) then problem 'ice under the mat' (5). Z3: cleared (2) then undone to none (3) -> not done.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z3', 'cleared'), row(3, 'Z3', 'none', { undoes: 'L-2' }),
    row(5, 'Z1', 'problem', { note: 'ice under the mat' })];
  const n = N.btNote(o, 'night-2026-12-04');
  // Walks list in name order, as on the crew's screen: Back stairs, Heated walk, Main entry.
  assert.equal(n.text.split('\n')[0], 'Not done: Back stairs, Heated walk. Problem: Main entry (ice under the mat).');
});

test('time in and out are the first and last tap at the site this shift, readable', () => {
  // Taps 11:55 PM and 12:53 AM (next calendar day, same night shift). A day-shift tap is not counted.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked', { at: '2026-12-05T00:53:00.000-09:00' }),
    row(3, 'Z3', 'cleared', { shift_id: 'day-2026-12-05', at: '2026-12-05T10:00:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.timeIn, '11:55 PM');
  assert.equal(n.timeOut, '12:53 AM');
});

test('no taps this shift: times are blank, never invented', () => {
  const n = N.btNote(base(), 'night-2026-12-04');
  assert.equal(n.timeIn, '');
  assert.equal(n.timeOut, '');
});

test('depth, materials and machine minutes come from each person\'s newest site card', () => {
  // C01: depth 1, 'salt', bobcat 45 (V-1), then re-saves depth 1.5 (V-4) -> V-4 counts.
  // C03: depth 1, '2 bags IceMelt', blower 30. Depths 1 and 1.5 -> 1-1.5". Bobcat carries its unit BCT7.
  const o = base();
  o.visits = [card(1, 'C01', { depth_in: 1, materials_used: 'salt', equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } }),
    card(2, 'C03', { depth_in: 1, materials_used: '2 bags IceMelt', equipment: { blower: 30, snowrator: '', bobcat: '', sweepster: '' } }),
    card(4, 'C01', { depth_in: 1.5, materials_used: 'salt', equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } })];
  const lines = N.btNote(o, 'night-2026-12-04').text.split('\n');
  assert.ok(lines.includes('Depth: 1-1.5"'), lines.join(' | '));
  assert.ok(lines.includes('Materials: salt; 2 bags IceMelt'), lines.join(' | '));
  assert.ok(lines.includes('Equipment: Blower 30 min, Bobcat BCT7 45 min'), lines.join(' | '));
});

test('blank cards add no depth, materials or equipment lines', () => {
  const o = base(); o.visits = [card(1, 'C01')];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.ok(!/Depth|Materials|Equipment/.test(n.text), n.text);
});

test('treated while snowing is said once', () => {
  const o = base(); o.log = [row(1, 'Z1', 'treated', { snowing_warned: true }), row(2, 'Z3', 'treated', { snowing_warned: true })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.text.split('\n').filter((l) => l === 'Treated while still snowing.').length, 1);
});

test('a site with no zones drawn reports its Whole site walk', () => {
  const o = { ...base(), site: { id: 'S2', name: 'TUDOR' }, zones: [] };
  o.log = [row(1, 'whole', 'cleared', { site_id: 'S2' })];
  assert.equal(N.btNote(o, 'night-2026-12-04').text.split('\n')[0], 'Cleared: Whole site.');
});

test('hand work is listed like a walk; a snow pile never is (10/4/26)', () => {
  // Z4 hand "Lot row" cleared (seq 3); Z5 storage never listed. Name order:
  // Back stairs (not done), Heated walk (not done), Lot row, Main entry (not done).
  const o = base();
  o.zones = ZONES.concat([{ id: 'Z4', site_id: 'S1', type: 'hand', name: 'Lot row' },
    { id: 'Z5', site_id: 'S1', type: 'storage', name: 'Snow pile 1' }]);
  o.log = [row(3, 'Z4', 'cleared')];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.text.split('\n')[0], 'Cleared: Lot row. Not done: Back stairs, Heated walk, Main entry.');
  assert.ok(!/Snow pile/.test(n.text));
});

test('Copy for BT uses the latest pass only (Clean again, 10/4/26)', () => {
  // Pass 1: Main entry (Z1) cleared seq 1 at 11:00 PM, Back stairs (Z3) cleared seq 2 at 11:10 PM.
  // Seq 4: Clean again. Pass 2: Main entry cleared seq 6 at 12:40 AM. The note is pass 2's:
  // Main entry cleared; Back stairs and Heated walk not done; In and Out both 12:40 AM.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared', { at: '2026-12-04T23:00:00.000-09:00' }), row(2, 'Z3', 'cleared', { at: '2026-12-04T23:10:00.000-09:00' }),
    row(4, '*', 'again', { at: '2026-12-05T00:20:00.000-09:00' }), row(6, 'Z1', 'cleared', { at: '2026-12-05T00:40:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.text.split('\n')[0], 'Cleared: Main entry. Not done: Back stairs, Heated walk.');
  assert.deepEqual([n.timeIn, n.timeOut], ['12:40 AM', '12:40 AM']);
});
