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

test('cardFromForm: trims the phone, reads yes/no/not set, lists machines, blank seasons is null (never 0), gear blank is null', () => {
  const card = R.cardFromForm({ phone: ' 555-0199 ', can_drive: 'yes', valid_id: 'no', on_call: '', smokes: '', can_operate: ['blower', 'shovel'], seasons: ' 2 ', gear: 'own' });
  assert.deepEqual(card, { phone: '555-0199', can_drive: true, valid_id: false, on_call: null, smokes: null, can_operate: ['blower', 'shovel'], seasons: 2, gear: 'own' });
  assert.equal('photo_thumb' in card, false);   // not touched: the one on file stays
  const blank = R.cardFromForm({ phone: '', can_drive: '', valid_id: '', on_call: '', smokes: '', can_operate: [], seasons: '', gear: '' });
  assert.deepEqual(blank, { phone: '', can_drive: null, valid_id: null, on_call: null, smokes: null, can_operate: [], seasons: null, gear: null });
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
