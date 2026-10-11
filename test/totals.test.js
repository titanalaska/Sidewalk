const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/totals');
const L = require('../lib/shiftlog');

// Snow-work totals for Matt's Sites tab (approved 10/10/26). Made-up sites and customers only:
// the repo is public. Every expected number is worked on paper in the comment above it.
//
// The curb tests are worked at a 4 ft curb strip (CURB_ROLLUP.widthFt), the number Matt set
// 10/8/26. If he changes it, this one test fails first and says why.
test('the curb tests below are worked at a 4 ft strip', () => {
  assert.equal(L.CURB_ROLLUP.widthFt, 4);
});

const zero = () => ({ zones: 0, sidewalk: [0, 0], heated: [0, 0], hand: [0, 0], curb: [0, 0], storage: [0, 0], no_touch: [0, 0] });
const z = (site, type, name, area, extra) => Object.assign({ id: 'Z-' + site + '-' + type + '-' + name, site_id: site, type, name, area_sqft: area }, extra || {});

// ---- siteTotals ----

test('siteTotals: one of each type, a Curb line in feet and not in hand, a plain hand zone stays hand', () => {
  const zones = [
    z('S1', 'sidewalk', 'Front walk', 1200),
    z('S1', 'sidewalk', 'Back walk', 300),
    z('S1', 'heated', 'Entry apron', 500),
    z('S1', 'hand', 'Steps', 250),
    z('S1', 'hand', 'Curb - north', 400),
    z('S1', 'storage', 'Pile area', 800),
    z('S1', 'no_touch', 'Planter', 90),
  ];
  // sidewalk 1200 + 300 = 1500 sq ft in 2 zones; heated 500 in 1; hand 250 in 1 (Steps only);
  // curb 400 / 4 = 100 ft in 1, and that 400 is NOT also in hand; storage 800 in 1; no_touch 90 in 1.
  // 2 + 1 + 1 + 1 + 1 + 1 = 7 zones.
  assert.deepEqual(T.siteTotals('S1', zones), {
    zones: 7, sidewalk: [1500, 2], heated: [500, 1], hand: [250, 1], curb: [100, 1], storage: [800, 1], no_touch: [90, 1],
  });
});

test('siteTotals: only a hand zone whose name starts with the word Curb is a curb', () => {
  const zones = [
    z('S1', 'hand', 'Curbside parking', 600),   // "Curbside": not the word Curb -> hand
    z('S1', 'hand', 'curb 3', 80),              // lower case, then a number -> curb, 80 / 4 = 20 ft
    z('S1', 'sidewalk', 'Curb cut ramp', 120),  // named Curb but a sidewalk zone -> sidewalk
    z('S1', 'heated', 'Curb heat', 60),         // named Curb but heated -> heated
  ];
  assert.deepEqual(T.siteTotals('S1', zones), {
    zones: 4, sidewalk: [120, 1], heated: [60, 1], hand: [600, 1], curb: [20, 1], storage: [0, 0], no_touch: [0, 0],
  });
});

test('siteTotals: the curb width is read from CURB_ROLLUP, not hard-coded', () => {
  const zones = [z('S1', 'hand', 'Curb - north', 400)];
  const was = L.CURB_ROLLUP.widthFt;
  try {
    L.CURB_ROLLUP.widthFt = 5;                      // 400 / 5 = 80 ft
    assert.deepEqual(T.siteTotals('S1', zones).curb, [80, 1]);
  } finally { L.CURB_ROLLUP.widthFt = was; }
  assert.deepEqual(T.siteTotals('S1', zones).curb, [100, 1]); // back at 4 ft: 400 / 4 = 100
});

test('siteTotals: another site\'s zones, archived zones and unknown types are left out', () => {
  const zones = [
    z('S1', 'sidewalk', 'Walk', 100),
    z('S2', 'sidewalk', 'Other site walk', 7000),                 // other site
    z('S1', 'heated', 'Old apron', 999, { archived: true }),      // archived
    z('S1', 'hand', 'Curb - old', 4000, { archived: true }),      // archived curb
    z('S1', 'parking', 'Lot', 777),                               // a type that does not exist: not counted anywhere
    z('S1', 'hand', 'Steps', 50, { archived: false }),            // archived: false is live
  ];
  // Live and known: sidewalk 100 (1 zone) and hand 50 (1 zone) = 2 zones.
  assert.deepEqual(T.siteTotals('S1', zones), {
    zones: 2, sidewalk: [100, 1], heated: [0, 0], hand: [50, 1], curb: [0, 0], storage: [0, 0], no_touch: [0, 0],
  });
});

test('siteTotals: no zones, or a site with none, is all zeros', () => {
  assert.deepEqual(T.siteTotals('S1', []), zero());
  assert.deepEqual(T.siteTotals('S1', undefined), zero());
  assert.deepEqual(T.siteTotals('S1', [z('S2', 'sidewalk', 'Walk', 10)]), zero());
});

test('siteTotals: an area that is missing, 0, negative or not a number counts 0 (zone and sq ft)', () => {
  const bad = [
    z('S1', 'hand', 'No area', undefined),
    z('S1', 'hand', 'Zero', 0),
    z('S1', 'hand', 'Negative', -50),
    z('S1', 'hand', 'Words', 'abc'),
    z('S1', 'hand', 'Not a number', NaN),
    z('S1', 'hand', 'Infinite', Infinity),
    z('S1', 'hand', 'Null', null),
    z('S1', 'hand', 'Yes', true),
    z('S1', 'hand', 'List', [5]),
    z('S1', 'hand', 'Curb - none', undefined),
    z('S1', 'hand', 'Curb - zero', 0),
    z('S1', 'hand', 'Curb - negative', -40),
  ];
  // None of the twelve has a usable area, so none adds sq ft, feet, or a zone to any bucket.
  assert.deepEqual(T.siteTotals('S1', bad), zero());
  // One good zone among them counts exactly itself.
  assert.deepEqual(T.siteTotals('S1', bad.concat([z('S1', 'hand', 'Good', 75)])),
    Object.assign(zero(), { zones: 1, hand: [75, 1] }));
});

test('siteTotals: a numeric STRING area counts 0 (the server always sends numbers; a string means something is wrong)', () => {
  // Decided 10/10/26: only a real number counts. "250" must not slip in as 250, and true/[5]
  // must not coerce to 1/5 the way Number() would.
  assert.deepEqual(T.siteTotals('S1', [z('S1', 'hand', 'Steps', '250'), z('S1', 'hand', 'Curb - x', '400')]), zero());
});

test('siteTotals: sums unrounded and rounds once at the end', () => {
  // Three curb zones of 10 sq ft: 10 / 4 = 2.5 ft each, 7.5 ft together, rounded ONCE -> 8.
  // (Rounding each zone first gives 3 + 3 + 3 = 9.)
  const curbs = [z('S1', 'hand', 'Curb 1', 10), z('S1', 'hand', 'Curb 2', 10), z('S1', 'hand', 'Curb 3', 10)];
  assert.deepEqual(T.siteTotals('S1', curbs).curb, [8, 3]);
  // Three sidewalk zones of 0.4 sq ft: 1.2 together -> 1. (Per zone each rounds to 0, total 0.)
  const bits = [z('S1', 'sidewalk', 'a', 0.4), z('S1', 'sidewalk', 'b', 0.4), z('S1', 'sidewalk', 'c', 0.4)];
  assert.deepEqual(T.siteTotals('S1', bits).sidewalk, [1, 3]);
  // Four sidewalk zones of 0.4: 1.6 -> 2.
  assert.deepEqual(T.siteTotals('S1', bits.concat([z('S1', 'sidewalk', 'd', 0.4)])).sidewalk, [2, 4]);
});

// ---- add ----

test('add: sums every amount and count, and an empty Totals changes nothing', () => {
  const a = { zones: 3, sidewalk: [1500, 2], heated: [0, 0], hand: [100, 1], curb: [50, 1], storage: [0, 0], no_touch: [0, 0] };
  const b = { zones: 2, sidewalk: [20, 1], heated: [300, 1], hand: [0, 0], curb: [8, 1], storage: [0, 0], no_touch: [0, 0] };
  // sidewalk 1500+20=1520 in 2+1=3; heated 300 in 1; hand 100 in 1; curb 50+8=58 in 1+1=2; zones 3+2=5.
  assert.deepEqual(T.add(a, b), { zones: 5, sidewalk: [1520, 3], heated: [300, 1], hand: [100, 1], curb: [58, 2], storage: [0, 0], no_touch: [0, 0] });
  assert.deepEqual(T.add(a, zero()), a);
  assert.deepEqual(T.add(zero(), a), a);
  assert.deepEqual(T.add(a, undefined), a);
  assert.deepEqual(T.add(undefined, undefined), zero());
});

test('add: rounds the sum once (whole numbers in, whole numbers out), and returns a new object', () => {
  // Given amounts that are not whole, the sum is rounded once: 2.4 + 2.4 = 4.8 -> 5 (not 2 + 2 = 4).
  const half = Object.assign(zero(), { zones: 1, hand: [2.4, 1] });
  assert.deepEqual(T.add(half, half).hand, [5, 2]);
  const a = Object.assign(zero(), { zones: 1, hand: [10, 1] });
  const out = T.add(a, zero());
  out.hand[0] = 999;
  assert.deepEqual(a.hand, [10, 1]); // the result does not share arrays with its inputs
});

// ---- byCustomer and all ----

const sites = [
  { id: 'S10', name: 'Zeta lot', customer: 'beta' },
  { id: 'S11', name: 'Mid', customer: 'Alpha' },
  { id: 'S12', name: 'Able', customer: 'Alpha' },
  { id: 'S13', name: 'Loose end', customer: '' },
  { id: 'S14', name: 'Another' },                               // no customer field at all
  { id: 'S15', name: 'Apex', customer: '  beta ' },             // padded: trims to beta
  { id: 'S16', name: 'Archived lot', customer: 'Alpha', archived: true },
  { id: 'S17', name: 'Gone yard', customer: 'Gamma', archived: true }, // its only site is archived: no Gamma group
  { id: 'S18', name: 'Delta yard', customer: 'Charlie' },
];
const zones = [
  z('S11', 'sidewalk', 'Walk', 1000),
  z('S12', 'sidewalk', 'Walk', 500),
  z('S12', 'hand', 'Curb 1', 200),
  z('S10', 'heated', 'Apron', 300),
  z('S15', 'hand', 'Steps', 100),
  z('S18', 'storage', 'Pile', 700),
  z('S13', 'no_touch', 'Planter', 40),
  z('S16', 'sidewalk', 'Walk', 9999),    // archived site
  z('S17', 'sidewalk', 'Walk', 8888),    // archived site
  z('S99', 'sidewalk', 'Walk', 5000),    // a site that is not in the list
];

test('byCustomer: customers A-Z ignoring case, blank last; sites A-Z inside', () => {
  const out = T.byCustomer(sites, zones);
  // Ignoring case: Alpha, beta, Charlie. (By raw character codes Charlie would come before beta.)
  // The blank customer (an empty string, a missing field) comes after all of them.
  assert.deepEqual(out.map((g) => g.customer), ['Alpha', 'beta', 'Charlie', '']);
  assert.deepEqual(out.map((g) => g.sites.map((s) => s.name)), [
    ['Able', 'Mid'], ['Apex', 'Zeta lot'], ['Delta yard'], ['Another', 'Loose end'],
  ]);
  assert.deepEqual(out.map((g) => g.sites.map((s) => s.id)), [['S12', 'S11'], ['S15', 'S10'], ['S18'], ['S14', 'S13']]);
});

test('byCustomer: each site and each customer carries its own Totals; archived sites are out', () => {
  const out = T.byCustomer(sites, zones);
  const by = {};
  out.forEach((g) => { by[g.customer] = g; });
  // Able: sidewalk 500 (1), Curb 1 is 200 / 4 = 50 ft (1); 2 zones. Mid: sidewalk 1000 (1).
  assert.deepEqual(by.Alpha.sites[0].totals, Object.assign(zero(), { zones: 2, sidewalk: [500, 1], curb: [50, 1] }));
  assert.deepEqual(by.Alpha.sites[1].totals, Object.assign(zero(), { zones: 1, sidewalk: [1000, 1] }));
  // Alpha together: sidewalk 500 + 1000 = 1500 in 2, curb 50 in 1, 3 zones. The archived Alpha site's 9999 is not in it.
  assert.deepEqual(by.Alpha.totals, Object.assign(zero(), { zones: 3, sidewalk: [1500, 2], curb: [50, 1] }));
  // beta: Apex hand 100 (1) + Zeta lot heated 300 (1) = 2 zones.
  assert.deepEqual(by.beta.totals, Object.assign(zero(), { zones: 2, hand: [100, 1], heated: [300, 1] }));
  assert.deepEqual(by.Charlie.totals, Object.assign(zero(), { zones: 1, storage: [700, 1] }));
  // Blank: Another has no zones, Loose end has no_touch 40 (1).
  assert.deepEqual(by[''].sites[0].totals, zero());
  assert.deepEqual(by[''].totals, Object.assign(zero(), { zones: 1, no_touch: [40, 1] }));
  // An archived site is in no group; Gamma, whose only site is archived, has no group at all.
  assert.equal(by.Gamma, undefined);
  assert.deepEqual(out.map((g) => g.sites.length), [2, 2, 1, 2]);
});

test('byCustomer: groups by the trimmed name, exactly as the Sites tab does, and a customer called constructor is safe', () => {
  const odd = [
    { id: 'A', name: 'One', customer: 'constructor' },
    { id: 'B', name: 'Two', customer: 'constructor ' },
    { id: 'C', name: 'Three', customer: '__proto__' },
  ];
  const out = T.byCustomer(odd, []);
  assert.deepEqual(out.map((g) => [g.customer, g.sites.map((s) => s.id)]), [['__proto__', ['C']], ['constructor', ['A', 'B']]]);
});

test('byCustomer: no live sites gives no groups', () => {
  assert.deepEqual(T.byCustomer([], zones), []);
  assert.deepEqual(T.byCustomer(undefined, undefined), []);
  assert.deepEqual(T.byCustomer([{ id: 'X', name: 'X', archived: true }], zones), []);
});

test('all: every live site\'s zones, no archived site, no zone of an unknown site', () => {
  // Live sites' zones: sidewalk 1000 + 500 = 1500 (2); hand: Steps 100 (1); curb 200 / 4 = 50 (1);
  // heated 300 (1); storage 700 (1); no_touch 40 (1). Zones 2 + 1 + 1 + 1 + 1 + 1 = 7.
  // Not counted: 9999 and 8888 (archived sites), 5000 (site S99 is not in the list).
  assert.deepEqual(T.all(sites, zones), {
    zones: 7, sidewalk: [1500, 2], heated: [300, 1], hand: [100, 1], curb: [50, 1], storage: [700, 1], no_touch: [40, 1],
  });
  assert.deepEqual(T.all([], zones), zero());
  assert.deepEqual(T.all(undefined, undefined), zero());
});

test('rounding across levels: each level rounds its own raw sum once, never a sum of rounded parts', () => {
  // Three sites of one customer, each with one curb zone of 10 sq ft = 2.5 ft.
  const ss = [{ id: 'R1', name: 'R1', customer: 'Round' }, { id: 'R2', name: 'R2', customer: 'Round' }, { id: 'R3', name: 'R3', customer: 'Round' }];
  const zs = [z('R1', 'hand', 'Curb a', 10), z('R2', 'hand', 'Curb a', 10), z('R3', 'hand', 'Curb a', 10)];
  const out = T.byCustomer(ss, zs);
  // Each site: 2.5 ft rounds to 3. The customer: 7.5 ft rounds to 8 (the three rounded rows add to 9).
  // The shown rows may not add to the shown total by 1; the total is the one that matches the zones.
  assert.deepEqual(out[0].sites.map((s) => s.totals.curb), [[3, 1], [3, 1], [3, 1]]);
  assert.deepEqual(out[0].totals.curb, [8, 3]);
  assert.deepEqual(T.all(ss, zs).curb, [8, 3]);
  // Adding the rounded site Totals with add() is the thing NOT to do for this: 3 + 3 + 3.
  assert.deepEqual(out[0].sites.map((s) => s.totals).reduce(T.add).curb, [9, 3]);
});

// ---- line ----

test('line: every bucket, in order, sq ft named once after the first number', () => {
  const t = { zones: 40, sidewalk: [19103, 12], heated: [11626, 8], hand: [27021, 15], curb: [1739, 9], storage: [1600, 2], no_touch: [184, 1] };
  assert.equal(T.line(t), 'Sidewalk 19,103 sq ft · Heated 11,626 · Hand 27,021 · Curbs 1,739 ft · Storage 1,600 · No-touch 184');
});

test('line: zero buckets are left out, and the first area figure carries the sq ft', () => {
  const heatedCurbNo = { zones: 3, sidewalk: [0, 0], heated: [11626, 2], hand: [0, 0], curb: [1739, 1], storage: [0, 0], no_touch: [184, 1] };
  assert.equal(T.line(heatedCurbNo), 'Heated 11,626 sq ft · Curbs 1,739 ft · No-touch 184');
  const sidewalkOnly = Object.assign(zero(), { zones: 1, sidewalk: [950, 1] });
  assert.equal(T.line(sidewalkOnly), 'Sidewalk 950 sq ft');
  // Curbs are feet, so they never carry "sq ft"; the first area bucket after them does.
  const curbThenStorage = Object.assign(zero(), { zones: 3, curb: [90, 1], storage: [1600, 1], no_touch: [12, 1] });
  assert.equal(T.line(curbThenStorage), 'Curbs 90 ft · Storage 1,600 sq ft · No-touch 12');
  const curbOnly = Object.assign(zero(), { zones: 1, curb: [90, 1] });
  assert.equal(T.line(curbOnly), 'Curbs 90 ft');
});

test('line: thousands separators at every size', () => {
  const one = (n) => T.line(Object.assign(zero(), { zones: 1, hand: [n, 1] }));
  assert.equal(one(5), 'Hand 5 sq ft');
  assert.equal(one(999), 'Hand 999 sq ft');
  assert.equal(one(1000), 'Hand 1,000 sq ft');
  assert.equal(one(12345), 'Hand 12,345 sq ft');
  assert.equal(one(1234567), 'Hand 1,234,567 sq ft');
});

test('line: nothing to list says No zones yet', () => {
  assert.equal(T.line(zero()), 'No zones yet');
  assert.equal(T.line(undefined), 'No zones yet');
  assert.equal(T.line(null), 'No zones yet');
  assert.equal(T.line(T.siteTotals('S1', [])), 'No zones yet');
});

test('line: a real site through siteTotals', () => {
  const zs = [z('S1', 'sidewalk', 'Walk', 1200), z('S1', 'sidewalk', 'Walk 2', 300), z('S1', 'hand', 'Curb - a', 400), z('S1', 'hand', 'Curb - b', 322), z('S1', 'no_touch', 'Bed', 90)];
  // sidewalk 1500; curb (400 + 322) / 4 = 180.5 -> 181 (Math.round, half up); no_touch 90.
  assert.equal(T.line(T.siteTotals('S1', zs)), 'Sidewalk 1,500 sq ft · Curbs 181 ft · No-touch 90');
});

// ---- the inputs are never changed ----

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); }
  return o;
}

test('no function changes what it is given', () => {
  const s = JSON.parse(JSON.stringify(sites));
  const zs = JSON.parse(JSON.stringify(zones));
  const sBefore = JSON.stringify(s), zBefore = JSON.stringify(zs);
  const a = T.siteTotals('S12', zs), b = T.siteTotals('S11', zs);
  const aBefore = JSON.stringify(a), bBefore = JSON.stringify(b);
  deepFreeze(s); deepFreeze(zs); deepFreeze(a); deepFreeze(b);
  // Frozen inputs throw on any write (lib/totals.js is strict mode).
  T.siteTotals('S12', zs); T.add(a, b); T.byCustomer(s, zs); T.all(s, zs); T.line(a);
  assert.equal(JSON.stringify(s), sBefore);
  assert.equal(JSON.stringify(zs), zBefore);
  assert.equal(JSON.stringify(a), aBefore);
  assert.equal(JSON.stringify(b), bBefore);
});

test('results do not share objects: changing one result leaves the others alone', () => {
  const out = T.byCustomer(sites, zones);
  const first = JSON.stringify(T.byCustomer(sites, zones));
  out[0].totals.sidewalk[0] = 123456;
  out[0].sites[0].totals.curb[0] = 654321;
  assert.notEqual(JSON.stringify(out), first);
  assert.equal(JSON.stringify(T.byCustomer(sites, zones)), first);
  const e1 = T.siteTotals('S404', []), e2 = T.siteTotals('S404', []);
  e1.hand[0] = 5;
  assert.deepEqual(e2, zero());
});
