const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/board.js');
const fake = require('./boardbatch-fake.js');

// The fake backend's boardBatch (test/boardbatch-fake.js, shared by ui.spec.js and boardbulk.spec.js) must apply the SERVER's rules
// (snow-app-script Code.js boardBatch_), through the same shared lib/boardbatch.js. Same worked fixture as test/boardbatch.test.js.
// Live routes R1, R2, R3. Crew C1 Ana, C2 Ben, C3 Cal, C4 Dee, C5 Eli, C6 Fay (on_call false). All 2026-11-18, -09:00.
//   M1 10:00 C1 -> R1 lead   M2 10:01 C2 -> R1 member   M3 10:02 C3 -> R2 member   M4 10:03 C4 -> R2 lead   M5 10:04 C4 -> off
// Board: R1 lead C1, members [C2] | R2 lead none, members [C3] | R3 empty | Unassigned C4, C5, C6.
const at = (hhmm) => '2026-11-18T' + hhmm + ':00.000-09:00';
const mv = (id, t, worker, to, role, extra) => Object.assign({ id: id, at: at(t), worker: worker, to_route: to, role: role }, extra || {});
const NOW = new Date('2026-11-18T22:00:00.000Z'); // 13:00 local at -09:00: later than every fixture row

function world() {
  return {
    moves: [mv('M1', '10:00', 'C1', 'R1', 'lead'), mv('M2', '10:01', 'C2', 'R1', 'member'), mv('M3', '10:02', 'C3', 'R2', 'member'),
      mv('M4', '10:03', 'C4', 'R2', 'lead'), mv('M5', '10:04', 'C4', null, null)],
    routes: [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }],
    crew: [{ id: 'C1', name: 'Ana' }, { id: 'C2', name: 'Ben' }, { id: 'C3', name: 'Cal' }, { id: 'C4', name: 'Dee' }, { id: 'C5', name: 'Eli' }, { id: 'C6', name: 'Fay', on_call: false }],
  };
}
const admin = { role: 'admin', now: NOW };
const boardOf = (s) => B.boardFrom(s.moves, s.routes.filter((r) => !r.archived), Object.fromEntries(s.crew.map((c) => [c.id, c])));

test('another action is not the fake: undefined', () => {
  assert.equal(fake(world(), { action: 'addMove' }, admin), undefined);
});

// Paper: add to R2 (no lead) C5, C4, C2 with lead C5. C2 is on R1: skipped. C5 leads, C4 member. Ids M6, M7 (5 rows + 1 + i).
test('add: a placed person is skipped, the lead leads; one batch id, one time, later than every move', () => {
  const s = world();
  const r = fake(s, { action: 'boardBatch', kind: 'add', batch: 'B-add00001', route_id: 'R2', workers: ['C5', 'C4', 'C2'], lead: 'C5' }, admin);
  assert.equal(r.ok, true);
  assert.deepEqual([r.written, r.skipped, r.left, r.already, r.lead_kept], [2, 1, 0, false, false]);
  assert.deepEqual(r.records.map((x) => [x.id, x.worker, x.to_route, x.role, x.batch, x.rev]),
    [['M6', 'C5', 'R2', 'lead', 'B-add00001', 1], ['M7', 'C4', 'R2', 'member', 'B-add00001', 1]]);
  assert.equal(r.records[0].at, r.records[1].at);
  assert.equal(Date.parse(r.records[0].at), NOW.getTime());
  assert.equal(r.moves.length, 7);
  assert.equal(s.moves.length, 7);
  assert.deepEqual(boardOf(s).routes.R2, { lead: 'C5', members: ['C3', 'C4'] });
});

// Paper: R1 already has a lead (C1), so the chosen lead C5 goes as a member and lead_kept is true.
test('add: the route already has a lead, lead_kept', () => {
  const s = world();
  const r = fake(s, { action: 'boardBatch', kind: 'add', batch: 'B-add00002', route_id: 'R1', workers: ['C5'], lead: 'C5' }, admin);
  assert.deepEqual([r.written, r.lead_kept, r.records[0].role], [1, true, 'member']);
});

// Paper: the clear takes C1 (R1 lead), C2 (R1 member), C3 (R2 member): three rows, ids M6..M8, each with from_route / from_role.
test('clear all: every placed person goes off, with where they were', () => {
  const s = world();
  const r = fake(s, { action: 'boardBatch', kind: 'clear', batch: 'B-clear001', route_id: null }, admin);
  assert.equal(r.written, 3);
  assert.deepEqual(r.records.map((x) => [x.id, x.worker, x.to_route, x.from_route, x.from_role]),
    [['M6', 'C1', null, 'R1', 'lead'], ['M7', 'C2', null, 'R1', 'member'], ['M8', 'C3', null, 'R2', 'member']]);
  assert.deepEqual(boardOf(s).routes, { R1: { lead: null, members: [] }, R2: { lead: null, members: [] }, R3: { lead: null, members: [] } });
});

// Paper: after the clear C2 is placed on R3 (a hand row, 13:05 local, after the clear's 13:00). Undo: C1 back as lead of R1, C3 back
// as member of R2; C2 is placed since, so left 1. Rows carry undoes = the clear batch; written 2.
test('undo: people placed since are left', () => {
  const s = world();
  fake(s, { action: 'boardBatch', kind: 'clear', batch: 'B-clear001', route_id: null }, admin);
  s.moves.push(mv('M9', '13:05', 'C2', 'R3', 'member'));
  const r = fake(s, { action: 'boardBatch', kind: 'undo', batch: 'B-undo0001', clear: 'B-clear001' }, { role: 'admin', now: new Date('2026-11-18T23:00:00.000Z') });
  assert.equal(r.ok, true);
  assert.deepEqual([r.written, r.left], [2, 1]);
  assert.deepEqual(r.records.map((x) => [x.worker, x.to_route, x.role, x.undoes, x.batch]),
    [['C1', 'R1', 'lead', 'B-clear001', 'B-undo0001'], ['C3', 'R2', 'member', 'B-clear001', 'B-undo0001']]);
  assert.deepEqual(boardOf(s).routes, { R1: { lead: 'C1', members: [] }, R2: { lead: null, members: ['C3'] }, R3: { lead: null, members: ['C2'] } });
});

test('undo of a clear that is not on the Board: conflict', () => {
  const s = world();
  assert.deepEqual(fake(s, { action: 'boardBatch', kind: 'undo', batch: 'B-undo0002', clear: 'B-nothere1' }, admin),
    { ok: false, code: 'conflict', reason: 'That clear is not on the Board' });
});

// Paper: the same batch twice writes nothing the second time and answers the first time's rows.
test('the same batch twice: already, the same rows, nothing more written', () => {
  const s = world();
  const first = fake(s, { action: 'boardBatch', kind: 'add', batch: 'B-add00003', route_id: 'R3', workers: ['C5', 'C6'], lead: null }, admin);
  const again = fake(s, { action: 'boardBatch', kind: 'add', batch: 'B-add00003', route_id: 'R3', workers: ['C5', 'C6'], lead: null }, admin);
  assert.deepEqual([again.ok, again.already, again.written, again.skipped, again.left, again.lead_kept], [true, true, 0, 0, 0, false]);
  assert.deepEqual(again.records, first.records);
  assert.equal(s.moves.length, 7);
  assert.equal(again.moves.length, 7);
});

test('a non-admin is refused and nothing is written', () => {
  const s = world();
  for (const role of ['lead', 'crew']) {
    assert.deepEqual(fake(s, { action: 'boardBatch', kind: 'clear', batch: 'B-clear002', route_id: null }, { role, now: NOW }),
      { ok: false, code: 'forbidden', reason: 'Only Matt can do that.' });
  }
  assert.equal(s.moves.length, 5);
});

test('refusals: a bad kind, a bad batch id (undo: a bad clear id too), a plan error', () => {
  const s = world();
  const f = (b) => fake(s, Object.assign({ action: 'boardBatch' }, b), admin);
  assert.deepEqual(f({ kind: 'wipe', batch: 'B-clear003' }), { ok: false, code: 'invalid', reason: 'Pick add, clear or undo' });
  assert.deepEqual(f({ kind: 'clear', batch: 'nope' }), { ok: false, code: 'invalid', reason: 'Bad batch id' });
  assert.deepEqual(f({ kind: 'undo', batch: 'B-undo0003', clear: 'x' }), { ok: false, code: 'invalid', reason: 'Bad batch id' });
  assert.deepEqual(f({ kind: 'add', batch: 'B-add00004', route_id: 'R9', workers: ['C5'] }), { ok: false, code: 'invalid', reason: 'Pick a route' });
  assert.equal(s.moves.length, 5);
});

// Paper: a row typed with a year-2099 time is already in Moves: C6 -> R3. The batch's time must be 1 ms after it, or the clear
// would sort BEFORE it and C6 would stay on R3. With the rule, every route is empty after the clear.
test('a move from the future: the batch sorts after it, so the clear leaves the Board empty', () => {
  const s = world();
  const far = '2099-01-01T00:00:00.000-09:00';
  s.moves.push({ id: 'M6', at: far, worker: 'C6', to_route: 'R3', role: 'member' });
  const r = fake(s, { action: 'boardBatch', kind: 'clear', batch: 'B-clear004', route_id: null }, admin);
  assert.equal(r.written, 4);
  assert.equal(Date.parse(r.records[0].at), Date.parse(far) + 1);
  assert.deepEqual(boardOf(s).routes, { R1: { lead: null, members: [] }, R2: { lead: null, members: [] }, R3: { lead: null, members: [] } });
});

// Paper: a pending card is no one on the Board (the server's pool leaves it out): adding C7 pending is "Unknown worker C7".
// R3 archived is no route: adding to it is "Pick a route".
test('a pending card and an archived route are left out of the Board', () => {
  const s = world();
  s.crew.push({ id: 'C7', name: 'Gus', pending: true });
  s.routes[2].archived = true;
  assert.deepEqual(fake(s, { action: 'boardBatch', kind: 'add', batch: 'B-add00005', route_id: 'R2', workers: ['C7'] }, admin),
    { ok: false, code: 'invalid', reason: 'Unknown worker C7' });
  assert.deepEqual(fake(s, { action: 'boardBatch', kind: 'add', batch: 'B-add00006', route_id: 'R3', workers: ['C5'] }, admin),
    { ok: false, code: 'invalid', reason: 'Pick a route' });
});
