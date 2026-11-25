// The Site card's unit and operator picks (Matt, 11/24/26): units come from the sites'
// own unit text (several per site, comma-separated), operators from the crew, tonight's
// route first. Expected lists are worked on paper in each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/machinepick.js');

test('splitUnits: " bc5 ,BT13,,BC5 " is bc5 and BT13', () => {
  // pieces: "bc5", "BT13", "", "BC5" -> empty dropped; "BC5" repeats "bc5" ignoring case, first spelling kept
  assert.deepEqual(P.splitUnits(' bc5 ,BT13,,BC5 '), ['bc5', 'BT13']);
  // spaces inside a name do not make a different unit: "BC 5" is "BC5"
  assert.deepEqual(P.splitUnits('BC5, BC 5'), ['BC5']);
  assert.deepEqual(P.splitUnits(''), []);
  assert.deepEqual(P.splitUnits(null), []);
  assert.deepEqual(P.splitUnits(undefined), []);
});

const SITES = [
  { id: 'H', name: 'Hospital', units: { bobcat: 'BC5, BT13, BC7', snowrator: 'SR2' } },
  { id: 'A', name: 'Alpha', units: { bobcat: 'BC9, BC5', snowrator: '' } },
  { id: 'B', name: 'Bravo', units: { bobcat: 'bc1' } },
  { id: 'X', name: 'Old', archived: true, units: { bobcat: 'BC99' } },
  { id: 'N', name: 'None' }
];

test('unitChoices: the hospital\'s three as three this-site picks, in the order typed', () => {
  var c = P.unitChoices(SITES, 'H', 'bobcat').slice(0, 3);
  assert.deepEqual(c, [
    { value: 'BC5', label: 'BC5 (this site)', here: true },
    { value: 'BT13', label: 'BT13 (this site)', here: true },
    { value: 'BC7', label: 'BC7 (this site)', here: true }
  ]);
});

test('unitChoices: other sites\' units A to Z, this site\'s not repeated, archived sites left out', () => {
  // Hospital's own: BC5, BT13, BC7. Others: Alpha BC9, BC5; Bravo bc1; Old (archived) BC99 left out.
  // BC5 is this site's, so Alpha's repeat is dropped -> BC9, bc1 -> A to Z ignoring case: bc1, BC9
  assert.deepEqual(P.unitChoices(SITES, 'H', 'bobcat'), [
    { value: 'BC5', label: 'BC5 (this site)', here: true },
    { value: 'BT13', label: 'BT13 (this site)', here: true },
    { value: 'BC7', label: 'BC7 (this site)', here: true },
    { value: 'bc1', label: 'bc1', here: false },
    { value: 'BC9', label: 'BC9', here: false }
  ]);
  // snowrator: Hospital's SR2 is this site's; nobody else has one
  assert.deepEqual(P.unitChoices(SITES, 'H', 'snowrator'), [{ value: 'SR2', label: 'SR2 (this site)', here: true }]);
});

test('unitChoices: a site with no unit has no this-site row', () => {
  // Alpha has no snowrator; None has no units at all. Others' snowrator: SR2 only.
  assert.deepEqual(P.unitChoices(SITES, 'A', 'snowrator'), [{ value: 'SR2', label: 'SR2', here: false }]);
  assert.deepEqual(P.unitChoices(SITES, 'N', 'snowrator'), [{ value: 'SR2', label: 'SR2', here: false }]);
  assert.deepEqual(P.unitChoices(SITES, 'N', 'sweepster'), []);
  // an unknown site id: everyone's, none this-site
  assert.deepEqual(P.unitChoices(SITES, 'nope', 'snowrator'), [{ value: 'SR2', label: 'SR2', here: false }]);
});

const CREW = [
  { id: 'c1', name: 'Zed' },
  { id: 'c2', name: 'amy' },
  { id: 'c3', name: 'Bo', is_lead: true },
  { id: 'c4', name: 'Waiting', pending: true },
  { id: 'c5', name: 'Gone', archived: true },
  { id: 'c6', name: 'Cy' }
];

test('operatorChoices: tonight\'s route first, then everyone A to Z with Matt among them, no one twice, no waiting or archived card', () => {
  // first: c1 (Zed), c4 (waiting, skipped), c3 (Bo), c1 again (once), nope (not on the crew, skipped)
  // rest, A to Z ignoring case: amy, Cy, Matt Walsh ("admin"); Waiting and Gone left out
  assert.deepEqual(P.operatorChoices(CREW, ['c1', 'c4', 'c3', 'c1', 'nope'], 'Matt Walsh'), [
    { key: 'c1', name: 'Zed' },
    { key: 'c3', name: 'Bo' },
    { key: 'c2', name: 'amy' },
    { key: 'c6', name: 'Cy' },
    { key: 'admin', name: 'Matt Walsh' }
  ]);
  // no route: all A to Z: amy, Bo, Cy, Matt Walsh, Zed
  assert.deepEqual(P.operatorChoices(CREW, [], 'Matt Walsh').map((o) => o.name), ['amy', 'Bo', 'Cy', 'Matt Walsh', 'Zed']);
  assert.deepEqual(P.operatorChoices(CREW, null, 'Matt Walsh').length, 5);
});

test('operatorChoices: no admin name, no Matt row', () => {
  assert.deepEqual(P.operatorChoices(CREW, ['c6'], '').map((o) => o.key), ['c6', 'c2', 'c3', 'c1']);
  assert.deepEqual(P.operatorChoices(CREW, ['c6'], '   ').map((o) => o.key), ['c6', 'c2', 'c3', 'c1']);
  assert.deepEqual(P.operatorChoices(CREW, ['c6']).map((o) => o.key), ['c6', 'c2', 'c3', 'c1']);
  assert.deepEqual(P.operatorChoices([], [], ''), []);
});

test('operatorChoices: a card with no name does not throw; a card with no id is left out', () => {
  // Worked on paper: c7 has no name -> listed with name "" (sorted first, "" before "amy"); a card with no id is never a pick.
  // c8's name is a number: read as the text "42", which sorts before letters. No route, no admin name.
  const crew = [{ id: 'c2', name: 'amy' }, { id: 'c7' }, { name: 'No Id' }, { id: '', name: 'Blank Id' }, { id: 'c8', name: 42 }, { id: 'c6', name: 'Cy' }];
  assert.deepEqual(P.operatorChoices(crew, ['c7'], ''), [{ key: 'c7', name: '' }, { key: 'c8', name: '42' }, { key: 'c2', name: 'amy' }, { key: 'c6', name: 'Cy' }]);
  assert.deepEqual(P.operatorChoices(crew, [], '').map((o) => o.key), ['c7', 'c8', 'c2', 'c6']);
});
