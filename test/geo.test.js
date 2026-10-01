// Geometry moved over from Bootprint (Yard-Measure-repo/tests/geometry.spec.js),
// same cases, same hand-worked expected values -- only the runner changed
// (node instead of Playwright). The first two tests check the projection
// against published figures so the rest are not circular.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/geo');

const ORIGIN = { lat: 61.2181, lng: -149.9003 };
const R = 6371000;
const DEG = Math.PI / 180;
const FT_TO_M = 0.3048;
const dLat = (ft) => (ft * FT_TO_M) / R / DEG;
const dLng = (ft, atLat) => (ft * FT_TO_M) / (R * Math.cos(atLat * DEG)) / DEG;
const pin = (eastFt, northFt, accuracy = 3) => ({ lat: ORIGIN.lat + dLat(northFt), lng: ORIGIN.lng + dLng(eastFt, ORIGIN.lat), accuracy });
const rect = (e, n, w, h) => [pin(e, n), pin(e + w, n), pin(e + w, n + h), pin(e, n + h)];
const lShape = (e, n, w, h, bw, bh) => [pin(e, n), pin(e + w, n), pin(e + w, n + h - bh), pin(e + w - bw, n + h - bh), pin(e + w - bw, n + h), pin(e, n + h)];
// Bootprint's closeTo: tolerance is a PERCENT of the expected value (tests/helpers.js).
const close = (a, b, pct) => (b === 0 ? Math.abs(a) < 1e-6 : Math.abs(a - b) / Math.abs(b) <= pct / 100);
const distanceM = (a, b) => G.calcPerimeterM([a, b]) / 2;
const sqft = (pins) => G.calcAreaSqm(pins) * 10.7639;

test('a thousandth of a degree of latitude is 111.19 m', () => {
  const d = distanceM({ lat: ORIGIN.lat, lng: ORIGIN.lng, accuracy: 1 }, { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng, accuracy: 1 });
  assert.ok(close(d, 111.1949, 0.5), d);
});
test('longitude shrinks by cos(latitude) this far north', () => {
  const north = distanceM({ lat: ORIGIN.lat, lng: ORIGIN.lng, accuracy: 1 }, { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng, accuracy: 1 });
  const east = distanceM({ lat: ORIGIN.lat, lng: ORIGIN.lng, accuracy: 1 }, { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001, accuracy: 1 });
  assert.ok(close(east / north, Math.cos(ORIGIN.lat * DEG), 0.1));
});
test('a 100 x 50 ft rectangle is 5,000 sq ft', () => { assert.ok(close(sqft(rect(0, 0, 100, 50)), 5000, 0.5)); });
test('walking a shape backwards measures the same ground', () => {
  const p = rect(0, 0, 120, 80);
  assert.ok(close(G.calcAreaSqm(p.slice().reverse()), G.calcAreaSqm(p), 0.001));
});
test('starting from a different corner measures the same ground', () => {
  const p = rect(0, 0, 120, 80);
  assert.ok(close(G.calcAreaSqm([...p.slice(2), ...p.slice(0, 2)]), G.calcAreaSqm(p), 0.001));
});
test('doubling both sides quadruples the area', () => {
  assert.ok(close(G.calcAreaSqm(rect(0, 0, 100, 60)) / G.calcAreaSqm(rect(0, 0, 50, 30)), 4, 0.01));
});
test('an L-shape equals the two rectangles it is made of', () => {
  // 100 x 100 with a 40 x 30 bite: 10,000 - 1,200 = 8,800 sq ft.
  assert.ok(close(sqft(lShape(0, 0, 100, 100, 40, 30)), 8800, 0.5));
});
test('fewer than three pins has no area', () => {
  const p = rect(0, 0, 10, 10);
  assert.deepEqual([G.calcAreaSqm([]), G.calcAreaSqm([p[0]]), G.calcAreaSqm([p[0], p[1]])], [0, 0, 0]);
});

// --- snow app additions
test('a bow-tie crosses itself; the same square in order does not', () => {
  // Drawn corners have no GPS wobble: accuracy 0.
  const sq = rect(0, 0, 100, 100).map((p) => ({ ...p, accuracy: 0 }));
  assert.equal(G.isSelfIntersecting(sq), false);
  assert.equal(G.isSelfIntersecting([sq[0], sq[2], sq[1], sq[3]]), true);
});
test('a ring of [lng, lat] corners converts to pins, and 300 m2 is 3,229 sq ft', () => {
  // 30 m east x 10 m north at 61.2 N: 300 m2 x 10.7639 = 3,229.17 sq ft.
  const e = 30 / (R * Math.cos(61.2 * DEG)) / DEG, n = 10 / R / DEG;
  const ring = [[-149.9, 61.2], [-149.9 + e, 61.2], [-149.9 + e, 61.2 + n], [-149.9, 61.2 + n]];
  const pins = G.ringToPins(ring);
  assert.deepEqual(pins[1], { lng: -149.9 + e, lat: 61.2, accuracy: 0 });
  assert.ok(close(G.sqmToSqft(G.calcAreaSqm(pins)), 3229.17, 0.031), G.sqmToSqft(G.calcAreaSqm(pins)));
});
