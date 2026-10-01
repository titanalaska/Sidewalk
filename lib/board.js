(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewBoard = factory();
})(this, function () {
  'use strict';

  // The board is never stored. It is replayed from `moves`, so every
  // place / move / make-lead / unassign is one write, and the board can
  // never disagree with its own history. (The db has no transactions.)
  function sortMoves(moves) {
    return (moves || []).slice().sort(function (a, b) {
      var d = Date.parse(a.at) - Date.parse(b.at);
      return d !== 0 ? d : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function positions(moves) {
    var pos = {};
    sortMoves(moves).forEach(function (m) {
      if (!m.worker) return; // a stray worker-less record must never move anyone
      // A new lead demotes the current one here, in the replay, so the old
      // lead does not quietly get the job back when the new one leaves.
      if (m.to_route && m.role === 'lead') {
        Object.keys(pos).forEach(function (id) {
          var p = pos[id];
          if (p && id !== m.worker && p.route === m.to_route && p.role === 'lead') {
            pos[id] = { route: p.route, role: 'member', since: p.since };
          }
        });
      }
      pos[m.worker] = m.to_route ? { route: m.to_route, role: m.role === 'lead' ? 'lead' : 'member', since: m.at } : null;
    });
    return pos;
  }

  function boardFrom(moves, routes, workersById) {
    var pos = positions(moves);
    var board = { routes: {}, unassigned: [] };
    (routes || []).forEach(function (r) { board.routes[r.id] = { lead: null, members: [] }; });

    var onBoard = {};
    Object.keys(pos)
      .filter(function (id) { return pos[id]; })
      .sort(function (a, b) { return (Date.parse(pos[a].since) - Date.parse(pos[b].since)) || (a < b ? -1 : 1); })
      .forEach(function (id) {
        var w = workersById[id];
        if (!w || w.archived) return;
        var slot = board.routes[pos[id].route];
        if (!slot) return;
        if (pos[id].role === 'lead') {
          if (slot.lead) slot.members.push(slot.lead);
          slot.lead = id;
        } else {
          slot.members.push(id);
        }
        onBoard[id] = true;
      });

    board.unassigned = Object.keys(workersById)
      .filter(function (id) { return !workersById[id].archived && !onBoard[id]; })
      .sort(function (a, b) {
        var oa = workersById[a].on_call === false ? 1 : 0, ob = workersById[b].on_call === false ? 1 : 0;
        if (oa !== ob) return oa - ob;
        return String(workersById[a].name).localeCompare(String(workersById[b].name));
      });
    return board;
  }

  function whereIs(board, id) {
    if (!id) return null;
    for (var r in board.routes) {
      if (board.routes[r].lead === id) return { route: r, role: 'lead' };
      if (board.routes[r].members.indexOf(id) !== -1) return { route: r, role: 'member' };
    }
    return null;
  }

  // The one record a tap writes, or null when the tap changes nothing.
  function planMove(board, workerId, toRoute, role, at) {
    if (!workerId) return null;
    var now = whereIs(board, workerId);
    var want = toRoute ? { route: toRoute, role: role === 'lead' ? 'lead' : 'member' } : null;
    if (!now && !want) return null;
    if (now && want && now.route === want.route && now.role === want.role) return null;
    return { at: at, worker: workerId, to_route: want ? want.route : null, role: want ? want.role : null };
  }

  function rosterFrom(board) {
    var roster = {};
    Object.keys(board.routes).forEach(function (r) {
      var s = board.routes[r];
      if (s.lead || s.members.length) roster[r] = { lead: s.lead, members: s.members.slice() };
    });
    return roster;
  }

  // A roster with the given people taken out (callout no-shows). Routes stay.
  function withoutWorkers(roster, ids) {
    var out = {};
    Object.keys(roster || {}).forEach(function (r) {
      var s = roster[r];
      out[r] = {
        lead: ids.indexOf(s.lead) === -1 ? s.lead : null,
        members: (s.members || []).filter(function (m) { return ids.indexOf(m) === -1; }),
      };
    });
    return out;
  }

  return { sortMoves: sortMoves, boardFrom: boardFrom, whereIs: whereIs, planMove: planMove, rosterFrom: rosterFrom, withoutWorkers: withoutWorkers };
});
