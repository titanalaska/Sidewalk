(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'), require('./board'));
  else root.CrewHistory = factory(root.CrewTime, root.CrewBoard);
})(this, function (T, B) {
  'use strict';

  function lists(slot, workerId) {
    return !!slot && (slot.lead === workerId || (slot.members || []).indexOf(workerId) !== -1);
  }

  // "N1 11/2 - 1/14, N4 1/14 - now", from the change log. Planned, not worked.
  function placedRanges(moves, workerId) {
    var out = [], cur = null;
    B.sortMoves(moves).filter(function (m) { return m.worker === workerId; }).forEach(function (m) {
      if (cur && m.to_route === cur.route) return; // a role change, not a new placement
      if (cur) { cur.to = T.shiftDate(m.at); out.push(cur); }
      cur = m.to_route ? { route: m.to_route, from: T.shiftDate(m.at), to: null } : null;
    });
    if (cur) out.push(cur);
    return out;
  }

  // "2 nights, 1 day; N1 x2", from callouts. Actually went out, not just placed.
  function shiftsWorked(callouts, workerId) {
    var out = { night: 0, day: 0, byRoute: {} };
    (callouts || []).forEach(function (c) {
      var s = T.parseShift(c.shift);
      if (!s) return;
      Object.keys(c.roster || {}).forEach(function (r) {
        if (lists(c.roster[r], workerId)) {
          out[s.kind]++;
          out.byRoute[r] = (out.byRoute[r] || 0) + 1;
        }
      });
    });
    return out;
  }

  // Default route for a gear-log entry: that shift's callout first (who went
  // out), then the board as of that shift's date (who was placed).
  function routeOn(callouts, moves, workerId, shiftId) {
    var callout = (callouts || []).filter(function (c) { return c.shift === shiftId; })[0];
    if (callout) {
      var hit = Object.keys(callout.roster || {}).filter(function (r) { return lists(callout.roster[r], workerId); })[0];
      if (hit) return hit;
    }
    var s = T.parseShift(shiftId), route = null;
    if (!s) return null;
    B.sortMoves(moves).forEach(function (m) {
      if (m.worker === workerId && T.shiftDate(m.at) <= s.date) route = m.to_route;
    });
    return route;
  }

  return { placedRanges: placedRanges, shiftsWorked: shiftsWorked, routeOn: routeOn };
});
