// The one type -> colour table (SnowMap.TYPES, Bootprint's colours) as a MapLibre paint
// expression, for every layer that colours a feature by its zone type: the zones on the
// crew map and, since 10/9/26, the editor's Import from Bootprint preview (Matt read a
// 4-ft curb ring as a sidewalk when every previewed outline was white).
const test = require('node:test');
const assert = require('node:assert/strict');
const SnowMap = require('../lib/mapview.js');

// Worked from the table in lib/mapview.js: key order is the legend's order, each key
// followed by its colour, the fallback last. A feature with no type (the outline being
// drawn) gets the fallback.
test('typeColour: a match on the feature type, every type in legend order, the fallback last', () => {
  assert.deepEqual(SnowMap.typeColour('#ffffff'), ['match', ['get', 'type'],
    'sidewalk', '#1c6fb0', 'hand', '#d98c00', 'heated', '#d62828', 'storage', '#7d5ba6', 'no_touch', '#e0218a',
    '#ffffff']);
});

test('typeColour: built from the table, so a type can never be missing from it', () => {
  const expr = SnowMap.typeColour('#888888');
  const pairs = {};
  for (let i = 2; i < expr.length - 1; i += 2) pairs[expr[i]] = expr[i + 1];
  assert.deepEqual(pairs, Object.fromEntries(Object.keys(SnowMap.TYPES).map((k) => [k, SnowMap.TYPES[k].color])));
  assert.equal(expr[expr.length - 1], '#888888');
});
