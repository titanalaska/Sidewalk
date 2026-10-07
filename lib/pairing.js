// Glue between the snow app's records and the Crew Board logic. PURE.
var SnowPairing = (function () {
  'use strict';

  // The Crew Board's warnings read a route as {name, sites: [{name, needs_clearance}]};
  // the snow app keeps sites as records the route points at by id.
  function routesForWarnings(routes, sites) {
    var byId = {};
    (sites || []).forEach(function (s) { byId[s.id] = s; });
    return (routes || []).filter(function (r) { return !r.archived; }).map(function (r) {
      return { id: r.id, name: r.name, sites: (r.site_ids || []).filter(function (id) { return byId[id] && !byId[id].archived; })
        .map(function (id) { return { name: byId[id].name, needs_clearance: byId[id].needs_clearance || null }; }) };
    });
  }

  // Does the board differ from what the crew were last shown?
  function changedSincePost(board, post) {
    if (!post) return true;
    var posted = {};
    (post.routes || []).forEach(function (r) { posted[r.id] = r; });
    return Object.keys(board.routes).some(function (id) {
      var a = board.routes[id], b = posted[id] || { lead: null, members: [] };
      return a.lead !== b.lead || a.members.join() !== (b.members || []).join();
    });
  }

  // Place from the roster (Matt, 10/6/26): what a roster tile says about tonight's Board.
  // routesById: id -> route record; a route the phone no longer holds reads as its id.
  function placementLabel(board, routesById, id) {
    var Board = typeof CrewBoard !== 'undefined' ? CrewBoard : require('./board.js'); // the page's global, or node's
    var at = Board.whereIs(board, id);
    if (!at) return 'Unplaced';
    var r = (routesById || {})[at.route];
    return (r ? r.name : at.route) + (at.role === 'lead' ? ' · lead' : '');
  }

  return { routesForWarnings: routesForWarnings, changedSincePost: changedSincePost, placementLabel: placementLabel };
})();
if (typeof module !== 'undefined') module.exports = SnowPairing;
if (typeof window !== 'undefined') window.SnowPairing = SnowPairing;
