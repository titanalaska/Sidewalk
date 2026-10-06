// The forecast hint (US National Weather Service). A hint only: Matt's or the
// lead's Snowing/Stopped switch is what counts, so every failure here must come
// out as "no hint", never as a wrong one.
//
// The clock is always passed in. The NWS gives each hour its own UTC offset
// ("-08:00" in Alaska), and the hint reads the hour off that string, so nothing
// here depends on the test machine's hour or time zone.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
const SnowWeather = require('../lib/weather.js');

// Hourly periods like the NWS sends, one per hour from `from` (an Alaska hour on
// 10/3/26, -08:00), text[i] is that hour's shortForecast.
const pad = (n) => String(n).padStart(2, '0');
function hours(from, text) {
  return text.map((t, i) => {
    const h = from + i, day = 3 + Math.floor(h / 24);
    return { startTime: '2026-10-' + pad(day) + 'T' + pad(h % 24) + ':00:00-08:00', shortForecast: t };
  });
}
const NOW = '2026-10-03T07:30:00-08:00'; // inside the 7 AM hour
const C = 'Mostly Cloudy', S = 'Snow';

// ---------------- hint ----------------

test('hint: snowing now says until when', () => {
  // Periods 7 AM .. 6 PM (12 of them). Now is 7:30, inside the 7 AM hour: that
  // hour is "now". Snow at 7, 8 and 9 (Snow Showers matches /snow/i); 10 AM is the
  // first period that is not snow, so the run ends at 10 AM. The snow again at
  // 11 AM does not extend it.
  const p = hours(7, ['Light Snow', S, 'Snow Showers', C, S, C, C, C, C, C, C, C]);
  assert.equal(SnowWeather.hint(p, NOW), 'Snow until 10 AM');
  // The same run ending after noon names the PM hour: snow 7 AM .. 12 PM, clear at 1 PM.
  assert.equal(SnowWeather.hint(hours(7, [S, S, S, S, S, S, C, C, C, C, C, C]), NOW), 'Snow until 1 PM');
  // 12 is read as 12 AM at midnight: now 10:30 PM, snow 10 PM and 11 PM, 12 AM (next day) clear.
  assert.equal(SnowWeather.hint(hours(22, [S, S, C, C, C, C, C, C, C, C, C, C]), '2026-10-03T22:30:00-08:00'), 'Snow until 12 AM');
});

test('hint: snowing now, run reaches the 12th period', () => {
  // All 12 periods 7 AM .. 6 PM are snow: it does not end inside the window.
  assert.equal(SnowWeather.hint(hours(7, Array(12).fill(S)), NOW), 'Snow for the next 12 h+');
  // 11 snow periods (7 AM .. 5 PM) and the 12th (6 PM) clear: it ends at 6 PM, not "12 h+".
  assert.equal(SnowWeather.hint(hours(7, [...Array(11).fill(S), C]), NOW), 'Snow until 6 PM');
});

test('hint: a short list that is snow to its end says until the end of its last period', () => {
  // Only 3 usable periods (7, 8, 9 AM), all snow, now 7:30. The run reaches the end
  // of the DATA, not the 12th period, so it is not "12 h+": we cannot claim 12 hours.
  // What is known is that it snows to the end of the last period, 9 AM + 1 h = 10 AM.
  const p = hours(7, [S, S, S]);
  assert.equal(SnowWeather.hint(p, NOW), 'Snow until 10 AM');
  // With an endTime it is that: the last period ends at 9:30 AM -> "9 AM" (hour read off the string).
  const q = hours(7, [S, S, S]); q[2].endTime = '2026-10-03T09:30:00-08:00';
  assert.equal(SnowWeather.hint(q, NOW), 'Snow until 9 AM');
  // Last period 11 PM, no endTime: ends at midnight, read as 12 AM.
  assert.equal(SnowWeather.hint(hours(22, [S, S]), '2026-10-03T22:30:00-08:00'), 'Snow until 12 AM');
  // One snow period only.
  assert.equal(SnowWeather.hint(hours(7, [S]), NOW), 'Snow until 8 AM');
});

test('hint: a short list clear for a while and ending in snow says from when', () => {
  // 7 AM .. 11 AM: clear, clear, clear, snow, snow (5 periods, ends in snow). Not snowing
  // now; the first snow period is 10 AM (index 3), so "Snow from 10 AM". It must not throw.
  assert.equal(SnowWeather.hint(hours(7, [C, C, C, S, S]), NOW), 'Snow from 10 AM');
  // Short and all clear: nothing in what is known.
  assert.equal(SnowWeather.hint(hours(7, [C, C]), NOW), 'No snow in the next 12 h');
});

test('hint: snow later says from when', () => {
  // Not snowing at 7 AM. First snow period within the 12 h (7 AM .. 6 PM) is 1 PM
  // (index 6); the snow at 4 PM does not matter.
  const p = hours(7, [C, C, C, C, C, C, 'Chance Light Snow', C, C, S, C, C]);
  assert.equal(SnowWeather.hint(p, NOW), 'Snow from 1 PM');
  // Snow in the very last period of the window (6 PM, the 12th) still counts.
  assert.equal(SnowWeather.hint(hours(7, [...Array(11).fill(C), S]), NOW), 'Snow from 6 PM');
});

test('hint: no snow in 12 h', () => {
  assert.equal(SnowWeather.hint(hours(7, Array(12).fill('Sunny')), NOW), 'No snow in the next 12 h');
  // Snow in the 13th period (7 PM) is past the window.
  assert.equal(SnowWeather.hint(hours(7, [...Array(12).fill(C), S]), NOW), 'No snow in the next 12 h');
});

test('hint: hours already past are not "now" and are not counted', () => {
  // Now 9:30 AM. The 7 and 8 AM periods (snow) are over; 9 AM is the current hour
  // (clear). The window is 9 AM .. 8 PM, with no snow in it.
  const p = hours(7, [S, S, C, C, C, C, C, C, C, C, C, C, C, C]);
  assert.equal(SnowWeather.hint(p, '2026-10-03T09:30:00-08:00'), 'No snow in the next 12 h');
});

test('hint: nothing usable gives no text', () => {
  assert.equal(SnowWeather.hint([], NOW), '');
  assert.equal(SnowWeather.hint(null, NOW), '');
  assert.equal(SnowWeather.hint([{ shortForecast: S }], NOW), ''); // no startTime
  assert.equal(SnowWeather.hint(hours(7, [S, S]), 'not a date'), '');
  // Every period over: there is no "now" to speak of.
  assert.equal(SnowWeather.hint(hours(1, [S, S]), NOW), '');
});

test('hint: the hour is read from the period, not the machine\'s time zone', () => {
  // 10 AM in Alaska is 18:00 UTC. A phone in any zone must still say 10 AM.
  const p = [{ startTime: '2026-10-03T07:00:00-08:00', shortForecast: S }, { startTime: '2026-10-03T10:00:00-08:00', shortForecast: C }];
  p.splice(1, 0, { startTime: '2026-10-03T08:00:00-08:00', shortForecast: S }, { startTime: '2026-10-03T09:00:00-08:00', shortForecast: S });
  assert.equal(SnowWeather.hint(p, NOW), 'Snow until 10 AM');
});

// ---------------- point ----------------

test('point rounds to two decimals', () => {
  // [lng, lat] saved on the site -> [lat, lon]. 61.3351 -> 61.34 (6133.51 rounds
  // up), -149.5149 -> -149.51 (-14951.49 rounds to -14951). Unrounded it would be
  // 61.3351, -149.5149: about 10 m, which is a position, not a forecast area.
  assert.deepEqual(SnowWeather.point({ map: { center: [-149.5149, 61.3351] } }, []), [61.34, -149.51]);
  // Zero and negative zero come out as plain 0.
  const z = SnowWeather.point({ map: { center: [-0.001, 0.002] } }, []);
  assert.ok(Object.is(z[0], 0) && Object.is(z[1], 0));
});

test('point: the saved view wins; without one the first zone\'s centroid is used', () => {
  const ring = [[-149.0, 61.0], [-148.9898, 61.0], [-148.9898, 61.0102], [-149.0, 61.0102]];
  // centroid = (-148.9949, 61.0051) -> [61.01, -148.99]
  assert.deepEqual(SnowWeather.point({}, [{ ring }]), [61.01, -148.99]);
  assert.deepEqual(SnowWeather.point({ map: { zoom: 18 } }, [{ ring }]), [61.01, -148.99]); // a view with no centre
  assert.deepEqual(SnowWeather.point({ map: { center: [-149.5149, 61.3351] } }, [{ ring }]), [61.34, -149.51]);
});

test('no saved view and no zones: no point', () => {
  assert.equal(SnowWeather.point({}, []), null);
  assert.equal(SnowWeather.point({ map: {} }, null), null);
  assert.equal(SnowWeather.point(null, []), null);
  assert.equal(SnowWeather.point({}, [{ ring: [] }, {}]), null); // zones with nothing drawn
  assert.equal(SnowWeather.point({ map: { center: ['x', 'y'] } }, []), null);
});

// ---------------- fetchHint ----------------

const HOURLY = 'https://api.weather.gov/gridpoints/ZZZ/1,1/forecast/hourly';
function stubFetch(routes) {
  const seen = [];
  global.fetch = async (u) => {
    seen.push(String(u));
    const r = routes[String(u)];
    if (r instanceof Error) throw r;
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: r.ok !== false, status: r.status || 200, json: async () => { if (r.badJson) throw new SyntaxError('bad json'); return r.body; } };
  };
  return seen;
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });
const goodRoutes = () => ({
  'https://api.weather.gov/points/61.34,-149.51': { body: { properties: { forecastHourly: HOURLY } } },
  [HOURLY]: { body: { properties: { periods: hours(7, ['Light Snow', S, 'Snow Showers', C, S, C, C, C, C, C, C, C]) } } },
});

test('fetchHint asks the points then the hourly forecast and returns the hint', async () => {
  const seen = stubFetch(goodRoutes());
  assert.equal(await SnowWeather.fetchHint(61.34, -149.51, NOW), 'Snow until 10 AM');
  assert.deepEqual(seen, ['https://api.weather.gov/points/61.34,-149.51', HOURLY]);
});

test('fetchHint: every failure is null', async () => {
  const cases = {
    'network down': () => ({ 'https://api.weather.gov/points/61.34,-149.51': new Error('offline') }),
    'points 500': () => ({ 'https://api.weather.gov/points/61.34,-149.51': { ok: false, status: 500 } }),
    'points bad JSON': () => ({ 'https://api.weather.gov/points/61.34,-149.51': { badJson: true } }),
    'no forecastHourly': () => ({ 'https://api.weather.gov/points/61.34,-149.51': { body: { properties: {} } } }),
    'no properties at all': () => ({ 'https://api.weather.gov/points/61.34,-149.51': { body: {} } }),
    'hourly down': () => { const r = goodRoutes(); r[HOURLY] = new Error('offline'); return r; },
    'hourly 503': () => { const r = goodRoutes(); r[HOURLY] = { ok: false, status: 503 }; return r; },
    'hourly bad JSON': () => { const r = goodRoutes(); r[HOURLY] = { badJson: true }; return r; },
    'no periods': () => { const r = goodRoutes(); r[HOURLY] = { body: { properties: {} } }; return r; },
    'empty periods': () => { const r = goodRoutes(); r[HOURLY] = { body: { properties: { periods: [] } } }; return r; },
  };
  for (const name of Object.keys(cases)) {
    stubFetch(cases[name]());
    assert.equal(await SnowWeather.fetchHint(61.34, -149.51, NOW), null, name);
  }
});

test('fetchHint follows only api.weather.gov', async () => {
  // The forecast URL comes from the server's reply: never follow it off the NWS.
  const r = goodRoutes();
  r['https://api.weather.gov/points/61.34,-149.51'] = { body: { properties: { forecastHourly: 'https://example.com/forecast' } } };
  const seen = stubFetch(r);
  assert.equal(await SnowWeather.fetchHint(61.34, -149.51, NOW), null);
  assert.deepEqual(seen, ['https://api.weather.gov/points/61.34,-149.51']);
});

test('fetchHint: a non-number point is refused before any request', async () => {
  const seen = stubFetch(goodRoutes());
  assert.equal(await SnowWeather.fetchHint('61.34', null, NOW), null);
  assert.deepEqual(seen, []);
});

// ---------------- fetchSnowfall ----------------

const GRID = 'https://api.weather.gov/gridpoints/ZZZ/1,1';
const POINTS = 'https://api.weather.gov/points/61.34,-149.51';
const gridRoutes = (values) => ({
  [POINTS]: { body: { properties: { forecastGridData: GRID } } },
  [GRID]: { body: { properties: { snowfallAmount: { uom: 'wmoUnit:mm', values } } } },
});
const T0 = Date.UTC(2026, 9, 3, 12, 0, 0); // 2026-10-03 12:00 UTC

test('fetchSnowfall asks the points then the grid data and reads the periods', async () => {
  const seen = stubFetch(gridRoutes([
    { validTime: '2026-10-03T12:00:00+00:00/PT6H', value: 12 },
    // P1DT6H is 24 h + 6 h = 30 h.
    { validTime: '2026-10-03T18:00:00+00:00/P1DT6H', value: 25.4 },
    // PT1H30M is 90 minutes; a null value counts as 0.
    { validTime: '2026-10-05T00:00:00+00:00/PT1H30M', value: null },
    // P1D is 24 h.
    { validTime: '2026-10-06T00:00:00+00:00/P1D', value: 3 },
  ]));
  const out = await SnowWeather.fetchSnowfall(61.34, -149.51);
  assert.deepEqual(seen, [POINTS, GRID]);
  const H = 3600000;
  assert.deepEqual(out, [
    { start: T0, end: T0 + 6 * H, mm: 12 },
    { start: T0 + 6 * H, end: T0 + 36 * H, mm: 25.4 },            // 18:00 + 30 h
    { start: T0 + 36 * H, end: T0 + 37.5 * H, mm: 0 },            // 2026-10-05 00:00 is 36 h after 10-03 12:00; + 90 min
    { start: T0 + 60 * H, end: T0 + 84 * H, mm: 3 },              // 2026-10-06 00:00 is 60 h after; + 24 h
  ]);
});

test('fetchSnowfall: a period it cannot read is skipped, the rest kept', async () => {
  stubFetch(gridRoutes([
    { validTime: 'nonsense', value: 1 },
    { validTime: '2026-10-03T12:00:00+00:00/garbage', value: 1 },
    { validTime: '2026-10-03T12:00:00+00:00/PT0H', value: 1 },
    { validTime: 'not a time/PT1H', value: 1 },
    { validTime: '2026-10-03T12:00:00+00:00/PT1H', value: 7 },
    null,
  ]));
  const out = await SnowWeather.fetchSnowfall(61.34, -149.51);
  assert.deepEqual(out, [{ start: T0, end: T0 + 3600000, mm: 7 }]);
});

test('fetchSnowfall follows only api.weather.gov', async () => {
  const r = gridRoutes([{ validTime: '2026-10-03T12:00:00+00:00/PT1H', value: 7 }]);
  r[POINTS] = { body: { properties: { forecastGridData: 'https://example.com/grid' } } };
  const seen = stubFetch(r);
  assert.equal(await SnowWeather.fetchSnowfall(61.34, -149.51), null);
  assert.deepEqual(seen, [POINTS]);
});

test('fetchSnowfall: every failure is null', async () => {
  const good = [{ validTime: '2026-10-03T12:00:00+00:00/PT1H', value: 7 }];
  const cases = {
    'network down': () => ({ [POINTS]: new Error('offline') }),
    'points 500': () => ({ [POINTS]: { ok: false, status: 500 } }),
    'points bad JSON': () => ({ [POINTS]: { badJson: true } }),
    'no forecastGridData': () => ({ [POINTS]: { body: { properties: {} } } }),
    'grid down': () => { const r = gridRoutes(good); r[GRID] = new Error('offline'); return r; },
    'grid 503': () => { const r = gridRoutes(good); r[GRID] = { ok: false, status: 503 }; return r; },
    'grid bad JSON': () => { const r = gridRoutes(good); r[GRID] = { badJson: true }; return r; },
    'no snowfallAmount': () => { const r = gridRoutes(good); r[GRID] = { body: { properties: {} } }; return r; },
    'values not a list': () => { const r = gridRoutes(good); r[GRID] = { body: { properties: { snowfallAmount: { uom: 'wmoUnit:mm', values: 'x' } } } }; return r; },
  };
  for (const name of Object.keys(cases)) {
    stubFetch(cases[name]());
    assert.equal(await SnowWeather.fetchSnowfall(61.34, -149.51), null, name);
  }
});

// The amounts are summed as mm (/ 25.4 for inches). A grid in any other unit (or none named) would
// put a wrong number in front of Matt, so it is no estimate at all.
test('fetchSnowfall: a grid not in millimetres is null', async () => {
  const good = [{ validTime: '2026-10-03T12:00:00+00:00/PT1H', value: 7 }];
  for (const uom of ['wmoUnit:cm', 'wmoUnit:in', undefined, '']) {
    const r = gridRoutes(good);
    r[GRID] = { body: { properties: { snowfallAmount: { uom, values: good } } } };
    stubFetch(r);
    assert.equal(await SnowWeather.fetchSnowfall(61.34, -149.51), null, String(uom));
  }
  stubFetch(gridRoutes(good)); // and wmoUnit:mm still reads
  assert.deepEqual(await SnowWeather.fetchSnowfall(61.34, -149.51), [{ start: T0, end: T0 + 3600000, mm: 7 }]);
});

test('fetchSnowfall: a non-number point is refused before any request', async () => {
  const seen = stubFetch(gridRoutes([]));
  assert.equal(await SnowWeather.fetchSnowfall('61.34', null), null);
  assert.deepEqual(seen, []);
});

// Sites a few blocks apart round to different points but sit in one NWS grid
// square (2.5 km), so their points answer with the same grid URL. The grid is the
// big download; while one is on its way, a second request for it waits on that one
// instead of fetching it again (the B2 review's fetch burst, 10/5/26).
test('fetchSnowfall: two points on one grid fetch the grid once while it is on its way', async () => {
  const good = [{ validTime: '2026-10-03T12:00:00+00:00/PT1H', value: 7 }];
  const P2 = 'https://api.weather.gov/points/61.35,-149.52';
  const r = gridRoutes(good);
  r[P2] = { body: { properties: { forecastGridData: GRID } } };
  const seen = stubFetch(r);
  const [a, b] = await Promise.all([SnowWeather.fetchSnowfall(61.34, -149.51), SnowWeather.fetchSnowfall(61.35, -149.52)]);
  const want = [{ start: T0, end: T0 + 3600000, mm: 7 }];
  assert.deepEqual(a, want);
  assert.deepEqual(b, want);
  assert.deepEqual(seen.filter((u) => u === GRID), [GRID]);
  // Once it has landed it is not kept: the next refresh asks the NWS again.
  await SnowWeather.fetchSnowfall(61.34, -149.51);
  assert.deepEqual(seen.filter((u) => u === GRID), [GRID, GRID]);
});

test('fetchSnowfall: a shared grid request that fails is null for both, and the next one tries again', async () => {
  const P2 = 'https://api.weather.gov/points/61.35,-149.52';
  const r = gridRoutes([]);
  r[GRID] = new Error('offline');
  r[P2] = { body: { properties: { forecastGridData: GRID } } };
  stubFetch(r);
  const both = await Promise.all([SnowWeather.fetchSnowfall(61.34, -149.51), SnowWeather.fetchSnowfall(61.35, -149.52)]);
  assert.deepEqual(both, [null, null]);
  const good = [{ validTime: '2026-10-03T12:00:00+00:00/PT1H', value: 7 }];
  stubFetch(gridRoutes(good));
  assert.deepEqual(await SnowWeather.fetchSnowfall(61.34, -149.51), [{ start: T0, end: T0 + 3600000, mm: 7 }]);
});
