const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/pairing.js');

const sites = [{ id: 'S1', name: 'PAC', needs_clearance: null }, { id: 'S2', name: 'Gate 3', needs_clearance: 'JBER' }, { id: 'S3', name: 'Gone', archived: true }];

test('routes become warning routes with their live sites', () => {
  const r = P.routesForWarnings([{ id: 'R1', name: 'N1', site_ids: ['S1', 'S2', 'S3'] }, { id: 'R9', name: 'Old', site_ids: [], archived: true }], sites);
  assert.deepEqual(r, [{ id: 'R1', name: 'N1', sites: [{ name: 'PAC', needs_clearance: null }, { name: 'Gate 3', needs_clearance: 'JBER' }] }]);
});

test('changed since post: same crews in the same roles is not a change', () => {
  const board = { routes: { R1: { lead: 'C01', members: ['C03'] }, R2: { lead: null, members: [] } } };
  const post = { routes: [{ id: 'R1', lead: 'C01', members: ['C03'] }, { id: 'R2', lead: null, members: [] }] };
  assert.equal(P.changedSincePost(board, post), false);
  assert.equal(P.changedSincePost({ routes: { R1: { lead: 'C03', members: ['C01'] }, R2: board.routes.R2 } }, post), true);
  assert.equal(P.changedSincePost(board, null), true);
  // Same lead, same head count, a different person: still a change the crew must see.
  assert.equal(P.changedSincePost({ routes: { R1: { lead: 'C01', members: ['C04'] }, R2: board.routes.R2 } }, post), true);
});

// Place from the roster (Matt, 10/6/26): what a roster tile says about tonight's Board.
test('placementLabel: where the Board has a person, in the words the roster tile shows', () => {
  const board = { routes: { R1: { lead: 'C01', members: ['C03'] }, R2: { lead: null, members: ['C04'] } }, unassigned: ['C05'] };
  const routes = { R1: { id: 'R1', name: 'N1' }, R2: { id: 'R2', name: 'N2' } };
  assert.equal(P.placementLabel(board, routes, 'C01'), 'N1 · lead');
  assert.equal(P.placementLabel(board, routes, 'C03'), 'N1');
  assert.equal(P.placementLabel(board, routes, 'C04'), 'N2');
  assert.equal(P.placementLabel(board, routes, 'C05'), 'Unplaced');
  assert.equal(P.placementLabel(board, routes, 'C99'), 'Unplaced');   // not on the Board at all
  // A route the phone has no record of (archived since): its id, never a crash.
  assert.equal(P.placementLabel({ routes: { RX: { lead: null, members: ['C03'] } } }, routes, 'C03'), 'RX');
});
