const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/warnings');
const fx = require('./fixture.js');

const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const workers = byId(fx.workers);
const route = byId(fx.routes);            // N1 = PAC (plain), N2 = JBER (needs JBER), N4 = TUDOR-TRANSIT (plain)
const rules = (ws) => ws.map((w) => w.rule).sort();
const clone = (o) => JSON.parse(JSON.stringify(o));

test('clearance: expired the day before fires', () => {
  // Sam's JBER expires 2026-10-20. On 10/21 it has lapsed. Sam leads and drives,
  // cold-rated, own gear, on call, valid ID -> the only warning is the clearance.
  const ws = W.warningsFor(route.N2, { lead: 'C02', members: [] }, workers, [], '2026-10-21');
  assert.deepEqual(rules(ws), ['clearance']);
  assert.match(ws[0].text, /JBER clearance expired 2026-10-20/);
});
test('clearance: still valid on its expiry day', () => {
  assert.deepEqual(W.warningsFor(route.N2, { lead: 'C02', members: [] }, workers, [], '2026-10-20'), []);
});
test('clearance: missing entry fires', () => {
  const ws = W.warningsFor(route.N2, { lead: 'C01', members: [] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['clearance']);
  assert.match(ws[0].text, /no JBER clearance/);
});
test('clearance: not required on a route without a clearance site', () => {
  assert.deepEqual(W.warningsFor(route.N1, { lead: 'C02', members: [] }, workers, [], '2026-10-21'), []);
});
test('clearance soon: blank setting never warns early', () => {
  // 5 days before expiry, no window set -> nothing.
  assert.deepEqual(W.warningsFor(route.N2, { lead: 'C02', members: [] }, workers, [], '2026-10-15', {}), []);
});
test('clearance soon: fires inside the window only', () => {
  // 10/15 -> 10/20 is 5 days. 5 <= 7 fires; 5 <= 3 does not.
  const ws = W.warningsFor(route.N2, { lead: 'C02', members: [] }, workers, [], '2026-10-15', { soonDays: 7 });
  assert.deepEqual(rules(ws), ['clearance-soon']);
  assert.match(ws[0].text, /expires 2026-10-20/);
  assert.deepEqual(W.warningsFor(route.N2, { lead: 'C02', members: [] }, workers, [], '2026-10-15', { soonDays: 3 }), []);
});
test('ride: driver on the same route is fine', () => {
  // Jordan rides with Alex, both on N1. Jordan is not cold-rated and needs gear issued.
  const ws = W.warningsFor(route.N1, { lead: 'C01', members: ['C03'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['cold', 'gear']);
});
test('ride: driver elsewhere fires', () => {
  const ws = W.warningsFor(route.N4, { lead: 'C07', members: ['C03'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['cold', 'gear', 'ride']);
  assert.match(ws.find((w) => w.rule === 'ride').text, /Jordan Demo rides with Alex Test/);
});
test('ride: archived driver still fires', () => {
  // Quinn rides with Pat (C12, archived). Pat can never be on the board.
  const ws = W.warningsFor(route.N1, { lead: 'C01', members: ['C10'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['ride']);
});
test('keep apart: one warning per pair', () => {
  // Sam and Morgan list each other. Morgan is also not cold-rated and needs gear.
  const ws = W.warningsFor(route.N1, { lead: 'C02', members: ['C06'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['cold', 'gear', 'keep-apart']);
});
test('keep apart: one side listing is enough', () => {
  const w = clone(workers);
  w.C06.keep_apart_from = [];             // only Sam still lists Morgan
  const ws = W.warningsFor(route.N1, { lead: 'C02', members: ['C06'] }, w, [], '2026-10-01');
  assert.ok(rules(ws).includes('keep-apart'));
});
test('gear: issued parka clears the gear warning', () => {
  const log = [{ date: '2026-10-01', worker: 'C06', type: 'issued', item: 'Parka' }];
  const ws = W.warningsFor(route.N1, { lead: 'C01', members: ['C06'] }, workers, log, '2026-10-02');
  assert.deepEqual(rules(ws), ['cold']);  // still not cold-rated, but has gear now
});
test('id: invalid id on a clearance route fires', () => {
  // Casey has no JBER clearance AND no valid ID. Sam is valid on 10/01.
  const ws = W.warningsFor(route.N2, { lead: 'C02', members: ['C04'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['clearance', 'id']);
});
test('id: invalid id on a plain route is fine', () => {
  assert.deepEqual(W.warningsFor(route.N1, { lead: 'C01', members: ['C04'] }, workers, [], '2026-10-01'), []);
});
test('crew shape: no lead and no driver', () => {
  // Casey and Drew: neither drives, no lead, and Drew's driver (Taylor) is not here.
  const ws = W.warningsFor(route.N4, { lead: null, members: ['C04', 'C08'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['no-driver', 'no-lead', 'ride']);
});
test('not on call: placed anyway fires', () => {
  const ws = W.warningsFor(route.N1, { lead: 'C01', members: ['C05'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['not-on-call']);
});
test('not set never fires', () => {
  // Casey with every judgment field blank, and a JBER clearance with no expiry recorded.
  const w = clone(workers);
  Object.assign(w.C04, { valid_id: null, cold_rated: null, can_drive: null, on_call: null, gear: null,
    clearances: [{ site: 'JBER', cleared: true, date: '2025-11-01', expires: null }] });
  assert.deepEqual(W.warningsFor(route.N2, { lead: 'C02', members: ['C04'] }, w, [], '2026-10-01'), []);
});
test('empty route has no warnings', () => {
  assert.deepEqual(W.warningsFor(route.N1, { lead: null, members: [] }, workers, [], '2026-10-01'), []);
});

// --- final review I7: "not set" is said as "not set", never as "no"
test('unknown driver is flagged as unknown, not as no driver', () => {
  // Casey alone on plain N1 with can_drive blank. Not "Nobody can drive": nobody is CONFIRMED.
  const w = clone(workers);
  w.C04.can_drive = null;
  const ws = W.warningsFor(route.N1, { lead: 'C04', members: [] }, w, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['driver-unknown']);
  assert.match(ws[0].text, /No confirmed driver \(1 not set\)/);
});
test('clearance marked not set is flagged as unknown', () => {
  const w = clone(workers);
  w.C02.clearances = [{ site: 'JBER', cleared: null, date: null, expires: '2027-01-01' }];
  const ws = W.warningsFor(route.N2, { lead: 'C02', members: [] }, w, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['clearance-unknown']);
  assert.match(ws[0].text, /JBER clearance not set/);
});

// --- 10/7/26 (Matt, first field test): a lead who can't drive is ALLOWED, and named.
// The lead drives the truck, so the route-level "nobody can drive" is not enough: with
// a driving member aboard it stays quiet while the lead still has no licence.
test("lead who can't drive: allowed, warned by name, even with a driver aboard", () => {
  // Casey (can_drive false) leads N1 with Alex (drives): no-driver stays quiet, the lead is named.
  const ws = W.warningsFor(route.N1, { lead: 'C04', members: ['C01'] }, workers, [], '2026-10-01');
  assert.deepEqual(rules(ws), ['lead-no-licence']);
  assert.deepEqual(ws[0].workers, ['C04']);
  assert.equal(ws[0].text, "Casey Mock leads but can't drive");
});
test("lead who can't drive: a non-driving MEMBER is not named; a lead with licence not set is not named (driver-unknown covers it)", () => {
  // Alex leads, Casey rides: nothing (Alex drives).
  assert.deepEqual(rules(W.warningsFor(route.N1, { lead: 'C01', members: ['C04'] }, workers, [], '2026-10-01')), []);
  // Casey leads alone with can_drive blank: "not set" is said as not set, never as "can't drive".
  const w = clone(workers);
  w.C04.can_drive = null;
  assert.deepEqual(rules(W.warningsFor(route.N1, { lead: 'C04', members: [] }, w, [], '2026-10-01')), ['driver-unknown']);
});
