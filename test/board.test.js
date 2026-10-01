const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/board');
const fx = require('./fixture.js');

const workers = Object.fromEntries(fx.workers.map((w) => [w.id, w]));
const routes = fx.routes;
const t = (hhmm) => '2026-11-01T' + hhmm + ':00-09:00';
const mv = (id, at, worker, to_route, role) => ({ id, at, worker, to_route, role });

test('board: lead and member land on the route', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N1', 'member'), mv('b', t('14:01'), 'C01', 'N1', 'lead')], routes, workers);
  assert.deepEqual(b.routes.N1, { lead: 'C01', members: ['C03'] });
  assert.deepEqual(b.routes.N4, { lead: null, members: [] });
});
test('board: new lead demotes the old one to member', () => {
  // Jordan 14:00, Alex lead 14:01, Taylor lead 14:02 -> Alex drops to member.
  // Members in placement order: Jordan (14:00), Alex (14:01).
  const b = B.boardFrom([
    mv('a', t('14:00'), 'C03', 'N1', 'member'),
    mv('b', t('14:01'), 'C01', 'N1', 'lead'),
    mv('c', t('14:02'), 'C07', 'N1', 'lead'),
  ], routes, workers);
  assert.deepEqual(b.routes.N1, { lead: 'C07', members: ['C03', 'C01'] });
});
test('board: demoted lead stays a member when the new lead leaves', () => {
  const b = B.boardFrom([
    mv('b', t('14:01'), 'C01', 'N1', 'lead'),
    mv('c', t('14:02'), 'C07', 'N1', 'lead'),
    mv('d', t('14:03'), 'C07', null, null),
  ], routes, workers);
  assert.deepEqual(b.routes.N1, { lead: null, members: ['C01'] });
});
test('board: a move leaves the old route', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N1', 'member'), mv('b', t('15:00'), 'C03', 'N4', 'member')], routes, workers);
  assert.deepEqual(b.routes.N1.members, []);
  assert.deepEqual(b.routes.N4.members, ['C03']);
});
test('board: unassign puts them in the tray', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N1', 'member'), mv('b', t('15:00'), 'C03', null, null)], routes, workers);
  assert.deepEqual(b.routes.N1.members, []);
  assert.ok(b.unassigned.includes('C03'));
});
test('board: archived worker is on neither board nor tray', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C12', 'N1', 'member')], routes, workers);
  assert.deepEqual(b.routes.N1.members, []);
  assert.ok(!b.unassigned.includes('C12'));
});
test('board: route that no longer exists sends them to the tray', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C01', 'N9', 'lead')], routes, workers);
  assert.ok(b.unassigned.includes('C01'));
});
test('board: same-timestamp moves order by id', () => {
  // Same instant. By id, 'a' (N1) comes before 'b' (N4), so N4 is final.
  // Given in the other order on purpose, so a sort that ignores id gets N1.
  const b = B.boardFrom([mv('b', t('14:00'), 'C03', 'N4', 'member'), mv('a', t('14:00'), 'C03', 'N1', 'member')], routes, workers);
  assert.deepEqual(b.routes.N4.members, ['C03']);
  assert.deepEqual(b.routes.N1.members, []);
});
test('tray: off-call workers sort last', () => {
  // Nobody placed. Nine active workers (C12 archived). By name, Riley (off call) last.
  const b = B.boardFrom([], routes, workers);
  assert.deepEqual(b.unassigned, ['C01', 'C04', 'C08', 'C03', 'C06', 'C10', 'C02', 'C07', 'C05']);
});
test('plan: same route and role is a no-op', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N1', 'member')], routes, workers);
  assert.equal(B.planMove(b, 'C03', 'N1', 'member', t('15:00')), null);
});
test('plan: role change is a move', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N1', 'member')], routes, workers);
  assert.deepEqual(B.planMove(b, 'C03', 'N1', 'lead', t('15:00')),
    { at: t('15:00'), worker: 'C03', to_route: 'N1', role: 'lead' });
});
test('plan: unassigning someone unplaced is a no-op', () => {
  assert.equal(B.planMove(B.boardFrom([], routes, workers), 'C03', null, null, t('15:00')), null);
});
test('roster: callout copies only routes with people', () => {
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N1', 'member'), mv('b', t('14:01'), 'C01', 'N1', 'lead')], routes, workers);
  const r = B.rosterFrom(b);
  assert.deepEqual(r, { N1: { lead: 'C01', members: ['C03'] } });
  r.N1.members.push('X');                     // a copy, not a live reference
  assert.deepEqual(b.routes.N1.members, ['C03']);
});

// --- final review C1: a double tap during a slow write must not write a worker-less move
test('plan: no worker is a no-op', () => {
  // N4 has no lead. whereIs(null) used to match it and planMove wrote {worker: null}.
  const b = B.boardFrom([], routes, workers);
  assert.equal(B.planMove(b, null, 'N4', 'lead', t('15:00')), null);
});
test('board: a move with no worker is ignored', () => {
  // Jordan made lead of N4, then a stray worker-less lead move at the same instant.
  // Without the guard the stray record demotes Jordan: {lead: null, members: ['C03']}.
  const b = B.boardFrom([mv('a', t('14:00'), 'C03', 'N4', 'lead'), mv('b', t('14:00'), null, 'N4', 'lead')], routes, workers);
  assert.deepEqual(b.routes.N4, { lead: 'C03', members: [] });
});
test('roster: removing no-shows keeps the route and clears a lead', () => {
  const r = B.withoutWorkers({ N1: { lead: 'C01', members: ['C03', 'C04'] } }, ['C03', 'C01']);
  assert.deepEqual(r, { N1: { lead: null, members: ['C04'] } });
});
