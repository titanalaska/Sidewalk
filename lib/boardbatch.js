(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./board'));
  else root.CrewBoardBatch = factory(root.CrewBoard);
})(this, function (B) {
  'use strict';

  // The rules for the Board's bulk actions: add several people to a route,
  // clear the Board, take a clear back. Pure: each returns the Moves rows to
  // write (or why not); the server writes them and the phone reads the same
  // answer. `board` is what CrewBoard.boardFrom returns.

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function planAdd(board, routeId, workers, lead) {
    var none = function (error) { return { rows: [], skipped: 0, lead_kept: false, error: error }; };
    if (!routeId || !Object.prototype.hasOwnProperty.call(board.routes, routeId)) return none('Pick a route');
    if (!Array.isArray(workers) || !workers.length) return none('Pick somebody');
    if (lead && workers.indexOf(lead) === -1) return none('The lead must be one of the people added');
    var ids = [];
    workers.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    for (var i = 0; i < ids.length; i++) {
      if (!B.whereIs(board, ids[i]) && board.unassigned.indexOf(ids[i]) === -1) return none('Unknown worker ' + ids[i]);
    }
    var routeHasLead = board.routes[routeId].lead !== null;
    var rows = [], skipped = 0, leadKept = false;
    ids.forEach(function (id) {
      if (B.whereIs(board, id)) { skipped++; return; }
      var isLead = !!lead && id === lead && !routeHasLead;
      if (lead && id === lead && routeHasLead) leadKept = true;
      rows.push({ worker: id, to_route: routeId, role: isLead ? 'lead' : 'member' });
    });
    return { rows: rows, skipped: skipped, lead_kept: leadKept, error: null };
  }

  function planClear(board, routeId) {
    var ids;
    if (routeId == null) ids = Object.keys(board.routes);
    else if (Object.prototype.hasOwnProperty.call(board.routes, routeId)) ids = [routeId];
    else return { rows: [], error: 'Pick a route' };
    var rows = [];
    ids.forEach(function (r) {
      var slot = board.routes[r];
      if (slot.lead) rows.push({ worker: slot.lead, to_route: null, role: null, from_route: r, from_role: 'lead' });
      slot.members.forEach(function (m) {
        rows.push({ worker: m, to_route: null, role: null, from_route: r, from_role: 'member' });
      });
    });
    return { rows: rows, error: null };
  }

  function clearRowsOf(moves, batch) {
    return (moves || []).filter(function (m) { return m.batch === batch && m.to_route == null && m.from_route; });
  }

  function isDone(moves, batch) {
    return (moves || []).some(function (m) { return m.undoes === batch; });
  }

  function planUndo(moves, board, clearBatch) {
    var cleared = clearRowsOf(moves, clearBatch);
    if (!cleared.length) return { rows: [], left: 0, known: false, done: false };
    if (isDone(moves, clearBatch)) return { rows: [], left: 0, known: true, done: true };
    var rows = [], left = 0, leadTaken = {};
    cleared.forEach(function (c) {
      var slot = has(board.routes, c.from_route) ? board.routes[c.from_route] : null;
      if (!slot || board.unassigned.indexOf(c.worker) === -1) { left++; return; }
      var lead = c.from_role === 'lead' && slot.lead === null && !has(leadTaken, c.from_route);
      if (lead) leadTaken[c.from_route] = true;
      rows.push({ worker: c.worker, to_route: c.from_route, role: lead ? 'lead' : 'member', undoes: clearBatch });
    });
    return { rows: rows, left: left, known: true, done: false };
  }

  function undoOffer(moves, board, post) {
    var latest = null, latestAt = -Infinity, count = {}, at = {}, seen = [];
    (moves || []).forEach(function (m) {
      if (!m.batch || m.to_route != null || !m.from_route) return;
      var t = Date.parse(m.at);
      if (!count[m.batch]) { count[m.batch] = 0; at[m.batch] = t; seen.push(m.batch); }
      count[m.batch]++;
      if (t > at[m.batch]) at[m.batch] = t;
    });
    seen.forEach(function (b) { if (at[b] > latestAt) { latestAt = at[b]; latest = b; } });
    if (latest === null) return null;
    if (isDone(moves, latest)) return null;
    if (post && Date.parse(post.posted_at) >= latestAt) return null;
    if (!planUndo(moves, board, latest).rows.length) return null;
    return { batch: latest, count: count[latest] };
  }

  function pickGroups(unassignedIds, workersById, moves, query) {
    var placed = {};
    (moves || []).forEach(function (m) { if (m.worker && m.to_route) placed[m.worker] = true; });
    var q = String(query == null ? '' : query).trim().toLowerCase();
    var of = function (id) { return has(workersById, id) ? workersById[id] : {}; };
    var name = function (id) { return String(of(id).name || ''); };
    var order = function (a, b) {
      var oa = of(a).on_call === false ? 1 : 0, ob = of(b).on_call === false ? 1 : 0;
      if (oa !== ob) return oa - ob;
      return name(a).localeCompare(name(b));
    };
    var fresh = [], rest = [], matched = 0;
    (unassignedIds || []).forEach(function (id) {
      if (q && name(id).toLowerCase().indexOf(q) === -1) return;
      matched++;
      (has(placed, id) ? rest : fresh).push(id);
    });
    var groups = [];
    if (fresh.length) groups.push({ key: 'new', label: 'New: never on a route', people: fresh.sort(order) });
    if (rest.length) groups.push({ key: 'rest', label: 'Everyone else', people: rest.sort(order) });
    return { groups: groups, total: (unassignedIds || []).length, matched: matched };
  }

  return { planAdd: planAdd, planClear: planClear, planUndo: planUndo, undoOffer: undoOffer, pickGroups: pickGroups };
});
