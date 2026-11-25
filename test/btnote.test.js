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
  // Old-shape minutes keep the site's unit; the blower is the Walk-behind blower and comes last (Task 7).
  assert.ok(lines.includes('Equipment: Bobcat BCT7 45 min, Walk-behind blower 30 min'), lines.join(' | '));
});

// Machine lines (Matt, 11/24/26): one phrase per counted line, "<Machine> <unit> <Attachment> <minutes> min", no names.
// By hand: C01's card has Bobcat BC5 Snowblower 106, Bobcat BT13 Bucket 106 and Snowrator 1 (no attachment) 106; C03's card has
// the walk-behind blower 20 (old shape). Counted lines print Bobcats then Snowrators (visitTotals), then old-shape sums by type
// (none here: nobody typed old-shape bobcat/snowrator/sweepster minutes), then the blower. Operator names never print.
test('BT: machine lines with units and attachments, no names', () => {
  const o = base();
  const m = (type, unit, attachment, minutes) => ({ type, unit, attachment, operator_key: 'C01', operator_name: 'Zed Operator', minutes, since: 1 });
  o.visits = [card(1, 'C01', { machines: [m('bobcat', 'BC5', 'snowblower', 106), m('bobcat', 'BT13', 'bucket', 106), m('snowrator', '1', '', 106)] }),
    card(2, 'C03', { equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: '' } })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.ok(n.text.split('\n').includes('Equipment: Bobcat BC5 Snowblower 106 min, Bobcat BT13 Bucket 106 min, Snowrator 1 106 min, Walk-behind blower 20 min'), n.text);
  assert.ok(!/Zed/.test(n.text), 'no operator names');
});

// By hand: C01 has a counted line (Bobcat BC5 Snowblower 100) AND old-shape bobcat 45; C03 has old-shape bobcat 15. The old-shape
// sum is 45 + 15 = 60, from the cards' own equipment.bobcat (NOT visitTotals().minutes, which would say 160), printed with the
// site's unit text as typed ("BCT7"). Counted line first, then the old-shape one.
test('BT: old-shape minutes keep the site unit', () => {
  const o = base();
  o.visits = [card(1, 'C01', { equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' },
      machines: [{ type: 'bobcat', unit: 'BC5', attachment: 'snowblower', operator_key: 'C01', operator_name: 'Zed', minutes: 100, since: 1 }] }),
    card(2, 'C03', { equipment: { blower: '', snowrator: '', bobcat: 15, sweepster: '' } })];
  const lines = N.btNote(o, 'night-2026-12-04').text.split('\n');
  assert.ok(lines.includes('Equipment: Bobcat BC5 Snowblower 100 min, Bobcat BCT7 60 min'), lines.join(' | '));
});

// By hand: one old-shape card with blower 20 -> "Walk-behind blower 20 min", never a bare "Blower".
test('BT: Walk-behind blower', () => {
  const o = base();
  o.visits = [card(1, 'C01', { equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: '' } })];
  const lines = N.btNote(o, 'night-2026-12-04').text.split('\n');
  assert.ok(lines.includes('Equipment: Walk-behind blower 20 min'), lines.join(' | '));
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

// New concrete (R7, 11/13/26): a treated STRIPED walk is Sanded in the note that goes to BuilderTrend; a plain treated walk is Treated.
// By hand: Z1 Main entry striped, Z3 Back stairs plain, Z2 Heated walk plain. Walks by name: Back stairs (Z3), Heated walk (Z2), Main entry (Z1).
// Z1 treated, Z3 treated, Z2 checked -> groups in the note's order cleared, treated, sanded, checked:
//   "Treated: Back stairs. Sanded: Main entry. Checked: Heated walk."
const STRIPED = ZONES.map((z) => (z.id === 'Z1' ? { ...z, new_concrete: true } : z));
test('new concrete: a treated striped walk is listed under Sanded, a plain treated walk under Treated', () => {
  const o = { ...base(), zones: STRIPED };
  o.log = [row(1, 'Z1', 'treated'), row(2, 'Z3', 'treated'), row(3, 'Z2', 'checked')];
  assert.equal(N.btNote(o, 'night-2026-12-04').text.split('\n')[0], 'Treated: Back stairs. Sanded: Main entry. Checked: Heated walk.');
  // Cleared on a striped walk stays Cleared; a plain-only site is untouched (no Sanded anywhere).
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z3', 'treated'), row(3, 'Z2', 'checked')];
  assert.equal(N.btNote(o, 'night-2026-12-04').text.split('\n')[0], 'Cleared: Main entry. Treated: Back stairs. Checked: Heated walk.');
  const p = base(); p.log = [row(1, 'Z1', 'treated')];
  assert.ok(!/Sanded/.test(N.btNote(p, 'night-2026-12-04').text));
});

test('new concrete: the snowing line says Sanded for a warned striped walk, Treated for a plain one, and both when both were warned', () => {
  const lines = (log) => { const o = { ...base(), zones: STRIPED }; o.log = log; return N.btNote(o, 'night-2026-12-04').text.split('\n').filter((l) => /while still snowing/.test(l)); };
  assert.deepEqual(lines([row(1, 'Z1', 'treated', { snowing_warned: true })]), ['Sanded while still snowing.']);
  assert.deepEqual(lines([row(1, 'Z3', 'treated', { snowing_warned: true })]), ['Treated while still snowing.']);
  assert.deepEqual(lines([row(1, 'Z1', 'treated', { snowing_warned: true }), row(2, 'Z3', 'treated', { snowing_warned: true })]), ['Treated while still snowing.', 'Sanded while still snowing.']);
  assert.deepEqual(lines([row(1, 'Z1', 'treated'), row(2, 'Z3', 'treated')]), []);
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

test('two passes in one shift: the site-card lines say they cover the whole shift (Matt 10/4/26)', () => {
  // Pass 1 (seq 1) and pass 2 (again seq 4, tap seq 6) both on night-2026-12-04. Alex's one card: 3", blower 30.
  // Cards are per person per shift, so the note says so instead of pinning them on pass 2.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(4, '*', 'again'), row(6, 'Z1', 'cleared')];
  o.visits = [card(1, 'C01', { by_name: 'Alex Test', depth_in: '3', equipment: { blower: '30', snowrator: '', bobcat: '', sweepster: '' } })];
  const lines = N.btNote(o, 'night-2026-12-04').text.split('\n');
  assert.ok(lines.includes('Depth: 3" (this shift, all passes)'), lines.join(' | '));
  assert.ok(lines.some((l) => l.startsWith('Equipment: ') && l.endsWith(' (this shift, all passes)')), lines.join(' | '));
  // One pass: the lines read as before.
  o.log = [row(1, 'Z1', 'cleared')];
  assert.ok(N.btNote(o, 'night-2026-12-04').text.split('\n').includes('Depth: 3"'));
});

// Curb roll-up (Matt, 10/8/26): the curb lines are one "Curbs" walk. Walks are listed with commas, so the
// item's feet go in brackets: "Curbs, about 500 ft" in a comma list read as two walks, "Curbs" and "about 500 ft".
test('a curbs item reads as one walk in the note: its feet in brackets, not after a comma', () => {
  // Curbs: 1,200 sq ft = 300 ft + 800 sq ft = 200 ft -> one item of 500 ft. Main entry and the curbs cleared.
  const o = base();
  o.zones = ZONES.concat([{ id: 'Z6', site_id: 'S1', type: 'hand', name: 'Curb - lot', area_sqft: 1200, from: 'bootprint:J1:6' },
    { id: 'Z7', site_id: 'S1', type: 'hand', name: 'Curb - island', area_sqft: 800, from: 'bootprint:J1:7' }]);
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked'), row(3, 'curbs-1', 'cleared')];
  assert.equal(N.btNote(o, 'night-2026-12-04').text.split('\n')[0], 'Cleared: Main entry, Curbs: clear 4 ft back (about 500 ft). Checked: Heated walk. Not done: Back stairs.');
});

// Start and stop times (Matt, 11/10/26): Time In / Time Out are the site's siteClock, the same two values the Storm tab's
// line and the Site card show. A side that was typed or tapped (Arrived / Left) wins over the walk taps; a side that is
// neither keeps what this note always printed (the latest pass's first and last walk tap).
test('Time In and Out: a tapped Arrived and Left beat the walk taps', () => {
  // Walk taps 11:55 PM (Z1) and 12:53 AM (Z2). Arrived tapped 10:05 PM (seq 3), Left tapped 1:15 AM (seq 4).
  // In = 10:05 PM, Out = 1:15 AM: the marks, not the walk taps.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked', { at: '2026-12-05T00:53:00.000-09:00' }),
    row(3, '*', 'arrived', { at: '2026-12-04T22:05:00.000-09:00' }), row(4, '*', 'left', { at: '2026-12-05T01:15:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['10:05 PM', '1:15 AM']);
});

test('Time In and Out: a typed side beats a tapped one, and each side is decided on its own', () => {
  // Arrived tapped 10:05 PM (seq 3); a dispatcher typed In 2026-12-04T21:40 (seq 4, no Out). In = 9:40 PM (typed beats the tap).
  // Nobody tapped or typed Out, so Out is the latest pass's last walk tap, 12:53 AM.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked', { at: '2026-12-05T00:53:00.000-09:00' }),
    row(3, '*', 'arrived', { at: '2026-12-04T22:05:00.000-09:00' }),
    row(4, '*', 'typed', { time_in: '2026-12-04T21:40', time_out: '', by_name: 'Matt', at: '2026-12-05T07:00:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['9:40 PM', '12:53 AM']);
});

test('Time In and Out: an undone Arrived goes back to the walk taps, and another storm marks never count', () => {
  // Arrived (seq 3) is undone (seq 4): In falls back to the first walk tap, 11:55 PM. A typed row of ST-0 (seq 5) is another storm's.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked', { at: '2026-12-05T00:53:00.000-09:00' }),
    row(3, '*', 'arrived', { at: '2026-12-04T22:05:00.000-09:00' }), row(4, '*', 'arrived_undone', { undoes: 'L-3' }),
    row(5, '*', 'typed', { storm_id: 'ST-0', time_in: '2026-12-04T18:00', time_out: '2026-12-04T19:00', by_name: 'Matt' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['11:55 PM', '12:53 AM']);
});

// A return visit and a second pass (final review C1 / R38). The story, one site, one shift (night-2026-12-04):
//   seq 3  Arrived 8:30 PM     seq 4  Left 9:15 PM      (pass 1: walk tap seq 1 at 8:40 PM)
//   seq 6  Clean again 2:00 AM (pass 2 starts: sinceSeq 6)
//   seq 8  walk tap 2:10 AM; then, if tapped: seq 9 Arrived 2:05 AM, seq 10 Left 2:30 AM.
// Pass 1 (before the Clean again) reads the marks: In 8:30 PM, Out 9:15 PM. Pass 2 may only use marks AFTER seq 6.

const passRows = () => [
  row(1, 'Z1', 'cleared', { at: '2026-12-04T20:40:00.000-09:00' }),
  row(3, '*', 'arrived', { at: '2026-12-04T20:30:00.000-09:00' }), row(4, '*', 'left', { at: '2026-12-04T21:15:00.000-09:00' })];
const pass2Rows = () => [
  row(6, '*', 'again', { at: '2026-12-05T02:00:00.000-09:00' }), row(8, 'Z1', 'cleared', { at: '2026-12-05T02:10:00.000-09:00' })];

test('R38 BT: pass 1 reads the visit it tapped, In 8:30 PM and Out 9:15 PM', () => {
  const o = base();
  o.log = passRows();
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['8:30 PM', '9:15 PM']);
});

test('R38 BT: pass 2 with no new marks reads ITS walk taps, not pass 1 marks', () => {
  // Only the walk tap seq 8 (2:10 AM) is after sinceSeq 6: In and Out are both 2:10 AM. The 8:30 PM / 9:15 PM marks are seq 3, 4.
  const o = base();
  o.log = passRows().concat(pass2Rows());
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:10 AM', '2:10 AM']);
});

test('R38 BT: pass 2 reads its own tapped Arrived and Left; an open second visit has no Out of its own', () => {
  const o = base();
  o.log = passRows().concat(pass2Rows(), [row(9, '*', 'arrived', { at: '2026-12-05T02:05:00.000-09:00' })]);
  // Arrived seq 9 (2:05 AM) is after sinceSeq 6: In 2:05 AM. No Left after sinceSeq: Out is the walk tap 2:10 AM.
  let n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:05 AM', '2:10 AM']);
  o.log = o.log.concat([row(10, '*', 'left', { at: '2026-12-05T02:30:00.000-09:00' })]);
  n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:05 AM', '2:30 AM']);
});

test('R38 BT: a typed time filed before the pass began is not the pass; one filed after is', () => {
  const o = base();
  o.log = passRows().concat([row(5, '*', 'typed', { time_in: '2026-12-04T20:00', time_out: '2026-12-04T21:30', by_name: 'Matt' })], pass2Rows());
  // Typed seq 5 is before sinceSeq 6: pass 2 reads the walk tap, 2:10 AM both sides.
  let n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:10 AM', '2:10 AM']);
  o.log = o.log.concat([row(11, '*', 'typed', { time_in: '', time_out: '2026-12-05T02:45', by_name: 'Matt' })]);
  n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:10 AM', '2:45 AM']);
});

// I4 (final review): the note says HOW each time was entered, so the post can mark a typed one the way every other screen does.
// how is 'typed' (with who typed it) | 'tapped' (with who tapped, which the post does not print) | 'walk' | null.
test('I4 BT: each side says how it was entered and who typed it', () => {
  // Walk taps 11:55 PM (seq 1) and 12:53 AM (seq 2). Arrived tapped 10:05 PM (seq 3). In typed 9:40 PM by Matt (seq 4); Out nobody entered.
  const o = base();
  o.log = [row(1, 'Z1', 'cleared'), row(2, 'Z2', 'checked', { at: '2026-12-05T00:53:00.000-09:00' }),
    row(3, '*', 'arrived', { at: '2026-12-04T22:05:00.000-09:00', by_name: 'Dana Test' }),
    row(4, '*', 'typed', { time_in: '2026-12-04T21:40', time_out: '', by_name: 'Matt', at: '2026-12-05T07:00:00.000-09:00' })];
  let n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.inHow, n.inBy, n.timeOut, n.outHow, n.outBy], ['9:40 PM', 'typed', 'Matt', '12:53 AM', 'walk', null]);
  // The same In tapped (no typed row): tapped, and the walk Out stays walk.
  o.log = o.log.slice(0, 3);
  n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.inHow, n.outHow], ['10:05 PM', 'tapped', 'walk']);
  // No tap of any kind: both blank, how null.
  o.log = [];
  n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.inHow, n.inBy, n.timeOut, n.outHow, n.outBy], ['', null, null, '', null, null]);
});

// R42 (final fix round B 6): a pass reads every site mark above its sinceSeq PLUS, when the latest standing tapped mark at or below it is an
// ARRIVED, that one Arrived (the crew is still on site when the lead taps Clean again). A typed row at or below sinceSeq stays out. Night of
// 12/4; the first visit is Arrived 8:30 PM (seq 3), Left 9:15 PM (seq 4); a walk tap in pass 1 at 8:40 PM (seq 1).
const R42_V1 = () => [row(1, 'Z1', 'cleared', { at: '2026-12-04T20:40:00.000-09:00' }),
  row(3, '*', 'arrived', { at: '2026-12-04T20:30:00.000-09:00' }), row(4, '*', 'left', { at: '2026-12-04T21:15:00.000-09:00' })];
const R42_WALK = row(8, 'Z1', 'cleared', { at: '2026-12-05T02:10:00.000-09:00' });
test('R42 BT (a): the crew arrives at 2:05, the lead taps Clean again at 2:06, Left 2:30: In 2:05 AM, Out 2:30 AM', () => {
  // Order one. Rows at or below sinceSeq 6: A1, L1, A2 (seq 5, 2:05). The latest standing mark there is A2, an Arrived: it is kept, A1 is not.
  const o = base();
  o.log = R42_V1().concat([row(5, '*', 'arrived', { at: '2026-12-05T02:05:00.000-09:00' }), row(6, '*', 'again', { at: '2026-12-05T02:06:00.000-09:00' }),
    R42_WALK, row(9, '*', 'left', { at: '2026-12-05T02:30:00.000-09:00' })]);
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:05 AM', '2:30 AM']);
});
test('R42 BT (b): Clean again first (2:04), the Arrived after it (2:05): the same answer', () => {
  const o = base();
  o.log = R42_V1().concat([row(5, '*', 'again', { at: '2026-12-05T02:04:00.000-09:00' }), row(6, '*', 'arrived', { at: '2026-12-05T02:05:00.000-09:00' }),
    R42_WALK, row(9, '*', 'left', { at: '2026-12-05T02:30:00.000-09:00' })]);
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:05 AM', '2:30 AM']);
});
test('R42 BT (c): the crew never left: Arrived 8:30 PM, Clean again, a walk tap at 2:10 AM, no Left: In 8:30 PM, Out the walk tap 2:10 AM', () => {
  const o = base();
  o.log = [row(1, 'Z1', 'cleared', { at: '2026-12-04T20:40:00.000-09:00' }), row(3, '*', 'arrived', { at: '2026-12-04T20:30:00.000-09:00' }),
    row(6, '*', 'again', { at: '2026-12-05T02:00:00.000-09:00' }), R42_WALK];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['8:30 PM', '2:10 AM']);
});
test('R42 BT (d): a closed first visit, Clean again, a walk tap only: the walk tap on both sides, as today', () => {
  const o = base();
  o.log = R42_V1().concat([row(6, '*', 'again', { at: '2026-12-05T02:00:00.000-09:00' }), R42_WALK]);
  const n = N.btNote(o, 'night-2026-12-04');
  assert.deepEqual([n.timeIn, n.timeOut], ['2:10 AM', '2:10 AM']);
});
test('R42 BT: a typed row at or below the pass start stays out even with an Arrived kept, and an undone Arrived is not kept', () => {
  // Arrived seq 3 (8:30 PM), typed In 8:00 PM seq 4 (the earlier visit's), Clean again seq 6, walk tap 2:10. The Arrived is kept (In 8:30 PM, not the
  // typed 8:00 PM). With the Arrived undone (seq 5) nothing is kept: In is the walk tap.
  const o = base();
  o.log = [row(3, '*', 'arrived', { at: '2026-12-04T20:30:00.000-09:00' }), row(4, '*', 'typed', { time_in: '2026-12-04T20:00', time_out: '', by_name: 'Matt' }),
    row(6, '*', 'again', { at: '2026-12-05T02:00:00.000-09:00' }), R42_WALK];
  assert.deepEqual([N.btNote(o, 'night-2026-12-04').timeIn, N.btNote(o, 'night-2026-12-04').timeOut], ['8:30 PM', '2:10 AM']);
  o.log = o.log.concat([]);
  o.log.splice(1, 0, row(5, '*', 'arrived_undone', { undoes: 'L-3' }));
  assert.deepEqual([N.btNote(o, 'night-2026-12-04').timeIn], ['2:10 AM']);
});


// ---- Check night (design 11/24/26): Copy for BT agrees with the sheet's derived Checked ----
// The paper fixture: storm ST-1 a check night. S1 "Loussac": Front walk (sidewalk), Ramp (heated). S2: East walk, West walk.
// Log 1 S1 arrived, 2 S1 left, 3 S2 arrived, 4 S2 East walk treated, 5 S2 left, all in night-2026-11-26.
// The switch: Log 6 a storm-wide 'stormed' row at 02:04, Log 7 West walk cleared at 02:30.
const CN_NIGHT = 'night-2026-11-26';
const cnZ = [
  { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Front walk' }, { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Ramp' },
  { id: 'Z3', site_id: 'S2', type: 'sidewalk', name: 'East walk' }, { id: 'Z4', site_id: 'S2', type: 'sidewalk', name: 'West walk' },
];
const cnRow = (seq, site, zone, state, at, extra = {}) => ({ id: 'L-' + seq, seq, storm_id: 'ST-1', shift_id: CN_NIGHT, site_id: site, zone_id: zone,
  state, note: '', by_name: 'Alex Test', at: '2026-11-26T' + at + ':00.000-09:00', snowing_warned: false, ...extra });
const cnLog = () => [cnRow(1, 'S1', '*', 'arrived', '21:42'), cnRow(2, 'S1', '*', 'left', '22:05'), cnRow(3, 'S2', '*', 'arrived', '22:08'),
  cnRow(4, 'S2', 'Z3', 'treated', '22:15'), cnRow(5, 'S2', '*', 'left', '22:31')];
const cnStorms = (check) => [{ id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-11-26T21:00:00.000-09:00', ...(check ? { check: true } : {}) },
  ...(check === 'switched' ? [{ id: 'ST-2', seq: 2, kind: 'to_storm', storm_id: 'ST-1', log_seq: 6, visit_seq: 0, at: '2026-11-27T02:04:00.000-09:00' }] : [])];
const cnNote = (siteId, log, storms) => N.btNote({ site: { id: siteId, name: siteId, units: {} }, zones: cnZ, storm_id: 'ST-1', log, visits: [], storms }, CN_NIGHT).text.split('\n')[0];

test('btNote: S1 on a check night lists Front walk and Ramp under Checked', () => {
  // S1 was visited (Arrived stands) and no walk was tapped: both walks are checked by the visit, in name order.
  assert.equal(cnNote('S1', cnLog(), cnStorms(true)), 'Checked: Front walk, Ramp.');
  // A walk that was tapped keeps its own state: S2's East walk is Treated, West walk (untapped, visited) is Checked.
  // STATES order lists Treated before Checked.
  assert.equal(cnNote('S2', cnLog(), cnStorms(true)), 'Treated: East walk. Checked: West walk.');
});

test('btNote: the storm-night copy says Not done', () => {
  // The same Log with no check flag: untapped walks are Not done, as today.
  assert.equal(cnNote('S1', cnLog(), cnStorms(false)), 'Not done: Front walk, Ramp.');
  // And with no storms handed in at all.
  assert.equal(cnNote('S1', cnLog(), undefined), 'Not done: Front walk, Ramp.');
});

test('btNote: a check night site with no visit says Not done', () => {
  // S1's rows removed: not visited, nothing is derived.
  const log = cnLog().filter((r) => r.site_id !== 'S1');
  assert.equal(cnNote('S1', log, cnStorms(true)), 'Not done: Front walk, Ramp.');
});

test('btNote after the switch uses storm rules', () => {
  // Log 6 is a storm-wide pass break at 02:04; Log 7 clears West walk at 02:30. After it every walk starts fresh and the latest
  // pass is the storm's: S2 lists Cleared: West walk and Not done: East walk (its check-time Treated belongs to the earlier pass).
  // S1 has nothing since the switch: Not done for both, never the derived Checked.
  const log = cnLog().concat([cnRow(6, '*', '*', 'stormed', '02:04', { by_name: 'Matthew' }), cnRow(7, 'S2', 'Z4', 'cleared', '02:30')]);
  assert.equal(cnNote('S2', log, cnStorms('switched')), 'Cleared: West walk. Not done: East walk.');
  assert.equal(cnNote('S1', log, cnStorms('switched')), 'Not done: Front walk, Ramp.');
});
