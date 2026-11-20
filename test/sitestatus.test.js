// The name bar's colour (Matt, 11/19/26): red = a Problem, green = every walk marked (curbs never count),
// amber = a crew came (Arrived / Left) or something is marked, navy = nothing yet. Expected values worked on paper below.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/shiftlog.js');
const S = require('../lib/sitestatus.js');

// Site S1 (made-up): Front, Side, Stairs (sidewalk/hand), Ramp (heated), and the curb item curbs-1.
// Main (non-curb) walks: 4. Curb items: 1.
const W = [
  { zone_id: 'Z1', type: 'sidewalk', name: 'Front' }, { zone_id: 'Z2', type: 'sidewalk', name: 'Side' },
  { zone_id: 'Z3', type: 'hand', name: 'Stairs' }, { zone_id: 'Z4', type: 'heated', name: 'Ramp' },
  { zone_id: 'curbs-1', type: 'hand', name: 'Curbs (about 300 ft)' },
];
// states map as CrewShiftLog.walkStates builds it: walkKey -> newest row
function st(pairs) {
  const out = {};
  Object.keys(pairs).forEach((z) => { out[L.walkKey('S1', z)] = { site_id: 'S1', zone_id: z, state: pairs[z] }; });
  return out;
}
const ARR = { state: 'arrived' }, LEFT = { state: 'left' };
const of = (states, mark, walks) => S.of(walks || W, states, 'S1', mark || null);

test('nothing marked, no visit: navy, no words', () => {
  assert.deepEqual(of(st({}), null), { kind: 'none', text: '' });
});
test('a null states map reads as nothing marked', () => {
  assert.deepEqual(of(null, null), { kind: 'none', text: '' });
});
test('Arrived and nothing marked: amber "Arrived"', () => {
  assert.deepEqual(of(st({}), ARR), { kind: 'working', text: 'Arrived' });
});
test('Left with nothing marked: amber, 0 of the 4 main walks', () => {
  assert.deepEqual(of(st({}), LEFT), { kind: 'working', text: '0 of 4 walks done' });
});
test('one walk cleared, no visit mark: amber "1 of 4 walks done"', () => {
  assert.deepEqual(of(st({ Z1: 'cleared' }), null), { kind: 'working', text: '1 of 4 walks done' });
});
test('Arrived and one walk cleared: the count wins over "Arrived"', () => {
  assert.deepEqual(of(st({ Z1: 'cleared' }), ARR), { kind: 'working', text: '1 of 4 walks done' });
});
test('treat-only night: 3 treated + heated checked, curb not done: green "Done"', () => {
  assert.deepEqual(of(st({ Z1: 'treated', Z2: 'treated', Z3: 'treated', Z4: 'checked' }), LEFT), { kind: 'done', text: 'Done' });
});
test('snow night: Site done (cleared + checked) is green too', () => {
  assert.deepEqual(of(st({ Z1: 'cleared', Z2: 'cleared', Z3: 'cleared', Z4: 'checked' }), null), { kind: 'done', text: 'Done' });
});
test('Site treated skips the heated walk: still amber, 3 of 4', () => {
  assert.deepEqual(of(st({ Z1: 'treated', Z2: 'treated', Z3: 'treated' }), ARR), { kind: 'working', text: '3 of 4 walks done' });
});
test('a Problem beats done: red "1 problem"', () => {
  assert.deepEqual(of(st({ Z1: 'problem', Z2: 'cleared', Z3: 'cleared', Z4: 'checked' }), LEFT), { kind: 'problem', text: '1 problem' });
});
test('two problems: "2 problems"', () => {
  assert.deepEqual(of(st({ Z1: 'problem', Z3: 'problem' }), null), { kind: 'problem', text: '2 problems' });
});
test('a Problem on the curb item still turns it red', () => {
  assert.deepEqual(of(st({ Z1: 'cleared', Z2: 'cleared', Z3: 'cleared', Z4: 'checked', 'curbs-1': 'problem' }), null), { kind: 'problem', text: '1 problem' });
});
test('an Undo back to none is not done', () => {
  assert.deepEqual(of(st({ Z1: 'none', Z2: 'cleared' }), null), { kind: 'working', text: '1 of 4 walks done' });
  assert.deepEqual(of(st({ Z1: 'none' }), null), { kind: 'none', text: '' });
});
test('only the curb item done: amber (work started), 0 of 4', () => {
  assert.deepEqual(of(st({ 'curbs-1': 'cleared' }), null), { kind: 'working', text: '0 of 4 walks done' });
});
test('a curbs-only site is never green: its curb done reads amber with no count', () => {
  const curbsOnly = [W[4]];
  assert.deepEqual(of(st({ 'curbs-1': 'cleared' }), null, curbsOnly), { kind: 'working', text: '' });
  assert.deepEqual(of(st({}), ARR, curbsOnly), { kind: 'working', text: 'Arrived' });
  assert.deepEqual(of(st({}), null, curbsOnly), { kind: 'none', text: '' });
});
test('a site with no zones: the Whole site walk cleared is green', () => {
  const whole = L.walksFor('S9', []);
  const states = { [L.walkKey('S9', 'whole')]: { state: 'cleared' } };
  assert.deepEqual(S.of(whole, states, 'S9', null), { kind: 'done', text: 'Done' });
});
test('another site\'s rows never colour this one', () => {
  const states = { [L.walkKey('S2', 'Z1')]: { state: 'problem' } };
  assert.deepEqual(of(states, null), { kind: 'none', text: '' });
});
