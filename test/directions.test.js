const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/directions.js');

const BASE = 'https://www.google.com/maps/dir/?api=1&destination=';
const TAIL = '&travelmode=driving';

// On paper: point [lng, lat] = [-149.86341261, 61.18195749].
//   lat 61.18195749 -> 6 decimals -> 61.181957 ; lng -149.86341261 -> -149.863413 ; latitude goes FIRST.
test('url: a point is latitude then longitude, 6 decimals, comma encoded', () => {
  assert.equal(D.url([-149.86341261, 61.18195749], '100 Test Way'), BASE + '61.181957%2C-149.863413' + TAIL);
});
// On paper: -149.9 -> "-149.900000", 61.2 -> "61.200000".
test('url: short numbers are padded to 6 decimals', () => {
  assert.equal(D.url([-149.9, 61.2], ''), BASE + '61.200000%2C-149.900000' + TAIL);
});
// On paper: "4000 Test Dr #2 & 3" -> space %20, # %23, & %26.
test('url: no point, the address exactly as typed, encoded', () => {
  assert.equal(D.url(null, '  4000 Test Dr #2 & 3 '), BASE + '4000%20Test%20Dr%20%232%20%26%203' + TAIL);
});
test('url: neither a point nor an address is no link', () => {
  for (const a of ['', '   ', null, undefined]) assert.equal(D.url(null, a), '');
});
test('url: a point that is not two finite numbers falls back to the address', () => {
  for (const bad of [[NaN, 61.2], ['-149.9', '61.2'], [61.2], [], {}, [-149.9, Infinity]])
    assert.equal(D.url(bad, '100 Test Way'), BASE + '100%20Test%20Way' + TAIL);
});

// point(): the server's point first, then points.js over the site and zones, else null.
const RING = [[-149.9, 61.2], [-149.8998, 61.2], [-149.8998, 61.2002], [-149.9, 61.2002]]; // centre on paper: [-149.8999, 61.2001]
test('point: the server point wins', () => {
  assert.deepEqual(D.point({ id: 'S1', map: { center: [-149.5, 61.5] } }, [-149.7, 61.3], []), [-149.7, 61.3]);
});
test('point: no server point, the saved map view centre', () => {
  assert.deepEqual(D.point({ id: 'S1', map: { center: [-149.5, 61.5] } }, undefined, []), [-149.5, 61.5]);
});
test('point: no server point and no saved view, the middle of the first drawn walk', () => {
  const p = D.point({ id: 'S1' }, undefined, [{ id: 'Z1', site_id: 'S1', ring: RING }]);
  assert.ok(Math.abs(p[0] - -149.8999) < 1e-9 && Math.abs(p[1] - 61.2001) < 1e-9, String(p));
});
test('point: a slim zone (no ring), no view, no server point is null; a bad server point is passed over', () => {
  assert.equal(D.point({ id: 'S1' }, undefined, [{ id: 'Z1', site_id: 'S1' }]), null);
  assert.equal(D.point({ id: 'S1' }, ['a', 'b'], []), null);
  assert.equal(D.point(null, undefined, []), null);
});

test('linkHtml: the exact markup, the href escaped; no href is no link', () => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  assert.equal(D.linkHtml('https://x/?a=1&b=2', esc),
    '<a class="small dirlink" data-directions href="https://x/?a=1&amp;b=2" target="_blank" rel="noopener">Directions</a>');
  assert.equal(D.linkHtml('', esc), '');
});

test('showNext: a green Done bar, or a latest mark that is a Left', () => {
  assert.equal(D.showNext('done', null), true);
  assert.equal(D.showNext('working', { state: 'left' }), true);
  assert.equal(D.showNext('problem', { state: 'left' }), true);
  assert.equal(D.showNext('working', { state: 'arrived' }), false);
  assert.equal(D.showNext('working', null), false);
  assert.equal(D.showNext('none', null), false);
  assert.equal(D.showNext('problem', null), false);
});

// Route order A, B, C, D. kinds on paper: A done, B working, C none, D none -> next is C.
const R = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
const kinds = (m) => (s) => m[s.id];
test('next: the first site in the given order that nobody has started', () => {
  assert.equal(D.next(R, kinds({ A: 'done', B: 'working', C: 'none', D: 'none' }), 'A').id, 'C');
});
test('next: an earlier site that was skipped comes before a later one', () => {
  assert.equal(D.next(R, kinds({ A: 'none', B: 'done', C: 'none', D: 'none' }), 'B').id, 'A');
});
test('next: never the card\'s own site; none left is null; an empty route is null', () => {
  assert.equal(D.next(R, kinds({ A: 'none', B: 'done', C: 'done', D: 'done' }), 'A'), null);
  assert.equal(D.next(R, kinds({ A: 'done', B: 'done', C: 'problem', D: 'working' }), 'A'), null);
  assert.equal(D.next([], kinds({}), 'A'), null);
});
