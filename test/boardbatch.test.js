const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/board.js');
const BB = require('../lib/boardbatch.js');

// Fixture, worked on paper. Live routes R1, R2, R3. Crew C1 Ana, C2 Ben, C3 Cal, C4 Dee, C5 Eli,
// C6 Fay (on_call false). All times 2026-11-18, -09:00.
//   M1 10:00 C1 -> R1 lead   M2 10:01 C2 -> R1 member   M3 10:02 C3 -> R2 member
//   M4 10:03 C4 -> R2 lead   M5 10:04 C4 -> off
// Board: R1 lead C1, members [C2] | R2 lead none, members [C3] | R3 empty | Unassigned C4 Dee, C5 Eli, C6 Fay
// (C4 Dee, C5 Eli, then C6 Fay last: not on call.)

const at = (hhmm) => '2026-11-18T' + hhmm + ':00.000-09:00';
const mv = (id, t, worker, to, role, extra) => Object.assign({ id: id, at: at(t), worker: worker, to_route: to, role: role }, extra || {});

const M = [
  mv('M1', '10:00', 'C1', 'R1', 'lead'),
  mv('M2', '10:01', 'C2', 'R1', 'member'),
  mv('M3', '10:02', 'C3', 'R2', 'member'),
  mv('M4', '10:03', 'C4', 'R2', 'lead'),
  mv('M5', '10:04', 'C4', null, null),
];
const workers = {
  C1: { name: 'Ana' }, C2: { name: 'Ben' }, C3: { name: 'Cal' },
  C4: { name: 'Dee' }, C5: { name: 'Eli' }, C6: { name: 'Fay', on_call: false },
};
const ROUTES = [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }];
const board = B.boardFrom(M, ROUTES, workers);

test('fixture board is the shape worked on paper', () => {
  assert.deepEqual(board.routes, { R1: { lead: 'C1', members: ['C2'] }, R2: { lead: null, members: ['C3'] }, R3: { lead: null, members: [] } });
  assert.deepEqual(board.unassigned, ['C4', 'C5', 'C6']);
});

test('planAdd: a new lead on a route with none; a placed worker is skipped', () => {
  assert.deepEqual(BB.planAdd(board, 'R2', ['C5', 'C4', 'C2'], 'C5'), {
    rows: [{ worker: 'C5', to_route: 'R2', role: 'lead' }, { worker: 'C4', to_route: 'R2', role: 'member' }],
    skipped: 1, lead_kept: false, error: null,
  });
});

test('planAdd: the route already has a lead, so the chosen lead is a member and lead_kept is true', () => {
  assert.deepEqual(BB.planAdd(board, 'R1', ['C5', 'C6'], 'C5'), {
    rows: [{ worker: 'C5', to_route: 'R1', role: 'member' }, { worker: 'C6', to_route: 'R1', role: 'member' }],
    skipped: 0, lead_kept: true, error: null,
  });
});

test('planAdd: the chosen lead was skipped, so nobody leads and lead_kept is false', () => {
  assert.deepEqual(BB.planAdd(board, 'R2', ['C2', 'C5'], 'C2'), {
    rows: [{ worker: 'C5', to_route: 'R2', role: 'member' }], skipped: 1, lead_kept: false, error: null,
  });
});

test('planAdd: a duplicate counts once', () => {
  const r = BB.planAdd(board, 'R2', ['C5', 'C5'], null);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped, 0);
});

test('planAdd: the four errors, each with no rows', () => {
  const e = (r, w, l) => { const x = BB.planAdd(board, r, w, l); assert.deepEqual(x.rows, []); return x.error; };
  assert.equal(e('R2', ['C5'], 'C4'), 'The lead must be one of the people added');
  assert.equal(e('R9', ['C5'], null), 'Pick a route');
  assert.equal(e('R2', [], null), 'Pick somebody');
  assert.equal(e('R2', 'C5', null), 'Pick somebody');
  assert.equal(e('R2', ['C99'], null), 'Unknown worker C99');
});

test('planAdd: errors come in the listed order', () => {
  assert.equal(BB.planAdd(board, 'R9', [], 'C1').error, 'Pick a route');
  assert.equal(BB.planAdd(board, 'R2', [], 'C1').error, 'Pick somebody');
  assert.equal(BB.planAdd(board, 'R2', ['C99'], 'C5').error, 'The lead must be one of the people added');
});

test('planClear: every route in order, lead first then members', () => {
  assert.deepEqual(BB.planClear(board, null).rows, [
    { worker: 'C1', to_route: null, role: null, from_route: 'R1', from_role: 'lead' },
    { worker: 'C2', to_route: null, role: null, from_route: 'R1', from_role: 'member' },
    { worker: 'C3', to_route: null, role: null, from_route: 'R2', from_role: 'member' },
  ]);
});

test('planClear: one route, an empty route, an unknown route', () => {
  assert.deepEqual(BB.planClear(board, 'R2').rows, [{ worker: 'C3', to_route: null, role: null, from_route: 'R2', from_role: 'member' }]);
  assert.deepEqual(BB.planClear(board, 'R3'), { rows: [], error: null });
  assert.deepEqual(BB.planClear(board, 'R9'), { rows: [], error: 'Pick a route' });
});

// After the clear (batch B-clear01, at 11:00) plus M9 11:05 C2 -> R3 member, and R2 archived (live routes R1, R3).
const clearRows = [
  mv('K1', '11:00', 'C1', null, null, { batch: 'B-clear01', from_route: 'R1', from_role: 'lead' }),
  mv('K2', '11:00', 'C2', null, null, { batch: 'B-clear01', from_route: 'R1', from_role: 'member' }),
  mv('K3', '11:00', 'C3', null, null, { batch: 'B-clear01', from_route: 'R2', from_role: 'member' }),
];
const M2 = M.concat(clearRows, [mv('M9', '11:05', 'C2', 'R3', 'member')]);
const live = [{ id: 'R1' }, { id: 'R3' }];
const board2 = B.boardFrom(M2, live, workers);

test('planUndo: C1 returns as lead; C2 placed since and C3 route archived are left', () => {
  assert.deepEqual(board2.unassigned.slice().sort(), ['C1', 'C3', 'C4', 'C5', 'C6']);
  assert.deepEqual(BB.planUndo(M2, board2, 'B-clear01'), {
    rows: [{ worker: 'C1', to_route: 'R1', role: 'lead', undoes: 'B-clear01' }], left: 2, known: true, done: false,
  });
});

test('planUndo: somebody else now leads the route, so C1 goes back as a member', () => {
  const M3 = M2.concat([mv('M10', '11:06', 'C5', 'R1', 'lead')]);
  const b = B.boardFrom(M3, live, workers);
  assert.deepEqual(BB.planUndo(M3, b, 'B-clear01').rows, [{ worker: 'C1', to_route: 'R1', role: 'member', undoes: 'B-clear01' }]);
});

test('planUndo: two cleared leads of one route get only one lead back', () => {
  const rows = [
    mv('L1', '11:00', 'C1', null, null, { batch: 'B-two', from_route: 'R1', from_role: 'lead' }),
    mv('L2', '11:00', 'C2', null, null, { batch: 'B-two', from_route: 'R1', from_role: 'lead' }),
  ];
  const mm = [mv('N1', '10:00', 'C1', 'R1', 'lead'), mv('N2', '10:01', 'C2', 'R1', 'lead')].concat(rows);
  const b = B.boardFrom(mm, live, workers);
  assert.deepEqual(BB.planUndo(mm, b, 'B-two').rows, [
    { worker: 'C1', to_route: 'R1', role: 'lead', undoes: 'B-two' },
    { worker: 'C2', to_route: 'R1', role: 'member', undoes: 'B-two' },
  ]);
});

test('planUndo: an unknown batch is not known; an undone batch is done with no rows', () => {
  assert.deepEqual(BB.planUndo(M2, board2, 'B-nope'), { rows: [], left: 0, known: false, done: false });
  const M4 = M2.concat([mv('U1', '11:07', 'C1', 'R1', 'lead', { undoes: 'B-clear01' })]);
  assert.deepEqual(BB.planUndo(M4, board2, 'B-clear01'), { rows: [], left: 0, known: true, done: true });
});

test('undoOffer: the latest clear, unless the Post is newer, done, or nobody can go back', () => {
  assert.deepEqual(BB.undoOffer(M2, board2, null), { batch: 'B-clear01', count: 3 });
  assert.deepEqual(BB.undoOffer(M2, board2, { posted_at: at('10:30') }), { batch: 'B-clear01', count: 3 });
  assert.equal(BB.undoOffer(M2, board2, { posted_at: at('11:10') }), null);
  assert.equal(BB.undoOffer(M2, board2, { posted_at: at('11:00') }), null);
  const done = M2.concat([mv('U1', '11:07', 'C1', 'R1', 'lead', { undoes: 'B-clear01' })]);
  assert.equal(BB.undoOffer(done, board2, null), null);
  assert.equal(BB.undoOffer(M, board, null), null);
});

test('undoOffer: every cleared person placed since gives null', () => {
  const placed = M2.concat([mv('P1', '11:06', 'C1', 'R1', 'lead'), mv('P2', '11:06', 'C3', 'R3', 'member')]);
  const b = B.boardFrom(placed, live, workers);
  assert.equal(BB.undoOffer(placed, b, null), null);
});

test('undoOffer: an older clear never stands in for the newest one', () => {
  const old = mv('O1', '10:30', 'C6', null, null, { batch: 'B-old', from_route: 'R3', from_role: 'member' });
  const withOld = [old].concat(M2);
  const b = B.boardFrom(withOld, live, workers);
  assert.deepEqual(BB.undoOffer(withOld, b, null), { batch: 'B-clear01', count: 3 });
  const done = withOld.concat([mv('U1', '11:07', 'C1', 'R1', 'lead', { undoes: 'B-clear01' })]);
  assert.equal(BB.undoOffer(done, b, null), null);
});

test('pickGroups: new people first (not on call last), then everyone else', () => {
  assert.deepEqual(BB.pickGroups(['C4', 'C5', 'C6'], workers, M, ''), {
    groups: [
      { key: 'new', label: 'New: never on a route', people: ['C5', 'C6'] },
      { key: 'rest', label: 'Everyone else', people: ['C4'] },
    ], total: 3, matched: 3,
  });
});

test('pickGroups: a search matches part of a name, any case; no match leaves no groups', () => {
  const r = BB.pickGroups(['C4', 'C5', 'C6'], workers, M, 'E');
  assert.deepEqual(r.groups.map((g) => g.people), [['C5'], ['C4']]);
  assert.equal(r.matched, 2);
  assert.equal(r.total, 3);
  assert.deepEqual(BB.pickGroups(['C4', 'C5', 'C6'], workers, M, ' dE '), { groups: [{ key: 'rest', label: 'Everyone else', people: ['C4'] }], total: 3, matched: 1 });
  assert.deepEqual(BB.pickGroups(['C4', 'C5', 'C6'], workers, M, 'zz'), { groups: [], total: 3, matched: 0 });
});

test('pickGroups: the search is taken literally, not as a regex', () => {
  assert.equal(BB.pickGroups(['C4', 'C5', 'C6'], workers, M, '.').matched, 0);
});

test('pickGroups: within a group, names A to Z, not on call last', () => {
  const w = { X1: { name: 'Zed' }, X2: { name: 'Amy' }, X3: { name: 'Mo', on_call: false }, X4: { name: 'Bo' } };
  assert.deepEqual(BB.pickGroups(['X1', 'X2', 'X3', 'X4'], w, [], '').groups[0].people, ['X2', 'X4', 'X1', 'X3']);
});

test('pickGroups: a person with only an off row was never on a route, so is new', () => {
  const w = { Y1: { name: 'Ida' }, Y2: { name: 'Jo' } };
  const mm = [mv('Z1', '09:00', 'Y1', null, null), mv('Z2', '09:01', 'Y2', 'R1', 'member'), mv('Z3', '09:02', 'Y2', null, null)];
  assert.deepEqual(BB.pickGroups(['Y1', 'Y2'], w, mm, '').groups.map((g) => g.key + ':' + g.people.join()), ['new:Y1', 'rest:Y2']);
});

// A clear row whose from_route names an Object.prototype member ('constructor') is no route: the person is left, not written.
// Paper: C5 is unassigned; the lookup board.routes['constructor'] must not find Object's constructor, so rows [], left 1.
test('planUndo: a clear row naming "constructor" is no route, so nothing is written and the person is left', () => {
  const odd = [mv('Q1', '11:00', 'C5', null, null, { batch: 'B-proto', from_route: 'constructor', from_role: 'member' })];
  const mm = M.concat(odd);
  const b = B.boardFrom(mm, ROUTES, workers);
  assert.deepEqual(BB.planUndo(mm, b, 'B-proto'), { rows: [], left: 1, known: true, done: false });
});

test('pickGroups: a worker id "constructor" is not read as placed', () => {
  const w = { constructor: { name: 'Odd' } };
  assert.deepEqual(BB.pickGroups(['constructor'], w, [], '').groups.map((g) => g.key), ['new']);
});
