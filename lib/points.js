// Points and slim zones (outlines on demand, Matt 10/9/26). Sign-in used to carry every
// zone's outline (225 KB of 341 KB); it now carries one [lng, lat] per site instead and the
// outlines come per map, on request. This file is the one place that point is decided and the
// one place a zone loses its ring, so the server's reply and the phone's map centre cannot
// disagree.
//
// The phone app and the Apps Script backend use this SAME file, byte for byte
// (snow-app-script/test/geo-identity.test.js fails if they differ). No requires: Apps Script
// loads it as a plain file, so it must not depend on any other file. Pure: nothing it is
// given is changed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowPoints = factory();
})(this, function () {
  'use strict';

  // Area-weighted centroid in the lng/lat plane: plenty at site scale, and it
  // stays inside an L-shaped walk where the corner average can fall outside.
  //
  // This is the centroid that was in lib/mapview.js, with ONE change: the corners are taken
  // relative to the first corner. The formula is the same (the centroid does not care where
  // the origin is), but at -149.9 / 61.2 the products p[0]*q[1] - q[0]*p[1] are about 9,000
  // each and their sum is about 1e-7, so the rounding in the products swamps the answer.
  // Measured (10/9/26): a 30 m x 10 m rectangle came out 36 m off, a 4 ft x 100 ft curb
  // strip 628 m to 1,350 m off, a 100 m square 0.24 m off. Relative to a corner, the same
  // rings come out within a millimetre.
  function centroid(ring) {
    var o = ring[0], a = 0, x = 0, y = 0, n = ring.length;
    for (var i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      var px = p[0] - o[0], py = p[1] - o[1], qx = q[0] - o[0], qy = q[1] - o[1];
      var c = px * qy - qx * py;
      a += c; x += (px + qx) * c; y += (py + qy) * c;
    }
    if (!a) return [o[0], o[1]];
    return [o[0] + x / (3 * a), o[1] + y / (3 * a)];
  }

  function finite(n) { return typeof n === 'number' && isFinite(n); }

  // Every corner is a [lng, lat] pair of finite numbers (what the server's saveZone checks too). The
  // Zones tab can be edited by hand, so a ring read from it is not trusted until it passes this.
  function cornersOk(ring) {
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i];
      if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return false;
    }
    return true;
  }

  // A site's one point: its saved map centre when both coordinates are numbers; else the
  // centroid of the FIRST zone (in the order given) that belongs to the site, is not archived,
  // and has a usable ring (3 or more corners, each a pair of finite numbers, with a finite
  // centroid); else null. A zone that is not usable is passed over, never an error: one bad
  // hand-edited row must not cost the whole crew their sign-in.
  //
  // An archived zone is skipped because Matt's (admin) reply includes archived zones and a
  // crew reply does not, and both must pick the same zone. The test is the same literal
  // `archived !== true` the server's live() uses.
  function sitePoint(site, zones) {
    if (!site) return null;
    var c = site.map && site.map.center;
    if (c && finite(c[0]) && finite(c[1])) return [c[0], c[1]];
    var list = zones || [];
    for (var i = 0; i < list.length; i++) {
      var z = list[i];
      if (z && z.site_id === site.id && z.archived !== true && Array.isArray(z.ring) && z.ring.length >= 3 && cornersOk(z.ring)) {
        var p = centroid(z.ring);
        if (finite(p[0]) && finite(p[1])) return p;
      }
    }
    return null;
  }

  // { site_id: [lng, lat] } for every site that has a point. A site without one has no key.
  function pointsFor(sites, zones) {
    var out = {}, list = sites || [];
    for (var i = 0; i < list.length; i++) {
      var p = sitePoint(list[i], zones);
      if (p) out[list[i].id] = p;
    }
    return out;
  }

  // Copies of the zones without their rings; every other field kept. The input zones keep theirs.
  function slim(zones) {
    return (zones || []).map(function (z) {
      var copy = {};
      for (var k in z) if (Object.prototype.hasOwnProperty.call(z, k) && k !== 'ring') copy[k] = z[k];
      return copy;
    });
  }

  return { centroid: centroid, sitePoint: sitePoint, pointsFor: pointsFor, slim: slim };
});
