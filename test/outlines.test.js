const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../lib/outlines');

// SnowOutlines is the phone's kept copy of each site's zone outlines. The page
// keeps zone records WITHOUT rings in S.zones; the rings live only here, one
// entry per site, in localStorage under 'snow-outlines':
//   { v: 1, sites: { <siteId>: { at: <iso>, rings: { <zoneId>: [[lng, lat], ...] } } } }
// localStorage is per origin and the origin is shared with two other apps, so
// a write can be refused (quota, private mode) and even the accessor can throw.
// Nothing in this module may ever throw.

// An in-memory localStorage double. getItem returns null for a missing key,
// like the real thing.
function memory(seed) {
  const items = Object.assign({}, seed || {});
  return {
    items,
    getItem(k) { return Object.prototype.hasOwnProperty.call(items, k) ? items[k] : null; },
    setItem(k, v) { items[k] = String(v); },
    removeItem(k) { delete items[k]; },
  };
}
const raw = (st) => JSON.parse(st.items[O.KEY]);

// Paper fixtures. Each ring is three or four [lng, lat] corners.
const R1 = [[-149.90, 61.20], [-149.90, 61.21], [-149.89, 61.21], [-149.89, 61.20]];
const R2 = [[-149.80, 61.10], [-149.80, 61.11], [-149.79, 61.11]];
const R3 = [[-149.70, 61.00], [-149.70, 61.01], [-149.69, 61.01]];
const z = (id, ring, extra) => Object.assign({ id, name: 'Zone ' + id, ring }, extra || {});
const slim = (zone) => { const c = Object.assign({}, zone); delete c.ring; return c; };
const clone = (v) => JSON.parse(JSON.stringify(v));
const Z1 = z('Z1', R1), Z2 = z('Z2', R2), Z3 = z('Z3', R3);

test('the key is named once: snow-outlines', () => {
  assert.equal(O.KEY, 'snow-outlines');
});

test('keep then withRings: the kept rings come back, a zone never kept does not', () => {
  const st = memory();
  const s = O.store(st);
  s.keep('S1', [Z1, Z2]);
  // The page hands withRings its slim zones (no rings) in the order it shows
  // them: Z1, Z2, and Z3 which was never kept. Expect Z1 and Z2, rings attached,
  // their other fields still there, in the order given. Z3 is not returned.
  const got = s.withRings('S1', [slim(Z1), slim(Z2), slim(Z3)]);
  assert.deepEqual(got, [Z1, Z2]);
  assert.equal(got.length, 2);
});

test('withRings keeps the page order, not the order kept', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  assert.deepEqual(s.withRings('S1', [slim(Z2), slim(Z1)]).map((x) => x.id), ['Z2', 'Z1']);
});

test('withRings returns copies and leaves the zones it was given alone', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1]);
  const input = [slim(Z1)];
  const got = s.withRings('S1', input);
  assert.notEqual(got[0], input[0]);
  assert.equal('ring' in input[0], false);
  // Changing the copy's ring must not reach the kept one: read it back again.
  got[0].ring[0][0] = 0;
  assert.deepEqual(s.withRings('S1', input)[0].ring, R1);
});

test('keep stores only zones that have a ring, in the v1 shape with an ISO time', () => {
  const st = memory();
  const before = Date.now();
  O.store(st).keep('S1', [Z1, { id: 'Z9', name: 'no ring' }, { id: 'Z8', ring: [] }]);
  const after = Date.now();
  const r = raw(st);
  assert.equal(r.v, 1);
  assert.deepEqual(Object.keys(r.sites), ['S1']);
  // Only Z1 had a usable ring: Z9 has none, Z8 has an empty one.
  assert.deepEqual(r.sites.S1.rings, { Z1: R1 });
  // `at` is an ISO instant taken while keep ran.
  assert.equal(new Date(r.sites.S1.at).toISOString(), r.sites.S1.at);
  const t = Date.parse(r.sites.S1.at);
  assert.ok(t >= before && t <= after, 'at ' + r.sites.S1.at + ' is not within the call');
});

test('keep replaces the site entry: a zone dropped from the list is gone', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  s.keep('S1', [Z2]);
  // Z1 was in the first keep and not the second, so only Z2 is left.
  assert.deepEqual(s.withRings('S1', [slim(Z1), slim(Z2)]), [Z2]);
});

test('keep replaces rather than merges: a moved corner is the new corner, nothing of the old', () => {
  const st = memory();
  const s = O.store(st);
  s.keep('S1', [Z1, Z2]);
  const moved = [[-149.80, 61.10], [-149.80, 61.11], [-149.79, 61.12]]; // last corner 61.11 -> 61.12
  s.keep('S1', [z('Z2', moved)]);
  assert.deepEqual(raw(st).sites.S1.rings, { Z2: moved });
});

// R9 (10/10/26): a failed or malformed getZones reply must never wipe the copy a map draws offline. The page
// only calls keep with an ok reply's zones, and keep itself refuses anything that is not a list: an Array,
// even [], is an answer ("this site has no zones now") and replaces; undefined, null, a string, a number or
// an object is not an answer and changes nothing.
test('keep with something that is not a list is a no-op that returns false; an empty list still replaces', () => {
  const st = memory();
  const s = O.store(st);
  assert.equal(s.keep('S1', [Z1, Z2]), true);
  const before = st.items[O.KEY]; // the exact text on disk, `at` included
  for (const notAList of [undefined, null, 'Z1', 5, true, {}, { 0: Z1, length: 1 }]) {
    assert.equal(s.keep('S1', notAList), false, JSON.stringify(notAList));
    // Same text: the entry was not rewritten, so Z1 and Z2 are still kept.
    assert.equal(st.items[O.KEY], before, JSON.stringify(notAList));
  }
  assert.deepEqual(s.withRings('S1', [slim(Z1), slim(Z2)]), [Z1, Z2]);
  // A site never kept gets no entry from a non-list either.
  assert.equal(s.keep('S9', undefined), false);
  assert.deepEqual(Object.keys(raw(st).sites), ['S1']);
  // [] is a real answer: the site has no zones, and that replaces what was kept.
  assert.equal(s.keep('S1', []), true);
  assert.deepEqual(raw(st).sites.S1.rings, {});
  assert.deepEqual(s.withRings('S1', [slim(Z1)]), []);
});

test("keep leaves another site's entry exactly as it was", () => {
  const st = memory();
  const s = O.store(st);
  s.keep('S2', [Z3]);
  const s2Before = clone(raw(st).sites.S2);
  s.keep('S1', [Z1]);
  s.keep('S1', [Z2]);
  assert.deepEqual(raw(st).sites.S2, s2Before);
  assert.deepEqual(s.withRings('S2', [slim(Z3)]), [Z3]);
  // And the rings do not leak across sites: S2 never kept Z1.
  assert.deepEqual(s.withRings('S2', [slim(Z1)]), []);
});

test('keepOne adds one ring to an existing entry and leaves the rest and its time', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const st = memory();
  st.items[O.KEY] = JSON.stringify({ v: 1, sites: { S1: { at, rings: { Z1: R1 } } } });
  const s = O.store(st);
  s.keepOne('S1', Z2);
  assert.deepEqual(raw(st).sites.S1.rings, { Z1: R1, Z2: R2 });
  // The entry still stands for the fetch that made it, not for this one save.
  assert.equal(raw(st).sites.S1.at, at);
  assert.deepEqual(s.withRings('S1', [slim(Z1), slim(Z2)]), [Z1, Z2]);
});

test('keepOne creates the entry for a site never kept, with an ISO time', () => {
  const st = memory();
  O.store(st).keepOne('S9', Z3);
  const e = raw(st).sites.S9;
  assert.deepEqual(e.rings, { Z3: R3 });
  assert.equal(new Date(e.at).toISOString(), e.at);
});

test('keepOne on a zone already kept replaces its ring (an editor save)', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  const moved = [[-149.90, 61.20], [-149.90, 61.21], [-149.88, 61.21], [-149.89, 61.20]]; // third corner lng -149.89 -> -149.88
  s.keepOne('S1', z('Z1', moved));
  const got = s.withRings('S1', [slim(Z1), slim(Z2)]);
  assert.deepEqual(got[0].ring, moved);
  assert.deepEqual(got[1].ring, R2);
});

test('keepOne with no ring writes nothing', () => {
  const st = memory();
  O.store(st).keepOne('S1', { id: 'Z9' });
  assert.equal(O.KEY in st.items, false);
});

test('changed: the same rings is false, even as fresh copies', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  assert.equal(s.changed('S1', clone([Z1, Z2])), false);
  // The set of ids is what matters, not the order the reply lists them in.
  assert.equal(s.changed('S1', clone([Z2, Z1])), false);
});

test('changed: one corner moved is true', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  const moved = clone(Z2);
  moved.ring[2][1] = 61.12; // 61.11 -> 61.12
  assert.equal(s.changed('S1', [Z1, moved]), true);
});

test('changed: a zone added is true', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  assert.equal(s.changed('S1', [Z1, Z2, Z3]), true);
});

test('changed: a zone gone is true', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, Z2]);
  assert.equal(s.changed('S1', [Z1]), true);
});

test('changed: a site never kept, with any zones, is true; with none it is false', () => {
  const st = memory();
  const s = O.store(st);
  s.keep('S2', [Z3]); // some other site is kept, which must not help S1
  assert.equal(s.changed('S1', [Z1]), true);
  assert.equal(s.changed('S1', []), false);
});

test('changed: a zone with no ring in the reply is not counted, as keep would not keep it', () => {
  const s = O.store(memory());
  s.keep('S1', [Z1, { id: 'Z9' }]);
  assert.equal(s.changed('S1', [Z1, { id: 'Z9' }]), false);
});

test('changed reads and never writes', () => {
  const st = memory();
  const s = O.store(st);
  s.keep('S1', [Z1]);
  const before = st.items[O.KEY];
  s.changed('S1', [Z1, Z2]);
  s.changed('S9', [Z3]);
  assert.equal(st.items[O.KEY], before);
});

test('forget removes the key and leaves other keys alone', () => {
  const st = memory({ 'wolf-lang': 'es' });
  const s = O.store(st);
  s.keep('S1', [Z1]);
  assert.equal(O.KEY in st.items, true);
  s.forget();
  assert.equal(O.KEY in st.items, false);
  assert.equal(st.getItem(O.KEY), null);
  assert.equal(st.items['wolf-lang'], 'es');
  assert.deepEqual(s.withRings('S1', [slim(Z1)]), []);
  assert.equal(s.changed('S1', [Z1]), true);
});

test('ids that are also Object.prototype names are not mistaken for kept rings', () => {
  const s = O.store(memory());
  s.keep('S1', [z('constructor', R1)]);
  // 'toString' and 'hasOwnProperty' exist on every object; neither was kept.
  const got = s.withRings('S1', [{ id: 'constructor' }, { id: 'toString' }, { id: 'hasOwnProperty' }]);
  assert.deepEqual(got.map((x) => x.id), ['constructor']);
  assert.equal(s.changed('S1', [z('constructor', R1)]), false);
  assert.equal(s.changed('S1', [z('constructor', R1), z('toString', R2)]), true);
  assert.deepEqual(s.withRings('constructor', [slim(Z1)]), []); // a site named like a prototype key, never kept
});

test('an id of __proto__ is an ordinary key, for a zone and for a site', () => {
  const st = memory();
  const s = O.store(st);
  s.keep('__proto__', [z('__proto__', R1), Z2]);
  // Both zones were kept under the site "__proto__": neither id was swallowed
  // as a prototype assignment.
  assert.deepEqual(s.withRings('__proto__', [slim(z('__proto__', R1)), slim(Z2)]).map((x) => x.id), ['__proto__', 'Z2']);
  assert.equal(s.changed('__proto__', [z('__proto__', R1), Z2]), false);
  assert.deepEqual(s.withRings('S1', [slim(Z2)]), []);
});

test('storage whose setItem throws: keep returns normally and nothing is kept', () => {
  const st = memory();
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  const s = O.store(st);
  assert.doesNotThrow(() => s.keep('S1', [Z1, Z2]));
  assert.doesNotThrow(() => s.keepOne('S1', Z3));
  assert.deepEqual(s.withRings('S1', [slim(Z1), slim(Z2)]), []);
  assert.equal(s.changed('S1', [Z1]), true); // nothing kept, so the reply is news
});

test('a refused write leaves the earlier copy as it was', () => {
  const st = memory();
  const s = O.store(st);
  s.keep('S1', [Z1]);
  const before = st.items[O.KEY];
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  s.keep('S1', [Z2]);
  s.keepOne('S1', Z3);
  assert.equal(st.items[O.KEY], before);
  assert.deepEqual(s.withRings('S1', [slim(Z1), slim(Z2)]), [Z1]);
});

test('unreadable JSON reads as empty, and the next keep starts a good store over it', () => {
  const st = memory({ [O.KEY]: 'not json' });
  const s = O.store(st);
  assert.deepEqual(s.withRings('S1', [slim(Z1)]), []);
  assert.equal(s.changed('S1', [Z1]), true);
  assert.equal(s.changed('S1', []), false);
  assert.doesNotThrow(() => s.keep('S1', [Z1]));
  assert.equal(raw(st).v, 1);
  assert.deepEqual(s.withRings('S1', [slim(Z1)]), [Z1]);
});

test('a store from another version, or the wrong shape, reads as empty', () => {
  const good = { S1: { at: '2026-01-01T00:00:00.000Z', rings: { Z1: R1 } } };
  const bad = [
    JSON.stringify({ v: 2 }),
    JSON.stringify({ v: 2, sites: good }),   // right shape, wrong version
    JSON.stringify({ sites: good }),         // no version
    JSON.stringify({ v: '1', sites: good }), // version is a string
    JSON.stringify({ v: 1 }),                // no sites
    JSON.stringify({ v: 1, sites: 5 }),
    JSON.stringify({ v: 1, sites: [] }),
    JSON.stringify({ v: 1, sites: { S1: 5 } }),
    JSON.stringify({ v: 1, sites: { S1: { at: 'x', rings: null } } }),
    JSON.stringify({ v: 1, sites: { S1: { at: 'x', rings: { Z1: 'not a ring' } } } }),
    'null', '5', '"text"', '[]', '',
  ];
  bad.forEach((text) => {
    const s = O.store(memory({ [O.KEY]: text }));
    assert.deepEqual(s.withRings('S1', [slim(Z1)]), [], 'withRings over ' + text);
    assert.equal(s.changed('S1', [Z1]), true, 'changed over ' + text);
    assert.doesNotThrow(() => s.keepOne('S1', Z2), 'keepOne over ' + text);
  });
  // The control: the same shape at v 1 is read.
  const ok = O.store(memory({ [O.KEY]: JSON.stringify({ v: 1, sites: good }) }));
  assert.deepEqual(ok.withRings('S1', [slim(Z1)]), [Z1]);
});

test('a storage accessor that throws: every method returns normally', () => {
  const s = O.store(() => { throw new Error('SecurityError'); });
  assert.doesNotThrow(() => s.keep('S1', [Z1]));
  assert.doesNotThrow(() => s.keepOne('S1', Z1));
  assert.doesNotThrow(() => s.forget());
  assert.deepEqual(s.withRings('S1', [slim(Z1)]), []);
  assert.equal(s.changed('S1', [Z1]), true);
  assert.equal(s.changed('S1', []), false);
});

test('a storage accessor that returns nothing is a store that is not there', () => {
  [() => null, () => undefined, () => ({})].forEach((get) => {
    const s = O.store(get);
    assert.doesNotThrow(() => s.keep('S1', [Z1]));
    assert.doesNotThrow(() => s.keepOne('S1', Z1));
    assert.doesNotThrow(() => s.forget());
    assert.deepEqual(s.withRings('S1', [slim(Z1)]), []);
    assert.equal(s.changed('S1', [Z1]), true);
  });
});

test('getItem or removeItem that throws: still returns normally', () => {
  const st = memory();
  st.getItem = () => { throw new Error('boom'); };
  st.removeItem = () => { throw new Error('boom'); };
  const s = O.store(st);
  assert.doesNotThrow(() => s.keep('S1', [Z1]));
  assert.doesNotThrow(() => s.keepOne('S1', Z1));
  assert.doesNotThrow(() => s.forget());
  assert.deepEqual(s.withRings('S1', [slim(Z1)]), []);
  assert.equal(s.changed('S1', [Z1]), true);
});

test('odd arguments do not throw', () => {
  const s = O.store(memory());
  assert.doesNotThrow(() => s.keep('S1'));
  assert.doesNotThrow(() => s.keep('S1', null));
  assert.doesNotThrow(() => s.keep('S1', [null, undefined, 5]));
  assert.doesNotThrow(() => s.keepOne('S1'));
  assert.doesNotThrow(() => s.keepOne('S1', null));
  assert.deepEqual(s.withRings('S1'), []);
  assert.deepEqual(s.withRings('S1', null), []);
  assert.deepEqual(s.withRings('S1', [null, 5]), []);
  assert.equal(s.changed('S1'), false);
});

test('the accessor is called when the store is used, not when it is made', () => {
  let calls = 0;
  const st = memory();
  const s = O.store(() => { calls++; return st; });
  assert.equal(calls, 0);
  s.keep('S1', [Z1]);
  assert.ok(calls > 0);
  // And it is asked each time: a storage that appears later is used.
  let live = null;
  const late = O.store(() => live);
  late.keep('S1', [Z1]);
  assert.deepEqual(late.withRings('S1', [slim(Z1)]), []); // nothing there yet
  live = memory();
  late.keep('S1', [Z1]);
  assert.deepEqual(late.withRings('S1', [slim(Z1)]), [Z1]);
});

test('local: loading it touches no window, and with none every method returns normally', () => {
  assert.equal(typeof window, 'undefined'); // node
  assert.doesNotThrow(() => O.local.keep('S1', [Z1]));
  assert.doesNotThrow(() => O.local.keepOne('S1', Z1));
  assert.doesNotThrow(() => O.local.forget());
  assert.deepEqual(O.local.withRings('S1', [slim(Z1)]), []);
  assert.equal(O.local.changed('S1', [Z1]), true);
});

test('local reads window.localStorage when it is used, so a window that arrives after load works', () => {
  const st = memory();
  globalThis.window = { localStorage: st };
  try {
    O.local.keep('S1', [Z1]);
    assert.equal(O.KEY in st.items, true);
    assert.deepEqual(O.local.withRings('S1', [slim(Z1)]), [Z1]);
    O.local.forget();
    assert.equal(O.KEY in st.items, false);
  } finally {
    delete globalThis.window;
  }
});

test('local: a window whose localStorage getter throws still returns normally', () => {
  const w = {};
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('SecurityError'); } });
  globalThis.window = w;
  try {
    assert.doesNotThrow(() => O.local.keep('S1', [Z1]));
    assert.deepEqual(O.local.withRings('S1', [slim(Z1)]), []);
  } finally {
    delete globalThis.window;
  }
});
