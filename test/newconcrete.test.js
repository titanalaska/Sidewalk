// New concrete (lime stripes), shared walk rules + route sheet. A zone with new_concrete === true is a walk that
// gets sand only, no salt; its Treated tap is displayed as "Sanded" but is still SAVED as `treated`.
// Expected values below are worked on paper in the comments, not read back from the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const Log = require('../lib/shiftlog.js');
const RS = require('../lib/routesheet.js');

const ring = [[0, 0], [0, 1], [1, 1]];
const zone = (id, name, extra) => Object.assign({ id, site_id: 'S1', type: 'sidewalk', name, ring }, extra || {});

test('walksFor: the flag is true only for a boolean true', () => {
  // Sorted by name: A (true), B (false), C (absent), D ('yes' is not true), E (1 is not true).
  const zones = [zone('Z1', 'A', { new_concrete: true }), zone('Z2', 'B', { new_concrete: false }), zone('Z3', 'C'),
    zone('Z4', 'D', { new_concrete: 'yes' }), zone('Z5', 'E', { new_concrete: 1 })];
  const w = Log.walksFor('S1', zones);
  assert.deepEqual(w.map(x => x.name), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(w.map(x => x.new_concrete), [true, false, false, false, false]);
});

test('walksFor: the whole-site walk is never striped', () => {
  const w = Log.walksFor('S1', []);
  assert.equal(w.length, 1);
  assert.equal(w[0].zone_id, 'whole');
  assert.equal(w[0].new_concrete, false);
});

// Curb zones: three short hand lines named "Curb ..." roll up into one item (3 short lines, well under one item's feet).
const curb = (id, extra) => Object.assign({ id, site_id: 'S2', type: 'hand', name: 'Curb ' + id, ring: [[-149.9, 61.2], [-149.9, 61.2001], [-149.9001, 61.2001]] }, extra || {});

test('curb item: striped when ANY one of its zones is (1 of 3)', () => {
  const zones = [curb('c1'), curb('c2', { new_concrete: true }), curb('c3')];
  const items = Log.curbItems('S2', zones);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].zone_ids.slice().sort(), ['c1', 'c2', 'c3']);
  assert.equal(items[0].new_concrete, true);
  const w = Log.walksFor('S2', zones);
  assert.equal(w.length, 1);
  assert.equal(w[0].new_concrete, true);
});

test('curb item: not striped when none of its zones is, and the roll-up memo does not remember a stripe that was removed', () => {
  const striped = [curb('c1'), curb('c2', { new_concrete: true }), curb('c3')];
  const plain = [curb('c1'), curb('c2'), curb('c3')];
  assert.equal(Log.curbItems('S2', striped)[0].new_concrete, true);
  // Same ids, same lengths: only the flag changed. A memo keyed on ids + lengths alone would still say true.
  assert.equal(Log.curbItems('S2', plain)[0].new_concrete, false);
  assert.equal(Log.curbItems('S2', striped)[0].new_concrete, true);
});

test('stateWord: Sanded only for treated on a striped walk', () => {
  const words = { cleared: 'Cleared', treated: 'Treated', checked: 'Checked', problem: 'Problem', none: 'Not done' };
  Object.keys(words).forEach(s => {
    // Striped: only treated changes.
    assert.equal(Log.stateWord(s, true), s === 'treated' ? 'Sanded' : words[s], s + ' striped');
    assert.equal(Log.stateWord(s, false), words[s], s + ' plain');
  });
  assert.equal(Log.stateWord('treated', undefined), 'Treated');
  assert.equal(Log.stateWord('treated', 'yes'), 'Treated');   // only a boolean true counts
  assert.equal(Log.stateWord('again', true), 'again');        // anything else: the raw state
});

test('NO_SALT is the exact copy', () => {
  assert.equal(Log.NO_SALT, 'Sand only, no salt');
});

// Route sheet: one site, two walks both Treated: "Striped path" (new concrete) and "Plain path".
function sheetFor(zones, log) {
  const o = {
    storm_id: 'ST-1', zones, log, visits: [], storms: [{ kind: 'start', storm_id: 'ST-1', seq: 1 }],
    sites: [{ id: 'S1', name: 'Test Site' }], routes: [{ id: 'R1', name: 'Route 1', site_ids: ['S1'] }],
  };
  const data = RS.sheetData(o, 'R1', 'night-2026-12-04');
  return { data, html: RS.sheetBody(data, '2026-12-05T06:00:00-09:00', false) };
}
const tapRow = (n, zid, state) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-12-04', site_id: 'S1', zone_id: zid, state,
  note: '', by_name: 'Alex Test', at: '2026-12-04T19:0' + n + ':00-09:00', snowing_warned: false, undoes: null });
const count = (s, sub) => s.split(sub).length - 1;

test('route sheet: a striped Treated walk prints Sanded + Sand only, no salt once; the plain one prints Treated', () => {
  const zones = [zone('Z1', 'Plain path'), zone('Z2', 'Striped path', { new_concrete: true })];
  const { data, html } = sheetFor(zones, [tapRow(1, 'Z1', 'treated'), tapRow(2, 'Z2', 'treated')]);
  const walks = data.sites[0].walks;
  assert.deepEqual(walks.map(w => [w.name, w.new_concrete, w.state]), [['Plain path', false, 'treated'], ['Striped path', true, 'treated']]);
  assert.equal(count(html, 'Sanded'), 1);
  assert.equal(count(html, 'Sand only, no salt'), 1);
  assert.equal(count(html, ': Treated'), 1);
  // The Sanded word and the line sit in the striped walk's own list item.
  const li = html.split('<li>').filter(x => x.indexOf('Striped path') !== -1)[0];
  assert.ok(li.indexOf('Sanded') !== -1 && li.indexOf('Sand only, no salt') !== -1);
  assert.ok(html.split('<li>').filter(x => x.indexOf('Plain path') !== -1)[0].indexOf('Sand only') === -1);
});

test('route sheet: an untapped striped walk still says Sand only, no salt, with Not done', () => {
  const zones = [zone('Z2', 'Striped path', { new_concrete: true })];
  const { data, html } = sheetFor(zones, [tapRow(1, 'Z9', 'cleared')]);   // a tap elsewhere so the sheet exists
  assert.equal(data.sites[0].walks[0].state, 'none');
  assert.equal(count(html, 'Not done'), 1);
  assert.equal(count(html, 'Sand only, no salt'), 1);
});

test('route sheet: a tap on an archived striped zone prints Sanded (flag found from the zone); a removed zone is plain', () => {
  const zones = [zone('Z1', 'Old path', { new_concrete: true, archived: true }), zone('Z3', 'Live path')];
  const { data, html } = sheetFor(zones, [tapRow(1, 'Z1', 'treated'), tapRow(2, 'Z8', 'treated'), tapRow(3, 'Z3', 'cleared')]);
  const by = {}; data.sites[0].walks.forEach(w => { by[w.name] = w; });
  assert.equal(by['Old path'].new_concrete, true);
  assert.equal(by['Removed zone'].new_concrete, false);
  assert.equal(by['Live path'].new_concrete, false);
  assert.equal(count(html, 'Sanded'), 1);      // the archived one only
  assert.equal(count(html, ': Treated'), 1);   // the removed zone's
});

// R2: the "Treated while snowing" flag uses the walk's own word. A striped walk is Sanded, so its flag reads
// "Sanded while snowing"; a plain walk keeps "Treated while snowing" exactly.
test('route sheet: the snowing flag says Sanded while snowing on a striped walk, Treated while snowing on a plain one', () => {
  const zones = [zone('Z1', 'Plain path'), zone('Z2', 'Striped path', { new_concrete: true })];
  const rows = [tapRow(1, 'Z1', 'treated'), tapRow(2, 'Z2', 'treated')];
  rows.forEach(r => { r.snowing_warned = true; });
  const { html } = sheetFor(zones, rows);
  // One flag per walk: one of each, never two of either.
  assert.equal(count(html, 'Sanded while snowing'), 1);
  assert.equal(count(html, 'Treated while snowing'), 1);
  const li = n => html.split('<li>').filter(x => x.indexOf(n) !== -1)[0];
  assert.ok(li('Striped path').indexOf('Sanded while snowing') !== -1);
  assert.ok(li('Plain path').indexOf('Treated while snowing') !== -1);
});

// R3: four curb lines of 8000 sq ft each = 2,000 ft each at 4 ft wide; total 8,000 ft; one item holds 2000 * 1.2 = 2,400 ft,
// so ceil(8000 / 2400) = 4 items (3.33 rounds up) (under the 5 cap), cut one line per item. Only the item holding the striped line is striped.
test('curb items: with several items at one site, only the item whose zones include a striped one is striped', () => {
  const big = (id, extra) => curb(id, Object.assign({ area_sqft: 8000 }, extra || {}));
  const zones = [big('c1'), big('c2'), big('c3', { new_concrete: true }), big('c4')];
  const items = Log.curbItems('S2', zones);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(i => i.zone_ids), [['c1'], ['c2'], ['c3'], ['c4']]);
  assert.deepEqual(items.map(i => i.new_concrete), [false, false, true, false]);
  const w = Log.walksFor('S2', zones);
  assert.deepEqual(w.map(x => x.new_concrete), [false, false, true, false]);
});
