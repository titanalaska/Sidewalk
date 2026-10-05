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
