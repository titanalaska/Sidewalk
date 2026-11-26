// lib/estyped.js, its pure parts (Spanish everywhere, Ship 2): which language a typed element shows in, the kept copy read
// back from localStorage, and the order a Spanish phone asks for its lines after sign-in. The page itself: test/estyped.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
global.CrewTyped = require('../lib/typedwords.js');
const T = require('../lib/estyped.js');

test('estyped: the language a typed element shows in', () => {
  // [print scope, crew note?, phone] -> target. null = as typed.
  //   no scope: a zone name follows a Spanish phone only; a crew note always follows the phone (both ways)
  //   scope es: everything Spanish (Matt's Espanol on an English phone)
  //   scope en: a zone name as typed; a crew note in English (it may have been typed in Spanish)
  const rows = [
    [null, false, 'es', 'es'], [null, false, 'en', null],
    [null, true, 'es', 'es'], [null, true, 'en', 'en'],
    ['es', false, 'en', 'es'], ['es', true, 'en', 'es'], ['es', false, 'es', 'es'],
    ['en', false, 'es', null], ['en', true, 'es', 'en'], ['en', false, 'en', null],
  ];
  for (const [scope, crew, phone, want] of rows) assert.equal(T.targetFor(scope, crew, phone), want, JSON.stringify([scope, crew, phone]));
});

test('estyped: the kept copy reads back; anything unreadable is an empty copy, only text values kept', () => {
  assert.deepEqual(T.readStore(JSON.stringify({ es: { a: 'b' }, en: { c: 'd' } })), { es: { a: 'b' }, en: { c: 'd' } });
  assert.deepEqual(T.readStore(null), { es: {}, en: {} });
  assert.deepEqual(T.readStore('{not json'), { es: {}, en: {} });
  assert.deepEqual(T.readStore('[1,2]'), { es: {}, en: {} });
  // a number and a nested object are dropped; a missing language is empty
  assert.deepEqual(T.readStore(JSON.stringify({ es: { a: 'b', n: 5, o: { x: 1 } } })), { es: { a: 'b' }, en: {} });
  assert.equal(T.KEY, 'snow-es-typed');
});

test("estyped: prefetch asks for the own route's lines first (route order), then the rest; each line once", () => {
  // Jordan (C03) is a member of R2 in the Post; R2's sites in route order: S3 then S2.
  //   S3: notes "Sweep the steps"; zone Z3 "South walk" (note "")              -> own: Sweep the steps, South walk
  //   S2: notes "  Salt   the ramp " (keys to "Salt the ramp"); materials "3" (no letter: never sent);
  //       zone Z2 "Door / Puerta 5" (never sent), Z4 "East walk" note "Ice by the door"
  //                                                                            -> own: Salt the ramp, East walk, Ice by the door
  //   S1 (not his): notes "Salt the ramp" (already in the own list: not again), materials "2 bags"; zone Z1 "North walk";
  //       Z5 ARCHIVED "Old walk" (left out)                                    -> rest: 2 bags, North walk
  //   S4 ARCHIVED: notes "Old note"                                             -> left out
  const S = {
    me: { crew_id: 'C03' },
    post: { routes: [{ id: 'R1', lead: 'C01', members: [], sites: [{ id: 'S1' }] },
      { id: 'R2', lead: null, members: ['C03'], sites: [{ id: 'S3' }, { id: 'S2' }] }] },
    sites: [{ id: 'S1', notes: 'Salt the ramp', materials_needed: '2 bags' },
      { id: 'S2', notes: '  Salt   the ramp ', materials_needed: '3' },
      { id: 'S3', notes: 'Sweep the steps', materials_needed: '' },
      { id: 'S4', notes: 'Old note', archived: true }],
    zones: [{ id: 'Z1', site_id: 'S1', name: 'North walk', note: '' },
      { id: 'Z2', site_id: 'S2', name: 'Door / Puerta 5', note: '' },
      { id: 'Z3', site_id: 'S3', name: 'South walk', note: '' },
      { id: 'Z4', site_id: 'S2', name: 'East walk', note: 'Ice by the door' },
      { id: 'Z5', site_id: 'S1', name: 'Old walk', note: '', archived: true }],
  };
  assert.deepEqual(T.prefetchLines(S), [['Sweep the steps', 'South walk', 'Salt the ramp', 'East walk', 'Ice by the door'], ['2 bags', 'North walk']]);
});

test('estyped: prefetch for Matt (no crew id) or with no Post: no own route, every site in order', () => {
  const S = { me: { crew_id: null }, post: null,
    sites: [{ id: 'S1', notes: 'Salt the ramp' }, { id: 'S2', notes: 'Sweep the steps' }], zones: [] };
  assert.deepEqual(T.prefetchLines(S), [[], ['Salt the ramp', 'Sweep the steps']]);
  // a lead counts as on the route
  const L = { me: { crew_id: 'C01' }, post: { routes: [{ id: 'R1', lead: 'C01', members: [], sites: [{ id: 'S2' }] }] },
    sites: S.sites, zones: [] };
  assert.deepEqual(T.prefetchLines(L), [['Sweep the steps'], ['Salt the ramp']]);
});

test('estyped: a kept value of only spaces is dropped (never a blank line on screen)', () => {
  // final review M2: a Translation cell Matt cleared to spaces must never blank the English
  assert.deepEqual(T.readStore(JSON.stringify({ es: { a: '   ', b: 'Banqueta' }, en: { c: '' } })), { es: { b: 'Banqueta' }, en: {} });
});

test("estyped: a crew phone's prefetch leaves out the curb zones it never sees (a site with Curbs for the crew off)", () => {
  // final review M9. S1 crew_curbs off: its curb zone "Curb north" (type hand, named Curb...) is never on a crew screen -> not
  // asked. S2 crew_curbs on: its "Curb south" is -> asked. Matt (admin) sees every zone on his map -> his list keeps both.
  global.CrewShiftLog = require('../lib/shiftlog.js');
  try {
    const sites = [{ id: 'S1', notes: '', crew_curbs: false }, { id: 'S2', notes: '', crew_curbs: true }];
    const zones = [{ id: 'Z1', site_id: 'S1', type: 'hand', name: 'Curb north', note: '' },
      { id: 'Z2', site_id: 'S1', type: 'sidewalk', name: 'Front walk', note: '' },
      { id: 'Z3', site_id: 'S2', type: 'hand', name: 'Curb south', note: '' }];
    const crew = { me: { crew_id: 'C03', role: 'crew' }, post: null, sites, zones };
    assert.deepEqual(T.prefetchLines(crew), [[], ['Front walk', 'Curb south']]);
    const matt = { me: { crew_id: null, role: 'admin' }, post: null, sites, zones };
    assert.deepEqual(T.prefetchLines(matt), [[], ['Curb north', 'Front walk', 'Curb south']]);
  } finally { delete global.CrewShiftLog; }
});
