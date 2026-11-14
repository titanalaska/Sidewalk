// Site done / Site treated, shared rules. Expected values are worked on paper below, never read back from the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const Log = require('../lib/shiftlog.js');

// Site S1 zones (made-up):
//   Z1 Front walk sidewalk | Z2 Side walk sidewalk, new concrete | Z3 Ramp heated | Z4 Bay heated, new concrete
//   Z5 Stairs hand | Z6 "Curb - north" hand (walksFor rolls it into the curb item curbs-1) | Z7 Pile storage | Z8 Bed no_touch
// Walks in walksFor order (by name, then the curb item): Bay Z4, Front Z1, Ramp Z3, Side Z2, Stairs Z5, curbs-1. Z7 and Z8 are not walks.
// Site S2 has no zones: one whole-site walk.
const ring = [[-149.9, 61.2], [-149.9, 61.2001], [-149.9001, 61.2001]];
const z = (id, name, type, extra) => Object.assign({ id, site_id: 'S1', type, name, ring }, extra || {});
const ZONES = [
  z('Z1', 'Front walk', 'sidewalk'), z('Z2', 'Side walk', 'sidewalk', { new_concrete: true }),
  z('Z3', 'Ramp', 'heated'), z('Z4', 'Bay', 'heated', { new_concrete: true }),
  z('Z5', 'Stairs', 'hand'), z('Z6', 'Curb - north', 'hand'),
  z('Z7', 'Pile', 'storage'), z('Z8', 'Bed', 'no_touch'),
];

let seq = 0;
const row = (id, zone_id, state, extra) => Object.assign({ id, seq: ++seq, storm_id: 'ST-1', site_id: 'S1', zone_id, state, note: '', at: '2026-11-13T01:00:00', by_name: 'Pat' }, extra || {});
const base = () => { seq = 0; return [row('L-1', 'Z1', 'problem', { note: 'car on it' }), row('L-2', 'Z5', 'treated')]; };
const sorted = a => a.slice().sort((p, q) => p.zone_id < q.zone_id ? -1 : p.zone_id > q.zone_id ? 1 : 0);
const tap = (rows, kind, site, zones) => sorted(Log.siteTapWalks(rows, 'ST-1', site || 'S1', zones || ZONES, kind));
const BATCH = 'B-aaaaaa1';
const withBatch = () => base().concat([row('L-3', 'Z2', 'cleared', { batch: BATCH }), row('L-4', 'Z3', 'checked', { batch: BATCH }), row('L-5', 'Z4', 'checked', { batch: BATCH })]);

test('Site done: what the tap writes', () => {
  // Z1 problem -> skip; Z2 none -> cleared; Z3 heated none -> checked; Z4 heated none -> checked;
  // Z5 treated -> skip; curbs-1 -> never; Z7/Z8 are not walks.
  assert.deepEqual(tap(base(), 'done'), [{ zone_id: 'Z2', state: 'cleared' }, { zone_id: 'Z3', state: 'checked' }, { zone_id: 'Z4', state: 'checked' }]);
});

test('Site treated: what the tap writes', () => {
  // Z1 problem -> skip; Z2 sidewalk none -> treated; Z3, Z4 heated -> never; Z5 already treated -> skip; curbs-1 -> never.
  assert.deepEqual(tap(base(), 'treated'), [{ zone_id: 'Z2', state: 'treated' }]);
});

test('a site with no zones: the whole-site walk', () => {
  assert.deepEqual(tap(base(), 'done', 'S2', []), [{ zone_id: 'whole', state: 'cleared' }]);
  assert.deepEqual(tap(base(), 'treated', 'S2', []), [{ zone_id: 'whole', state: 'treated' }]);
});

test('another kind writes nothing', () => {
  assert.deepEqual(Log.siteTapWalks(base(), 'ST-1', 'S1', ZONES, 'bogus'), []);
  assert.deepEqual(Log.siteTapWalks(base(), 'ST-1', 'S1', ZONES, undefined), []);
});

test('a cleared walk is treated by Site treated, and a treated one is left by Site done', () => {
  // Only L-1 Z2 cleared: Site treated writes Z1, Z2, Z5 (no problem here); heated and the curb item never.
  seq = 0;
  assert.deepEqual(tap([row('L-1', 'Z2', 'cleared')], 'treated'),
    [{ zone_id: 'Z1', state: 'treated' }, { zone_id: 'Z2', state: 'treated' }, { zone_id: 'Z5', state: 'treated' }]);
  // Z2 treated: Site done has Z1 cleared, Z3 + Z4 checked, Z5 cleared and nothing for Z2.
  seq = 0;
  assert.deepEqual(tap([row('L-1', 'Z2', 'treated')], 'done'),
    [{ zone_id: 'Z1', state: 'cleared' }, { zone_id: 'Z3', state: 'checked' }, { zone_id: 'Z4', state: 'checked' }, { zone_id: 'Z5', state: 'cleared' }]);
});

test('a walk undone back to none counts as not done', () => {
  // L-1 Z2 cleared, L-2 undoes it (state none): Z2 is open again, so Site done writes it with the rest.
  seq = 0;
  const rows = [row('L-1', 'Z2', 'cleared'), row('L-2', 'Z2', 'none', { undoes: 'L-1' })];
  assert.deepEqual(tap(rows, 'done'), [{ zone_id: 'Z1', state: 'cleared' }, { zone_id: 'Z2', state: 'cleared' }, { zone_id: 'Z3', state: 'checked' },
    { zone_id: 'Z4', state: 'checked' }, { zone_id: 'Z5', state: 'cleared' }]);
});

test('after a batch: Site done has nothing left, Site treated still treats Z2', () => {
  // Z1 problem, Z2 cleared, Z3 checked, Z4 checked, Z5 treated: all done for Site done. Site treated: only Z2 (cleared -> treated).
  const rows = withBatch();
  assert.deepEqual(tap(rows, 'done'), []);
  assert.deepEqual(tap(rows, 'treated'), [{ zone_id: 'Z2', state: 'treated' }]);
  const b = Log.siteBatch(rows, 'ST-1', 'S1');
  assert.equal(b.batch, BATCH);
  assert.equal(b.kind, 'done');
  assert.equal(b.standing, 3);
  assert.equal(b.by_name, 'Pat');
  assert.equal(Log.siteBatch(rows, 'ST-1', 'S2'), null);
});

test('batchUndo: a walk tapped by hand since is kept', () => {
  // L-6 Z3 problem by hand: newer than L-4, so L-4 stays. L-3 (Z2) and L-5 (Z4) are the newest on their walks and go back to none.
  const rows = withBatch().concat([row('L-6', 'Z3', 'problem', { note: 'ice' })]);
  const u = Log.batchUndo(rows, 'ST-1', BATCH);
  assert.deepEqual(u.targets.map(t => [t.row.id, t.state, t.note]), [['L-3', 'none', ''], ['L-5', 'none', '']]);
  assert.equal(u.kept, 1);
  assert.equal(u.before, 0);
  assert.equal(Log.siteBatch(rows, 'ST-1', 'S1').standing, 2);
});

test('batchUndo: rows already undone count as before; nothing stands, siteBatch is null', () => {
  // L-7 undoes L-3, L-8 undoes L-5: before 2. L-4 is under L-6: kept 1. No target, so no standing batch.
  const rows = withBatch().concat([row('L-6', 'Z3', 'problem'), row('L-7', 'Z2', 'none', { undoes: 'L-3' }), row('L-8', 'Z4', 'none', { undoes: 'L-5' })]);
  const u = Log.batchUndo(rows, 'ST-1', BATCH);
  assert.equal(u.targets.length, 0);
  assert.equal(u.kept, 1);
  assert.equal(u.before, 2);
  assert.equal(Log.siteBatch(rows, 'ST-1', 'S1'), null);
});

test('a treated batch over a cleared walk undoes back to cleared', () => {
  // L-1 Z2 cleared by hand, L-2 Z2 treated in batch B-bbbbbb2: undo goes back to what L-1 said.
  seq = 0;
  const rows = [row('L-1', 'Z2', 'cleared'), row('L-2', 'Z2', 'treated', { batch: 'B-bbbbbb2' })];
  const u = Log.batchUndo(rows, 'ST-1', 'B-bbbbbb2');
  assert.deepEqual(u.targets.map(t => [t.row.id, t.state]), [['L-2', 'cleared']]);
  assert.equal(Log.siteBatch(rows, 'ST-1', 'S1').kind, 'treated');
});

test('Clean again after a batch: the old batch is gone, every non-curb walk is open again', () => {
  // L-9 is a Clean again row: the pass restarts, so L-1..L-5 no longer count.
  // Site done writes Z1, Z2, Z5 cleared and Z3, Z4 checked; never the curb item.
  const rows = withBatch().concat([row('L-9', '*', 'again')]);
  assert.deepEqual(tap(rows, 'done'), [{ zone_id: 'Z1', state: 'cleared' }, { zone_id: 'Z2', state: 'cleared' }, { zone_id: 'Z3', state: 'checked' },
    { zone_id: 'Z4', state: 'checked' }, { zone_id: 'Z5', state: 'cleared' }]);
  assert.equal(Log.siteBatch(rows, 'ST-1', 'S1'), null);
  const u = Log.batchUndo(rows, 'ST-1', BATCH);
  assert.equal(u.targets.length, 0);
  assert.equal(u.kept, 3);
  assert.equal(u.before, 0);
});

test('siteBatch picks the newest standing batch', () => {
  // Batch 1 is L-3..L-5; batch 2 treats Z2 after it (L-6). Batch 2 is newest by seq, kind treated, standing 1.
  const rows = withBatch().concat([row('L-6', 'Z2', 'treated', { batch: 'B-cccccc3' })]);
  const b = Log.siteBatch(rows, 'ST-1', 'S1');
  assert.equal(b.batch, 'B-cccccc3');
  assert.equal(b.kind, 'treated');
  assert.equal(b.standing, 1);
});

test('isBatchId', () => {
  assert.equal(Log.isBatchId('B-abc123'), true);
  assert.equal(Log.isBatchId('B-' + 'a'.repeat(40)), true);
  assert.equal(Log.isBatchId('B-' + 'a'.repeat(41)), false);
  for (const bad of ['B-abc', 'X-abc123', 'B-abc 12', null, undefined, 123]) assert.equal(Log.isBatchId(bad), false);
});

test('isCurbItem', () => {
  assert.equal(Log.isCurbItem({ zone_id: 'curbs-1' }), true);
  assert.equal(Log.isCurbItem({ zone_id: 'curbs-12' }), true);
  for (const bad of ['curbs-', 'curbs-x', 'Z6', 'whole', 'xcurbs-1', 'curbs-1x']) assert.equal(Log.isCurbItem({ zone_id: bad }), false);
});
