(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowTotals = factory(root.CrewShiftLog);
})(this, function (L) {
  'use strict';

  // Snow-work totals for Matt's Sites tab (approved 10/10/26), the same rules as his totals page.
  // Pure: nothing here changes what it is given, and every result is a fresh object.
  //
  //   Totals = { zones: n, sidewalk: [sqft, n], heated: [sqft, n], hand: [sqft, n],
  //              curb: [feet, n], storage: [sqft, n], no_touch: [sqft, n] }
  //
  // The rules:
  //  - Only live zones (archived !== true) of live sites (archived !== true).
  //  - A zone counts by its server-computed area_sqft. Rings are never read (a sign-in zone carries
  //    none). Only a real number above 0 counts. Missing, 0, negative, NaN, Infinity, null, true,
  //    a list, or a STRING (even "250") counts nothing: the server always sends numbers, so
  //    anything else means something is wrong, and Number() would let true and [5] in as 1 and 5.
  //    A zone with no usable area adds neither sq ft nor a zone to its bucket, so `zones` is 0
  //    exactly when there is nothing to show.
  //  - A curb zone (CrewShiftLog.isCurbZone: a hand zone named "Curb ...") counts as FEET,
  //    area / CURB_ROLLUP.widthFt, and is not also counted as hand work. Every other zone counts
  //    under its type. A type that is not one of the five is counted nowhere.
  //
  // ROUNDING: amounts are summed unrounded and rounded to a whole number ONCE, at the end of each
  // level (a site, a customer, the grand total). siteTotals, byCustomer and all each round their
  // own raw sum, so a customer's total is what its zones add up to, and never a sum of rounded
  // site rows. The cost is that the shown site rows can differ from the shown customer total by
  // a unit or two (three curb zones of 10 sq ft: 2.5 ft each shows 3 + 3 + 3 = 9 on the rows,
  // while the customer's 7.5 ft shows 8). The total is the one that matches the zones.
  // add() sums the two Totals it is given and rounds that sum once; for Totals that are already
  // whole numbers the rounding changes nothing, but chaining add() over rounded rows will carry
  // their rounding, so byCustomer and all do not use it.

  var BUCKETS = ['sidewalk', 'heated', 'hand', 'curb', 'storage', 'no_touch'];
  var AREA_TYPES = { sidewalk: true, heated: true, hand: true, storage: true, no_touch: true };
  var SEP = ' · ';

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function blank() {
    var t = { zones: 0 };
    BUCKETS.forEach(function (b) { t[b] = [0, 0]; });
    return t;
  }

  // A real, finite number above 0, or 0.
  function usableArea(z) {
    var a = z.area_sqft;
    return typeof a === 'number' && isFinite(a) && a > 0 ? a : 0;
  }

  function bucketOf(z) {
    if (L.isCurbZone(z)) return 'curb';
    return typeof z.type === 'string' && has(AREA_TYPES, z.type) ? z.type : null;
  }

  // Unrounded totals for one site.
  function rawSite(siteId, zones) {
    var t = blank();
    (zones || []).forEach(function (z) {
      if (!z || z.site_id !== siteId || z.archived === true) return;
      var b = bucketOf(z), a = usableArea(z);
      if (!b || !a) return;
      t[b][0] += b === 'curb' ? a / L.CURB_ROLLUP.widthFt : a;
      t[b][1] += 1;
      t.zones += 1;
    });
    return t;
  }

  // Unrounded sum of any number of Totals (a missing one counts as empty, a missing bucket as 0).
  function sumRaw(list) {
    var t = blank();
    list.forEach(function (x) {
      if (!x) return;
      t.zones += Number(x.zones) || 0;
      BUCKETS.forEach(function (b) {
        var p = x[b];
        if (!p) return;
        t[b][0] += Number(p[0]) || 0;
        t[b][1] += Number(p[1]) || 0;
      });
    });
    return t;
  }

  // A fresh Totals with each amount rounded to a whole number (counts are whole already).
  function rounded(raw) {
    var t = { zones: raw.zones };
    BUCKETS.forEach(function (b) { t[b] = [Math.round(raw[b][0]), raw[b][1]]; });
    return t;
  }

  function siteTotals(siteId, zones) { return rounded(rawSite(siteId, zones)); }

  function add(a, b) { return rounded(sumRaw([a, b])); }

  // The Sites tab's own order (lib/app.js renderSites): sites A-Z by name; customers A-Z by
  // localeCompare on the trimmed name, the blank customer last.
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }

  function liveSites(sites) {
    return (sites || []).filter(function (s) { return s && s.archived !== true; }).sort(byName);
  }

  function byCustomer(sites, zones) {
    var groups = Object.create(null);
    liveSites(sites).forEach(function (s) {
      var c = String(s.customer || '').trim();
      (groups[c] = groups[c] || []).push({ id: s.id, name: s.name, raw: rawSite(s.id, zones) });
    });
    var order = Object.keys(groups).filter(function (c) { return c; }).sort(function (a, b) { return a.localeCompare(b); });
    if (groups['']) order.push('');
    return order.map(function (c) {
      var rows = groups[c];
      return {
        customer: c,
        sites: rows.map(function (r) { return { id: r.id, name: r.name, totals: rounded(r.raw) }; }),
        totals: rounded(sumRaw(rows.map(function (r) { return r.raw; }))),
      };
    });
  }

  function all(sites, zones) {
    return rounded(sumRaw(liveSites(sites).map(function (s) { return rawSite(s.id, zones); })));
  }

  // ---- the phone line ----

  var LINE_ORDER = [['sidewalk', 'Sidewalk'], ['heated', 'Heated'], ['hand', 'Hand'], ['curb', 'Curbs'],
    ['storage', 'Storage'], ['no_touch', 'No-touch']];

  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // "Sidewalk 19,103 sq ft · Heated 11,626 · Hand 27,021 · Curbs 1,739 ft · Storage 1,600 · No-touch 184".
  // Only buckets with something in them. Curbs are feet. "sq ft" is said once, after the first
  // area figure (the first bucket that is not curbs), so curbs listed first do not take it.
  function line(t) {
    var parts = [], unitSaid = false;
    LINE_ORDER.forEach(function (p) {
      var pair = t && t[p[0]];
      var n = pair ? Math.round(Number(pair[0])) : 0;
      if (!(n > 0)) return;
      var s = p[1] + ' ' + commas(n);
      if (p[0] === 'curb') s += ' ft';
      else if (!unitSaid) { s += ' sq ft'; unitSaid = true; }
      parts.push(s);
    });
    return parts.length ? parts.join(SEP) : 'No zones yet';
  }

  // The Sites tab and Routes tab line (Matt, 11/23/26: "How about we just show sidewalk totals?"): Sidewalk, Heated
  // and Hand, each its own number, in that order; curbs, storage and no-touch are never on it (a "Curb ..." line is
  // already a curb here, never Hand). "sq ft" once, after the first number. One string per part, so the page can keep
  // each part whole on a narrow phone and Spanish can read each part on its own. Nothing to list = [] (no line).
  var WALK_ORDER = [['sidewalk', 'Sidewalk'], ['heated', 'Heated'], ['hand', 'Hand']];

  function walkParts(t) {
    var parts = [];
    WALK_ORDER.forEach(function (p) {
      var pair = t && t[p[0]];
      var n = pair ? Math.round(Number(pair[0])) : 0;
      if (!(n > 0)) return;
      parts.push(p[1] + ' ' + commas(n) + (parts.length ? '' : ' sq ft'));
    });
    return parts;
  }

  function walkLine(t) { return walkParts(t).join(SEP); }

  return { siteTotals: siteTotals, add: add, byCustomer: byCustomer, all: all, line: line, walkParts: walkParts, walkLine: walkLine };
});
