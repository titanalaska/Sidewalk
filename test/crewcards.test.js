// Crew cards (Matt, 11/24/26): the pure words and order of the Crew tab (lib/crewcards.js). Made-up people only.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/crewcards.js');

// Worked on paper. A football field = 57,600 sq ft; the line shows from N = round(sqft / 57600) >= 1.
//   28,799 / 57,600 = 0.49998 -> 0 -> none | 28,800 / 57,600 = 0.5 -> 1 | 57,600 -> 1
//   1,214,300 / 57,600 = 21.08 -> 21 | 0 -> 0 -> none

test('seasonsWord: null none, 0 and 1 Rookie, n seasons from 2', () => {
  assert.strictEqual(C.seasonsWord(null), null);
  assert.strictEqual(C.seasonsWord(0), 'Rookie');
  assert.strictEqual(C.seasonsWord(1), 'Rookie');
  assert.strictEqual(C.seasonsWord(2), '2 seasons');
  assert.strictEqual(C.seasonsWord(11), '11 seasons');
});

test('fieldsWord: shown only from one football field, singular at 1', () => {
  assert.strictEqual(C.fieldsWord(0), null);
  assert.strictEqual(C.fieldsWord(28799), null);
  assert.strictEqual(C.fieldsWord(28800), 'about 1 football field');
  assert.strictEqual(C.fieldsWord(57600), 'about 1 football field');
  assert.strictEqual(C.fieldsWord(1214300), 'about 21 football fields');
});

test('winterWord: hyphen in, en dash out', () => {
  assert.strictEqual(C.winterWord('2026-27'), 'Winter 2026\u201327');
});

const crew = [
  { id: 'c1', name: 'Ana Test', photo_thumb: 'data:image/jpeg;base64,AAA' },
  { id: 'c2', name: 'Abel Test', photo_thumb: null },
  { id: 'c3', name: 'Zed Test', photo_thumb: 'data:image/jpeg;base64,ZZZ' }
];
function reply(cards) { return { ok: true, season: '2026-27', counted_at: 'x', cards: cards }; }
const card = (id, name, o) => Object.assign({ id: id, name: name, seasons: 3, card_line: null, nights_worked: 4, team_sqft: 1214321 }, o || {});

test('build: own card first, then A-Z (Abel before Ana)', () => {
  const out = C.build(reply([card('c1', 'Ana Test'), card('c3', 'Zed Test'), card('c2', 'Abel Test')]), crew, 'c3');
  assert.deepStrictEqual(out.map(x => x.id), ['c3', 'c2', 'c1']);
  assert.deepStrictEqual(out.map(x => x.mine), [true, false, false]);
});

test('build: myCrewId null (Matt) gives no mine, plain A-Z', () => {
  const out = C.build(reply([card('c3', 'Zed Test'), card('c1', 'Ana Test'), card('c2', 'Abel Test')]), crew, null);
  assert.deepStrictEqual(out.map(x => x.id), ['c2', 'c1', 'c3']);
  assert.ok(out.every(x => x.mine === false));
});

test('build: photo from crewList by id; an id the phone does not have gets null', () => {
  const out = C.build(reply([card('c1', 'Ana Test'), card('c9', 'Newly Added')]), crew, null);
  assert.strictEqual(out[0].photo_thumb, 'data:image/jpeg;base64,AAA');
  assert.strictEqual(out[1].id, 'c9');
  assert.strictEqual(out[1].photo_thumb, null);
  assert.strictEqual(C.build(reply([card('c2', 'Abel Test')]), crew, null)[0].photo_thumb, null);
});

test('build: the words on a card', () => {
  const x = C.build(reply([card('c1', 'Ana Test', { seasons: 1, card_line: 'Early riser', nights_worked: 4 })]), crew, null)[0];
  assert.strictEqual(x.name, 'Ana Test');
  assert.strictEqual(x.seasons_word, 'Rookie');
  assert.strictEqual(x.line, 'Early riser');
  assert.strictEqual(x.nights, 4);
  assert.strictEqual(x.sqft_word, '1,214,300');   // 1,214,321 rounds to the nearest 100
  assert.strictEqual(x.fields_word, 'about 21 football fields');
});

test('build: a blank line is null; null seasons and tiny sq ft give no words', () => {
  const x = C.build(reply([card('c1', 'Ana Test', { seasons: null, card_line: '   ', team_sqft: 100 })]), crew, null)[0];
  assert.strictEqual(x.line, null);
  assert.strictEqual(x.seasons_word, null);
  assert.strictEqual(x.fields_word, null);
  assert.strictEqual(C.build(reply([card('c1', 'Ana Test', { card_line: null })]), crew, null)[0].line, null);
});

test('build: no reply or no cards gives an empty list', () => {
  assert.deepStrictEqual(C.build(null, crew, null), []);
  assert.deepStrictEqual(C.build({ ok: true }, crew, null), []);
});
