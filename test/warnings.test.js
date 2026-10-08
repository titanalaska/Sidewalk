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

// ---- Valley and a short night (Matt, 10/8/26) ----
// A night is short when the work cannot reach 8 hours before the 8 AM deadline. 8 working hours
// plus the mandatory 30-minute lunch is 8.5 hours on the clock, so the latest start that still
// gets there is 8:00 AM minus 8.5 h = 11:30 PM. "Midnight to 8" is only 7.5 hours of work (Matt's
// correction of the first draft, which said midnight). After 11:30 PM and before 8:00 AM is short.
// Exactly 11:30:00 PM is exactly 8 hours: not short.
test('isShortNight: after 11:30 PM and before 8:00 AM, to the second; a manual switch adds nights the clock cannot know', () => {
  const at = (hms) => '2026-10-09T' + hms + '-08:00';
  const table = [
    ['23:29:59', false], ['23:30:00', false], ['23:30:01', true], ['23:59:59', true],
    ['00:00:00', true], ['03:15:00', true], ['07:59:59', true], ['08:00:00', false],
    ['09:00:00', false], ['12:00:00', false], ['18:00:00', false], ['20:00:00', false],
  ];
  for (const [hms, want] of table) assert.equal(W.isShortNight(at(hms), false), want, hms);
  // A cleanup night starts around 8 PM with little work: only Matt knows, so his switch turns it on.
  assert.equal(W.isShortNight(at('20:00:00'), true), true);
  assert.equal(W.isShortNight(at('12:00:00'), true), true);
  // The switch never turns the clock's own answer off.
  assert.equal(W.isShortNight(at('00:30:00'), false), true);
});

test('isShortNight: a time that cannot be read is not a short night, and never throws; the switch still counts', () => {
  for (const bad of ['', null, undefined, 'tonight', 12, '2026-10-09']) {
    assert.equal(W.isShortNight(bad, false), false, String(bad));
    assert.equal(W.isShortNight(bad, true), true, String(bad));
  }
});

test('the short-night cutoff is worked out from the three numbers, never typed in', () => {
  const S = W.SHORT_NIGHT;
  assert.deepEqual([S.workHours, S.lunchMinutes, S.deadlineHour], [8, 30, 8]);
  // 24:00 + 8:00 deadline - (8 h work + 30 min lunch) = 23:30 = 84,600 seconds into the day.
  assert.equal(S.cutoffSeconds, 24 * 3600 + S.deadlineHour * 3600 - (S.workHours * 3600 + S.lunchMinutes * 60));
  assert.equal(S.cutoffSeconds, 84600);
});

const withHome = (id, home) => { const w = clone(workers); w[id].home_area = home; return w; };
test('valley-short: a Valley person on a route warns on a short night, naming them; warn only', () => {
  const ws = W.warningsFor(route.N1, { lead: 'C02', members: [] }, withHome('C02', 'valley'), [], '2026-10-01', { shortNight: true });
  assert.deepEqual(rules(ws), ['valley-short']);
  assert.equal(ws[0].text, 'Sam Sample: Valley, short night (under 8 hours)');
  assert.deepEqual(ws[0].workers, ['C02']);
});

test('valley-short: never on a normal night, for Anchorage, or when not set', () => {
  const lead = { lead: 'C02', members: [] };
  assert.deepEqual(W.warningsFor(route.N1, lead, withHome('C02', 'valley'), [], '2026-10-01', { shortNight: false }), []);
  assert.deepEqual(W.warningsFor(route.N1, lead, withHome('C02', 'valley'), [], '2026-10-01', {}), []);
  assert.deepEqual(W.warningsFor(route.N1, lead, withHome('C02', 'valley'), [], '2026-10-01'), []);
  assert.deepEqual(W.warningsFor(route.N1, lead, withHome('C02', 'anchorage'), [], '2026-10-01', { shortNight: true }), []);
  // Not set (null) and a record that never had the field are the same: no guess either way.
  assert.deepEqual(W.warningsFor(route.N1, lead, withHome('C02', null), [], '2026-10-01', { shortNight: true }), []);
  assert.deepEqual(W.warningsFor(route.N1, lead, workers, [], '2026-10-01', { shortNight: true }), []);
});

test('valley-short: one line per Valley person, beside the other warnings, never instead of them', () => {
  const w = withHome('C02', 'valley');
  w.C01.home_area = 'valley';
  w.C01.cold_rated = false;
  const ws = W.warningsFor(route.N1, { lead: 'C02', members: ['C01'] }, w, [], '2026-10-01', { shortNight: true });
  assert.deepEqual(rules(ws), ['cold', 'valley-short', 'valley-short']);
  assert.deepEqual(ws.filter((x) => x.rule === 'valley-short').map((x) => x.workers[0]).sort(), ['C01', 'C02']);
});
