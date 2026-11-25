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
  // SNOW_SERVER_REPO (as test/log-fields.js reads it) points at a server worktree that is ahead of the main checkout.
  const backend = path.join(process.env.SNOW_SERVER_REPO || path.join(__dirname, '..', '..', 'snow-app-script'), 'roster.js');
  // A path the caller named that is wrong must FAIL (a typo would otherwise pass silently); only the unset default may skip.
  if (process.env.SNOW_SERVER_REPO && !fs.existsSync(backend)) assert.fail('SNOW_SERVER_REPO is set but has no roster.js: ' + backend);
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
    emergency_name: 'Pat Nursery', emergency_phone: '555-0911', home_area: 'valley', card_line: null });
  assert.equal('photo_thumb' in card, false);   // not touched: the one on file stays
  const blank = R.cardFromForm({ phone: '', can_drive: '', valid_id: '', on_call: '', cold_rated: '', can_operate: [], seasons: '', gear: '', emergency_name: '', emergency_phone: '', home_area: '' });
  assert.deepEqual(blank, { phone: '', can_drive: null, valid_id: null, on_call: null, cold_rated: null, can_operate: [], seasons: null, gear: null, emergency_name: '', emergency_phone: '', home_area: null, card_line: null });
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

// card_line (crew cards, 11/24/26): the one line on one's card. Trimmed; blank (or only spaces) is null, never ''; never cut
// here (the form's maxlength is 40, the server refuses longer in its own words).
test('cardFromForm: the card line is trimmed; blank is null; 40 characters go as typed; one over goes as typed for the server to refuse', () => {
  assert.equal(R.cardFromForm({ card_line: '  Plow before sunrise  ' }).card_line, 'Plow before sunrise');
  for (const v of ['', '   ', undefined, null]) assert.equal(R.cardFromForm({ card_line: v }).card_line, null, JSON.stringify(v));
  assert.equal(R.cardFromForm({ card_line: 'W'.repeat(40) }).card_line, 'W'.repeat(40));
  assert.equal(R.cardFromForm({ card_line: ' ' + 'W'.repeat(41) + ' ' }).card_line, 'W'.repeat(41));
});

test('formHtml: A line for your card sits right after the photo buttons, maxlength 40, value escaped', () => {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = R.formHtml({ esc, avatar: () => '' }, { name: 'Abel Stone', card_line: '<b>x</b> "q"' });
  const i = html.indexOf('s_photo_file'), j = html.indexOf('<label>A line for your card</label>'), k = html.indexOf('<label>Phone</label>');
  assert.ok(i > 0 && j > i && k > j, 'order: photo row, line, phone');
  assert.ok(html.includes('<input id="s_card_line" maxlength="40" value="&lt;b&gt;x&lt;/b&gt; &quot;q&quot;">'));
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

// The dispatcher mark (Matt, 11/9/26; Plow Command's rule of 10/21/26): nobody changes their own mark, so the editor
// locks the row on one's own card. A dispatcher signs in as an admin WITH a crew id; Matt has none and is on no card.
test('ownCard: a dispatcher is on their own card and on no other; Matt (no crew id) is on none, new worker included', () => {
  const dee = { role: 'admin', crew_id: 'C05' }, matt = { role: 'admin', crew_id: null };
  assert.equal(R.ownCard(dee, { id: 'C05' }), true);
  assert.equal(R.ownCard(dee, { id: 'C03' }), false);
  assert.equal(R.ownCard(dee, { id: 'C50' }), false);          // C05 is not a prefix match
  // "Add worker" opens a record with no id yet: it is nobody's own card, for Matt and for a dispatcher alike.
  assert.equal(R.ownCard(dee, { name: '' }), false);
  assert.equal(R.ownCard(matt, { name: '' }), false);          // undefined must never equal a missing crew id
  assert.equal(R.ownCard({ role: 'admin' }, { name: '' }), false);
  assert.equal(R.ownCard(matt, { id: 'C05' }), false);
  assert.equal(R.ownCard(matt, { id: null }), false);          // null === null would read true without the crew id check
  assert.equal(R.ownCard(null, { id: 'C05' }), false);
  assert.equal(R.ownCard(dee, null), false);
  assert.equal(R.ownCard(dee, undefined), false);
});

// Crew pictures (Matt, 11/24/26: "the whole point was to put a face to the name"). A picture is a data:image URL, the rule avatar()
// has always drawn by; anything else is no picture. The bar is for crew and leads whose own live card has none.
const PIC = 'data:image/jpeg;base64,AAAA';
test('hasPicture: only a data:image URL is a picture', () => {
  assert.equal(R.hasPicture({ photo_thumb: PIC }), true);
  assert.equal(R.hasPicture({ photo_thumb: 'data:image/png;base64,iVBO' }), true);
  for (const v of [null, undefined, '', 'http://x/a.jpg', 'data:text/plain;base64,AAAA', 42]) assert.equal(R.hasPicture({ photo_thumb: v }), false, String(v));
  assert.equal(R.hasPicture(null), false);
  assert.equal(R.hasPicture(undefined), false);
});

test('needsPicture: crew and leads on the crew with no picture, and nobody else', () => {
  const crew = { name: 'Abel', role: 'crew', crew_id: 'C1' }, lead = { name: 'Ana', role: 'lead', crew_id: 'C2' };
  const disp = { name: 'Ben', role: 'admin', crew_id: 'C3' }, matt = { name: 'Matthew', role: 'admin', crew_id: null };
  const none = { id: 'C1', name: 'Abel', pending: false, photo_thumb: null };
  assert.equal(R.needsPicture(crew, none), true);
  assert.equal(R.needsPicture(lead, Object.assign({}, none, { id: 'C2' })), true);
  assert.equal(R.needsPicture(crew, Object.assign({}, none, { photo_thumb: PIC })), false);
  assert.equal(R.needsPicture(crew, Object.assign({}, none, { photo_thumb: 'http://x/a.jpg' })), true);   // old data: not a picture
  assert.equal(R.needsPicture(disp, Object.assign({}, none, { id: 'C3' })), false);   // a dispatcher sees the Roster markers instead
  assert.equal(R.needsPicture(matt, null), false);
  assert.equal(R.needsPicture(null, none), false);                                    // signed out
  assert.equal(R.needsPicture(crew, null), false);                                    // no card came with the sign-in
  assert.equal(R.needsPicture(crew, Object.assign({}, none, { pending: true })), false); // still waiting: the waiting screen says it
});
