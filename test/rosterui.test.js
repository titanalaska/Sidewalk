// Roster self-service (Matt, 10/6/26): the pure parts of lib/rosterui.js, and the one
// list both ends must agree on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../lib/rosterui.js');

test('the self-field list is the backend\'s, word for word', () => {
  // snow-app-script sits beside this repo (no remote). Its SNOW_ROSTER.SELF_FIELDS is the law;
  // this file carries a copy so the phone never sends a field the server would ignore.
  const backend = path.join(__dirname, '..', '..', 'snow-app-script', 'roster.js');
  if (!fs.existsSync(backend)) { assert.ok(true, 'backend repo not beside this one: list unchecked'); return; }
  const B = require(backend);
  assert.deepEqual(R.SELF_FIELDS, B.SELF_FIELDS);
  assert.deepEqual(R.OPERATE, B.OPERATE);
});

test('selfFieldsOf keeps only the self fields that are present: never a name, never a field Matt owns', () => {
  assert.deepEqual(R.selfFieldsOf({ phone: '1', name: 'X', is_lead: true, weaknesses: 'w', pending: false, id: 'C1', rev: 3, seasons: null }),
    { phone: '1', seasons: null });
  assert.deepEqual(R.selfFieldsOf({}), {});
  assert.deepEqual(R.selfFieldsOf(null), {});
});

// roster-2 (Matt, 10/6/26 bedtime): cold-rated is theirs to claim (his to correct), the emergency
// contact is theirs to fill (only he sees it), and Smokes left the form (his alone).
test('cardFromForm: trims the phone and the emergency contact, reads yes/no/not set, lists machines, blank seasons is null (never 0), gear blank is null', () => {
  const card = R.cardFromForm({ phone: ' 555-0199 ', can_drive: 'yes', valid_id: 'no', on_call: '', cold_rated: 'yes', can_operate: ['blower', 'shovel'], seasons: ' 2 ', gear: 'own',
    emergency_name: ' Pat Nursery ', emergency_phone: ' 555-0911 ', home_area: 'valley' });
  assert.deepEqual(card, { phone: '555-0199', can_drive: true, valid_id: false, on_call: null, cold_rated: true, can_operate: ['blower', 'shovel'], seasons: 2, gear: 'own',
    emergency_name: 'Pat Nursery', emergency_phone: '555-0911', home_area: 'valley' });
  assert.equal('photo_thumb' in card, false);   // not touched: the one on file stays
  const blank = R.cardFromForm({ phone: '', can_drive: '', valid_id: '', on_call: '', cold_rated: '', can_operate: [], seasons: '', gear: '', emergency_name: '', emergency_phone: '', home_area: '' });
  assert.deepEqual(blank, { phone: '', can_drive: null, valid_id: null, on_call: null, cold_rated: null, can_operate: [], seasons: null, gear: null, emergency_name: '', emergency_phone: '', home_area: null });
  // Smokes is Matt's: a value from an old form is dropped, never sent.
  assert.equal('smokes' in R.cardFromForm({ smokes: 'yes' }), false);
});

// home_area (Matt, 10/8/26): Valley or Anchorage, blank until chosen. Never guessed: a value the form
// does not offer is sent as blank, so a stale or odd form can never put a third answer on a record.
test('cardFromForm: where one lives is valley, anchorage or blank (null); anything else is blank, never guessed', () => {
  assert.equal(R.cardFromForm({ home_area: 'valley' }).home_area, 'valley');
  assert.equal(R.cardFromForm({ home_area: 'anchorage' }).home_area, 'anchorage');
  for (const v of ['', undefined, null, 'wasilla', 'Valley', 'ANCHORAGE', 7]) assert.equal(R.cardFromForm({ home_area: v }).home_area, null, String(v));
});

test('cardFromForm: a seasons that is not a whole number goes as typed, so the server refuses it in its own words; 0 is 0', () => {
  assert.equal(R.cardFromForm({ seasons: 'two' }).seasons, 'two');
  assert.equal(R.cardFromForm({ seasons: '1.5' }).seasons, '1.5');
  assert.equal(R.cardFromForm({ seasons: '0' }).seasons, 0);
  assert.equal(R.cardFromForm({ seasons: '12' }).seasons, 12);
});

test('cardFromForm: a picked picture is sent; a cleared one (null) is sent as null', () => {
  assert.equal(R.cardFromForm({ photo_thumb: 'data:image/jpeg;base64,QUJD' }).photo_thumb, 'data:image/jpeg;base64,QUJD');
  assert.equal(R.cardFromForm({ photo_thumb: null }).photo_thumb, null);
  // the list the form may send is exactly the self fields
  const keys = Object.keys(R.cardFromForm({ photo_thumb: 'data:image/jpeg;base64,QUJD' })).sort();
  assert.deepEqual(keys, R.SELF_FIELDS.slice().sort());
});

// Who is waiting on Matt (10/19/26): the Roster tab's count is the two waiting lists' own rows, so the number and
// the lists never disagree. Worked by hand: requests 9 and 10 are pending (1 is approved) = 2; cards: C04 pending
// = 1 (C05 is pending but archived, C06 was added, C01 never pending) -> 3.
test('waitingCount: pending requests plus pending cards; approved names, added and archived cards do not count', () => {
  const S = { profiles: [{ id: 1, status: 'approved' }, { id: 9, status: 'pending' }, { id: 10, status: 'pending' }],
    crew: [{ id: 'C01' }, { id: 'C04', pending: true }, { id: 'C05', pending: true, archived: true }, { id: 'C06', pending: false }] };
  assert.equal(R.waitingCount(S), 3);
  // The names not read yet (null): the cards still count.
  assert.equal(R.waitingCount({ profiles: null, crew: [{ id: 'C04', pending: true }] }), 1);
  assert.equal(R.waitingCount({ profiles: [], crew: [] }), 0);
  // A rejected request is gone, not waiting.
  assert.equal(R.waitingCount({ profiles: [{ id: 9, status: 'rejected' }], crew: [] }), 0);
});
