// The live view's summary line (live window, Matt 10/6/26): how the night is going in one
// line, from the same rows the route cards replay. PURE: node tests it directly. Nothing is
// stored; the Storm tab's poll redraws it every 20 s while it is on screen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowLiveSum = factory(root.CrewShiftLog);
})(this, function (Log) {
  'use strict';

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }

  // o: { routes: [{id, siteIds}] (live routes, live sites only), zones, log, stormId,
  //      states (optional: CrewShiftLog.walkStates, when the caller already has it) }
  // -> { sitesDone, sitesTouched, sitesTotal, problems, lastTapAt, routesStarted, routesTotal }
  //   sitesTotal   each site once, however many routes carry it
  //   sitesDone    every walk done (CrewShiftLog.siteDone), this storm
  //   sitesTouched Touched and not done (CrewShiftLog.siteTouched: sidewalks done, hand work left)
  //   problems     open Problems (CrewShiftLog.openProblems: carried from an earlier pass too)
  //   lastTapAt    the newest REAL tap (never a '*' row, never an undo, never a tap whose undo stands)
  //   routesStarted  routes with a real tap on any of their sites this storm
  // No storm: nothing done, nothing open, no tap; the totals still count what there is.
  function liveSummary(o) {
    var routes = o.routes || [], zones = o.zones || [], stormId = o.stormId || null;
    var rows = stormId ? (o.log || []).filter(function (r) { return r.storm_id === stormId; }) : [];
    var states = o.states || Log.walkStates(o.log || [], stormId);
    var siteIds = [], seen = {};
    routes.forEach(function (r) { (r.siteIds || []).forEach(function (id) { if (!seen[id]) { seen[id] = true; siteIds.push(id); } }); });
    var done = stormId ? siteIds.filter(function (id) { return Log.siteDone(id, zones, states); }).length : 0;
    // Touched (Matt, 10/8/26): sidewalks done, hand work (curbs) left; never counted with done.
    var touchedSites = stormId ? siteIds.filter(function (id) { return !Log.siteDone(id, zones, states) && Log.siteTouched(id, zones, states); }).length : 0;
    var problems = 0, touched = {};
    rows.forEach(function (r) { touched[r.site_id] = true; });
    Object.keys(touched).forEach(function (id) { problems += Log.openProblems(o.log || [], stormId, id, states).length; });
    var taps = Log.realTaps(rows).slice().sort(bySeq);
    var tapped = {};
    taps.forEach(function (t) { tapped[t.site_id] = true; });
    var started = routes.filter(function (r) { return (r.siteIds || []).some(function (id) { return tapped[id]; }); }).length;
    return { sitesDone: done, sitesTouched: touchedSites, sitesTotal: siteIds.length, problems: problems, lastTapAt: taps.length ? taps[taps.length - 1].at : null,
      routesStarted: started, routesTotal: routes.length };
  }

  return { liveSummary: liveSummary };
});
