// Crew stats (Matt, 11/19/26): the back of a baseball card for one crew member, this winter. The rules live in crewstats.js, shared
// byte-identical with the phone. Spec: "Sidewalk crew stats spec 2026-11-19 (approved by Matt).md". Made-up people only.
//
// The world, worked on paper. now = 2026-12-06 10:00 Alaska -> winter 2026-27 (July 1 starts a winter).
//   Routes: R1 "N1" holds S1, S2.  R2 "N2" holds S3.
//   Zones:  Z1 S1 sidewalk 1000 | Z2 S1 hand "Back steps" 200 | Z3 S1 hand "Curb north" 800 (a curb: never counts)
//           Z4 S1 heated 500 (Checked, never counts) | Z5 S2 sidewalk 600 | Z6 S3 sidewalk 900
//   Callouts: night-2026-12-04 roster R1 { lead C1, members C2, C3 }, R2 { lead C4 }, no_shows [C5] (Matt tapped Eli)
//             night-2026-11-08 roster R1 { lead C1, members C2 } (before Start/End existed)
//   Clock night-2026-12-04: C1 start tap 20:00 on R1, end tap 12-05 04:00 -> 480 min
//                           C2 typed in 22:00, out 12-05 04:00, route_id '' -> 360 min, route from the callout = R1
//                           C4 start tap 20:00 on R2, no end -> open, no hours
//   Clock night-2026-06-20 (last winter): C1 20:00 - 23:00 -> outside the season, never counted
//   Log:
//     L1  S1 Z1 cleared 12-04 21:00     open on R1 then: C1 only (Bea starts 22:00)   -> C1 +1000
//     L2  S1 Z2 cleared 12-04 23:00     open on R1: C1, C2                             -> +100 each
//     L3  S1 Z3 cleared (curb)                                                          -> nobody
//     L4  S1 Z4 checked (heated)                                                        -> nobody
//     L5  S2 Z5 cleared 23:30, L6 its undo                                              -> nobody
//     L7  S1 Z1 cleared 12-05 02:00, after a Clean again at S1 (seq 6.5) = pass 2: C1, C2 -> +500 each
//     L8  S3 Z6 cleared 12-05 01:00     open on R2: C4 (5 h in, no end, under 18 h)     -> C4 +900
//     L9  S3 Arrived off_route by C2 03:00, L10 again 03:30                             -> 1 help visit (one site, one shift)
//     L11 S2 Arrived off_route by C1, L12 its undo                                      -> C1 none
//     L13 S2 Z5 cleared night-2026-11-08 22:00, nobody has a Clock row that night      -> the callout's R1: C1, C2 +300 each
//     L14 S1 Arrived by C1 on his own route (off_route false)                           -> not a help visit
//     L15 S1 Z4 cleared 21:30 (tapped before Z4 was re-typed heated)                    -> nobody: a heated walk now
//   Visits (Site cards): C1 S1 12-04 seq 1 { bobcat 106, snowrator blank }, then seq 2 { bobcat 120 } (the newest wins) -> Bobcat 120
//                        C2 S1 12-04 { snowrator 90 }
//   Alex C1: called out 2, worked 1, no-show 0, 480 min, sq ft 1000 + 100 + 500 = 1600 on 12-04, + 300 on 11-08 = 1900
//   Bea  C2: called out 2, worked 1, 360 min, sq ft 100 + 500 = 600 on 12-04, + 300 = 900, Snowrator 90, help visits 1
//   Cy   C3: called out 1 on R1, no start, and Alex on R1 started -> no-show
//   Dee  C4: worked 1, open 1, minutes 0, sq ft 900
//   Eli  C5: in no_shows -> called out 1, no-show 1, no route
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/crewstats.js');

const NOW = '2026-12-06T10:00:00.000-09:00';
const N4 = 'night-2026-12-04', N8 = 'night-2026-11-08';
const at = (d, t) => d + 'T' + t + ':00.000-09:00';

let world = function () {
  let k = 0;
  const clk = (o) => Object.assign({ id: 'K-' + (++k), seq: k, route_id: 'R1', storm_id: 'ST-1', time_in: '', time_out: '', undoes: '', by_key: 'C9', by_name: 'Tapper' }, o);
  let l = 0;
  const log = (o) => Object.assign({ id: 'L' + (++l), seq: l, storm_id: 'ST-1', shift_id: N4, note: '', by_key: 'C1', by_name: 'Alex', off_route: false, undoes: null }, o);
  return {
    crewId: 'C1', now: NOW,
    routes: [{ id: 'R1', name: 'N1', site_ids: ['S1', 'S2'] }, { id: 'R2', name: 'N2', site_ids: ['S3'] }],
    zones: [
      { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Front walk', area_sqft: 1000 },
      { id: 'Z2', site_id: 'S1', type: 'hand', name: 'Back steps', area_sqft: 200 },
      { id: 'Z3', site_id: 'S1', type: 'hand', name: 'Curb north', area_sqft: 800 },
      { id: 'Z4', site_id: 'S1', type: 'heated', name: 'Entry', area_sqft: 500 },
      { id: 'Z5', site_id: 'S2', type: 'sidewalk', name: 'Walk', area_sqft: 600 },
      { id: 'Z6', site_id: 'S3', type: 'sidewalk', name: 'Walk', area_sqft: 900 },
    ],
    callouts: [
      { id: 'CO-1', shift: N4, roster: { R1: { lead: 'C1', members: ['C2', 'C3'] }, R2: { lead: 'C4', members: [] } }, no_shows: ['C5'] },
      { id: 'CO-2', shift: N8, roster: { R1: { lead: 'C1', members: ['C2'] } }, no_shows: [] },
    ],
    moves: [],
    clock: [
      clk({ shift_id: N4, kind: 'start', crew_id: 'C1', name: 'Alex', at: at('2026-12-04', '20:00') }),
      clk({ shift_id: N4, kind: 'end', crew_id: 'C1', name: 'Alex', at: at('2026-12-05', '04:00') }),
      clk({ shift_id: N4, kind: 'typed', crew_id: 'C2', name: 'Bea', route_id: '', at: at('2026-12-05', '06:00'), time_in: '2026-12-04T22:00', time_out: '2026-12-05T04:00' }),
      clk({ shift_id: N4, kind: 'start', crew_id: 'C4', name: 'Dee', route_id: 'R2', at: at('2026-12-04', '20:00') }),
      clk({ shift_id: 'night-2026-06-20', kind: 'start', crew_id: 'C1', name: 'Alex', at: at('2026-06-20', '20:00') }),
      clk({ shift_id: 'night-2026-06-20', kind: 'end', crew_id: 'C1', name: 'Alex', at: at('2026-06-20', '23:00') }),
    ],
    log: [
      log({ site_id: 'S1', zone_id: 'Z1', state: 'cleared', at: at('2026-12-04', '21:00') }),
      log({ site_id: 'S1', zone_id: 'Z2', state: 'cleared', at: at('2026-12-04', '23:00') }),
      log({ site_id: 'S1', zone_id: 'Z3', state: 'cleared', at: at('2026-12-04', '23:10') }),
      log({ site_id: 'S1', zone_id: 'Z4', state: 'checked', at: at('2026-12-04', '23:20') }),
      log({ site_id: 'S2', zone_id: 'Z5', state: 'cleared', at: at('2026-12-04', '23:30') }),
      log({ site_id: 'S2', zone_id: 'Z5', state: 'not_done', at: at('2026-12-04', '23:31'), undoes: 'L5' }),
      log({ site_id: 'S1', zone_id: 'Z1', state: 'cleared', at: at('2026-12-05', '02:00') }),
      // L7b: the Clean again that makes L7 a second pass. Written after L7 in this list but given a lower seq below.
      log({ site_id: 'S3', zone_id: 'Z6', state: 'cleared', at: at('2026-12-05', '01:00'), by_key: 'C4', by_name: 'Dee' }),
      log({ site_id: 'S3', zone_id: '*', state: 'arrived', at: at('2026-12-05', '03:00'), by_key: 'C2', by_name: 'Bea', off_route: true }),
      log({ site_id: 'S3', zone_id: '*', state: 'arrived', at: at('2026-12-05', '03:30'), by_key: 'C2', by_name: 'Bea', off_route: true }),
      log({ site_id: 'S2', zone_id: '*', state: 'arrived', at: at('2026-12-05', '03:40'), off_route: true }),
      log({ site_id: 'S2', zone_id: '*', state: 'arrived_undone', at: at('2026-12-05', '03:41'), off_route: true, undoes: 'L11' }),
      log({ shift_id: N8, storm_id: 'ST-0', site_id: 'S2', zone_id: 'Z5', state: 'cleared', at: at('2026-11-08', '22:00') }),
      // L14: Alex's Arrived at his OWN site S1: not a help visit.
      log({ site_id: 'S1', zone_id: '*', state: 'arrived', at: at('2026-12-04', '20:05') }),
      // L15: Z4 Cleared while it was still a sidewalk, re-typed heated since: counts by what it is now, so nothing.
      log({ site_id: 'S1', zone_id: 'Z4', state: 'cleared', at: at('2026-12-04', '21:30') }),
    ],
    visits: [
      { id: 'V-1', seq: 1, site_id: 'S1', shift_id: N4, by_key: 'C1', equipment: { blower: '', snowrator: '', bobcat: '106', sweepster: '' } },
      { id: 'V-2', seq: 2, site_id: 'S1', shift_id: N4, by_key: 'C1', equipment: { blower: '', snowrator: '', bobcat: '120', sweepster: '' } },
      { id: 'V-3', seq: 3, site_id: 'S1', shift_id: N4, by_key: 'C2', equipment: { blower: '', snowrator: '90', bobcat: '', sweepster: '' } },
    ],
  };
}
// The Clean again at S1 before L7 (seq between L6 and L7), added to every world.
const AGAIN = { id: 'A-1', seq: 6.5, storm_id: 'ST-1', shift_id: N4, site_id: 'S1', zone_id: '*', state: 'again', note: '', at: at('2026-12-05', '01:30'), by_key: 'C1', by_name: 'Alex', off_route: false, undoes: null };
const baseWorld = world;
world = () => { const w = baseWorld(); w.log.push(AGAIN); return w; };
const statsFor = (id, w) => S.forPerson(Object.assign(w || world(), { crewId: id }));
const night = (st, id) => st.nights.filter((n) => n.shift_id === id)[0];

test('crew stats: seasons turn on July 1', () => {
  assert.equal(S.seasonOf('2026-06-30'), '2025-26');
  assert.equal(S.seasonOf('2026-07-01'), '2026-27');
  assert.equal(S.seasonOf('2027-01-15'), '2026-27');
});

test('crew stats: Alex, a lead who worked one night and was called out for one before Start existed', () => {
  const st = statsFor('C1');
  assert.equal(st.crew_id, 'C1');
  assert.equal(st.season, '2026-27');
  assert.deepEqual(st.totals, { called_out: 2, worked: 1, no_show: 0, minutes: 480, open_nights: 0, sqft: 1900, machines: { bobcat: 120 }, help_visits: 0 });
  assert.deepEqual(st.nights, [
    { shift_id: N4, route_id: 'R1', route_name: 'N1', called_out: true, worked: true, no_show: false, minutes: 480, open: false, sqft: 1600, machines: { bobcat: 120 } },
    { shift_id: N8, route_id: 'R1', route_name: 'N1', called_out: true, worked: false, no_show: false, minutes: null, open: false, sqft: 300, machines: {} },
  ]);
});

test("crew stats: Bea's typed start has no route, so the callout gives her N1", () => {
  const st = statsFor('C2');
  assert.deepEqual(st.totals, { called_out: 2, worked: 1, no_show: 0, minutes: 360, open_nights: 0, sqft: 900, machines: { snowrator: 90 }, help_visits: 1 });
  assert.equal(night(st, N4).route_id, 'R1');
  assert.equal(night(st, N4).sqft, 600);
});

test('crew stats: Cy was called out on N1, N1 started, he never did: a no-show', () => {
  const st = statsFor('C3');
  assert.equal(st.totals.called_out, 1);
  assert.equal(st.totals.worked, 0);
  assert.equal(st.totals.no_show, 1);
  assert.equal(st.totals.sqft, 0);
  assert.equal(night(st, N4).no_show, true);
  assert.equal(night(st, N4).route_id, 'R1');
});

test('crew stats: Dee never tapped End: no hours, one open night, still her route\'s square feet', () => {
  const st = statsFor('C4');
  assert.equal(st.totals.minutes, 0);
  assert.equal(st.totals.open_nights, 1);
  assert.equal(st.totals.sqft, 900);
  assert.equal(night(st, N4).open, true);
  assert.equal(night(st, N4).minutes, null);
  assert.equal(night(st, N4).route_id, 'R2');
});

test('crew stats: Eli, tapped as a no-show on the Callout screen', () => {
  const st = statsFor('C5');
  assert.equal(st.totals.called_out, 1);
  assert.equal(st.totals.no_show, 1);
  assert.equal(st.totals.worked, 0);
  assert.equal(night(st, N4).route_id, '');
  assert.equal(night(st, N4).route_name, '');
});

test('crew stats: a tapped no-show who has a start worked', () => {
  const w = world();
  w.clock.push({ id: 'K-99', seq: 99, shift_id: N4, kind: 'start', crew_id: 'C5', name: 'Eli', route_id: 'R2', at: at('2026-12-04', '21:00'), time_in: '', time_out: '', undoes: '' });
  const st = statsFor('C5', w);
  assert.equal(st.totals.worked, 1);
  assert.equal(st.totals.no_show, 0);
});

test('crew stats: nobody on the route started, so nobody called out is a no-show', () => {
  // 11-08: C1 and C2 called out on R1, nobody has any Clock row that shift.
  assert.equal(night(statsFor('C2'), N8).no_show, false);
  assert.equal(statsFor('C2').totals.no_show, 0);
});

test('crew stats: a site on two routes shares among both crews once each', () => {
  // S3 also on R1: L8 at 12-05 01:00 -> open on R1: C1, C2; on R2: C4 -> 900 / 3 = 300 each.
  const w = world();
  w.routes[0].site_ids.push('S3');
  assert.equal(statsFor('C4', w).totals.sqft, 300);
  assert.equal(statsFor('C1', world2(w)).totals.sqft, 1900 + 300);
  function world2(x) { const y = world(); y.routes = x.routes; return y; }
});

test('crew stats: a walk cleared after Alex ended is Bea\'s alone', () => {
  // Alex ends 12-05 03:00 instead of 04:00; Z2 (200) cleared again at 03:30 -> open on R1: Bea only (her Out is 04:00) -> Bea +200.
  const w = world();
  w.clock[1].at = at('2026-12-05', '03:00');
  w.log.push({ id: 'L20', seq: 20, storm_id: 'ST-1', shift_id: N4, site_id: 'S1', zone_id: 'Z2', state: 'cleared', at: at('2026-12-05', '03:30'), by_key: 'C1', off_route: false, undoes: null });
  assert.equal(statsFor('C2', w).totals.sqft, 900 + 200);
  const w2 = world();
  w2.clock[1].at = at('2026-12-05', '03:00');
  w2.log = w.log;
  assert.equal(statsFor('C1', w2).totals.sqft, 1900);
});

test('crew stats: a late tap after everyone ended goes to those who started, never to the no-show', () => {
  // Z2 (200) cleared 12-05 05:00: Alex and Bea both ended 04:00 -> nobody open -> those who started on R1: Alex, Bea, 100 each.
  // The callout would also name Cy, a no-show: he gets nothing.
  const w = world();
  w.log.push({ id: 'L20', seq: 20, storm_id: 'ST-1', shift_id: N4, site_id: 'S1', zone_id: 'Z2', state: 'cleared', at: at('2026-12-05', '05:00'), by_key: 'C1', off_route: false, undoes: null });
  assert.equal(statsFor('C1', w).totals.sqft, 2000);
  assert.equal(statsFor('C3', w).totals.sqft, 0);
});

test('crew stats: an open start counts for 18 hours, then not', () => {
  // Fay (C6) joins R2: start tap 12-05 14:00, end 16:00. Z6 (900) cleared 12-05 15:00. Dee started 12-04 20:00 with no end:
  // 19 h before the tap, past the 18-hour rule, so she is not on shift then. Open: Fay only -> Fay +900, Dee keeps her 900 from L8.
  const w = world();
  w.clock.push({ id: 'K-50', seq: 50, shift_id: N4, kind: 'start', crew_id: 'C6', name: 'Fay', route_id: 'R2', at: at('2026-12-05', '14:00'), time_in: '', time_out: '', undoes: '' });
  w.clock.push({ id: 'K-51', seq: 51, shift_id: N4, kind: 'end', crew_id: 'C6', name: 'Fay', route_id: 'R2', at: at('2026-12-05', '16:00'), time_in: '', time_out: '', undoes: '' });
  // A Clean again at S3 at 14:30 first, so the 15:00 Cleared is a new pass (the same pass as L8 would count once).
  w.log.push({ id: 'A-2', seq: 19, storm_id: 'ST-1', shift_id: N4, site_id: 'S3', zone_id: '*', state: 'again', note: '', at: at('2026-12-05', '14:30'), by_key: 'C6', off_route: false, undoes: null });
  w.log.push({ id: 'L20', seq: 20, storm_id: 'ST-1', shift_id: N4, site_id: 'S3', zone_id: 'Z6', state: 'cleared', at: at('2026-12-05', '15:00'), by_key: 'C6', off_route: false, undoes: null });
  assert.equal(statsFor('C6', w).totals.sqft, 900);
  const w2 = world();
  w2.clock = w.clock; w2.log = w.log;
  assert.equal(statsFor('C4', w2).totals.sqft, 900);
});

test('crew stats: an archived zone still counts at its area', () => {
  const w = world();
  w.zones[0].archived = true;
  assert.equal(statsFor('C1', w).totals.sqft, 1900);
});

test('crew stats: someone with no rows anywhere', () => {
  const st = statsFor('C9');
  assert.deepEqual(st.totals, { called_out: 0, worked: 0, no_show: 0, minutes: 0, open_nights: 0, sqft: 0, machines: {}, help_visits: 0 });
  assert.deepEqual(st.nights, []);
});

test('crew stats: cardLines for Alex', () => {
  const c = S.cardLines(statsFor('C1'));
  assert.equal(c.season, 'Winter 2026-27');
  assert.deepEqual(c.rows, [['Nights worked', '1 (called out 2, no-show 0)'], ['Hours', '8:00'], ['Sq ft cleared', '1,900'],
    ['Machines', 'Bobcat 120 min'], ['Help visits', '0']]);
  assert.deepEqual(c.nights, [
    { when: 'Night of 12/4', route: 'N1', hours: '8:00', sqft: '1,600 sq ft', machines: 'Bobcat 120' },
    { when: 'Night of 11/8', route: 'N1', hours: 'called out', sqft: '300 sq ft', machines: '' },
  ]);
});

test('crew stats: cardLines words for the other cases', () => {
  const dee = S.cardLines(statsFor('C4'));
  assert.deepEqual(dee.rows[1], ['Hours', '0:00 (1 night with no End shift)']);
  assert.equal(dee.nights[0].hours, 'no End');
  const cy = S.cardLines(statsFor('C3'));
  assert.equal(cy.nights[0].hours, 'no-show');
  assert.equal(cy.nights[0].sqft, '');
  assert.deepEqual(S.cardLines(statsFor('C9')).rows[3], ['Machines', 'none']);
  // Sq ft to the nearest 100, with a comma.
  const fake = (sqft) => S.cardLines({ season: '2026-27', totals: { called_out: 0, worked: 0, no_show: 0, minutes: 0, open_nights: 0, sqft, machines: {}, help_visits: 0 }, nights: [] }).rows[2][1];
  assert.equal(fake(1950), '2,000');
  assert.equal(fake(1949), '1,900');
  assert.equal(fake(33.3), '0');
  // Two machines: in the card's fixed order, Blower, Snowrator, Bobcat, Sweepster.
  const two = S.cardLines({ season: '2026-27', totals: { called_out: 0, worked: 0, no_show: 0, minutes: 0, open_nights: 2, sqft: 0, machines: { bobcat: 212, snowrator: 265 }, help_visits: 3 }, nights: [] });
  assert.deepEqual(two.rows.slice(1), [['Hours', '0:00 (2 nights with no End shift)'], ['Sq ft cleared', '0'], ['Machines', 'Snowrator 265 min · Bobcat 212 min'], ['Help visits', '3']]);
});

test('crew stats: a walk tapped Cleared twice in one pass counts once', () => {
  // L1 again at 21:05 (a double tap, a second phone or a Retry), and Z2 Cleared -> Problem -> Cleared at 23:01 / 23:02, all pass 1:
  // each walk still counts once in its pass. Alex stays 1900, Bea 900.
  const w = world();
  const row = (id, seq, zone, state, hhmm) => ({ id, seq, storm_id: 'ST-1', shift_id: N4, site_id: 'S1', zone_id: zone, state, note: state === 'problem' ? 'ice' : '', at: at('2026-12-04', hhmm), by_key: 'C2', by_name: 'Bea', off_route: false, undoes: null });
  // seq in time order, all before the Clean again (seq 6.5): pass 1.
  w.log.push(row('L30', 1.5, 'Z1', 'cleared', '21:05'), row('L31', 2.1, 'Z2', 'problem', '23:01'), row('L32', 2.2, 'Z2', 'cleared', '23:02'));
  assert.equal(statsFor('C1', w).totals.sqft, 1900);
  const w2 = world(); w2.log = w.log;
  assert.equal(statsFor('C2', w2).totals.sqft, 900);
});

test('crew stats: without the Clean again, L7 is the same pass as L1 and adds nothing', () => {
  // baseWorld has no Clean again row: L7 repeats L1 in pass 1 -> Alex 1000 + 100 + 300 = 1400; Bea 100 + 300 = 400.
  assert.equal(S.forPerson(Object.assign(baseWorld(), { crewId: 'C1' })).totals.sqft, 1400);
  assert.equal(S.forPerson(Object.assign(baseWorld(), { crewId: 'C2' })).totals.sqft, 400);
});

test('crew stats: a typed correction keeps the route of the tapped Start', () => {
  // Bea is moved to N2 after the callout and taps Start on R2 at 22:00; the dispatcher then types her in and out.
  // Her route is R2 (the tap), not the callout's R1. On R2: L8 at 01:00 open: Dee, Bea -> 450 each. On R1 she shares nothing,
  // so L2 (23:00) is Alex's alone: 200, and L7 (pass 2, 02:00) Alex's alone: 1000. Alex = 1000 + 200 + 1000 + 300 = 2500.
  // Bea = 450 + 300 (11-08, the callout) = 750; Dee = 450.
  const w = world();
  w.clock.push({ id: 'K-60', seq: 60, shift_id: N4, kind: 'start', crew_id: 'C2', name: 'Bea', route_id: 'R2', at: at('2026-12-04', '22:00'), time_in: '', time_out: '', undoes: '' });
  w.clock.push({ id: 'K-61', seq: 61, shift_id: N4, kind: 'typed', crew_id: 'C2', name: 'Bea', route_id: '', at: at('2026-12-05', '06:30'), time_in: '2026-12-04T22:00', time_out: '2026-12-05T04:00', undoes: '' });
  const bea = statsFor('C2', w);
  assert.equal(night(bea, N4).route_id, 'R2');
  assert.equal(night(bea, N4).sqft, 450);
  assert.equal(bea.totals.sqft, 750);
  const w2 = world(); w2.clock = w.clock;
  assert.equal(statsFor('C1', w2).totals.sqft, 2500);
});

test('crew stats: a start tap that was taken back gives no route', () => {
  // Bea taps Start on R2, undoes it, the dispatcher types her times: no standing tap -> the callout's R1, as before.
  const w = world();
  w.clock.push({ id: 'K-60', seq: 60, shift_id: N4, kind: 'start', crew_id: 'C2', name: 'Bea', route_id: 'R2', at: at('2026-12-04', '21:50'), time_in: '', time_out: '', undoes: '' });
  w.clock.push({ id: 'K-62', seq: 62, shift_id: N4, kind: 'start_undone', crew_id: 'C2', name: 'Bea', route_id: 'R2', at: at('2026-12-04', '21:51'), time_in: '', time_out: '', undoes: 'K-60' });
  assert.equal(night(statsFor('C2', w), N4).route_id, 'R1');
});

test('crew stats: a night crew working past the 9 AM cutover keeps the walks they clear', () => {
  // Alex ends 12-05 10:00 instead of 04:00. Z2 (200) Cleared 12-05 09:30 is filed under day-2026-12-05 (the cutover passed).
  // Time decides (Matt's 18-hour rule): Alex's night-12-04 window is open at 09:30, Bea's ended 04:00 -> Alex +200, on his
  // night-12-04 line: 1600 + 200 = 1800; total 2100; no day-12-05 line for him.
  const w = world();
  w.clock[1].at = at('2026-12-05', '10:00');
  w.log.push({ id: 'L40', seq: 40, storm_id: 'ST-1', shift_id: 'day-2026-12-05', site_id: 'S1', zone_id: 'Z2', state: 'cleared', note: '', at: at('2026-12-05', '09:30'), by_key: 'C1', by_name: 'Alex', off_route: false, undoes: null });
  const st = statsFor('C1', w);
  assert.equal(night(st, N4).sqft, 1800);
  assert.equal(st.totals.sqft, 2100);
  assert.equal(night(st, 'day-2026-12-05'), undefined);
});

test('crew stats: a Start filed under the day name still counts for the night callout', () => {
  // Cy taps Start at 19:50 before Night is switched on: his Clock row is day-2026-12-04, his callout night-2026-12-04.
  // He started: not a no-show. (His card shows the day line worked and the night line called out.)
  const w = world();
  w.clock.push({ id: 'K-70', seq: 70, shift_id: 'day-2026-12-04', kind: 'start', crew_id: 'C3', name: 'Cy', route_id: 'R1', at: at('2026-12-04', '19:50'), time_in: '', time_out: '', undoes: '' });
  const st = statsFor('C3', w);
  assert.equal(st.totals.no_show, 0);
  assert.equal(night(st, N4).no_show, false);
});

test('crew stats: a Clean again that was taken back starts no new pass', () => {
  // The Clean again at S1 is undone (seq 6.6): L7 is pass 1 again, a repeat of L1 -> Alex 1400, as with no Clean again at all.
  const w = world();
  w.log.push({ id: 'A-1u', seq: 6.6, storm_id: 'ST-1', shift_id: N4, site_id: 'S1', zone_id: '*', state: 'again_undone', note: '', at: at('2026-12-05', '01:31'), by_key: 'C1', by_name: 'Alex', off_route: false, undoes: 'A-1' });
  assert.equal(statsFor('C1', w).totals.sqft, 1400);
});
