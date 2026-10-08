// Matt's rule (10/1/26): warn only when NO photo loads at all.
const test = require('node:test');
const assert = require('node:assert');
const { photoUnavailable } = require('../lib/mapview.js');

test('both photos load: no banner', () => assert.strictEqual(photoUnavailable(true, true, true), false));
test('Esri down, MOA fine: MOA is a photo, no banner', () => assert.strictEqual(photoUnavailable(false, true, true), false));
test('Esri fine, MOA down: blurrier, still a photo, no banner', () => assert.strictEqual(photoUnavailable(true, false, true), false));
test('outside MOA, Esri fine: no banner', () => assert.strictEqual(photoUnavailable(true, false, false), false));
test('both down: banner', () => assert.strictEqual(photoUnavailable(false, false, true), true));
test('outside MOA, Esri down: banner', () => assert.strictEqual(photoUnavailable(false, false, false), true));
// A stray MOA "ok" outside its area can't count as a photo: MOA was never asked.
test('outside MOA, Esri down, moaOk somehow true: still banner', () => assert.strictEqual(photoUnavailable(false, true, false), true));

// Walk marks on the map: a tick for done, a bang for a problem, nothing else.
// 'none' is a walk undone back to not done; a missing row is not started.
const { markOf } = require('../lib/mapview.js');
test('marks: cleared, treated and checked are a tick; problem is a bang', () => {
  for (const s of ['cleared', 'treated', 'checked']) assert.strictEqual(markOf({ state: s }), '✓', s);
  assert.strictEqual(markOf({ state: 'problem' }), '!');
});
test('marks: not started, undone and unknown states get no mark', () => {
  for (const r of [undefined, null, {}, { state: 'none' }, { state: 'whatever' }]) assert.strictEqual(markOf(r), '', JSON.stringify(r));
});

// Curb roll-up (Matt, 10/8/26): a curb line is tapped as its "Curbs" item, so its mark comes from the item's row.
const { markFor } = require('../lib/mapview.js');
test('marks: a curb zone takes its Curbs item\'s mark; a sidewalk its own', () => {
  const Log = require('../lib/shiftlog.js');
  const zones = [{ id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Walk' },
    { id: 'Z9', site_id: 'S1', type: 'hand', name: 'Curb - lot', area_sqft: 1200 },
    { id: 'Z8', site_id: 'S1', type: 'hand', name: 'Curb - island', area_sqft: 400 }];
  const states = { 'S1|curbs-1': { state: 'cleared' }, 'S1|Z1': { state: 'problem' } };
  assert.strictEqual(markFor(zones[1], zones, states, Log), '✓');
  assert.strictEqual(markFor(zones[2], zones, states, Log), '✓');
  assert.strictEqual(markFor(zones[0], zones, states, Log), '!');
  // An old row on the curb zone's own id (from before the roll-up) no longer marks it.
  assert.strictEqual(markFor(zones[1], zones, { 'S1|Z9': { state: 'cleared' } }, Log), '');
  // No shift log loaded (a cut-off load): a zone is looked up by its own id, never an error.
  assert.strictEqual(markFor(zones[0], zones, states, null), '!');
});
