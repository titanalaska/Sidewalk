// Geometry, moved VERBATIM from Bootprint (Yard-Measure-repo/index.html):
// project, signedArea, polyArea, pointInTriangle, triangulate, calcAreaSqm,
// calcPerimeterM, areaDisagreesWithGround, isSelfIntersecting. Its numbers go
// into bids and are covered by Bootprint's hand-worked tests (moved to
// test/geo.test.js). Do not "improve" it here -- fix it in Bootprint first.
//
// The phone app and the Apps Script backend use this SAME file, byte for byte
// (snow-app-script/test/geo-identity.test.js fails if they differ).
var SnowGeo = (function () {
  'use strict';

  const cross3 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  function project(pins, ref) {
    if (!pins.length) return [];
    const latRef = (ref || pins[0]).lat, lngRef = (ref || pins[0]).lng;
    const R = 6371000;
    return pins.map(p => ({
      x: (p.lng - lngRef) * Math.PI / 180 * R * Math.cos(latRef * Math.PI / 180),
      y: (p.lat - latRef) * Math.PI / 180 * R,
      acc: p.accuracy,
    }));
  }

  function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return s / 2;
  }

  function polyArea(pts) {
    return pts.length < 3 ? 0 : Math.abs(signedArea(pts));
  }

  function pointInTriangle(p, a, b, c) {
    const d1 = cross3(a, b, p), d2 = cross3(b, c, p), d3 = cross3(c, a, p);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  function triangulate(poly) {
    const pts = poly.slice();
    if (signedArea(pts) < 0) pts.reverse(); // ear clipping wants CCW
    const idx = pts.map((_, i) => i);
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 5000) {
      let clipped = false;
      for (let i = 0; i < idx.length; i++) {
        const n = idx.length;
        const ai = (i - 1 + n) % n, ci = (i + 1) % n;
        const a = pts[idx[ai]], b = pts[idx[i]], c = pts[idx[ci]];
        if (cross3(a, b, c) <= 0) continue; // reflex corner, not an ear
        let ok = true;
        for (let j = 0; j < n; j++) {
          if (j === i || j === ai || j === ci) continue;
          if (pointInTriangle(pts[idx[j]], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([a, b, c]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break; // self-intersecting or degenerate — bail out
    }
    if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
    return tris;
  }

  function calcAreaSqm(pins) {
    if (pins.length < 3) return 0;
    const pts = project(pins);
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area / 2);
  }

  function calcPerimeterM(pins) {
    if (pins.length < 2) return 0;
    const pts = project(pins);
    let perim = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      perim += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    }
    return perim;
  }

  function areaDisagreesWithGround(pins) {
    if (pins.length < 4) return false;
    const covered = triangulate(project(pins)).reduce((s, t) => s + polyArea(t), 0);
    if (covered <= 0) return false;
    // 2% tolerance absorbs floating-point drift without hiding a real fold.
    return Math.abs(calcAreaSqm(pins) - covered) > Math.max(0.5, covered * 0.02);
  }

  function isSelfIntersecting(pins) {
    if (pins.length < 4) return false;
    if (areaDisagreesWithGround(pins)) return true;
    const pts = project(pins);
    const n = pts.length;
    const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    const segmentsIntersect = (a1, a2, b1, b2) =>
      (ccw(a1, b1, b2) !== ccw(a2, b1, b2)) && (ccw(a1, a2, b1) !== ccw(a1, a2, b2));
    const distToLine = (pt, p, q) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      return Math.abs((pt.x - p.x) * dy - (pt.y - p.y) * dx) / len;
    };
    // How far past each other's line the segments actually reach — small for
    // noise-scale crossings, large for a genuine walked-out-of-order mistake.
    const crossDepth = (a1, a2, b1, b2) => Math.min(
      distToLine(a1, b1, b2), distToLine(a2, b1, b2),
      distToLine(b1, a1, a2), distToLine(b2, a1, a2)
    );

    for (let i = 0; i < n; i++) {
      const a1 = pts[i], a2 = pts[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
        const b1 = pts[j], b2 = pts[(j + 1) % n];
        if (segmentsIntersect(a1, a2, b1, b2)) {
          const depth = crossDepth(a1, a2, b1, b2);
          const avgAccM = (a1.acc + a2.acc + b1.acc + b2.acc) / 4;
          const threshold = Math.max(1.5, avgAccM * 2);
          if (depth > threshold) return true;
        }
      }
    }
    return false;
  }

  // [[lng, lat], ...] -> pins. Drawn corners have no GPS wobble: accuracy 0.
  function ringToPins(ring) {
    return (ring || []).map(function (c) { return { lng: Number(c[0]), lat: Number(c[1]), accuracy: 0 }; });
  }
  function sqmToSqft(sqm) { return sqm * 10.7639; }

  return { calcAreaSqm: calcAreaSqm, calcPerimeterM: calcPerimeterM, isSelfIntersecting: isSelfIntersecting,
    ringToPins: ringToPins, sqmToSqft: sqmToSqft };
})();
if (typeof module !== 'undefined') module.exports = SnowGeo;
if (typeof window !== 'undefined') window.SnowGeo = SnowGeo;
