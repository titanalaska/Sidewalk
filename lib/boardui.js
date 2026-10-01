// Snow Crew pairings screens (sub-project 4, moved from the Crew Board 10/1/26).
// The board is never stored: it is replayed from Moves, one write per tap, so it
// can never disagree with its own history. Warn, never block.
//
// ctx (built by app.js on every call): {S, $, esc, call, toast, render, avatar,
// openWorker(id, extraHtml)}.
var SnowBoardUI = (function () {
  'use strict';
  var selected = null, busy = false;

  function byId(list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function nowIso() { return CrewTime.localIso(new Date()); }
  function liveRoutes(S) {
    return S.routes.filter(function (r) { return !r.archived; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
  }
  function board(S) { return CrewBoard.boardFrom(S.moves, liveRoutes(S), byId(S.crew)); }
  function md(ymd) { return Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10)); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function chip(ctx, id, role) {
    var w = byId(ctx.S.crew)[id] || { id: id, name: id }, esc = ctx.esc;
    var unknown = [w.cold_rated, w.valid_id, w.can_drive, w.on_call].some(function (v) { return v == null; });
    return '<div class="chip' + (selected === id ? ' sel' : '') + (w.on_call === false ? ' off' : '') + '" role="button" tabindex="0" data-worker="' + esc(id) + '">' +
      ctx.avatar(w) + '<span>' + (role === 'lead' ? '<span class="lead">LEAD </span>' : '') + esc(w.name) +
      (unknown ? ' <span class="q" title="Some fields not set">?</span>' : '') + '</span>' +
      (w.phone ? '<a class="call" href="tel:' + esc(w.phone) + '" aria-label="Call ' + esc(w.name) + '">☎</a>' : '') + '</div>';
  }

  function renderBoard(ctx) {
    var S = ctx.S, esc = ctx.esc, b = board(S), workers = byId(S.crew), siteById = byId(S.sites);
    var warnRoutes = byId(SnowPairing.routesForWarnings(S.routes, S.sites));
    var today = nowIso().slice(0, 10);
    var html = '<div id="boardhead"></div>';
    var routes = liveRoutes(S);
    if (!routes.length) html += '<p class="muted">No routes yet. Add them on the Routes tab.</p>';
    routes.forEach(function (r) {
      var crew = b.routes[r.id];
      var ws = CrewWarnings.warningsFor(warnRoutes[r.id], crew, workers, S.gear, today, {});
      html += '<section class="card board-route" data-route="' + esc(r.id) + '"><div class="route-top"><span class="route-badge">' + esc(r.name) + '</span></div>' +
        '<div class="sites">' + esc((r.site_ids || []).map(function (id) { return siteById[id] ? siteById[id].name : id; }).join(' · ')) + '</div>' +
        '<div class="chips">' + (crew.lead ? chip(ctx, crew.lead, 'lead') : '') +
        crew.members.map(function (id) { return chip(ctx, id, 'member'); }).join('') +
        (!crew.lead && !crew.members.length ? '<span class="muted">Nobody yet</span>' : '') + '</div>' +
        (ws.length ? '<ul class="warns">' + ws.map(function (w) { return '<li data-rule="' + esc(w.rule) + '">' + esc(w.text) + '</li>'; }).join('') + '</ul>' : '') +
        (selected && !busy ? '<div class="row"><button data-place="' + esc(r.id) + '" data-role="member">Place here</button>' +
          (crew.lead ? '' : '<button data-place="' + esc(r.id) + '" data-role="lead">Place as lead</button>') + '</div>' : '') +
        '</section>';
    });
    html += '<section class="card"><h2>Unassigned</h2><div class="chips">' +
      (b.unassigned.map(function (id) { return chip(ctx, id); }).join('') || '<span class="muted">Everyone is placed</span>') + '</div></section>';
    if (selected && !busy) {
      var at = CrewBoard.whereIs(b, selected);
      html += '<div class="bar" id="bar"><span style="flex:1">Tap a route for <b>' + esc((workers[selected] || {}).name || selected) + '</b></span>' +
        (at && at.role !== 'lead' ? '<button data-act="lead">Make lead</button>' : '') +
        (at ? '<button data-act="unassign">Unassign</button>' : '') +
        '<button data-act="card">Card</button><button data-act="cancel">Cancel</button></div>';
    }
    ctx.$('main').innerHTML = html;
  }

  // One write at a time: the buttons go away first, so a second tap on a slow
  // Apps Script call has nothing to hit.
  async function writeMove(ctx, rec) {
    busy = true;
    ctx.render();
    try {
      var r = await ctx.call('addMove', { record: rec });
      if (r.ok) ctx.S.moves.push(r.record);
      else ctx.toast('Not saved: ' + (r.reason || 'try again'));
    } finally {
      busy = false;
      ctx.render();
    }
  }

  function place(ctx, routeId, role) {
    var rec = CrewBoard.planMove(board(ctx.S), selected, routeId, role, nowIso());
    selected = null;
    if (rec) return writeMove(ctx, rec);
    ctx.render();
  }

  function barAction(ctx, act) {
    var id = selected, at = CrewBoard.whereIs(board(ctx.S), id);
    selected = null;
    if (act === 'cancel') return ctx.render();
    if (act === 'card') { ctx.render(); return openCard(ctx, id); }
    var rec = act === 'lead' && at ? CrewBoard.planMove(board(ctx.S), id, at.route, 'lead', nowIso())
      : CrewBoard.planMove(board(ctx.S), id, null, null, nowIso());
    if (rec) return writeMove(ctx, rec);
    ctx.render();
  }

  // Matt's card for a person: the roster card plus where they've been placed,
  // the shifts they actually worked and the gear they hold.
  function openCard(ctx, id) {
    var S = ctx.S, esc = ctx.esc, routes = byId(S.routes);
    var placed = CrewHistory.placedRanges(S.moves, id).map(function (r) {
      var name = esc(routes[r.route] ? routes[r.route].name : r.route);
      return r.to ? name + ' ' + md(r.from) + ' – ' + md(r.to) : name + ' from ' + md(r.from);
    }).join(' · ') || '<span class="muted">never placed</span>';
    var w = CrewHistory.shiftsWorked(S.callouts, id);
    var held = CrewGear.gearOnHand(S.gear, id);
    ctx.openWorker(id, '<table><tr><th>Placed</th><td>' + placed + '</td></tr>' +
      '<tr><th>Worked</th><td>' + plural(w.night, 'night') + ' · ' + plural(w.day, 'day') + '</td></tr>' +
      '<tr><th>Gear on hand</th><td>' + (esc(held.join(', ')) || '<span class="muted">none logged</span>') + '</td></tr></table>');
  }

  // Board clicks. Returns true when handled.
  function onClick(ev, ctx) {
    var t = ev.target, el;
    if (ctx.S.tab !== 'board') return false;
    if (t.closest('a.call')) return true;            // let the phone dial
    if (busy) return !!t.closest('[data-worker],[data-place],[data-act]');
    if ((el = t.closest('[data-place]'))) { place(ctx, el.dataset.place, el.dataset.role); return true; }
    if ((el = t.closest('[data-act]'))) { barAction(ctx, el.dataset.act); return true; }
    if ((el = t.closest('.chip[data-worker]'))) {
      selected = selected === el.dataset.worker ? null : el.dataset.worker;
      ctx.render();
      return true;
    }
    return false;
  }

  return { renderBoard: renderBoard, onClick: onClick, board: board, isBusy: function () { return busy; } };
})();
if (typeof window !== 'undefined') window.SnowBoardUI = SnowBoardUI;
