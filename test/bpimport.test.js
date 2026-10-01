// Bootprint -> Snow Crew zones (Matt, 10/1/26: trace in Bootprint, import here).
// Expected values are worked out on paper in the comments, never pasted from a run.
const test = require('node:test');
const assert = require('node:assert');
const BP = require('../lib/bpimport.js');
const G = require('../lib/geo.js');

const DEG = Math.PI / 180, R = 6371000;
const LAT0 = 61.2177, LNG0 = -149.8885; // PAC
// A point x m east and y m north of PAC, as a Bootprint pin.
const pin = (x, y) => ({ lat: LAT0 + y / R / DEG, lng: LNG0 + x / (R * Math.cos(LAT0 * DEG)) / DEG, accuracy: 0 });
const sqm = (ring) => G.calcAreaSqm(G.ringToPins(ring));

const job = (zones, over) => ({ id: 'J1', name: 'PAC', zones, ...over });
const zone = (id, mode, surface, pins, widthFt) => ({ id, name: 'Zone ' + id, mode, surface, pins, widthFt: widthFt == null ? '' : widthFt });
const SQUARE = [pin(0, 0), pin(10, 0), pin(10, 5), pin(0, 5)];

test('a walk area comes across as a sidewalk zone with the same corners', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'walk', SQUARE)]), []);
  assert.strictEqual(r.zones.length, 1);
  const z = r.zones[0];
  assert.strictEqual(z.type, 'sidewalk');
  assert.strictEqual(z.name, 'Zone 1');
  assert.strictEqual(z.from, 'bootprint:J1:1');
  assert.deepStrictEqual(z.ring, SQUARE.map((p) => [p.lng, p.lat]));
  // 10 m x 5 m = 50 m2 (on paper), within 0.5%.
  assert.ok(Math.abs(sqm(z.ring) - 50) < 0.25, sqm(z.ring));
});

test('hand areas (stairs, by the door) are the sidewalk crew too', () => {
  assert.strictEqual(BP.convertJob(job([zone(1, 'area', 'hand', SQUARE)]), []).zones.length, 1);
});

test('lots, storage and cut-outs are skipped and counted, never sent', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', SQUARE), zone(2, 'area', 'storage', SQUARE),
    zone(3, 'cut', 'walk', SQUARE), zone(4, 'area', undefined, SQUARE)]), []);
  assert.strictEqual(r.zones.length, 0);
  // A zone with no surface is an older or summer job: Bootprint's default is plow.
  assert.deepStrictEqual(r.skipped, { lots: 2, storage: 1, cutouts: 1, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0 });
});

test('a run with no width is skipped, not given a made-up width', () => {
  const r = BP.convertJob(job([zone(1, 'line', 'walk', [pin(0, 0), pin(30, 0)], '')]), []);
  assert.strictEqual(r.zones.length, 0);
  assert.strictEqual(r.skipped.noWidth, 1);
});

test('a straight run becomes a strip of its width', () => {
  // 30 m long, 10 ft (3.048 m) wide: 30 x 3.048 = 91.44 m2 = 984.25 sq ft.
  const r = BP.convertJob(job([zone(1, 'line', 'walk', [pin(0, 0), pin(30, 0)], '10')]), []);
  assert.strictEqual(r.zones.length, 1);
  assert.strictEqual(r.zones[0].ring.length, 4);
  assert.ok(Math.abs(sqm(r.zones[0].ring) - 91.44) < 0.5, sqm(r.zones[0].ring));
});

test('a run that turns a corner keeps its full area (mitred corner)', () => {
  // 20 m east then 20 m north, 2 m wide (6.5617 ft). Edges: y=+-1 and x=19/21, mitres at
  // (19,1) and (21,-1): 21 x 2 + 2 x 19 = 80 m2 = centreline 40 m x 2 m.
  const r = BP.convertJob(job([zone(1, 'line', 'walk', [pin(0, 0), pin(20, 0), pin(20, 20)], String(2 / 0.3048))]), []);
  assert.strictEqual(r.zones.length, 1);
  assert.strictEqual(r.zones[0].ring.length, 6);
  assert.ok(Math.abs(sqm(r.zones[0].ring) - 80) < 0.5, sqm(r.zones[0].ring));
  assert.strictEqual(G.isSelfIntersecting(G.ringToPins(r.zones[0].ring)), false);
});

test('a run that doubles back on itself is skipped: trace it as an area', () => {
  // 20 m east then straight back 19 m: the two halves of the strip overlap.
  const r = BP.convertJob(job([zone(1, 'line', 'walk', [pin(0, 0), pin(20, 0), pin(1, 0.5)], '6')]), []);
  assert.strictEqual(r.zones.length, 0);
  assert.strictEqual(r.skipped.tooSharp, 1);
});

test('unfinished shapes (too few corners) are skipped', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'walk', SQUARE.slice(0, 2)), zone(2, 'line', 'walk', [pin(0, 0)], '6')]), []);
  assert.strictEqual(r.zones.length, 0);
  assert.strictEqual(r.skipped.unfinished, 2);
});

test('importing the same job again adds nothing', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'walk', SQUARE), zone(2, 'area', 'walk', SQUARE)]), ['bootprint:J1:1']);
  assert.deepStrictEqual(r.zones.map((z) => z.from), ['bootprint:J1:2']);
  assert.strictEqual(r.skipped.already, 1);
});

test('the export file is read; anything else is refused with a reason', () => {
  const file = JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [job([zone(1, 'area', 'walk', SQUARE)])],
    current: { jobId: 'J9', zones: [zone(1, 'area', 'walk', SQUARE)] } });
  const p = BP.parseExport(file);
  assert.strictEqual(p.error, undefined);
  // The job open in Bootprint is not filed yet; it comes along too.
  assert.deepStrictEqual(p.jobs.map((j) => j.id), ['J1', 'J9']);
  assert.match(BP.parseExport('{"hello":1}').error, /Bootprint export/);
  assert.match(BP.parseExport('not json').error, /Bootprint export/);
});

test('jobs are listed nearest the site first', () => {
  const far = job([zone(1, 'area', 'walk', SQUARE.map((p) => ({ ...p, lat: p.lat + 0.1 })))], { id: 'FAR', name: 'Far' });
  const near = job([zone(1, 'area', 'walk', SQUARE)], { id: 'NEAR', name: 'Near' });
  const sorted = BP.byDistance([far, near], [LNG0, LAT0]);
  assert.deepStrictEqual(sorted.map((s) => s.job.id), ['NEAR', 'FAR']);
  assert.ok(sorted[0].meters < 20 && sorted[1].meters > 10000); // 0.1 deg of latitude is ~11.1 km
});
