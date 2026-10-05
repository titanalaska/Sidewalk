// Callouts (Matt, 10/4/26): which sites have had enough new snow since their last
// cleaning to be called out, and the order they are shown in. Pure functions:
// the clock and the forecast series are passed in, so nothing here reads the
// phone's time, the network or the page.
//
// "New snow" at a site is the measured depth when someone measured one after the
// site's last cleaning (CrewShiftLog.snowSince), else the National Weather
// Service's gridpoint estimate summed over the time since then. The estimate is
// a hint: a measured reading always wins, even a measured 0.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowCallout = factory(root.CrewShiftLog);
})(this, function (Log) {
  'use strict';

  var MM_PER_IN = 25.4;

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  // One decimal. This rounded value is what is shown AND what meets the callout.
  function round1(n) { return Math.round(n * 10) / 10; }

  // series: [{start: ms, end: ms, mm}], as SnowWeather.fetchSnowfall returns.
  // Each period counts by the fraction of it inside [from, now]; a period with no
  // snow still counts as covered (0). `since` is the first instant the series
  // covers inside the span: the span's own start, unless the series begins later
  // (storm started yesterday, forecast data begins this morning). null when
  // nothing overlaps.
  function estimate(series, fromIso, nowIso) {
    var from = Date.parse(fromIso), now = Date.parse(nowIso);
    var mm = 0, first = null, i, p, lo, hi;
    if (!(series instanceof Array) || isNaN(from) || isNaN(now) || now <= from) return null;
    for (i = 0; i < series.length; i++) {
      p = series[i];
      if (!p || !isNum(p.start) || !isNum(p.end) || p.end <= p.start) continue;
      lo = Math.max(p.start, from);
      hi = Math.min(p.end, now);
      if (hi <= lo) continue;
      mm += (isNum(p.mm) ? p.mm : 0) * ((hi - lo) / (p.end - p.start));
      if (first === null || lo < first) first = lo;
    }
    if (first === null) return null;
    return { inches: round1(mm / MM_PER_IN), since: new Date(first).toISOString() };
  }

  function rankOf(site) {
    var r = site ? site.day_rank : null;
    return isNum(r) ? r : null;
  }

  // Day shift: ranked sites first (rank ascending, ties by place in the list),
  // then the unranked in list order. Night shift keeps the order it was given.
  // Always a new array.
  function rankOrder(siteIds, siteById, isDay) {
    var ids = (siteIds || []).slice(), items;
    if (!isDay) return ids;
    items = ids.map(function (id, i) { return { id: id, i: i, rank: rankOf((siteById || {})[id]) }; });
    items.sort(function (a, b) {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.i - b.i;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.i - b.i;
    });
    return items.map(function (x) { return x.id; });
  }

  // A measured depth, as a number, or null when the row has no usable value.
  function measuredInches(row) {
    var v = row ? row.depth_in : null;
    if (v === null || v === undefined || v === '') return null;
    v = Number(v);
    return isFinite(v) ? v : null;
  }

  // The sites to call out, in display order.
  //   siteIds    live-view order; a site on two routes is kept at its first place
  //   siteById   id -> site ({callout_in, day_rank, ...})
  //   log, storms, stormId   for CrewShiftLog.snowSince
  //   nowIso     the end of the estimate's span
  //   seriesFor  site id -> series | null | undefined (no forecast for this site)
  //   isDay      day-shift order (see rankOrder)
  // Each: { site_id, inches (1 dp), since (iso), measured (the row or null), callout }.
  function calloutList(o) {
    var seen = {}, kept = [], byId = {}, siteById = o.siteById || {};
    (o.siteIds || []).forEach(function (id) {
      var site = siteById[id], since, inches, at, m, est, series;
      if (seen[id]) return;
      seen[id] = true;
      if (!site || !isNum(site.callout_in)) return;
      since = Log.snowSince(o.log, o.storms, o.stormId, id);
      m = measuredInches(since.measured);
      if (m !== null) { inches = round1(m); at = since.measured.at; }
      else if (since.from) {
        series = o.seriesFor ? o.seriesFor(id) : null;
        est = series ? estimate(series, since.from, o.nowIso) : null;
        if (est) { inches = est.inches; at = est.since; }
      }
      if (inches === undefined || inches < site.callout_in) return;
      kept.push(id);
      byId[id] = { site_id: id, inches: inches, since: at, measured: m !== null ? since.measured : null, callout: site.callout_in };
    });
    return rankOrder(kept, siteById, !!o.isDay).map(function (id) { return byId[id]; });
  }

  return { estimate: estimate, rankOrder: rankOrder, calloutList: calloutList };
});
