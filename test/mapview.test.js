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

// Outlines on demand, ruling R5 (Matt 10/9/26): SnowMap.centroid (the priority star, the walk marks) is
// lib/points.js's centroid, the one the server uses for a site's point, so the two can never disagree.
// The arithmetic that was here took the corners as raw lng/lat. At -149.9 / 61.2 each cross product
// p[0]*q[1] - q[0]*p[1] is about 9,000 and a thin ring's whole sum is about 1e-8, so the rounding in the
// products swamps the answer: a thin curb strip came out hundreds of metres from where it is. The pins
// elsewhere (weather.test.js, snowmap.test.js) agree to 2 dp, where the old and new arithmetic agree too,
// so only a ring this thin tells them apart.
//
// Worked on paper (a degree of latitude is 111,195 m on a 6,371 km sphere; a degree of longitude at 61.2 N
// is 111,195 x cos 61.2 deg = 111,195 x 0.4817 = 53,568 m):
//   Strip, 30 m x 1.2 m (a 4 ft curb line) at the PAC lot's latitude. 30 m = 0.00056 deg of longitude,
//   1.2 m = 0.000011 deg of latitude. Corners (lng, lat): west -149.9, east -149.9 + 0.00056 = -149.89944;
//   south 61.2, north 61.2 + 0.000011 = 61.200011. The centroid of a rectangle is its centre:
//     lng = -149.9 + 0.00056 / 2 = -149.9 + 0.00028 = -149.89972
//     lat = 61.2 + 0.000011 / 2 = 61.2 + 0.0000055 = 61.2000055
//   Rectangle, 30 m x 10 m at PAC (-149.8885, 61.2177). 30 m = 0.00056 deg of longitude, 10 m = 0.00009 deg of
//   latitude (10 / 111,195). Centre: lng = -149.8885 + 0.00028 = -149.88822; lat = 61.2177 + 0.000045 = 61.217745.
// 1e-9 deg is 0.1 mm of latitude: far inside any rounding of a correct centroid, far outside the old one's error.
const SnowMap = require('../lib/mapview.js');
const SnowPoints = require('../lib/points.js');

// The arithmetic SnowMap.centroid had before R5: the area-weighted centroid on the raw lng/lat.
function rawCentroid(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], c = p[0] * q[1] - q[0] * p[1];
    a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
  }
  return [x / (3 * a), y / (3 * a)];
}
const STRIP = [[-149.9, 61.2], [-149.89944, 61.2], [-149.89944, 61.200011], [-149.9, 61.200011]];
const STRIP_CENTRE = [-149.89972, 61.2000055];
const RECT = [[-149.8885, 61.2177], [-149.88794, 61.2177], [-149.88794, 61.21779], [-149.8885, 61.21779]];
const RECT_CENTRE = [-149.88822, 61.217745];
const near = (got, want, tol) => Math.abs(got[0] - want[0]) <= tol && Math.abs(got[1] - want[1]) <= tol;

for (const [name, ring, centre] of [['a 30 m x 1.2 m curb strip', STRIP, STRIP_CENTRE], ['a 30 m x 10 m rectangle', RECT, RECT_CENTRE]]) {
  test('SnowMap.centroid: ' + name + ' at 61.2 N comes out at its true centre, the same point the server uses', () => {
    // The fixture tells the two arithmetics apart: the old one is more than 1e-4 deg (about 5 m) away.
    assert.ok(!near(rawCentroid(ring), centre, 1e-4), 'the raw arithmetic should be off on this ring: ' + JSON.stringify(rawCentroid(ring)));
    const got = SnowMap.centroid(ring);
    assert.ok(near(got, centre, 1e-9), name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(centre));
    // And it is lib/points.js's, exactly, not a second copy that merely agrees.
    assert.deepStrictEqual(got, SnowPoints.centroid(ring));
  });
}
