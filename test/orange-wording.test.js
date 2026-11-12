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
  // One 1,200 ft zone: one item, "Curbs", then ": clear 4 ft back", then " (about 1,200 ft)".
  assert.equal(SL.curbItems('S1', [CZ('Z1', 1200, 1)])[0].name, 'Curbs: clear 4 ft back (about 1,200 ft)');
  // 900 + 750 + 500 = 2,150 ft, ceil(2150 / 900) = 3 items, one zone each: the second is "Curbs 2 of 3", 750 ft.
  assert.equal(SL.curbItems('S1', [CZ('A', 900, 1), CZ('B', 750, 2), CZ('C', 500, 3)])[1].name, 'Curbs 2 of 3: clear 4 ft back (about 750 ft)');
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
