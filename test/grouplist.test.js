// SnowGroupList (list break-up, 11/15/26): the one place the Sites tab and the route editor's
// "Add sites" view decide which sites show, under which customer heading, with or without letter
// rows, what a customer button counts, and what a tick list does. lib/grouplist.js is pure.
//
// Expected values are worked out on paper in the comments from the rules, never copied from what
// the code returned.
//
// The fixture (ids have gaps and the order is scrambled on purpose, so nothing can lean on id
// order or array position):
//   S9 "Zeta"       customer ANTHC, address "1 Main St"
//   S2 "alpha"      ANTHC; lower case on purpose: A to Z must ignore case
//   S5 "4001 Tudor" ANTHC; starts with a digit: the # bucket, listed first
//   S4 "Delta"      customer " ANTHC " (padded): the same customer once trimmed
//   S7 "Beta"       MOA, address "200 Muldoon Rd"
//   S3 "Gamma"      no customer
//   S8 "Epsilon"    MOA but ARCHIVED: never shown, never counted
// Live sites: 6. ANTHC 4, MOA 1, no customer 1.
//   ANTHC by name, ignoring case, # first: 4001 Tudor, alpha, Delta, Zeta.
const test = require('node:test');
const assert = require('node:assert/strict');
const SnowGroupList = require('../lib/grouplist.js');

const mk = () => [
  { id: 'S9', name: 'Zeta', customer: 'ANTHC', address: '1 Main St' },
  { id: 'S2', name: 'alpha', customer: 'ANTHC' },
  { id: 'S5', name: '4001 Tudor', customer: 'ANTHC' },
  { id: 'S4', name: 'Delta', customer: ' ANTHC ' },
  { id: 'S7', name: 'Beta', customer: 'MOA', address: '200 Muldoon Rd' },
  { id: 'S3', name: 'Gamma' },
  { id: 'S8', name: 'Epsilon', customer: 'MOA', archived: true },
];

const keys = (r) => r.groups.map((g) => g.key);
const siteNames = (g) => g.items.filter((i) => i.site).map((i) => i.site.name);
const counts = (r) => r.chips.map((c) => c.count);
const rowWords = (g) => g.items.map((i) => (i.site ? i.site.name : i.letter));

// n live ANTHC sites: even numbers "Alpha NN", odd numbers "Bravo NN" (two letters, sorted by the
// padded number inside each).
const many = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 'M' + i, name: (i % 2 ? 'Bravo ' : 'Alpha ') + String(i).padStart(2, '0'), customer: 'ANTHC' });
  return out;
};

test('no options: customers A to Z with none last, sites by name ignoring case with # first, archived left out', () => {
  const r = SnowGroupList.group(mk());
  assert.deepEqual(keys(r), ['ANTHC', 'MOA', '']);
  assert.deepEqual(r.groups.map((g) => g.label), ['ANTHC', 'MOA', 'No customer yet']);
  // 4001 Tudor first (digit = # bucket), then alpha, Delta, Zeta: a plain code-unit sort would put
  // Delta, Zeta, then alpha last, so only a real ignore-case sort gives this order.
  assert.deepEqual(siteNames(r.groups[0]), ['4001 Tudor', 'alpha', 'Delta', 'Zeta']);
  assert.equal(r.groups[0].showing, 4);
  assert.equal(r.groups[0].lettered, false);
  // No letter rows when not lettered: every item is a site.
  assert.ok(r.groups[0].items.every((i) => i.site && !('letter' in i)));
  assert.deepEqual(siteNames(r.groups[1]), ['Beta']);
  assert.deepEqual(siteNames(r.groups[2]), ['Gamma']);
  assert.deepEqual(r.groups.map((g) => g.showing), [4, 1, 1]);
  // The same order and labels on the buttons; Epsilon (archived) is not in MOA's 1.
  assert.deepEqual(r.chips, [
    { key: 'ANTHC', label: 'ANTHC', count: 4 },
    { key: 'MOA', label: 'MOA', count: 1 },
    { key: '', label: 'No customer yet', count: 1 },
  ]);
  assert.equal(r.total, 6);
  assert.equal(r.matched, 6);
});

test('the items hold the caller\'s own site objects', () => {
  const sites = mk();
  const r = SnowGroupList.group(sites);
  assert.equal(r.groups[1].items[0].site, sites[4]); // Beta is S7, the fifth in the list
});

test('customers sort A to Z by localeCompare ignoring case, none last; a customer with only archived sites has no group and no button', () => {
  const sites = [
    { id: 'A1', name: 'One', customer: 'zeta co' },
    { id: 'A2', name: 'Two', customer: 'alpha co' },
    { id: 'A3', name: 'Three' },
    { id: 'A4', name: 'Four', customer: 'Beta Co' },
    { id: 'A5', name: 'Five', customer: 'Old Co', archived: true },
  ];
  // alpha co, Beta Co, zeta co. A code-unit sort puts capitals first (Beta Co, alpha co, zeta co), so
  // the mixed case is what proves the ignore-case rule. None last. Old Co is archived only: absent.
  const r = SnowGroupList.group(sites);
  assert.deepEqual(keys(r), ['alpha co', 'Beta Co', 'zeta co', '']);
  assert.deepEqual(r.chips.map((c) => c.key), ['alpha co', 'Beta Co', 'zeta co', '']);
  assert.equal(r.total, 4);
});

test('letterMin 3: ANTHC (4 showing) gets letter rows, # first; MOA (1) and none (1) do not', () => {
  const r = SnowGroupList.group(mk(), { letterMin: 3 });
  assert.equal(r.groups[0].lettered, true);
  // # (4001 Tudor), A (alpha), D (Delta), Z (Zeta): letters upper case even for "alpha".
  assert.deepEqual(rowWords(r.groups[0]), ['#', '4001 Tudor', 'A', 'alpha', 'D', 'Delta', 'Z', 'Zeta']);
  assert.equal(r.groups[0].showing, 4, 'letter rows are not sites');
  assert.equal(r.groups[1].lettered, false);
  assert.equal(r.groups[2].lettered, false);
  assert.deepEqual(r.groups[1].items.map((i) => i.site.name), ['Beta']);
});

test('letter rows need MORE THAN letterMin sites: 4 showing with letterMin 4 is not lettered', () => {
  const r = SnowGroupList.group(mk(), { letterMin: 4 });
  assert.equal(r.groups[0].lettered, false);
  assert.equal(r.groups[0].items.length, 4);
});

test('the default letterMin is 12: 12 sites showing are plain, 13 get letter rows', () => {
  const r12 = SnowGroupList.group(many(12));
  assert.equal(r12.groups[0].showing, 12);
  assert.equal(r12.groups[0].lettered, false);
  assert.equal(r12.groups[0].items.length, 12);
  // 13 sites: i = 0..12, even i is Alpha (0, 2, 4, 6, 8, 10, 12 = 7), odd is Bravo (1, 3, 5, 7, 9, 11 = 6).
  // Rows: A, 7 Alpha, B, 6 Bravo = 15.
  const r13 = SnowGroupList.group(many(13));
  assert.equal(r13.groups[0].showing, 13);
  assert.equal(r13.groups[0].lettered, true);
  assert.equal(r13.groups[0].items.length, 15);
  assert.deepEqual(r13.groups[0].items.filter((i) => 'letter' in i).map((i) => i.letter), ['A', 'B']);
  assert.equal(r13.groups[0].items[0].letter, 'A');
  assert.equal(r13.groups[0].items[8].letter, 'B');
  assert.equal(r13.groups[0].items[1].site.name, 'Alpha 00');
  assert.equal(r13.groups[0].items[14].site.name, 'Bravo 11');
});

test('the letter count follows what is SHOWING, not the customer\'s whole list', () => {
  // 13 ANTHC sites; searching "Alpha" leaves 7 showing, so no letter rows (7 is not more than 12).
  const r = SnowGroupList.group(many(13), { query: 'alpha' });
  assert.equal(r.groups[0].showing, 7);
  assert.equal(r.groups[0].lettered, false);
  assert.equal(r.chips[0].count, 13, 'the button still counts all 13');
});

test('names that start with a digit or punctuation (or have no name) go under #, listed first, then letters', () => {
  const sites = [
    { id: 'B1', name: 'beta', customer: 'X' },
    { id: 'B2', name: '9 Depot', customer: 'X' },
    { id: 'B3', name: '(Old) Annex', customer: 'X' },
    { id: 'B4', customer: 'X' },
  ];
  // letterMin 0: any showing site means letter rows. # holds the three that do not start with a
  // letter: "(Old) Annex" and "9 Depot" (punctuation sorts before digits) and the nameless one.
  // A nameless site compares as "" which sorts before both. Then B for "beta".
  const r = SnowGroupList.group(sites, { letterMin: 0 });
  const words = r.groups[0].items.map((i) => (i.letter ? i.letter : (i.site.name || '(no name)')));
  assert.deepEqual(words, ['#', '(no name)', '(Old) Annex', '9 Depot', 'B', 'beta']);
});

test('query: matches the name or the address, case-insensitive, trimmed; the buttons do not move', () => {
  const r = SnowGroupList.group(mk(), { query: 'main' });
  // "main" is only in Zeta's address "1 Main St".
  assert.deepEqual(keys(r), ['ANTHC']);
  assert.deepEqual(siteNames(r.groups[0]), ['Zeta']);
  assert.equal(r.groups[0].showing, 1);
  assert.equal(r.matched, 1);
  assert.equal(r.total, 6);
  // The buttons count every site not on the route, whatever the search says.
  assert.deepEqual(counts(r), [4, 1, 1]);
  assert.deepEqual(r.chips.map((c) => c.key), ['ANTHC', 'MOA', '']);

  // Trim and case: "  ALPHA " finds alpha.
  const a = SnowGroupList.group(mk(), { query: '  ALPHA ' });
  assert.deepEqual(a.groups.map(siteNames), [['alpha']]);
  assert.equal(a.matched, 1);

  // The address of the MOA site, mixed case.
  const m = SnowGroupList.group(mk(), { query: 'MuLdOoN' });
  assert.deepEqual(keys(m), ['MOA']);
  assert.deepEqual(siteNames(m.groups[0]), ['Beta']);
});

test('query: a part of a name matches anywhere in it, and the customer\'s own name is not searched', () => {
  // "ta" is in Zeta, Delta, Beta (names), and in "4001 Tudor"? T-u-d-o-r: no. "alpha": no.
  // Gamma: no. Address "1 Main St": "St" is s-t, not "ta". "200 Muldoon Rd": no.
  const r = SnowGroupList.group(mk(), { query: 'ta' });
  assert.deepEqual(r.groups.map((g) => [g.key, siteNames(g)]), [['ANTHC', ['Delta', 'Zeta']], ['MOA', ['Beta']]]);
  assert.equal(r.matched, 3);
  // ANTHC and MOA are customers, not site names or addresses: nothing matches.
  assert.equal(SnowGroupList.group(mk(), { query: 'anthc' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: 'moa' }).matched, 0);
});

test('query: spaces only is no search; text with no match finds nothing and the buttons stay', () => {
  assert.equal(SnowGroupList.group(mk(), { query: '   ' }).matched, 6);
  assert.equal(SnowGroupList.group(mk(), { query: '' }).matched, 6);
  assert.equal(SnowGroupList.group(mk(), { query: '\t \n' }).matched, 6);
  const none = SnowGroupList.group(mk(), { query: 'zzz' });
  assert.deepEqual(none.groups, []);
  assert.equal(none.matched, 0);
  assert.equal(none.total, 6);
  assert.deepEqual(counts(none), [4, 1, 1]);
});

test('query is plain text, never a pattern: "." and "(" find nothing here', () => {
  // None of the fixture's names or addresses holds a dot or a bracket. As a pattern "." would match
  // every site and "(" would throw, so zero is the only right answer.
  assert.equal(SnowGroupList.group(mk(), { query: '.' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: '(' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: '*' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: '[' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: '\\' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: '.*' }).matched, 0);
});

test('query: ". ( ) * [" match only themselves when a name really has them', () => {
  const sites = [
    { id: 'P1', name: 'Lot (East) 1.5', customer: 'X' },
    { id: 'P2', name: 'Star * Lot', customer: 'X' },
    { id: 'P3', name: 'Plain Lot', address: '12 Oak Rd', customer: 'X' },
  ];
  const ids = (q) => SnowGroupList.group(sites, { query: q }).groups.map((g) => g.items.map((i) => i.site.id)).flat();
  assert.deepEqual(ids('.'), ['P1']);        // only P1 has a dot; as a pattern it would match all three
  assert.deepEqual(ids('('), ['P1']);
  assert.deepEqual(ids(')'), ['P1']);
  assert.deepEqual(ids('*'), ['P2']);
  assert.deepEqual(ids('1.5'), ['P1']);
  assert.deepEqual(ids('1x5'), []);          // as a pattern "1.5" would match "1x5"; as text it does not
  assert.deepEqual(ids('.*'), []);           // as a pattern it matches everything; as text, nothing
  assert.deepEqual(ids('lot (east'), ['P1']);
});

test('query: a site with no address is not found by the words "undefined" or "null"', () => {
  assert.equal(SnowGroupList.group(mk(), { query: 'undefined' }).matched, 0);
  assert.equal(SnowGroupList.group(mk(), { query: 'null' }).matched, 0);
});

test('archived sites are never shown, found or counted', () => {
  const r = SnowGroupList.group(mk(), { query: 'epsilon' });
  assert.deepEqual(r.groups, []);
  assert.equal(r.matched, 0);
  // And not with a customer filter either: MOA shows only Beta, never Epsilon.
  const moa = SnowGroupList.group(mk(), { customer: 'MOA' });
  assert.deepEqual(moa.groups.map(siteNames), [['Beta']]);
  assert.equal(moa.chips.find((c) => c.key === 'MOA').count, 1);
  assert.equal(SnowGroupList.group(mk()).total, 6, '7 sites, 1 archived');
});

test('customer: a name shows only that customer, "" only the sites with none, null/undefined all', () => {
  const moa = SnowGroupList.group(mk(), { customer: 'MOA' });
  assert.deepEqual(keys(moa), ['MOA']);
  assert.deepEqual(siteNames(moa.groups[0]), ['Beta']);
  assert.equal(moa.matched, 1);
  // The buttons and the total do not narrow with the filter: you can still switch.
  assert.equal(moa.total, 6);
  assert.deepEqual(counts(moa), [4, 1, 1]);

  const none = SnowGroupList.group(mk(), { customer: '' });
  assert.deepEqual(keys(none), ['']);
  assert.deepEqual(siteNames(none.groups[0]), ['Gamma']);
  assert.equal(none.matched, 1);

  assert.equal(SnowGroupList.group(mk(), { customer: null }).matched, 6);
  assert.equal(SnowGroupList.group(mk(), { customer: undefined }).matched, 6);
  assert.equal(SnowGroupList.group(mk(), {}).matched, 6);

  const nobody = SnowGroupList.group(mk(), { customer: 'NOBODY' });
  assert.deepEqual(nobody.groups, []);
  assert.equal(nobody.matched, 0);
});

test('customer and query together: both must hold', () => {
  const r = SnowGroupList.group(mk(), { customer: 'ANTHC', query: 'main' });
  assert.deepEqual(r.groups.map(siteNames), [['Zeta']]);
  // "muldoon" is MOA's address, so under ANTHC it finds nothing.
  assert.equal(SnowGroupList.group(mk(), { customer: 'ANTHC', query: 'muldoon' }).matched, 0);
});

test('exclude: sites already on the route drop out of the list, the button counts and the total', () => {
  // S2 alpha and S9 Zeta are on the route: ANTHC keeps 4001 Tudor and Delta.
  const r = SnowGroupList.group(mk(), { exclude: ['S2', 'S9'] });
  assert.deepEqual(siteNames(r.groups[0]), ['4001 Tudor', 'Delta']);
  assert.equal(r.groups[0].showing, 2);
  assert.deepEqual(r.chips.find((c) => c.key === 'ANTHC'), { key: 'ANTHC', label: 'ANTHC', count: 2 });
  assert.equal(r.total, 4, '6 live minus 2 on the route');
  assert.equal(r.matched, 4);
});

test('exclude: a customer whose every site is on the route has no group and no button', () => {
  const r = SnowGroupList.group(mk(), { exclude: ['S7'] });
  assert.deepEqual(keys(r), ['ANTHC', '']);
  assert.deepEqual(r.chips.map((c) => c.key), ['ANTHC', '']);
  assert.equal(r.total, 5);
});

test('exclude: every site on the route leaves nothing and total 0 (the caller says "Every site is already on this route.")', () => {
  const r = SnowGroupList.group(mk(), { exclude: ['S9', 'S2', 'S5', 'S4', 'S7', 'S3'] });
  assert.deepEqual(r.groups, []);
  assert.deepEqual(r.chips, []);
  assert.equal(r.total, 0);
  assert.equal(r.matched, 0);
});

test('exclude: an id that is no site is ignored; an excluded site is not found by a search; the buttons skip it with a query on', () => {
  assert.equal(SnowGroupList.group(mk(), { exclude: ['S99'] }).total, 6);
  assert.equal(SnowGroupList.group(mk(), { exclude: ['S9'], query: 'main' }).matched, 0);
  // Zeta (S9) is on the route, "alpha" searched: one site shows; the button counts the 3 ANTHC
  // sites left (not 4, not 1) because it ignores the query but not the route.
  const r = SnowGroupList.group(mk(), { exclude: ['S9'], query: 'alpha' });
  assert.equal(r.matched, 1);
  assert.equal(r.total, 5);
  assert.equal(r.chips[0].count, 3);
});

test('no sites at all: nothing, total 0', () => {
  for (const input of [[], null, undefined]) {
    const r = SnowGroupList.group(input);
    assert.deepEqual(r.groups, []);
    assert.deepEqual(r.chips, []);
    assert.equal(r.total, 0);
    assert.equal(r.matched, 0);
  }
});

test('one site with no customer: one group and ONE chip (the caller shows no buttons for a single chip)', () => {
  const r = SnowGroupList.group([{ id: 'Q1', name: 'Solo' }]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].key, '');
  assert.equal(r.groups[0].label, 'No customer yet');
  assert.equal(r.chips.length, 1);
  assert.deepEqual(r.chips[0], { key: '', label: 'No customer yet', count: 1 });
  assert.equal(r.total, 1);
});

test('group never changes what it is given', () => {
  const freeze = (o) => { Object.freeze(o); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') freeze(o[k]); return o; };
  const sites = freeze(mk());
  const opts = freeze({ query: ' a ', customer: 'ANTHC', exclude: ['S9'], letterMin: 1 });
  const before = JSON.stringify(sites);
  // Sorting the caller's array in place would throw on a frozen one.
  const r = SnowGroupList.group(sites, opts);
  assert.ok(r.groups.length > 0);
  assert.equal(JSON.stringify(sites), before);
  assert.equal(sites[0].id, 'S9', 'still in the caller\'s order');
});

test('tick: adds the ids not yet ticked, at the end, in the order given', () => {
  assert.deepEqual(SnowGroupList.tick([], ['S2', 'S9']), ['S2', 'S9']);
  // S2 is already ticked and keeps its place; S5 is new and goes last.
  assert.deepEqual(SnowGroupList.tick(['S9', 'S2'], ['S2', 'S5']), ['S9', 'S2', 'S5']);
  // The same id twice in one call is one tick.
  assert.deepEqual(SnowGroupList.tick(['S9'], ['S2', 'S2']), ['S9', 'S2']);
  assert.deepEqual(SnowGroupList.tick(['S9'], []), ['S9']);
});

test('untick: takes the ids out and keeps the order of the rest', () => {
  assert.deepEqual(SnowGroupList.untick(['S9', 'S2', 'S5'], ['S2']), ['S9', 'S5']);
  assert.deepEqual(SnowGroupList.untick(['S9', 'S2', 'S5'], ['S5', 'S9']), ['S2']);
  assert.deepEqual(SnowGroupList.untick(['S9', 'S2'], ['S99']), ['S9', 'S2'], 'an id that is not ticked changes nothing');
  assert.deepEqual(SnowGroupList.untick([], ['S2']), []);
});

test('hidden: how many ticks are not among the ids shown', () => {
  // Ticked S9, S2, S5; only S2 is on screen: S9 and S5 are hidden.
  assert.equal(SnowGroupList.hidden(['S9', 'S2', 'S5'], ['S2']), 2);
  // All ticks showing: none hidden (more shown than ticked).
  assert.equal(SnowGroupList.hidden(['S9', 'S2'], ['S9', 'S2', 'S5']), 0);
  assert.equal(SnowGroupList.hidden([], ['S2']), 0);
  // Nothing shown (a search with no match): every tick is hidden.
  assert.equal(SnowGroupList.hidden(['S9', 'S2'], []), 2);
});

test('tick, untick and hidden never change the arrays they are given and answer a new one', () => {
  const ticks = Object.freeze(['S9', 'S2', 'S5']);
  const ids = Object.freeze(['S2', 'S7']);
  const t = SnowGroupList.tick(ticks, ids);
  assert.deepEqual(t, ['S9', 'S2', 'S5', 'S7']);
  assert.notEqual(t, ticks);
  const u = SnowGroupList.untick(ticks, ids);
  assert.deepEqual(u, ['S9', 'S5']);
  assert.notEqual(u, ticks);
  assert.equal(SnowGroupList.hidden(ticks, ids), 2);
  assert.deepEqual(ticks, ['S9', 'S2', 'S5']);
  assert.deepEqual(ids, ['S2', 'S7']);
  // Nothing to add still answers a new array, so a caller can always keep the result.
  assert.notEqual(SnowGroupList.tick(ticks, []), ticks);
});

// ---- people (Roster search, 11/19/26): who shows on Matt's Roster, in what order, with which
// letter rows. Expected values are worked out on paper from the rule, never from the code.
//
// The fixture (ids gapped and scrambled on purpose; `place` is what the test's placeOf answers):
//   P7 "Zoe Adams"         phone "(907) 555-0123"  place "Route 2 · lead"
//   P2 "álvaro Ruiz"       phone "907.555.0199"    place "Unplaced"  (lower-case accented first letter: under A)
//   P5 "Juan Carlos Pérez" phone ""                place "Route 2"
//   P4 "Ñico Soto"         phone null              place "Route 10"
//   P9 "3rd Shift Temp"    phone "555-3000"        place "Unplaced"  (# bucket)
//   P3 "Beto Lima"         archived                never listed
//   P8 "Ana Wait"          pending                 never listed
//   P6 "José Niño"         phone "9075551234"      place "Route 3"
// Listed: 6. In order: 3rd Shift Temp (#), álvaro Ruiz (A), José Niño, Juan Carlos Pérez (J; "jo"
// before "ju"), Ñico Soto (N), Zoe Adams (Z).
const PLACES = { P7: 'Route 2 · lead', P2: 'Unplaced', P5: 'Route 2', P4: 'Route 10', P9: 'Unplaced', P6: 'Route 3', P1: 'Unplaced' };
const placeOf = (p) => PLACES[p.id] || '';
const crewMk = () => [
  { id: 'P7', name: 'Zoe Adams', phone: '(907) 555-0123' },
  { id: 'P2', name: 'álvaro Ruiz', phone: '907.555.0199' },
  { id: 'P5', name: 'Juan Carlos Pérez', phone: '' },
  { id: 'P4', name: 'Ñico Soto', phone: null },
  { id: 'P9', name: '3rd Shift Temp', phone: '555-3000' },
  { id: 'P3', name: 'Beto Lima', archived: true },
  { id: 'P8', name: 'Ana Wait', pending: true },
  { id: 'P6', name: 'José Niño', phone: '9075551234' },
];
const ALL6 = ['3rd Shift Temp', 'álvaro Ruiz', 'José Niño', 'Juan Carlos Pérez', 'Ñico Soto', 'Zoe Adams'];
const peopleNames = (r) => r.items.filter((i) => i.person).map((i) => i.person.name);
const peopleRows = (r) => r.items.map((i) => (i.person ? i.person.name : i.letter));
const find = (query, extra) => SnowGroupList.people(crewMk().concat(extra || []), { query: query, placeOf: placeOf });

test('people: no query lists the six live people in order; archived and pending are never counted', () => {
  const r = find();
  assert.deepEqual(peopleNames(r), ALL6);
  assert.equal(r.total, 6);
  assert.equal(r.matched, 6);
  assert.equal(r.lettered, false);    // 6 is not more than 12
});

test('people: a pending card is not listed', () => {
  const r = find('wait');
  assert.deepEqual(peopleNames(r), []);
  assert.equal(r.total, 6);
  assert.equal(r.matched, 0);
});

test('people: an archived card is not listed', () => {
  assert.deepEqual(peopleNames(find('beto')), []);
});

test('people: accents are ignored', () => {
  assert.deepEqual(peopleNames(find('jose')), ['José Niño']);
});

test('people: case is ignored, and "nino" is not "nico"', () => {
  assert.deepEqual(peopleNames(find('NINO')), ['José Niño']);
});

test('people: an accented query finds a plain name; "jose l" sorts before "jose n" under one J', () => {
  const r = find('josé', [{ id: 'P1', name: 'Jose Luna', phone: null }]);
  assert.deepEqual(peopleNames(r), ['Jose Luna', 'José Niño']);
});

test('people: every word may sit anywhere in the name', () => {
  assert.deepEqual(peopleNames(find('juan perez')), ['Juan Carlos Pérez']);
});

test('people: every word must match the SAME person', () => {
  assert.deepEqual(peopleNames(find('juan soto')), []);
});

test('people: the place words are searched', () => {
  assert.deepEqual(peopleNames(find('unplaced')), ['3rd Shift Temp', 'álvaro Ruiz']);
  assert.deepEqual(peopleNames(find('lead')), ['Zoe Adams']);
});

test('people: "route 2" is Juan and Zoe; José\'s phone holds a 2 but one digit never matches a phone', () => {
  // José Niño: phone 9075551234 has a 2; "Route 3" has no 2. Zoe: "Route 2 · lead". Juan: "Route 2".
  assert.deepEqual(peopleNames(find('route 2')), ['Juan Carlos Pérez', 'Zoe Adams']);
});

test('people: "route 1" is "Route 10" only; Zoe\'s phone holds a 1 and does not count', () => {
  assert.deepEqual(peopleNames(find('route 1')), ['Ñico Soto']);
});

test('people: "3" finds the name and "Route 3", never a phone', () => {
  // 3rd Shift Temp (name) and José Niño ("Route 3"); the phones with a 3 do not count at one digit.
  assert.deepEqual(peopleNames(find('3')), ['3rd Shift Temp', 'José Niño']);
});

test('people: two digits never match a phone', () => {
  assert.deepEqual(peopleNames(find('55')), []);
});

test('people: "555" finds the four with 555 in the phone digits', () => {
  // Zoe 9075550123, álvaro 9075550199, José 9075551234, 3rd Shift 5553000; Juan "" and Ñico null have none.
  assert.deepEqual(peopleNames(find('555')), ['3rd Shift Temp', 'álvaro Ruiz', 'José Niño', 'Zoe Adams']);
});

test('people: phone punctuation is dropped ("555-0123" is 5550123)', () => {
  assert.deepEqual(peopleNames(find('555-0123')), ['Zoe Adams']);
});

test('people: "(907) 555" is two words; 3rd Shift Temp has no 907', () => {
  assert.deepEqual(peopleNames(find('(907) 555')), ['álvaro Ruiz', 'José Niño', 'Zoe Adams']);
});

test('people: "300" is inside 5553000', () => {
  assert.deepEqual(peopleNames(find('300')), ['3rd Shift Temp']);
});

test('people: a letter in the word makes it not a phone word', () => {
  assert.deepEqual(peopleNames(find('0123x')), []);
});

test('people: ".*", "[" and "(" are plain text, never a pattern, and never throw', () => {
  ['.*', '[', '('].forEach((q) => {
    assert.deepEqual(peopleNames(find(q)), [], q);
  });
});

test('people: spaces only is no search', () => {
  assert.deepEqual(peopleNames(find('   ')), ALL6);
});

test('people: letterMin 5 draws letter rows (6 > 5); Ñ folds to N and á to A', () => {
  const r = SnowGroupList.people(crewMk(), { placeOf: placeOf, letterMin: 5 });
  assert.deepEqual(peopleRows(r), ['#', '3rd Shift Temp', 'A', 'álvaro Ruiz', 'J', 'José Niño', 'Juan Carlos Pérez', 'N', 'Ñico Soto', 'Z', 'Zoe Adams']);
  assert.equal(r.lettered, true);
});

test('people: letterMin 6 draws no letter rows (6 is not more than 6)', () => {
  const r = SnowGroupList.people(crewMk(), { placeOf: placeOf, letterMin: 6 });
  assert.deepEqual(peopleRows(r), ALL6);
  assert.equal(r.lettered, false);
});

test('people: the default letterMin is 12: 13 people are lettered, 12 are not', () => {
  const crew = (n) => Array.from({ length: n }, (_, i) => ({ id: 'X' + i, name: 'Person ' + String.fromCharCode(65 + i) }));
  assert.equal(SnowGroupList.people(crew(13)).lettered, true);
  assert.equal(SnowGroupList.people(crew(12)).lettered, false);
});

test('people: a letter appears once, even when another letter sorts between its names', () => {
  // In this Node 'Oa' < 'Øb' < 'Oc' by localeCompare (checked: 'Oa'.localeCompare('Øb') = -1 and
  // 'Øb'.localeCompare('Oc') = -1), so a sort by name alone gives O, Ø, O. Ø does not fold, so it is
  // its own letter; 'O'.localeCompare('Ø') = -1, so O comes first. Letter first: O Oa Oc Ø Øb.
  const crew = [{ id: 'a', name: 'Oc' }, { id: 'b', name: 'Øb' }, { id: 'c', name: 'Oa' }];
  const r = SnowGroupList.people(crew, { letterMin: 0 });
  assert.deepEqual(peopleRows(r), ['O', 'Oa', 'Oc', 'Ø', 'Øb']);
});

test('people: a phone that is a NUMBER, and one with a plus and an extension', () => {
  const crew = [{ id: 'n', name: 'Num Ber', phone: 9075550123 }, { id: 'e', name: 'Ext Ension', phone: '+1 (907) 555-0123 x12' }];
  const q = (s) => peopleNames(SnowGroupList.people(crew, { query: s }));
  assert.deepEqual(q('5550123'), ['Ext Ension', 'Num Ber']);    // both hold 5550123
  assert.deepEqual(q('19075550123'), ['Ext Ension']);           // digits 1907555012312 hold it; 9075550123 does not
  assert.deepEqual(q('0123'), ['Ext Ension', 'Num Ber']);
});

test('people: no name sits in # and no query finds it by name; no placeOf means no place words; null is empty', () => {
  const crew = [{ id: 'q', phone: '907-555-0000' }, { id: 'r', name: 'Rae Roe' }];
  assert.deepEqual(peopleRows(SnowGroupList.people(crew, { letterMin: 0 })).slice(0, 1), ['#']);
  assert.deepEqual(SnowGroupList.people(crew, { query: 'undefined' }).items, []);
  assert.deepEqual(SnowGroupList.people(crew, { query: 'null' }).items, []);
  assert.deepEqual(peopleNames(SnowGroupList.people(crewMk(), { query: 'unplaced' })), []);
  assert.deepEqual(SnowGroupList.people(null), { total: 0, matched: 0, lettered: false, items: [] });
});

test('people: two people with the same name keep the caller\'s order', () => {
  const crew = [{ id: 't2', name: 'Sam Twin' }, { id: 't1', name: 'Sam Twin' }];
  assert.deepEqual(SnowGroupList.people(crew).items.map((i) => i.person.id), ['t2', 't1']);
});

test('people: pure; the crew is not changed and each item is the caller\'s own object', () => {
  const crew = crewMk();
  const before = JSON.parse(JSON.stringify(crew));
  const r = SnowGroupList.people(crew, { query: 'o', placeOf: placeOf, letterMin: 2 });
  assert.deepEqual(crew, before);
  const people = r.items.filter((i) => i.person);
  assert.ok(people.length > 0);
  people.forEach((i) => assert.ok(crew.indexOf(i.person) >= 0));
});
