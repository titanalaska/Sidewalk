// Orange says the job (Matt, 11/12/26): the type's label and the curb item's name.
// The crew skipped the orange zones: "Hand work" names a category, not a job. Orange means
// clear the curb 4 feet back, by whatever means; the 4 is CURB_ROLLUP.widthFt in lib/shiftlog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const SnowMap = require('../lib/mapview.js');
const SL = require('../lib/shiftlog.js');

const CZ = (id, feet, bp, over) => Object.assign({ id, site_id: 'S1', type: 'hand', name: 'Curb - ' + id, archived: false,
  area_sqft: feet === null ? undefined : feet * 4, from: 'bootprint:J1:' + bp }, over || {});

test('the orange type is labelled by its job, in the same place the legend and the zone card read it', () => {
  assert.equal(SnowMap.TYPES.hand.label, 'Clear 4 ft back');
  assert.equal(SnowMap.TYPES.hand.color, '#d98c00'); // the colour is not what changed
});

test('curb item names: the three forms, worked on paper', () => {
  // One 3,000 ft zone: ceil(3000 / 2400) = 2 by length but never more items than zones, so one item, "Curbs", then ": clear 4 ft back", then " (about 3,000 ft)".
  assert.equal(SL.curbItems('S1', [CZ('Z1', 3000, 1)])[0].name, 'Curbs: clear 4 ft back (about 3,000 ft)');
  // 2,400 + 2,000 + 1,500 = 5,900 ft, ceil(5900 / 2400) = 3 items, one zone each: the second is "Curbs 2 of 3", 2,000 ft.
  assert.equal(SL.curbItems('S1', [CZ('A', 2400, 1), CZ('B', 2000, 2), CZ('C', 1500, 3)])[1].name, 'Curbs 2 of 3: clear 4 ft back (about 2,000 ft)');
  // No length: no brackets.
  assert.equal(SL.curbItems('S1', [CZ('Z1', null, 1)])[0].name, 'Curbs: clear 4 ft back');
});

test('the number in the curb item name follows CURB_ROLLUP.widthFt', () => {
  const was = SL.CURB_ROLLUP.widthFt;
  try {
    SL.CURB_ROLLUP.widthFt = 3; // a 2,400 sq ft strip is 2,400 / 3 = 800 ft
    assert.equal(SL.curbItems('S1', [CZ('Z1', 600, 1, { area_sqft: 2400 })])[0].name, 'Curbs: clear 3 ft back (about 800 ft)');
  } finally { SL.CURB_ROLLUP.widthFt = was; }
});

// Matt, 11/13/26: 2,000 ft per tap (was 750). The phone's own copy of the roll-up must size items the same as the server's.
test('curb roll-up on the phone: 2,000 ft per tap, an item may run to 2,400 ft', () => {
  assert.deepEqual(SL.CURB_ROLLUP, { feetPerItem: 2000, allowance: 0.2, maxItems: 5, widthFt: 4 });
  // Four zones of 750 ft = 3,000 ft: ceil(3000 / 2400) = 2 items (it was ceil(3000 / 900) = 4 at 750 ft per tap),
  // cut [A, B] 1,500 | [C, D] 1,500 (the only even split; any other has a group of 2,250 or more).
  const four = [CZ('A', 750, 1), CZ('B', 750, 2), CZ('C', 750, 3), CZ('D', 750, 4)];
  const items = SL.curbItems('S1', four);
  assert.deepEqual(items.map(i => i.zone_ids), [['A', 'B'], ['C', 'D']]);
  assert.deepEqual(items.map(i => i.name), ['Curbs 1 of 2: clear 4 ft back (about 1,500 ft)', 'Curbs 2 of 2: clear 4 ft back (about 1,500 ft)']);
  // 2,400 ft in one go is still one item (the 20% allowance); 2,401 ft needs a second (two zones so a second can exist).
  assert.equal(SL.curbItems('S1', [CZ('A', 1200, 1), CZ('B', 1200, 2)]).length, 1);
  assert.equal(SL.curbItems('S1', [CZ('A', 1200, 1), CZ('B', 1201, 2)]).length, 2);
});
