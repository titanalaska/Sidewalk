// Print map (Matt, 11/18/26): the page lib/mapprint.js builds from plain data.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/mapprint');
const M = require('../lib/mapview');

const ring = [[0, 0], [1, 0], [1, 1], [0, 1]];
const zones = [
  { id: 'Z1', type: 'sidewalk', name: 'Walk 10', ring },
  { id: 'Z2', type: 'hand', name: 'Walk 2', ring, note: 'Clear the <ramp>' },
  { id: 'Z3', type: 'heated', name: 'Zed entry', priority: true, ring, new_concrete: true },
];
const page = (o) => P.pageHtml(Object.assign({ site: { name: 'PAC & Co', address: '621 W 6TH AVE', customer: 'MOA', materials_needed: '~8 buckets sand', notes: 'Line 1\nLine 2' },
  items: P.numbered(zones), img: 'data:image/jpeg;base64,AAAA', types: M.TYPES, concreteLabel: M.NEW_CONCRETE_LABEL, madeAt: '11/18/26, 12:40 PM' }, o));

test('zones are numbered priority first, then by name with numbers read as numbers', () => {
  assert.deepEqual(P.numbered(zones).map((it) => [it.n, it.z.id]), [[1, 'Z3'], [2, 'Z2'], [3, 'Z1']]);
  assert.deepEqual(zones.map((z) => z.id), ['Z1', 'Z2', 'Z3'], 'the input is not sorted');
  assert.deepEqual(P.numbered(null), []);
});

test('the page carries the site, the picture, the legend and one row per zone, escaped', () => {
  const h = page();
  assert.match(h, /<h1 data-no-es>PAC &amp; Co<\/h1>/);
  assert.match(h, /621 W 6TH AVE.*MOA/);
  assert.match(h, /<b>Materials:<\/b> <b data-no-es data-typed>~8 buckets sand<\/b>/);
  assert.match(h, /Line 1\nLine 2/);
  assert.match(h, /<img class="mp-img" src="data:image\/jpeg;base64,AAAA"/);
  for (const k of Object.keys(M.TYPES)) assert.ok(h.includes(M.TYPES[k].label), k + ' in the legend');
  assert.equal((h.match(/<tr><td>/g) || []).length, 3);
  // the star outside the typed name's span (the name is what lib/estyped.js translates)
  assert.match(h, /mp-num mp-pri">1<\/b><\/td><td><b>★ <span data-no-es data-typed>Zed entry<\/span>/);
  assert.match(h, /New concrete: sand only, no salt/);
  assert.match(h, /Clear the &lt;ramp&gt;/);
  assert.ok(!h.includes('<ramp>'));
  assert.match(h, /Printed <span data-no-es>11\/18\/26, 12:40 PM/);
});

// Spanish everywhere, Ship 2: Print map in Espanol shows the Spanish of the typed lines (lib/estyped.js). On paper, this page:
// the materials "~8 buckets sand", the notes "Line 1\nLine 2", the three zone names (Zed entry, Walk 2, Walk 10 in print
// order) and Walk 2's note "Clear the <ramp>" -> 6 marks, each also data-no-es; Walk 10 and Zed entry have no note: their note
// cells are not marked. Never marked: the site's name (PAC & Co), its address, its customer (MOA).
test('typed words: the map page marks exactly the typed lines, never a name, an address or a customer', () => {
  const h = page();
  const marked = [...h.matchAll(/<(?:b|span|div|td)[^>]*data-typed[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(marked, ['~8 buckets sand', 'Line 1\nLine 2', 'Zed entry', 'Walk 2', 'Clear the &lt;ramp&gt;', 'Walk 10']);
  assert.equal(h.split('data-typed').length - 1, 6);
  assert.equal(h.split('data-no-es data-typed').length - 1, 6);
  for (const never of ['PAC', '621 W 6TH AVE', 'MOA']) assert.ok(!marked.some((t) => t.includes(never)), never);
});

test('no picture: the page says so and the list still prints; no zones: it says so; blank fields leave no line', () => {
  const h = page({ img: null, site: { name: 'X' } });
  assert.match(h, /could not be made/);
  assert.ok(!h.includes('<img'));
  assert.ok(!h.includes('Materials:') && !h.includes('Needs clearance') && !h.includes('mp-sub'));
  const none = page({ items: [] });
  assert.match(none, /No zones drawn on this site yet/);
  assert.ok(!none.includes('<img') && !none.includes('mp-noimg') && !none.includes('mp-legend'), 'no zones: no picture, no legend');
  const lost = page({ items: [], img: null, loadFailed: true });
  assert.match(lost, /couldn't be loaded on this phone/);
  assert.ok(!lost.includes('No zones drawn') && !lost.includes('mp-zones'), 'a site that could not load never reads as having nothing drawn');
});

test('every css rule is under #printsheets, so the app is never restyled', () => {
  P.css.split('\n').forEach((line) => assert.match(line, /^#printsheets /, line));
});

test('the print zoom keeps everything the screen showed: the tighter stretch wins', () => {
  assert.equal(P.zoomFor(P.PRINT_W, P.PRINT_H), 0);
  assert.equal(P.zoomFor(P.PRINT_W / 2, P.PRINT_H / 2), 1);
  // A phone's tall map: the height is the tighter stretch, so the zoom goes in only that far and the whole height still shows.
  const z = P.zoomFor(390, 523);
  assert.ok(Math.abs(z - Math.log2(P.PRINT_H / 523)) < 1e-9);
  assert.equal(P.zoomFor(0, 100), 0);
});
