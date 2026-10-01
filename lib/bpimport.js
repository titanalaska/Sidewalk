// Bootprint -> Snow Crew zones. PURE: no page, no network. Matt traces a site
// in Bootprint (snow season: walk / hand / plow / storage surfaces) and imports
// its export file here (Matt, 10/1/26). The file is read on this laptop; only
// the outlines that become zones are ever sent.
//
// What comes across: walk and hand surfaces, as sidewalk zones. Areas keep
// their corners; runs become a strip of their own width. Lots (plow) stay out
// because parking is the plow crew's and is never drawn (Matt, 9/30), storage
// is where snow goes, and Snow Crew zones have no holes, so cut-outs stay out.
// A run with no width is skipped, never given one.
var SnowBpImport = (function () {
  'use strict';
  var DEG = Math.PI / 180, R = 6371000, FT = 0.3048;
  // A corner sharper than this (the strip's mitre would reach past 4 half-widths)
  // folds the strip over itself. Such a run is skipped: trace it as an area.
  var SHARPEST = 0.25;
  var Geo = typeof module !== 'undefined' ? require('./geo.js') : null;
  function geo() { return Geo || window.SnowGeo; }

  function parseExport(text) {
    var bad = { error: 'That file is not a Bootprint export. Make one at bootprint.app/export.html.' };
    var p;
    try { p = JSON.parse(text); } catch (e) { return bad; }
    if (!p || p.schema !== 'bootprint-library-export' || !Array.isArray(p.jobs)) return bad;
    var jobs = p.jobs.filter(function (j) { return j && Array.isArray(j.zones); });
    // The job open in Bootprint is not filed until it is saved; bring it too.
    var cur = p.current;
    if (cur && Array.isArray(cur.zones) && cur.zones.length && !jobs.some(function (j) { return j.id === cur.jobId; })) {
      jobs.push({ id: cur.jobId || 'open', name: cur.jobName || 'Open in Bootprint (not filed yet)', zones: cur.zones });
    }
    return { jobs: jobs };
  }

  function pinsOf(z) {
    return (z.pins || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
  }

  // Jobs nearest the site first, so the right one is at the top of the list.
  function byDistance(jobs, center) {
    return jobs.map(function (j) {
      var all = [];
      j.zones.forEach(function (z) { all = all.concat(pinsOf(z)); });
      if (!all.length) return { job: j, meters: Infinity };
      var lat = all.reduce(function (s, p) { return s + p.lat; }, 0) / all.length;
      var lng = all.reduce(function (s, p) { return s + p.lng; }, 0) / all.length;
      var dx = (lng - center[0]) * DEG * R * Math.cos(center[1] * DEG), dy = (lat - center[1]) * DEG * R;
      return { job: j, meters: Math.sqrt(dx * dx + dy * dy) };
    }).sort(function (a, b) { return a.meters - b.meters; });
  }

  // A run (centreline + width) as an outline: offset both sides, mitred at
  // each bend so the strip keeps its full area. null when a bend is too sharp
  // or the strip would cross itself.
  function stripRing(pins, widthFt) {
    var lat0 = pins[0].lat, lng0 = pins[0].lng, k = Math.cos(lat0 * DEG);
    var pts = [];
    pins.forEach(function (p) {
      var q = { x: (p.lng - lng0) * DEG * R * k, y: (p.lat - lat0) * DEG * R };
      var last = pts[pts.length - 1];
      if (!last || Math.abs(last.x - q.x) > 1e-6 || Math.abs(last.y - q.y) > 1e-6) pts.push(q);
    });
    if (pts.length < 2) return null;
    var half = widthFt * FT / 2, left = [], right = [];
    function normal(a, b) { var dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy); return { x: -dy / l, y: dx / l }; }
    for (var i = 0; i < pts.length; i++) {
      var n1 = i > 0 ? normal(pts[i - 1], pts[i]) : null, n2 = i < pts.length - 1 ? normal(pts[i], pts[i + 1]) : null;
      var m, len = half;
      if (n1 && n2) {
        var sx = n1.x + n2.x, sy = n1.y + n2.y, sl = Math.sqrt(sx * sx + sy * sy);
        if (sl < 1e-9) return null;                     // straight back on itself
        m = { x: sx / sl, y: sy / sl };
        var cos = m.x * n1.x + m.y * n1.y;
        if (cos < SHARPEST) return null;
        len = half / cos;
      } else m = n1 || n2;
      left.push({ x: pts[i].x + m.x * len, y: pts[i].y + m.y * len });
      right.push({ x: pts[i].x - m.x * len, y: pts[i].y - m.y * len });
    }
    var ring = left.concat(right.reverse()).map(function (q) {
      return [lng0 + q.x / (R * k) / DEG, lat0 + q.y / R / DEG];
    });
    return geo().isSelfIntersecting(geo().ringToPins(ring)) ? null : ring;
  }

  // existing: the `from` of zones this site already has, so a second import adds nothing.
  function convertJob(job, existing) {
    var skipped = { lots: 0, storage: 0, cutouts: 0, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0 };
    var zones = [];
    job.zones.forEach(function (z) {
      var mode = z.mode || 'area', surface = z.surface || 'plow'; // Bootprint's own default surface
      if (mode === 'cut') { skipped.cutouts++; return; }
      if (surface === 'plow') { skipped.lots++; return; }
      if (surface === 'storage') { skipped.storage++; return; }
      var from = 'bootprint:' + job.id + ':' + z.id;
      if ((existing || []).indexOf(from) !== -1) { skipped.already++; return; }
      var pins = pinsOf(z), ring;
      if (mode === 'line') {
        if (pins.length < 2) { skipped.unfinished++; return; }
        var w = parseFloat(z.widthFt);
        if (!(w > 0)) { skipped.noWidth++; return; }
        ring = stripRing(pins, w);
        if (!ring) { skipped.tooSharp++; return; }
      } else {
        if (pins.length < 3) { skipped.unfinished++; return; }
        ring = pins.map(function (p) { return [p.lng, p.lat]; });
      }
      zones.push({ name: z.name || 'Zone ' + z.id, type: 'sidewalk', ring: ring, from: from });
    });
    return { zones: zones, skipped: skipped };
  }

  return { parseExport: parseExport, byDistance: byDistance, convertJob: convertJob, stripRing: stripRing };
})();
if (typeof module !== 'undefined') module.exports = SnowBpImport;
if (typeof window !== 'undefined') window.SnowBpImport = SnowBpImport;
