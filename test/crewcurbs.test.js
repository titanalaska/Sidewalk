// Curbs for the crew: crewZones keeps a site's curb zones only where the site says crew_curbs === true.
// Expected values are worked on paper in the comments.
const test = require('node:test');
const assert = require('node:assert/strict');
const Log = require('../lib/shiftlog.js');
const RS = require('../lib/routesheet.js');

const ring = [[-149.9, 61.2], [-149.9, 61.2001], [-149.9001, 61.2001]];   // short: any set of curb lines is ONE item
const z = (id, site, type, name) => ({ id, site_id: site, type, name, ring });
const zones = [
  z('A1', 'S1', 'sidewalk', 'Front walk'), z('A2', 'S1', 'hand', 'Curb - north'), z('A3', 'S1', 'hand', 'Curb - south'),
  z('B1', 'S2', 'sidewalk', 'Front walk'), z('B2', 'S2', 'hand', 'Curb - north'), z('B3', 'S2', 'hand', 'Curb - south'), z('B4', 'S2', 'hand', 'Stairs'),
  z('C1', 'S3', 'hand', 'Curb - north'), z('C2', 'S3', 'hand', 'Curb - south'),
];
const sites = [{ id: 'S1', name: 'Birch Clinic', crew_curbs: true }, { id: 'S2', name: 'Spruce Office' }, { id: 'S3', name: 'Alder Hall', crew_curbs: false }];
const ids = a => a.map(x => x.id);

test('crewCurbs: only an exact true', () => {
  assert.equal(Log.crewCurbs({ crew_curbs: true }), true);
  [{ crew_curbs: 'yes' }, { crew_curbs: 1 }, { crew_curbs: null }, { crew_curbs: false }, {}, null, undefined].forEach(s =>
    assert.equal(Log.crewCurbs(s), false, JSON.stringify(s)));
});

test('crewZones: S1 keeps all 3, S2 keeps sidewalk + Stairs, S3 keeps none', () => {
  // S1 (on): A1 A2 A3. S2 (absent): B1 B4 (curbs B2 B3 out). S3 (false, only curbs): nothing.
  assert.deepEqual(ids(Log.crewZones(zones, sites)), ['A1', 'A2', 'A3', 'B1', 'B4']);
});

test('crewZones: the inputs are not changed', () => {
  const zCopy = JSON.stringify(zones), sCopy = JSON.stringify(sites);
  const out = Log.crewZones(zones, sites);
  assert.equal(JSON.stringify(zones), zCopy);
  assert.equal(JSON.stringify(sites), sCopy);
  assert.notEqual(out, zones);
  assert.equal(zones.length, 9);
});

test("crewZones: crew_curbs 'yes' and an unknown site both drop their curbs", () => {
  const zs = [z('D1', 'S4', 'sidewalk', 'Walk'), z('D2', 'S4', 'hand', 'Curb - east'), z('E1', 'S9', 'sidewalk', 'Walk'), z('E2', 'S9', 'hand', 'Curb - east')];
  // S4 says 'yes' (not true): D1 only. S9 is not in sites: the curb is dropped, the sidewalk stays.
  assert.deepEqual(ids(Log.crewZones(zs, [{ id: 'S4', crew_curbs: 'yes' }])), ['D1', 'E1']);
});

test('crewZones: no zones / no sites', () => {
  assert.deepEqual(Log.crewZones(null, sites), []);
  assert.deepEqual(Log.crewZones(zones.slice(0, 1), null), ['A1'].map(() => zones[0]));
});

test('walksFor over crewZones: S2 has no curbs item, S1 is what it is today, S3 is the whole-site walk', () => {
  const cz = Log.crewZones(zones, sites);
  // S2: Front walk, Stairs (by name), no curbs-1.
  assert.deepEqual(Log.walksFor('S2', cz).map(w => w.name), ['Front walk', 'Stairs']);
  assert.equal(Log.walksFor('S2', cz).some(w => /^curbs-/.test(w.zone_id)), false);
  // S1: front walk + one curbs item, identical to the unfiltered list.
  assert.deepEqual(Log.walksFor('S1', cz), Log.walksFor('S1', zones));
  assert.ok(Log.walksFor('S1', cz).some(w => w.zone_id === 'curbs-1'));
  // S3: nothing left to walk -> one whole-site walk.
  assert.deepEqual(Log.walksFor('S3', cz), [{ zone_id: 'whole', type: 'sidewalk', name: 'Whole site', new_concrete: false }]);
});

test('siteDone at S2: Front walk + Stairs done, no curb tap needed', () => {
  const cz = Log.crewZones(zones, sites);
  const states = {};
  states[Log.walkKey('S2', 'B1')] = { state: 'cleared' };
  assert.equal(Log.siteDone('S2', cz, states), false);   // Stairs still open
  states[Log.walkKey('S2', 'B4')] = { state: 'cleared' };
  assert.equal(Log.siteDone('S2', cz, states), true);
  // Uncut, the curbs item would still be owed.
  assert.equal(Log.siteDone('S2', zones, states), false);
});

test('route sheet: an earlier curbs-1 tap at S2 prints as Curbs with its state, not Removed zone', () => {
  const cz = Log.crewZones(zones, sites);
  const o = {
    storm_id: 'ST-1', zones: cz, visits: [], storms: [{ kind: 'start', storm_id: 'ST-1', seq: 1 }],
    sites: [{ id: 'S2', name: 'Spruce Office' }], routes: [{ id: 'R1', name: 'Route 1', site_ids: ['S2'] }],
    log: [{ id: 'L-1', seq: 1, storm_id: 'ST-1', shift_id: 'night-2026-12-04', site_id: 'S2', zone_id: 'curbs-1', state: 'cleared',
      note: '', by_name: 'Alex Test', at: '2026-12-04T19:01:00-09:00', snowing_warned: false, undoes: null }],
  };
  const data = RS.sheetData(o, 'R1', 'night-2026-12-04');
  const html = RS.sheetBody(data, '2026-12-05T06:00:00-09:00', false);
  const w = data.sites[0].walks.filter(x => x.state === 'cleared');
  assert.equal(w.length, 1);
  assert.equal(w[0].name, 'Curbs');
  assert.equal(w[0].new_concrete, false);
  assert.ok(html.indexOf('Removed zone') === -1);
  assert.ok(html.indexOf('Curbs') !== -1 && html.indexOf('Cleared') !== -1);
});
