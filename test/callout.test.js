// The Callouts logic: the new-snow estimate, which sites are called out, and
// day-shift order. Pure functions, no clock and no network: `nowIso` is passed
// in and the forecast series is a plain array. All times are UTC ("Z") so
// nothing depends on the test machine's time zone.
//
// Expected values are worked out on paper in the comments, never copied from
// what the code returned.
const test = require('node:test');
const assert = require('node:assert/strict');
const SnowCallout = require('../lib/callout.js');

const HOUR = 3600000;
const ms = (iso) => Date.parse(iso);
const D = '2026-10-03T';
// One NWS period: starts at `startIso`, lasts `hours`, `mm` of snow.
const per = (startIso, hours, mm) => ({ start: ms(startIso), end: ms(startIso) + hours * HOUR, mm });

// ---------------- estimate ----------------

test('estimate: a period fully inside the span counts whole, in inches to 1 dp', () => {
  // PT6H 06:00-12:00 with 12 mm. Span 05:00-13:00 covers all of it.
  // 12 / 25.4 = 0.4724 -> 0.5. The span starts before the series, so "since"
  // is the series' first instant, 06:00, not 05:00.
  const e = SnowCallout.estimate([per(D + '06:00:00Z', 6, 12)], D + '05:00:00Z', D + '13:00:00Z');
  assert.equal(e.inches, 0.5);
  assert.equal(e.since, D + '06:00:00.000Z');
});

test('estimate: a period counts by the fraction that overlaps the span', () => {
  // 25.4 mm over 06:00-12:00; the span 06:00-09:00 is half of it:
  // 25.4 * 3/6 = 12.7 mm = 0.5". (Counting the whole period would say 1.0.)
  const p = [per(D + '06:00:00Z', 6, 25.4)];
  assert.equal(SnowCallout.estimate(p, D + '06:00:00Z', D + '09:00:00Z').inches, 0.5);
  // Same period, span 09:00-15:00: the covered part is 09:00-12:00, again half.
  // The span starts inside the series, so "since" is the span's start, 09:00.
  const e = SnowCallout.estimate(p, D + '09:00:00Z', D + '15:00:00Z');
  assert.equal(e.inches, 0.5);
  assert.equal(e.since, D + '09:00:00.000Z');
});

test('estimate: several periods add up, each by its own overlap', () => {
  // 06:00-07:00 with 12.7 mm and 07:00-08:00 with 12.7 mm; span 06:30-07:30
  // takes half of each: 6.35 + 6.35 = 12.7 mm = 0.5".
  const p = [per(D + '06:00:00Z', 1, 12.7), per(D + '07:00:00Z', 1, 12.7)];
  assert.equal(SnowCallout.estimate(p, D + '06:30:00Z', D + '07:30:00Z').inches, 0.5);
  // A period past "now" adds nothing: 08:00-09:00 with 100 mm is outside 06:30-07:30.
  p.push(per(D + '08:00:00Z', 1, 100));
  assert.equal(SnowCallout.estimate(p, D + '06:30:00Z', D + '07:30:00Z').inches, 0.5);
});

test('estimate: a long period (30 h) is cut by its real length', () => {
  // 50.8 mm over 30 h (06:00 day 1 .. 12:00 day 2); the first 6 h is a fifth:
  // 50.8 / 5 = 10.16 mm = 0.4".
  const p = [per(D + '06:00:00Z', 30, 50.8)];
  assert.equal(SnowCallout.estimate(p, D + '06:00:00Z', D + '12:00:00Z').inches, 0.4);
});

test('estimate: a period with no snow still counts as covered, as 0', () => {
  // mm 0 (and a missing mm) is "the forecast says none here": 0", not "no estimate".
  const e = SnowCallout.estimate([per(D + '06:00:00Z', 6, 0)], D + '07:00:00Z', D + '09:00:00Z');
  assert.deepEqual(e, { inches: 0, since: D + '07:00:00.000Z' });
  const q = SnowCallout.estimate([{ start: ms(D + '06:00:00Z'), end: ms(D + '12:00:00Z'), mm: null }], D + '07:00:00Z', D + '09:00:00Z');
  assert.equal(q.inches, 0);
});

test('estimate: a span that starts before the series says "since" the series start', () => {
  // The storm began at midnight; the NWS series (one 6 h period, 25.4 mm) starts
  // at 06:00. Only the covered part counts, and the time shown is 06:00.
  // Span 00:00-12:00 holds the whole period: 25.4 mm = 1.0".
  const e = SnowCallout.estimate([per(D + '06:00:00Z', 6, 25.4)], D + '00:00:00Z', D + '12:00:00Z');
  assert.equal(e.inches, 1);
  assert.equal(e.since, D + '06:00:00.000Z');
});

test('estimate: since is the earliest covered instant across periods', () => {
  // Out of order, with one before the span: only the 07:00 and 08:00 periods
  // overlap 07:15-09:00, so the first covered instant is the span start 07:15
  // (inside the 07:00 period). The 03:00 period is ignored.
  const p = [per(D + '08:00:00Z', 1, 1), per(D + '03:00:00Z', 1, 99), per(D + '07:00:00Z', 1, 1)];
  assert.equal(SnowCallout.estimate(p, D + '07:15:00Z', D + '09:00:00Z').since, D + '07:15:00.000Z');
});

test('estimate: no overlap is no estimate', () => {
  const p = [per(D + '06:00:00Z', 6, 25.4)]; // 06:00-12:00
  assert.equal(SnowCallout.estimate(p, D + '12:00:00Z', D + '15:00:00Z'), null); // starts as the series ends
  assert.equal(SnowCallout.estimate(p, D + '01:00:00Z', D + '06:00:00Z'), null); // ends as the series starts
  assert.equal(SnowCallout.estimate([], D + '01:00:00Z', D + '06:00:00Z'), null);
  assert.equal(SnowCallout.estimate(null, D + '01:00:00Z', D + '06:00:00Z'), null);
  // An empty or backwards span, or a clock that cannot be read.
  assert.equal(SnowCallout.estimate(p, D + '09:00:00Z', D + '09:00:00Z'), null);
  assert.equal(SnowCallout.estimate(p, D + '10:00:00Z', D + '08:00:00Z'), null);
  assert.equal(SnowCallout.estimate(p, 'garbage', D + '08:00:00Z'), null);
  assert.equal(SnowCallout.estimate(p, null, D + '08:00:00Z'), null);
});

// ---------------- rankOrder ----------------

test('rankOrder: on day shift ranked sites come first, ties by place in the list', () => {
  // [A(-), B(2), C(1), D(-), E(2)]: rank 1 is C, rank 2 is B then E (their
  // list order), then the unranked A, D in list order.
  const by = { A: { id: 'A' }, B: { id: 'B', day_rank: 2 }, C: { id: 'C', day_rank: 1 }, D: { id: 'D', day_rank: null }, E: { id: 'E', day_rank: 2 } };
  assert.deepEqual(SnowCallout.rankOrder(['A', 'B', 'C', 'D', 'E'], by, true), ['C', 'B', 'E', 'A', 'D']);
});

test('rankOrder: ties and blanks keep list order, not id order', () => {
  // Ids chosen so list order and sorted-id order differ.
  // List: s5(-) s7(2) s9(1) s1(-) s3(2). Day: s9 (rank 1); s7 then s3 (rank 2,
  // list order, not "s3 first"); then s5, s1 (blank, list order, not "s1 first").
  const by = { s5: {}, s7: { day_rank: 2 }, s9: { day_rank: 1 }, s1: {}, s3: { day_rank: 2 } };
  assert.deepEqual(SnowCallout.rankOrder(['s5', 's7', 's9', 's1', 's3'], by, true), ['s9', 's7', 's3', 's5', 's1']);
});

test('rankOrder: at night the order is untouched', () => {
  const by = { A: { id: 'A' }, B: { id: 'B', day_rank: 2 }, C: { id: 'C', day_rank: 1 } };
  assert.deepEqual(SnowCallout.rankOrder(['A', 'B', 'C'], by, false), ['A', 'B', 'C']);
});

test('rankOrder: the input array is not changed, and the result is a new array', () => {
  const by = { A: {}, B: { day_rank: 1 } };
  const input = ['A', 'B'];
  const day = SnowCallout.rankOrder(input, by, true);
  assert.deepEqual(day, ['B', 'A']);
  assert.deepEqual(input, ['A', 'B']);
  const night = SnowCallout.rankOrder(input, by, false);
  assert.deepEqual(night, ['A', 'B']);
  assert.notEqual(night, input);
});

test('rankOrder: a site the lookup does not know is just unranked', () => {
  assert.deepEqual(SnowCallout.rankOrder(['X', 'B'], { B: { day_rank: 1 } }, true), ['B', 'X']);
});

// ---------------- calloutList ----------------

// A storm that started at 12:00; now is 18:00.
const STORM = 'S1';
const STORMS = [{ kind: 'start', storm_id: STORM, at: D + '12:00:00Z', seq: 1 }];
const NOW = D + '18:00:00Z';
let seq = 0;
const row = (o) => Object.assign({ storm_id: STORM, seq: ++seq, id: 'r' + seq }, o);
const tap = (site, zone, at) => row({ site_id: site, zone_id: zone, state: 'cleared', at });
const depth = (site, inches, at, by) => row({ site_id: site, zone_id: '*', state: 'depth', depth_in: inches, at, by_name: by || 'Alex' });
const again = (site, at) => row({ site_id: site, zone_id: '*', state: 'again', at });
// A series that is one period 12:00-18:00 with `mm`.
const flat = (mm) => [per(D + '12:00:00Z', 6, mm)];

function run(o) {
  const siteById = o.siteById || {};
  return SnowCallout.calloutList({
    siteIds: o.siteIds || Object.keys(siteById),
    siteById,
    log: o.log || [],
    storms: STORMS,
    stormId: STORM,
    nowIso: o.nowIso || NOW,
    seriesFor: o.seriesFor || (() => null),
    isDay: !!o.isDay,
  });
}

test('calloutList: an estimate of 0.96" lists at callout 1, as 1.0', () => {
  // 0.96" = 24.384 mm over the whole span. 0.96 rounds to 1.0, and the ROUNDED
  // value is what meets the callout.
  const out = run({ siteById: { a: { id: 'a', callout_in: 1 } }, seriesFor: () => flat(24.384) });
  assert.equal(out.length, 1);
  assert.equal(out[0].site_id, 'a');
  assert.equal(out[0].inches, 1);
  assert.equal(out[0].since, D + '12:00:00.000Z');
  assert.equal(out[0].measured, null);
  assert.equal(out[0].callout, 1);
});

test('calloutList: an estimate of 0.94" does not list at callout 1', () => {
  // 0.94" = 23.876 mm -> shows 0.9, under 1.
  const out = run({ siteById: { a: { id: 'a', callout_in: 1 } }, seriesFor: () => flat(23.876) });
  assert.deepEqual(out, []);
});

test('calloutList: the estimate runs from the newest real tap of the pass', () => {
  // Cleared at 15:00: the span is 15:00-18:00, half of the 12:00-18:00 period.
  // 48.768 mm * 3/6 = 24.384 mm = 0.96" -> 1.0, since 15:00.
  const log = [tap('a', 'z1', D + '14:00:00Z'), tap('a', 'z2', D + '15:00:00Z')];
  const out = run({ log, siteById: { a: { id: 'a', callout_in: 1 } }, seriesFor: () => flat(48.768) });
  assert.equal(out.length, 1);
  assert.equal(out[0].inches, 1);
  assert.equal(out[0].since, D + '15:00:00.000Z');
});

test('calloutList: a measured 2" beats an estimate of 0.2" and lists', () => {
  const log = [depth('a', 2, D + '16:05:00Z', 'Alex')];
  // The series says 5.08 mm = 0.2", which would not list at callout 1.
  const out = run({ log, siteById: { a: { id: 'a', callout_in: 1 } }, seriesFor: () => flat(5.08) });
  assert.equal(out.length, 1);
  assert.equal(out[0].inches, 2);
  assert.equal(out[0].since, D + '16:05:00Z');
  assert.equal(out[0].measured, log[0]);
  assert.equal(out[0].callout, 1);
});

test('calloutList: a measured 0 beats an estimate of 3" and does not list', () => {
  const log = [depth('a', 0, D + '16:05:00Z')];
  const out = run({ log, siteById: { a: { id: 'a', callout_in: 1 } }, seriesFor: () => flat(76.2) }); // 3"
  assert.deepEqual(out, []);
});

test('calloutList: a measured value is compared at one decimal too', () => {
  const siteById = { a: { id: 'a', callout_in: 1 } };
  assert.equal(run({ log: [depth('a', 0.96, D + '16:00:00Z')], siteById }).length, 1); // 0.96 shows as 1.0
  assert.equal(run({ log: [depth('a', 0.94, D + '16:00:00Z')], siteById }).length, 0); // 0.94 shows as 0.9
});

test('calloutList: a blank callout never lists, however much snow', () => {
  const log = [depth('b', 10, D + '16:00:00Z'), depth('c', 10, D + '16:00:00Z'), depth('d', 10, D + '16:00:00Z')];
  const siteById = { a: { id: 'a' }, b: { id: 'b', callout_in: null }, c: { id: 'c', callout_in: undefined }, d: { id: 'd', callout_in: 5 } };
  const out = run({ log, siteById, siteIds: ['a', 'b', 'c', 'd'], seriesFor: () => flat(2540) }); // 100" forecast
  assert.deepEqual(out.map((x) => x.site_id), ['d']);
});

test('calloutList: no series and no measured depth is not listed; a measured depth still lists', () => {
  const siteById = { a: { id: 'a', callout_in: 1 }, b: { id: 'b', callout_in: 1 } };
  const log = [depth('b', 3, D + '16:00:00Z')];
  assert.deepEqual(run({ log, siteById, seriesFor: () => undefined }).map((x) => x.site_id), ['b']);
  assert.deepEqual(run({ log, siteById, seriesFor: () => null }).map((x) => x.site_id), ['b']);
  // And with nothing measured at all, neither is there.
  assert.deepEqual(run({ siteById, seriesFor: () => undefined }), []);
});

test('calloutList: no storm start row and nothing measured is no estimate', () => {
  // snowSince has no clock to start from, so there is no span to sum.
  const out = SnowCallout.calloutList({
    siteIds: ['a'], siteById: { a: { id: 'a', callout_in: 1 } }, log: [], storms: [], stormId: STORM,
    nowIso: NOW, seriesFor: () => flat(2540), isDay: false,
  });
  assert.deepEqual(out, []);
});

test('calloutList: a Clean again retires the old reading; a new one counts', () => {
  const siteById = { a: { id: 'a', callout_in: 1 } };
  const log = [tap('a', 'z1', D + '14:00:00Z'), depth('a', 3, D + '15:00:00Z'), again('a', D + '16:00:00Z')];
  // The 3" reading is older than the again: it no longer applies. The estimate
  // runs from the again (16:00): 2/6 of 5.08 mm = 1.69 mm = 0.07" -> 0.1, under 1.
  assert.deepEqual(run({ log, siteById, seriesFor: () => flat(5.08) }), []);
  // A reading AFTER the again counts.
  const log2 = log.concat([depth('a', 2, D + '17:00:00Z')]);
  const out = run({ log: log2, siteById, seriesFor: () => flat(5.08) });
  assert.equal(out.length, 1);
  assert.equal(out[0].inches, 2);
});

test('calloutList: a site on two routes is listed once, at its first place', () => {
  const log = ['a', 'b', 'c'].map((s) => depth(s, 2, D + '16:00:00Z'));
  const siteById = { a: { id: 'a', callout_in: 1 }, b: { id: 'b', callout_in: 1 }, c: { id: 'c', callout_in: 1 } };
  const out = run({ log, siteById, siteIds: ['b', 'a', 'b', 'c', 'a'] });
  assert.deepEqual(out.map((x) => x.site_id), ['b', 'a', 'c']);
});

test('calloutList: a site the lookup does not know is skipped', () => {
  const log = [depth('ghost', 5, D + '16:00:00Z')];
  assert.deepEqual(run({ log, siteById: {}, siteIds: ['ghost'] }), []);
});

test('calloutList: day shift puts ranked sites first; night keeps list order', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const log = ids.map((s) => depth(s, 5, D + '16:00:00Z'));
  const siteById = {
    a: { id: 'a', callout_in: 1 },                    // no rank
    b: { id: 'b', callout_in: 1, day_rank: 2 },
    c: { id: 'c', callout_in: 1, day_rank: 1 },
    d: { id: 'd', callout_in: 1 },                    // no rank
  };
  assert.deepEqual(run({ log, siteById, siteIds: ids, isDay: true }).map((x) => x.site_id), ['c', 'b', 'a', 'd']);
  assert.deepEqual(run({ log, siteById, siteIds: ids, isDay: false }).map((x) => x.site_id), ['a', 'b', 'c', 'd']);
});

test('calloutList: ranking applies only to sites that are listed', () => {
  // c is ranked first but has not reached its callout: it is not in the list.
  const log = [depth('a', 5, D + '16:00:00Z'), depth('b', 5, D + '16:00:00Z'), depth('c', 0.2, D + '16:00:00Z')];
  const siteById = { a: { id: 'a', callout_in: 1 }, b: { id: 'b', callout_in: 1, day_rank: 1 }, c: { id: 'c', callout_in: 1, day_rank: 1 } };
  assert.deepEqual(run({ log, siteById, siteIds: ['a', 'b', 'c'], isDay: true }).map((x) => x.site_id), ['b', 'a']);
});

// ---------------- outlook (storm watch, Matt 11/9/26) ----------------
// What the forecast adds at each site between now and the end of the night, against the site's callout depth.
// The same arithmetic as the estimate above, pointed forward. Worked on paper, 25.4 mm to the inch:
//
//   now 6 PM, until 9 AM the next morning (15 hours). Times below are UTC; only the instants matter.
//
//   SERIES_A (six-hour periods):  3 PM-9 PM 15.24 mm | 9 PM-3 AM 25.4 mm | 3 AM-9 AM 43.18 mm | 9 AM-3 PM 99 mm
//     3 PM-9 PM is half inside the window (6 PM-9 PM): 15.24 / 2 = 7.62 mm
//     9 PM-3 AM and 3 AM-9 AM are whole:               25.4 + 43.18 = 68.58 mm
//     9 AM-3 PM starts as the window ends:             0
//     7.62 + 68.58 = 76.2 mm = 3.0 in.  Snow is already falling at 6 PM: it "starts" now.
//
//   SERIES_B:  6 PM-midnight 0 mm | midnight-6 AM 20.32 mm | 6 AM-noon 30.48 mm
//     midnight-6 AM is whole:                  20.32 mm
//     6 AM-noon is half inside (6 AM-9 AM):    15.24 mm
//     35.56 mm = 1.4 in.  The first period with snow begins at midnight.
//
//   SERIES_DRY: 6 PM-noon 0 mm  ->  0 in, and no start.
const OUT_NOW = '2026-11-10T03:00:00Z';     // 6 PM Alaska standard time, 11/9
const OUT_UNTIL = '2026-11-10T18:00:00Z';   // 9 AM, 11/10
const at = (iso) => Date.parse(iso);
const SERIES_A = [
  { start: at('2026-11-10T00:00:00Z'), end: at('2026-11-10T06:00:00Z'), mm: 15.24 },
  { start: at('2026-11-10T06:00:00Z'), end: at('2026-11-10T12:00:00Z'), mm: 25.4 },
  { start: at('2026-11-10T12:00:00Z'), end: at('2026-11-10T18:00:00Z'), mm: 43.18 },
  { start: at('2026-11-10T18:00:00Z'), end: at('2026-11-11T00:00:00Z'), mm: 99 }];
const SERIES_B = [
  { start: at('2026-11-10T03:00:00Z'), end: at('2026-11-10T09:00:00Z'), mm: 0 },
  { start: at('2026-11-10T09:00:00Z'), end: at('2026-11-10T15:00:00Z'), mm: 20.32 },
  { start: at('2026-11-10T15:00:00Z'), end: at('2026-11-10T21:00:00Z'), mm: 30.48 }];
const SERIES_DRY = [{ start: at('2026-11-10T03:00:00Z'), end: at('2026-11-10T21:00:00Z'), mm: 0 }];
// Six sites. Ids and list order are not alphabetical and not by depth, so an order the code did not make cannot pass.
//   S-b  series B, callout 1.4   1.4 in: AT its depth, and that reaches (the Callouts box's own rule: under is out)
//   S-a  series A, callout 2     3.0 in: reaches
//   S-c  series B, callout 1.5   1.4 in: 0.1 short
//   S-d  series B, no callout    1.4 in: a row, never "reaches", counted as not set
//   S-e  no forecast, callout 1  missing (it is NOT 0 in)
//   S-f  dry, callout 0.5        0 in
const OUT_SITES = { 'S-b': { callout_in: 1.4 }, 'S-a': { callout_in: 2 }, 'S-c': { callout_in: 1.5 }, 'S-d': { callout_in: null },
  'S-e': { callout_in: 1 }, 'S-f': { callout_in: 0.5 } };
const OUT_SERIES = { 'S-b': SERIES_B, 'S-a': SERIES_A, 'S-c': SERIES_B, 'S-d': SERIES_B, 'S-e': null, 'S-f': SERIES_DRY };
const lookOut = (over) => SnowCallout.outlook(Object.assign({ siteIds: ['S-b', 'S-a', 'S-c', 'S-d', 'S-e', 'S-f'], siteById: OUT_SITES,
  seriesFor: (id) => OUT_SERIES[id], nowIso: OUT_NOW, untilIso: OUT_UNTIL }, over));

test('outlook: forecast inches per site from now to the end of the night, deepest first, and which reach their callout', () => {
  const o = lookOut();
  assert.deepEqual(o.rows, [
    { site_id: 'S-a', inches: 3, starts: '2026-11-10T03:00:00.000Z', callout: 2, reaches: true },   // already snowing at 6 PM: now
    { site_id: 'S-b', inches: 1.4, starts: '2026-11-10T09:00:00.000Z', callout: 1.4, reaches: true },
    { site_id: 'S-c', inches: 1.4, starts: '2026-11-10T09:00:00.000Z', callout: 1.5, reaches: false },
    { site_id: 'S-d', inches: 1.4, starts: '2026-11-10T09:00:00.000Z', callout: null, reaches: false },
    { site_id: 'S-f', inches: 0, starts: null, callout: 0.5, reaches: false }]);
});

test('outlook: the most snow anywhere, and the earliest it starts', () => {
  const o = lookOut();
  assert.equal(o.max, 3);
  // Site A is already under snow at 6 PM: the earliest start is now, not midnight.
  assert.equal(Date.parse(o.starts), Date.parse(OUT_NOW));
  // Without site A the first snow is B's, at midnight (09:00 UTC).
  const b = lookOut({ siteIds: ['S-b', 'S-c', 'S-f'] });
  assert.deepEqual([b.max, b.starts], [1.4, '2026-11-10T09:00:00.000Z']);
});

test('outlook: a site with no forecast is missing, never 0 inches; a site with no callout depth is counted, never guessed', () => {
  const o = lookOut();
  assert.deepEqual(o.missing, ['S-e']);
  assert.equal(o.rows.some((r) => r.site_id === 'S-e'), false);
  // S-d has no depth: it is in the rows with callout null, it does not reach, and it is the one counted.
  assert.equal(o.unset, 1);
  // A depth of 0 or a word is not a depth either (the server never stores one; a hand-edited Sheet might).
  const odd = lookOut({ siteById: Object.assign({}, OUT_SITES, { 'S-a': { callout_in: 0 }, 'S-b': { callout_in: '2' }, 'S-c': {} }) });
  assert.equal(odd.unset, 4);
  assert.deepEqual(odd.rows.filter((r) => r.reaches), []);
  // A site with no forecast AND no depth is both missing and not set.
  const both = lookOut({ siteById: Object.assign({}, OUT_SITES, { 'S-e': {} }) });
  assert.deepEqual([both.missing, both.unset], [['S-e'], 2]);
});

test('outlook: a dry night is 0 inches everywhere and has no start', () => {
  const o = lookOut({ siteIds: ['S-f'] });
  assert.deepEqual(o, { rows: [{ site_id: 'S-f', inches: 0, starts: null, callout: 0.5, reaches: false }], missing: [], unset: 0, max: 0, starts: null });
});

test('outlook: nothing fetched at all is no rows, no max and every site missing', () => {
  const o = lookOut({ seriesFor: () => null });
  assert.deepEqual(o, { rows: [], missing: ['S-b', 'S-a', 'S-c', 'S-d', 'S-e', 'S-f'], unset: 1, max: null, starts: null });
});

test('outlook: a site listed twice is counted once, an unknown id is skipped, and a window that has already ended gives nothing', () => {
  const twice = lookOut({ siteIds: ['S-a', 'S-zz', 'S-a', 'S-d', 'S-d'] });
  assert.deepEqual(twice.rows.map((r) => r.site_id), ['S-a', 'S-d']);
  assert.equal(twice.unset, 1);
  // until at or before now: there is no night left to look at, so every site is "missing" and nothing reaches.
  const over = lookOut({ untilIso: OUT_NOW });
  assert.deepEqual([over.rows, over.max, over.starts], [[], null, null]);
});

test('outlook: sites tied on inches keep the order they were given', () => {
  // B, C and D all read 1.4 in. Given D, C, B they come back D, C, B.
  assert.deepEqual(lookOut({ siteIds: ['S-d', 'S-c', 'S-b'] }).rows.map((r) => r.site_id), ['S-d', 'S-c', 'S-b']);
});

test('outlook: snow too light to round to a tenth has no start (0 inches is a dry night)', () => {
  // 1 mm over the whole window = 0.039 in -> 0.0.
  const thin = [{ start: at(OUT_NOW), end: at(OUT_UNTIL), mm: 1 }];
  const o = lookOut({ siteIds: ['S-a'], seriesFor: () => thin });
  assert.deepEqual(o.rows, [{ site_id: 'S-a', inches: 0, starts: null, callout: 2, reaches: false }]);
  assert.equal(o.starts, null);
});

test('outlook: snow that ended before now is not when the snow tonight starts', () => {
  // 3 PM-6 PM 10 mm (over as the window opens: none of it counts), 6 PM-midnight 0, midnight-6 AM 20.32 mm.
  // Inside the window: 20.32 mm = 0.8 in, and the first snow is midnight (09:00 UTC), not 6 PM.
  const earlier = [{ start: at('2026-11-10T00:00:00Z'), end: at('2026-11-10T03:00:00Z'), mm: 10 },
    { start: at('2026-11-10T03:00:00Z'), end: at('2026-11-10T09:00:00Z'), mm: 0 },
    { start: at('2026-11-10T09:00:00Z'), end: at('2026-11-10T15:00:00Z'), mm: 20.32 },
    // ... and snow that only begins as the night ends is not tonight's either.
    { start: at('2026-11-10T18:00:00Z'), end: at('2026-11-11T00:00:00Z'), mm: 50 }];
  const o = lookOut({ siteIds: ['S-a'], seriesFor: () => earlier });
  assert.deepEqual(o.rows, [{ site_id: 'S-a', inches: 0.8, starts: '2026-11-10T09:00:00.000Z', callout: 2, reaches: false }]);
  assert.equal(o.starts, '2026-11-10T09:00:00.000Z');
});
