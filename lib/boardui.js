// Snow Crew pairings screens (sub-project 4, moved from the Crew Board 10/1/26).
// The board is never stored: it is replayed from Moves, one write per tap, so it
// can never disagree with its own history. Warn, never block.
//
// ctx (built by app.js on every call): {S, $, esc, call, toast, render, avatar,
// openWorker(id, extraHtml)}.
var SnowBoardUI = (function () {
  'use strict';
  var selected = null, busy = false;
  var lastFail = null;        // { key, batch }: a failed bulk request, so the same request tried again keeps its batch id
  var clearPending = null;    // { route_id }: the confirm on screen

  function byId(list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function nowIso() { return CrewTime.localIso(new Date()); }
  function liveRoutes(S) {
    return S.routes.filter(function (r) { return !r.archived; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
  }
  // The pool the Board places from: a self-made card still waiting for Matt's Add to crew
  // (roster self-service, 10/6/26) is not crew and never sits in Unassigned.
  function pool(S) { return S.crew.filter(function (c) { return c.pending !== true; }); }
  function board(S) { return CrewBoard.boardFrom(S.moves, liveRoutes(S), byId(pool(S))); }
  function md(ymd) { return Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10)); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function people(n) { return n === 1 ? '1 person' : n + ' people'; }
  // A batch id made as lib/shiftlogui.js newBatchId does (B- + time + 6 random base-36 characters).
  function newBatchId() {
    var s = '', i;
    for (i = 0; i < 6; i++) s += Math.floor(Math.random() * 36).toString(36);
    return 'B-' + Date.now().toString(36) + s;
  }
  // The time on a single move (Board bulk place, 11/18/26). The server stamps a batch's rows with ITS clock, never earlier than 1 ms after
  // the newest Moves row, so those rows can be later than this phone's clock; a single move stamped by the phone would then sort BEFORE
  // the batch in the replay ("clear, then place Ana" would leave Ana unassigned). So: the later of now and 1 ms after the newest row held.
  function moveAt(S) {
    var now = nowIso(), top = -Infinity;
    (S.moves || []).forEach(function (m) { var t = Date.parse(m.at); if (!isNaN(t) && t > top) top = t; });
    if (top === -Infinity) return now;
    var after = CrewTime.localIso(new Date(top + 1));
    return Date.parse(after) > Date.parse(now) ? after : now;
  }

  // ---- A short night (Matt, 10/8/26) ----
  // On when the clock says so (after 11:30 PM and before 8 AM: CrewWarnings.isShortNight works the
  // cutoff out from 8 working hours + the 30-minute lunch), or when Matt turns it on himself for a
  // night only he knows is short (a cleanup night starts around 8 PM with little work). His switch is
  // remembered on THIS phone until the next 9 AM cutover, then it is off again. Nothing is sent to the
  // backend: warnings are worked out at draw time, never stored. A Valley person is marked, never blocked.
  var SHORT_KEY = 'snow-short-night-until';
  function manualUntil() {
    try { var v = Number(localStorage.getItem(SHORT_KEY)); return isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
  }
  // The next 9 AM (the shift cutover) after nowMs.
  function nextCutover(nowMs) {
    var d = new Date(nowMs);
    d.setHours(CrewTime.SHIFT_CUTOVER_HOUR, 0, 0, 0);
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // Seconds into the day as the words on the button: 84600 -> "11:30 PM", 32400 -> "9 AM".
  function clockText(sec) {
    var s = sec % 86400, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM');
  }
  function shortNight() {
    var nowMs = new Date().getTime();
    var auto = CrewWarnings.isShortNight(nowIso(), false), manual = manualUntil() > nowMs;
    return { auto: auto, manual: manual, on: auto || manual };
  }
  function shortNightButton(sn) {
    var label = sn.auto ? 'Short night: on (after ' + clockText(CrewWarnings.SHORT_NIGHT.cutoffSeconds) + ')'
      : sn.manual ? 'Short night: on until ' + clockText(CrewTime.SHIFT_CUTOVER_HOUR * 3600) : 'Short night: off';
    return '<button id="shortnight" class="small' + (sn.on ? ' on' : '') + '" aria-pressed="' + sn.on + '"' + (sn.auto ? ' disabled' : '') + '>' + label + '</button>';
  }
  var curShort = false;   // set at the top of renderBoard, read by chip()

  function chip(ctx, id, role) {
    var w = byId(ctx.S.crew)[id] || { id: id, name: id }, esc = ctx.esc;
    var unknown = [w.cold_rated, w.valid_id, w.can_drive, w.on_call].some(function (v) { return v == null; });
    var valley = w.home_area === 'valley';
    return '<div class="chip' + (selected === id ? ' sel' : '') + (w.on_call === false ? ' off' : '') + (valley && curShort ? ' valley-short' : '') + '" role="button" tabindex="0" data-worker="' + esc(id) + '">' +
      ctx.avatar(w) + '<span>' + (role === 'lead' ? '<span class="lead">LEAD </span>' : '') + esc(w.name) +
      (valley ? ' <span class="home" title="Lives in the Valley">V</span>' : '') +
      (unknown ? ' <span class="q" title="Some fields not set">?</span>' : '') + '</span>' +
      (w.phone ? '<a class="call" href="tel:' + esc(w.phone) + '" aria-label="Call ' + esc(w.name) + '">☎</a>' : '') + '</div>';
  }

  function renderBoard(ctx) {
    var S = ctx.S, esc = ctx.esc, b = board(S), workers = byId(S.crew), siteById = byId(S.sites);
    var sn = shortNight();
    curShort = sn.on;
    var warnRoutes = byId(SnowPairing.routesForWarnings(S.routes, S.sites));
    var today = nowIso().slice(0, 10);
    var placedAny = Object.keys(b.routes).some(function (id) { return b.routes[id].lead || b.routes[id].members.length; });
    var changed = SnowPairing.changedSincePost(b, S.post) && (placedAny || !!S.post);
    var html = '<div class="row boardhead" style="margin-top:0">' +
      '<span id="crewsees" class="badge">' + (S.post ? 'Crew sees ' + esc(CrewTime.shiftLabel(S.post.shift)) + ', posted ' + esc(clock(S.post.posted_at)) : 'Not posted') + '</span>' +
      '<span id="changed" class="badge off"' + (changed ? '' : ' hidden') + '>Changed since post</span>' +
      '<button id="post" class="primary"' + (busy ? ' disabled' : '') + '>Post</button>' +
      '<button id="callout"' + (busy ? ' disabled' : '') + '>Callout</button>' + shortNightButton(sn) + '</div>';
    // Clear Board and the Undo line (Board bulk place, 11/18/26). The Undo line is worked out from the Moves rows, so it survives a reload.
    var offer = CrewBoardBatch.undoOffer(S.moves, b, S.post), dis = busy ? ' disabled' : '';
    if (placedAny || offer) {
      html += '<div class="row" id="bulkrow" style="margin-top:8px">' +
        (placedAny ? '<button id="clearboard"' + dis + '>Clear Board</button>' : '') +
        (offer ? '<span id="clearedline">Cleared ' + people(offer.count) + '</span><button id="undoclear" class="small"' + dis + '>Undo</button>' : '') + '</div>';
    }
    // The shift the trucks below are for (final review C1): the one Matt picked, or the current post's when
    // nothing later is on offer. With a post current but a later shift on offer (the afternoon), Save asks
    // Day or Night. Change opens the same question (10/4/26).
    var ts = SnowShiftUI.boardShift(S);
    html += '<div class="row truckshiftrow"><span id="truckshift" class="muted">' + (ts ? 'Trucks for ' + esc(CrewTime.shiftLabel(ts)) :
      SnowShiftUI.postShift(S) ? 'Trucks: Save asks which shift' : 'Trucks: nothing is posted, so Save asks which shift') + '</span>' +
      '<button id="truckchange" class="small">Change</button></div>';
    var routes = liveRoutes(S);
    if (!routes.length) html += '<p class="muted">No routes yet. Add them on the Routes tab.</p>';
    routes.forEach(function (r) {
      var crew = b.routes[r.id];
      var ws = CrewWarnings.warningsFor(warnRoutes[r.id], crew, workers, S.gear, today, { shortNight: sn.on });
      html += '<section class="card board-route" data-route="' + esc(r.id) + '"><div class="route-top"><span class="route-badge">' + esc(r.name) + '</span></div>' +
        '<div class="sites">' + esc((r.site_ids || []).map(function (id) { return siteById[id] ? siteById[id].name : id; }).join(' · ')) + '</div>' +
        // The truck for this route (Matt sets any route's; the lead can change their own on the Storm tab),
        // for the shift named above.
        SnowShiftUI.truckHtml(ctx, r.id, true) +
        '<div class="chips">' + (crew.lead ? chip(ctx, crew.lead, 'lead') : '') +
        crew.members.map(function (id) { return chip(ctx, id, 'member'); }).join('') +
        (!crew.lead && !crew.members.length ? '<span class="muted">Nobody yet</span>' : '') + '</div>' +
        routeClockBox(ctx, r.id, routeIds(crew)) + clockRowsHtml(ctx, routeIds(crew), true) +
        (ws.length ? '<ul class="warns">' + ws.map(function (w) { return '<li data-rule="' + esc(w.rule) + '">' + esc(w.text) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="row routebulk"><button data-addpeople="' + esc(r.id) + '"' + (busy ? ' disabled' : '') + '>Add people…</button>' +
          (routeIds(crew).length ? '<button data-clearroute="' + esc(r.id) + '"' + (busy ? ' disabled' : '') + '>Clear route</button>' : '') + '</div>' +
        (selected && !busy ? '<div class="row"><button data-place="' + esc(r.id) + '" data-role="member">Place here</button>' +
          (crew.lead ? '' : '<button data-place="' + esc(r.id) + '" data-role="lead">Place as lead</button>') + '</div>' : '') +
        '</section>';
    });
    html += '<section class="card"><h2>Unassigned</h2><div class="chips">' +
      (b.unassigned.map(function (id) { return chip(ctx, id); }).join('') || '<span class="muted">Everyone is placed</span>') + '</div>' +
      clockRowsHtml(ctx, b.unassigned) + '</section>';
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
      return !!r.ok;
    } finally {
      busy = false;
      ctx.render();
    }
  }

  // ---------- bulk: Clear Board, Clear route, Undo clear (Board bulk place, 11/18/26) ----------
  // One server call for the whole batch (action boardBatch): all or nothing, and the reply's `moves` is the server's WHOLE Moves list, which
  // replaces this phone's copy, so after any bulk save the Board drawn is the real one. A failed request keeps its batch id: the same request
  // tried again sends the same id, so a save that landed and whose reply was lost answers `already` and writes nothing twice. Any change to the
  // request is a new id. Returns whether it saved. done(reply) runs once, on success.
  async function bulk(ctx, req, done) {
    var key = JSON.stringify(req), batch = lastFail && lastFail.key === key ? lastFail.batch : newBatchId(), saved = false, r;
    busy = true;
    ctx.render();
    try {
      try { r = await ctx.call('boardBatch', Object.assign({ batch: batch }, req)); }
      catch (e) { r = { ok: false, code: 'network', reason: 'no signal' }; }
      if (r.ok) {
        lastFail = null;
        if (Array.isArray(r.moves)) ctx.S.moves = r.moves;
        saved = true;
        done(r);
      } else {
        lastFail = { key: key, batch: batch };
        if (r.code === 'signin') ctx.signedOut(r.reason);
        else ctx.toast('Not saved: ' + (r.code === 'network' ? 'no signal' : r.code === 'forbidden' ? 'the server is not updated yet' : (r.reason || 'try again')));
      }
    } finally {
      busy = false;
      ctx.render();
    }
    return saved;
  }

  // What the confirm says, from this phone's copy: who comes off, and how many of them an End shift tap would still cover (the server's own
  // rule, routeTaps), summed over the routes affected. null when nobody would come off.
  function clearPlan(S, routeId) {
    var b = board(S), plan = CrewBoardBatch.planClear(b, routeId);
    if (plan.error || !plan.rows.length) return null;
    var ids = routeId == null ? Object.keys(b.routes) : [routeId], routes = 0, onClock = 0, loaded = SnowShiftUI.isLoaded();
    ids.forEach(function (rid) {
      var crew = routeIds(b.routes[rid]);
      if (!crew.length) return;
      routes++;
      if (loaded) onClock += SnowSiteTimes.routeTaps(S.clock, crew, nowShift(S), nowIso()).end;
    });
    return { people: plan.rows.length, routes: routes, onClock: onClock, loaded: loaded, storm: loaded && !!CrewShiftLog.stormState(S.storms).open };
  }

  function clearAsk(ctx, routeId) {
    var S = ctx.S, esc = ctx.esc, p = clearPlan(S, routeId);
    if (!p) return;
    var rname = routeId == null ? '' : (byId(S.routes)[routeId] || {}).name || routeId;
    var q = routeId == null ? 'Take ' + people(p.people) + ' off ' + plural(p.routes, 'route') + '?'
      : 'Take ' + people(p.people) + ' off <span data-no-es>' + esc(rname) + '</span>?';
    var clock = !p.loaded ? 'Couldn\'t check who is on the clock.'
      : p.onClock > 0 ? p.onClock + (p.onClock === 1 ? ' is' : ' are') + ' still on the clock. Tap End shift first, or their End has to be typed with Set shift.' : '';
    clearPending = { route_id: routeId };
    ctx.$('dlgIn').innerHTML = '<h2 id="clr_q">' + q + '</h2>' +
      (clock ? '<p id="clr_clock" class="muted">' + esc(clock) + '</p>' : '') +
      (p.storm ? '<p id="clr_storm" class="muted">A storm is open: people off the Board cannot tap until they are placed again.</p>' : '') +
      '<p id="clr_post" class="muted">The crew still sees the last Post until you tap Post.</p>' +
      '<div class="row"><button id="clr_go" class="primary">Clear</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
  }

  function clearGo(ctx) {
    var pend = clearPending;
    clearPending = null;
    ctx.closeDialog();
    if (!pend || busy) return Promise.resolve(false);
    var routeId = pend.route_id, rname = routeId == null ? '' : (byId(ctx.S.routes)[routeId] || {}).name || routeId;
    return bulk(ctx, { kind: 'clear', route_id: routeId }, function (r) {
      if (r.already) ctx.toast('Already saved');
      else if (!r.written) ctx.toast('Nobody to take off');
      else ctx.toast('Took ' + people(r.written) + ' off ' + (routeId == null ? 'the Board' : rname));
    });
  }

  function undoClear(ctx) {
    var offer = CrewBoardBatch.undoOffer(ctx.S.moves, board(ctx.S), ctx.S.post);
    if (!offer) { ctx.render(); return Promise.resolve(false); }
    return bulk(ctx, { kind: 'undo', clear: offer.batch }, function (r) {
      if (r.already) ctx.toast('Already saved');
      else if (!r.written) ctx.toast('Nothing to put back');
      else ctx.toast('Put ' + r.written + ' back.' + (r.left === 1 ? ' 1 was left as it is.' : r.left > 1 ? ' ' + r.left + ' were left as they are.' : ''));
    });
  }

  // ---------- Add people… (Board bulk place, 11/18/26) ----------
  // One dialog drawn like the route editor's Add sites view (same classes): everybody under Unassigned, grouped by CrewBoardBatch.pickGroups
  // (never on a route first, then everyone else), a search box, a tick box per row, a Lead button on each ticked row when the route has no lead,
  // and a bar under the list. The state is memory only and starts empty each time the view opens. A key in the search box redraws #ppl_list and
  // nothing else (the box keeps its focus and its caret); a tick or a Lead pick changes the rows and the bar in place (pplMark). The clicks come
  // through onClick (a tick box is read AFTER its click: no preventDefault), the search box carries its own oninput; nothing is put on #dlgIn,
  // whose onclick / onchange / oninput belong to the route editor. One server call, bulk() above, in tick order.
  var ppl = null;   // { route, ticks: [ids, in tick order], lead: id or null, q }

  function pplLive(ctx) { return !!ppl && !!ctx.$('ppl_scroll'); }   // the view's own element is on screen (another dialog written over it takes it away)
  function pplRes(ctx) { return CrewBoardBatch.pickGroups(board(ctx.S).unassigned, byId(pool(ctx.S)), ctx.S.moves, ppl.q); }
  function pplRouteHasLead(ctx) { var c = board(ctx.S).routes[ppl.route]; return !!(c && c.lead); }

  function pplListHtml(ctx, res) {
    var esc = ctx.esc, workers = byId(pool(ctx.S));
    if (!res.groups.length) return '<p id="ppl_nomatch" class="muted">No people match</p><div class="row"><button id="ppl_reset">Clear</button></div>';
    return res.groups.map(function (g) {
      return '<div class="ppl-grp"><div class="grp-bar" data-pgrp="' + esc(g.key) + '"><h2 class="site-group">' + esc(g.label) + '</h2><span class="grp-count">' + g.people.length + '</span></div>' +
        g.people.map(function (id) {
          var w = workers[id] || { id: id, name: id };
          return '<label class="grp-row' + (w.on_call === false ? ' off' : '') + '" data-person="' + esc(id) + '"><input type="checkbox">' + ctx.avatar(w) +
            '<span class="grp-name" data-no-es>' + esc(w.name) + '</span></label>';
        }).join('') + '</div>';
    }).join('');
  }

  // The tick boxes, each ticked row's Lead button, and the bar, from the state as it stands. In place: a tapped box keeps its focus. The Lead
  // buttons are decided from the Board as it is now, never from an earlier opening.
  function pplMark(ctx) {
    if (!pplLive(ctx) || !ctx.$('ppl_add')) return;
    var shown = [], on = {}, hasLead = pplRouteHasLead(ctx), n = ppl.ticks.length, hid;
    pplRes(ctx).groups.forEach(function (g) { shown = shown.concat(g.people); });
    ppl.ticks.forEach(function (id) { on[id] = true; });
    Array.prototype.forEach.call(document.querySelectorAll('#ppl_list [data-person]'), function (row) {
      var id = row.dataset.person, btn = row.querySelector('[data-leadpick]');
      row.querySelector('input').checked = !!on[id];
      if (on[id] && !hasLead) {
        if (!btn) { btn = document.createElement('button'); btn.className = 'small'; btn.setAttribute('data-leadpick', id); row.appendChild(btn); }
        btn.setAttribute('aria-pressed', String(ppl.lead === id));
        btn.textContent = ppl.lead === id ? 'LEAD ✓' : 'Lead';
      } else if (btn) btn.remove();
    });
    hid = ppl.ticks.filter(function (id) { return shown.indexOf(id) === -1; }).length;
    ctx.$('ppl_add').textContent = 'Add ticked (' + n + ')';
    ctx.$('ppl_add').disabled = n === 0 || busy;
    ctx.$('ppl_hidden').hidden = hid === 0;
    ctx.$('ppl_hidden').textContent = hid ? hid + ' hidden by search' : '';
  }
  function pplFill(ctx) { ctx.$('ppl_list').innerHTML = pplListHtml(ctx, pplRes(ctx)); pplMark(ctx); }

  function pplDraw(ctx) {
    var esc = ctx.esc, rname = (byId(ctx.S.routes)[ppl.route] || {}).name || ppl.route;
    var head = '<div class="pickhead"><button id="ppl_back">‹ Back</button><h2>Add people to <span data-no-es>' + esc(rname) + '</span></h2></div>';
    if (!pplRes(ctx).total) {
      ctx.$('dlgIn').innerHTML = '<div class="pickview">' + head + '<div class="pickscroll" id="ppl_scroll" tabindex="-1"><p id="ppl_none" class="muted">Everyone is placed</p></div></div>';
      return;
    }
    ctx.$('dlgIn').innerHTML = '<div class="pickview">' + head + '<div class="pickscroll" id="ppl_scroll" tabindex="-1">' +
      '<input id="ppl_q" type="search" placeholder="Search name" aria-label="Search name" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<div id="ppl_list" class="grp-list"></div></div>' +
      '<div class="pickbar"><div id="ppl_hidden" class="muted" hidden></div><button id="ppl_add" class="primary" disabled>Add ticked (0)</button></div></div>';
    ctx.$('ppl_q').oninput = function () { ppl.q = this.value; pplFill(ctx); };
    pplFill(ctx);
  }

  function pplOpen(ctx, routeId) {
    selected = null;   // a chip picked on the Board would leave its bottom bar under the dialog
    ppl = { route: routeId, ticks: [], lead: null, q: '' };
    ctx.render();
    pplDraw(ctx);
    ctx.showDialog();
  }

  function pplAdd(ctx) {
    if (busy || !ppl.ticks.length) return;
    var req = { kind: 'add', route_id: ppl.route, workers: ppl.ticks.slice(), lead: ppl.lead };
    var rname = (byId(ctx.S.routes)[req.route_id] || {}).name || req.route_id, leadName = req.lead ? (byId(ctx.S.crew)[req.lead] || {}).name || req.lead : '';
    ctx.$('ppl_add').disabled = true;
    return bulk(ctx, req, function (r) {
      var parts = [];
      if (r.already) parts.push('Already saved');
      else {
        parts.push(r.written ? 'Added ' + r.written + ' to ' + rname : 'Nobody added');
        if (r.skipped) parts.push(r.skipped + (r.skipped === 1 ? ' was' : ' were') + ' already on a route and ' + (r.skipped === 1 ? 'was' : 'were') + ' left');
        if (r.lead_kept) parts.push(rname + ' already had a lead: ' + leadName + ' was added as a member');
      }
      ctx.closeDialog();
      ctx.toast(parts.join('. '));
    }).then(function (ok) { if (!ok) pplMark(ctx); return ok; });
  }

  // The clicks inside the view. Returns true when the click was inside it.
  function pplClick(ev, ctx) {
    var t = ev.target, el;
    if (!pplLive(ctx) || !t.closest('.pickview')) return false;
    if (t.closest('#ppl_back')) { ctx.closeDialog(); return true; }
    if (t.closest('#ppl_add')) { pplAdd(ctx); return true; }
    if (t.closest('#ppl_reset')) { ppl.q = ''; ctx.$('ppl_q').value = ''; pplFill(ctx); return true; }
    if ((el = t.closest('[data-leadpick]'))) {
      if (!busy) { ppl.lead = ppl.lead === el.dataset.leadpick ? null : el.dataset.leadpick; pplMark(ctx); }
      return true;
    }
    if (t.matches('#ppl_list [data-person] input')) {
      var id = t.closest('[data-person]').dataset.person;
      if (!busy) {
        ppl.ticks = t.checked ? (ppl.ticks.indexOf(id) === -1 ? ppl.ticks.concat([id]) : ppl.ticks) : ppl.ticks.filter(function (x) { return x !== id; });
        if (!t.checked && ppl.lead === id) ppl.lead = null;
      }
      pplMark(ctx);   // while a save is out the box goes back to what was ticked
      return true;
    }
    return true;
  }

  // Place from the roster (Matt, 10/6/26): the worker card's Place / Make lead / Unassign.
  // The same plan as a Board tap, through the same one-at-a-time write; the toast says
  // what happened. routeId null = off the Board.
  function placeFromRoster(ctx, workerId, routeId, role) {
    if (busy) { ctx.toast('Still saving the last move…'); return Promise.resolve(false); }
    var rec = CrewBoard.planMove(board(ctx.S), workerId, routeId || null, role, moveAt(ctx.S));
    if (!rec) { ctx.toast('Nothing to change'); return Promise.resolve(false); }
    var name = (byId(ctx.S.crew)[workerId] || {}).name || workerId, rname = (byId(ctx.S.routes)[routeId] || {}).name || routeId;
    var done = !routeId ? name + ' taken off the Board' : role === 'lead' ? name + ': lead on ' + rname : name + ' placed on ' + rname;
    return writeMove(ctx, rec).then(function (ok) { if (ok) ctx.toast(done); return ok; });
  }

  function place(ctx, routeId, role) {
    var rec = CrewBoard.planMove(board(ctx.S), selected, routeId, role, moveAt(ctx.S));
    selected = null;
    if (rec) return writeMove(ctx, rec);
    ctx.render();
  }

  function barAction(ctx, act) {
    var id = selected, at = CrewBoard.whereIs(board(ctx.S), id);
    selected = null;
    if (act === 'cancel') return ctx.render();
    if (act === 'card') { ctx.render(); return openCard(ctx, id); }
    var rec = act === 'lead' && at ? CrewBoard.planMove(board(ctx.S), id, at.route, 'lead', moveAt(ctx.S))
      : CrewBoard.planMove(board(ctx.S), id, null, null, moveAt(ctx.S));
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

  function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

  // Post and Callout ask which shift. The shifts around now, NONE pre-picked:
  // nights start when the weather says (Matt, 10/1/26), so no clock can guess.
  var pendingShift = null;
  // `from` (optional): only the shifts at or after it are offered (trucks never go to a shift already past
  // the post's).
  function pickShift(ctx, title, then, from) {
    pendingShift = then;
    var floor = from ? CrewTime.shiftKey(from) : '';
    ctx.$('dlgIn').innerHTML = '<h2>' + ctx.esc(title) + '</h2><div class="row shiftpick">' +
      CrewTime.shiftChoices(nowIso()).filter(function (id) { return CrewTime.shiftKey(id) >= floor; }).map(function (id) {
        return '<button data-shift="' + id + '" aria-pressed="false">' + ctx.esc(CrewTime.shiftLabel(id)) + '</button>';
      }).join('') + '</div><div class="row"><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
  }

  async function busyCall(ctx, action, payload, done) {
    busy = true;
    ctx.render();
    try {
      var r = await ctx.call(action, payload);
      if (r.ok) done(r.record);
      else ctx.toast('Not saved: ' + (r.reason || 'try again'));
    } finally {
      busy = false;
      ctx.render();
    }
  }

  function post(ctx, shift) {
    return busyCall(ctx, 'post', { shift: shift }, function (rec) {
      ctx.S.post = rec;
      ctx.toast('Posted: the crew see ' + CrewTime.shiftLabel(shift));
    });
  }

  // Who actually went out: a COPY of the board, so a later move never rewrites
  // a past shift. Matt taps anyone placed who didn't show: they come off the
  // roster (no shift worked) and are kept in no_shows. Reopening the same
  // shift keeps its no-shows and note.
  var calloutShift = null;
  function prevCallout(S, shift) { return S.callouts.filter(function (c) { return c.shift === shift; })[0]; }
  function openCallout(ctx, shift) {
    var S = ctx.S, esc = ctx.esc, prev = prevCallout(S, shift), roster = CrewBoard.rosterFrom(board(S));
    var noShows = (prev && prev.no_shows) || [], workers = byId(S.crew), routes = byId(S.routes);
    calloutShift = shift;
    var body = Object.keys(roster).map(function (rid) {
      var r = roster[rid], ids = (r.lead ? [r.lead] : []).concat(r.members);
      return '<h3>' + esc((routes[rid] || {}).name || rid) + '</h3><div class="row">' + ids.map(function (id) {
        return '<button class="noshow" data-noshow="' + esc(id) + '" aria-pressed="' + (noShows.indexOf(id) !== -1) + '">' +
          esc((workers[id] || {}).name || id) + '</button>';
      }).join('') + '</div>';
    }).join('') || '<p class="muted">Nobody is placed on the board.</p>';
    ctx.$('dlgIn').innerHTML = '<h2>Callout: ' + esc(CrewTime.shiftLabel(shift)) + '</h2>' +
      '<p class="muted">Tap anyone who didn\'t show. They won\'t get this shift.</p>' + body +
      '<label>Note</label><input id="co_note" value="' + esc((prev && prev.note) || '') + '">' +
      '<div class="row"><button id="co_save" class="primary">Save callout</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
  }

  function callout(ctx, shift) {
    var S = ctx.S, prev = prevCallout(S, shift), roster = CrewBoard.rosterFrom(board(S)), onBoard = [];
    Object.keys(roster).forEach(function (rid) { onBoard = onBoard.concat(roster[rid].lead ? [roster[rid].lead] : [], roster[rid].members); });
    // A no-show since taken off the board is still a no-show for this shift.
    var noShows = ((prev && prev.no_shows) || []).filter(function (id) { return onBoard.indexOf(id) === -1; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-noshow][aria-pressed="true"]'), function (b) { noShows.push(b.dataset.noshow); });
    var rec = { shift: shift, started_at: prev ? prev.started_at : nowIso(), note: ctx.$('co_note').value.trim(),
      roster: CrewBoard.withoutWorkers(roster, noShows), no_shows: noShows, rev: prev ? prev.rev : 0 };
    ctx.closeDialog();
    return busyCall(ctx, 'saveCallout', { record: rec }, function (saved) {
      S.callouts = S.callouts.filter(function (c) { return c.id !== saved.id; }).concat([saved]);
      ctx.toast('Callout saved for ' + CrewTime.shiftLabel(shift));
    });
  }

  // Board clicks. Returns true when handled.
  function onClick(ev, ctx) {
    var t = ev.target, el;
    if (ctx.S.tab === 'log' && t.id === 'newEntry') { openEntry(ctx); return true; }
    if ((ctx.S.tab === 'tonight' || ctx.S.tab === 'board') && (el = t.closest('[data-clockretry]'))) {
      var key = el.dataset.clockretry;
      if (clockFailed[key]) clockRun(ctx, key, clockFailed[key].req);
      return true;
    }
    if (ctx.S.tab === 'tonight') {
      if (t.closest('#shiftStart')) { clockTap(ctx, 'card', 'clockTap', 'start'); return true; }
      if (t.closest('#shiftEnd')) { clockTap(ctx, 'card', 'clockTap', 'end'); return true; }
      if ((el = t.closest('#shiftUndo'))) { clockTap(ctx, 'card', 'clockUndo', el.dataset.kind); return true; }
    }
    if (ctx.S.tab !== 'board') return false;
    if (ctx.S.me && ctx.S.me.role === 'admin') {
      if ((el = t.closest('[data-clockstart]'))) { clockTap(ctx, 'route:' + el.dataset.clockstart, 'clockTap', 'start'); return true; }
      if ((el = t.closest('[data-clockend]'))) { clockTap(ctx, 'route:' + el.dataset.clockend, 'clockTap', 'end'); return true; }
      if ((el = t.closest('[data-clockundo]'))) { clockTap(ctx, 'route:' + el.dataset.clockundo, 'clockUndo', el.dataset.kind); return true; }
      if ((el = t.closest('[data-setshift]'))) { SnowShiftUI.openSetShift(ctx, el.dataset.setshift); return true; }
    }
    // Matt's own short-night switch: this phone only, nothing sent. The clock's answer (disabled) cannot be turned off.
    if (t.id === 'shortnight') {
      var sn = shortNight();
      if (sn.auto) return true;
      try {
        if (sn.manual) localStorage.removeItem(SHORT_KEY);
        else localStorage.setItem(SHORT_KEY, String(nextCutover(new Date().getTime())));
      } catch (e) { /* private window: the switch just does not stick */ }
      ctx.render();
      return true;
    }
    if ((el = t.closest('[data-shift]')) && pendingShift) {
      var then = pendingShift;
      pendingShift = null;
      ctx.closeDialog();
      then(el.dataset.shift);
      return true;
    }
    if ((el = t.closest('[data-noshow]'))) { el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true')); return true; }
    if (t.id === 'co_save' && calloutShift) { var sh = calloutShift; calloutShift = null; callout(ctx, sh); return true; }
    if (t.closest('a.call')) return true;            // let the phone dial
    if (t.id === 'clr_go') { clearGo(ctx); return true; }
    if (pplClick(ev, ctx)) return true;
    if (busy) return !!t.closest('[data-worker],[data-place],[data-act],#post,#callout,#clearboard,#undoclear,[data-clearroute],[data-addpeople]');
    if (t.id === 'clearboard') { clearAsk(ctx, null); return true; }
    if ((el = t.closest('[data-clearroute]'))) { clearAsk(ctx, el.dataset.clearroute); return true; }
    if (t.id === 'undoclear') { undoClear(ctx); return true; }
    if ((el = t.closest('[data-addpeople]'))) { pplOpen(ctx, el.dataset.addpeople); return true; }
    if (t.id === 'post') { pickShift(ctx, 'Post to the crew for which shift?', function (s) { post(ctx, s); }); return true; }
    if (t.id === 'truckchange') {
      pickShift(ctx, 'Trucks for which shift?', function (s) { SnowShiftUI.setPickedShift(s); ctx.render(); }, SnowShiftUI.postShift(ctx.S));
      return true;
    }
    if (t.id === 'callout') { pickShift(ctx, 'Callout: who is going out, for which shift?', function (s) { openCallout(ctx, s); }); return true; }
    if ((el = t.closest('[data-place]'))) { place(ctx, el.dataset.place, el.dataset.role); return true; }
    if ((el = t.closest('[data-act]'))) { barAction(ctx, el.dataset.act); return true; }
    if ((el = t.closest('.chip[data-worker]'))) {
      selected = selected === el.dataset.worker ? null : el.dataset.worker;
      ctx.render();
      return true;
    }
    return false;
  }

  // ---------- shift times (Matt, 11/10/26) ----------
  // Start shift / End shift on the crew's Tonight tab (one tap covers everyone the Board has on the route), a line per person on
  // Matt's Board, a Start / End per route, and Set shift (lib/shiftlogui.js). The rows are the truth: a reply's records are merged
  // into S.clock the way the poll merges them (never touching the cursor or the tail), and everything on screen is drawn from
  // them again. A crew phone holds only its own rows, so its card is only ever about the person holding it; how many people a tap
  // covered comes from the reply's `written`. The buttons come from the shared Clock rules (lib/sitetimes.js, over lib/clock.js).
  var clockInflight = {}, clockFailed = {}, clockNote = null, clockGen = 0;
  var NOTE_MS = 10 * 60 * 1000;   // a count line is about the tap just made: it goes after ten minutes
  function tclock(iso) { return SnowBtNote.clock(iso); }
  function routeIds(crew) { return (crew.lead ? [crew.lead] : []).concat(crew.members); }
  function nowShift(S) { return SnowShiftUI.nowShift(S); }

  // One person's line: the shown shift's (R33), prefixed with its label and a colon when it is the shift before. A typed time is
  // marked typed. Nothing yet: ''.
  function shiftLineHtml(ctx, crewId) {
    var S = ctx.S, esc = ctx.esc, v = SnowSiteTimes.shiftShown(S.clock, crewId, nowShift(S), nowIso()), p = CrewClock.personShift(S.clock, crewId, v.shift), body = '';
    if (p.end !== null) {
      body = '<span>Ended</span> <b>' + esc(tclock(p.end)) + '</b>' + (p.endHow === 'typed' ? SnowShiftUI.typedMarkHtml(ctx, p.endBy) : '');
      if (p.startHow === 'typed') body += ' · ' + SnowShiftUI.sideHtml(ctx, 'In', p.start, p.startHow, p.startBy);
    } else if (p.start !== null) {
      body = '<span>On the clock since</span> <b>' + esc(tclock(p.start)) + '</b>' + (p.startHow === 'typed' ? SnowShiftUI.typedMarkHtml(ctx, p.startBy) : '');
    }
    if (!body) return '';
    return (v.earlier ? '<span>' + esc(CrewTime.shiftLabel(v.shift)) + '</span>: ' : '') + body;
  }
  function noteHtml(ctx, key, id) {
    if (!clockNote || clockNote.key !== key || new Date().getTime() - clockNote.at > NOTE_MS) return '';
    return '<div' + (id ? ' id="' + id + '" class="muted"' : ' class="muted clocknote"') + ' role="status">' + ctx.esc(clockNote.text) + '</div>';
  }
  function failHtml(ctx, key) {
    var f = clockFailed[key];
    return f ? '<div class="walk-fail err" role="alert">Not saved: ' + ctx.esc(f.reason) +
      (f.retry ? ' <button class="small" data-clockretry="' + ctx.esc(key) + '">Retry</button>' : '') + '</div>' : '';
  }

  // The crew's card on Tonight. Buttons for a person the fresh Post lists, and for anyone when no fresh Post can say (the server
  // decides by the Board, as it does for Arrived / Left); a fresh Post that does not list them gets the card, the line and a few
  // words. Nothing is offered before the first read of the Clock rows has come back (a Start would be offered to someone started).
  function cardHtml(ctx) {
    var S = ctx.S, me = S.me && S.me.crew_id, key = 'card', busyNow = !!clockInflight[key];
    var ready = SnowShiftUI.isLoaded(), st = SnowShiftUI.standing(S);
    var can = ready && (st === 'lead' || st === 'member' || st === 'unposted');
    var o = SnowSiteTimes.shiftOffers(S.clock, me, nowShift(S), nowIso()), dis = busyNow ? ' disabled' : '', btns = '';
    if (can) {
      if (o.start) btns += '<button id="shiftStart" class="primary"' + dis + '>Start shift</button>';
      if (o.end) btns += '<button id="shiftEnd"' + dis + '>End shift</button>';
      if (o.undo) btns += '<button id="shiftUndo" class="small" data-kind="' + o.undo + '"' + dis + '>Undo ' + o.undo + '</button>';
    }
    return '<section class="card" id="shiftcard"' + (busyNow ? ' aria-busy="true"' : '') + '><h2>Your shift</h2>' +
      '<div id="shiftLine" class="shiftline">' + (ready ? shiftLineHtml(ctx, me) : '') + '</div>' +
      (btns ? '<div class="row shiftbtns">' + btns + '</div>' : '') +
      (ready && st === null ? '<p class="muted" id="shiftAsk">Ask the dispatcher to put you on a route.</p>' : '') +
      // A first read that failed (no signal): say so, in the app's own words; Refresh is on the screen above.
      (!ready && SnowShiftUI.isUnreachable() ? '<p class="muted" id="shiftOffline" role="status">Couldn\'t reach the server. Try again.</p>' : '') +
      noteHtml(ctx, key, 'shiftNote') + failHtml(ctx, key) + '</section>';
  }

  // Matt's Board: Start shift / End shift for a route, only when the tap would cover somebody (CrewClock.tapShifts, through routeTaps, as the
  // server counts), and a row per person with their line and Set shift.
  function routeClockBox(ctx, routeId, ids) {
    var S = ctx.S, esc = ctx.esc, key = 'route:' + routeId, busyNow = !!clockInflight[key], dis = busyNow ? ' disabled' : '';
    var loaded = SnowShiftUI.isLoaded() && ids.length, now = nowIso(), cur = nowShift(S);
    var n = loaded ? SnowSiteTimes.routeTaps(S.clock, ids, cur, now) : { start: 0, end: 0 };
    // Undo (board undo, 11/12/26): the one the server's clockUndo_ would take for this route's people, from the same shared rule.
    var undo = loaded ? SnowSiteTimes.routeUndo(S.clock, ids, cur, now) : null;
    return '<div class="routeclock" data-routeclock="' + esc(routeId) + '"' + (busyNow ? ' aria-busy="true"' : '') + '>' +
      (n.start ? '<button data-clockstart="' + esc(routeId) + '"' + dis + '>Start shift</button>' : '') +
      (n.end ? '<button data-clockend="' + esc(routeId) + '"' + dis + '>End shift</button>' : '') +
      (undo ? '<button class="small" data-clockundo="' + esc(routeId) + '" data-kind="' + undo + '"' + dis + '>Undo ' + undo + '</button>' : '') +
      noteHtml(ctx, key, '') + failHtml(ctx, key) + '</div>';
  }
  // M3: on a route, a placed person with no times for the shown shift reads "Not started" (once the Clock rows have been read: before
  // that a blank line is the honest one); an unassigned person has nothing to start, and the crew's own card keeps its blank line.
  function boardLineHtml(ctx, id, placed) {
    var line = shiftLineHtml(ctx, id);
    return line || (placed && SnowShiftUI.isLoaded() ? '<span>Not started</span>' : '');
  }
  function clockRowsHtml(ctx, ids, placed) {
    var esc = ctx.esc, workers = byId(ctx.S.crew);
    if (!ids.length) return '';
    return '<div class="clockrows">' + ids.map(function (id) {
      return '<div class="clockrow"><span class="cname" data-no-es>' + esc((workers[id] || {}).name || id) + '</span>' +
        '<span class="clockline" data-clock="' + esc(id) + '"' + (placed ? ' data-placed="1"' : '') + '>' + boardLineHtml(ctx, id, placed) + '</span>' +
        '<button class="small" data-setshift="' + esc(id) + '">Set shift</button></div>';
    }).join('') + '</div>';
  }

  // Draw the shift pieces again in place (a reply landed, a poll brought rows): not the whole tab, so a truck box being typed in
  // or a move being picked is left alone.
  function refreshClock(ctx) {
    var S = ctx.S, el;
    if (!S.me) return;
    if (S.tab === 'tonight') {
      if ((el = ctx.$('shiftcard'))) el.outerHTML = cardHtml(ctx);
    } else if (S.tab === 'board') {
      var b = board(S);
      Array.prototype.forEach.call(document.querySelectorAll('[data-routeclock]'), function (box) {
        var crew = b.routes[box.dataset.routeclock];
        if (crew) box.outerHTML = routeClockBox(ctx, box.dataset.routeclock, routeIds(crew));
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-clock]'), function (line) { line.innerHTML = boardLineHtml(ctx, line.dataset.clock, !!line.dataset.placed); });
    }
  }
  function resetClock() { clockGen++; clockInflight = {}; clockFailed = {}; clockNote = null; }

  function countText(req, written) {
    if (!written) return 'Nothing to change: it was already recorded';
    var who = written === 1 ? '1 person' : written + ' people', kind = req.payload.kind;
    if (req.action === 'clockUndo') return (kind === 'start' ? 'Start' : 'End') + ' taken back for ' + who;
    return (kind === 'start' ? 'Started' : 'Ended') + ' for ' + who;
  }

  function clockTap(ctx, key, action, kind) {
    return clockRun(ctx, key, { action: action, payload: key === 'card' ? { kind: kind } : { kind: kind, route_id: key.slice(6) } });
  }

  // One request in flight per place (the card, or a route): a double tap and a Retry on top of a tap find it busy and do nothing.
  async function clockRun(ctx, key, req) {
    if (clockInflight[key]) return;
    clockInflight[key] = true;
    delete clockFailed[key];
    clockNote = null;
    refreshClock(ctx);
    var g = clockGen, r;
    try { r = await ctx.call(req.action, req.payload); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== clockGen) return; // signed out meanwhile; resetClock() already cleared everything
    delete clockInflight[key];
    if (r.ok) {
      // The rows join S.clock the way a poll's do: same id = same row. The cursor and the tail are the poll's alone.
      ctx.S.clock = SnowShiftUI.mergeRows(ctx.S.clock, r.records || []);
      clockNote = { key: key, text: countText(req, r.written), at: new Date().getTime() };
      refreshClock(ctx);
      // Nothing written: somebody tapped first (or this is a Retry of a tap that had landed). Read the rows that are there.
      if (!r.written) SnowShiftUI.catchUp(ctx);
      return;
    }
    if (r.code === 'signin') return ctx.signedOut(r.reason);
    // Not allowed (not on the Board) is refused again however often it is sent: no Retry.
    clockFailed[key] = { req: req, reason: r.code === 'network' ? 'no signal' : (r.reason || 'try again'), retry: r.code !== 'conflict' && r.code !== 'forbidden' };
    refreshClock(ctx);
    // A refusal means the phone's picture is out of date (someone tapped first, the Board moved).
    if (r.code === 'invalid' || r.code === 'conflict') SnowShiftUI.catchUp(ctx);
  }

  // ---------- Matt's gear log ----------
  var GEAR_TYPES = ['broken', 'left_on_site', 'issued', 'returned'];
  var logWorker = '', logType = '';
  function option(ctx, v, label, sel) { return '<option value="' + ctx.esc(v) + '"' + (sel ? ' selected' : '') + '>' + ctx.esc(label) + '</option>'; }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }
  function newestFirst(a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at)); }

  function renderLog(ctx) {
    var S = ctx.S, esc = ctx.esc, workers = byId(S.crew), routes = byId(S.routes);
    var list = S.gear.filter(function (e) { return (!logWorker || e.worker === logWorker) && (!logType || e.type === logType); }).sort(newestFirst);
    ctx.$('main').innerHTML = '<div class="row">' +
      '<select id="logWorker" style="flex:1">' + option(ctx, '', 'All workers', !logWorker) +
        pool(S).sort(byName).map(function (w) { return option(ctx, w.id, w.name, logWorker === w.id); }).join('') + '</select>' +
      '<select id="logType" style="flex:1">' + option(ctx, '', 'All types', !logType) +
        GEAR_TYPES.map(function (t) { return option(ctx, t, t.replace(/_/g, ' '), logType === t); }).join('') + '</select>' +
      '<button id="newEntry" class="primary">+ Entry</button></div>' +
      '<table id="gearlog">' + (list.map(function (e) {
        return '<tr><td>' + esc(e.shift ? CrewTime.shiftLabel(e.shift) : e.date) + '</td>' +
          '<td>' + esc((workers[e.worker] || {}).name || e.worker) + '<br><span class="muted">' + esc(String(e.type || '').replace(/_/g, ' ')) + '</span></td>' +
          '<td>' + esc(e.item) + (e.note ? '<br><span class="muted">' + esc(e.note) + '</span>' : '') + '</td>' +
          '<td>' + esc(e.route ? (routes[e.route] || {}).name || e.route : '') + (e.site ? '<br><span class="muted">' + esc(e.site) + '</span>' : '') + '</td></tr>';
      }).join('') || '<tr><td class="muted">Nothing logged yet.</td></tr>') + '</table>';
    ctx.$('logWorker').onchange = function () { logWorker = this.value; renderLog(ctx); };
    ctx.$('logType').onchange = function () { logType = this.value; renderLog(ctx); };
  }

  // The shifts an entry can belong to: the ones on offer now, then the last
  // two weeks, newest first. Gear turns up broken days after the shift.
  function entryShifts(iso) {
    var out = CrewTime.shiftChoices(iso).slice().reverse(), today = CrewTime.shiftDate(iso);
    for (var k = 0; k <= 14; k++) {
      var p = today.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] - k)).toISOString().slice(0, 10);
      ['night', 'day'].forEach(function (kind) { var id = CrewTime.shiftId(kind, d); if (out.indexOf(id) === -1) out.push(id); });
    }
    return out;
  }

  function openEntry(ctx) {
    var S = ctx.S, $ = ctx.$, touched = false;
    $('dlgIn').innerHTML = '<h2>Log entry</h2>' +
      '<label>Worker</label><select id="g_worker">' + option(ctx, '', 'choose…', true) +
        pool(S).filter(function (w) { return !w.archived; }).sort(byName).map(function (w) { return option(ctx, w.id, w.name, false); }).join('') + '</select>' +
      '<label>Type</label><select id="g_type">' + GEAR_TYPES.map(function (t) { return option(ctx, t, t.replace(/_/g, ' '), false); }).join('') + '</select>' +
      '<label>Item</label><input id="g_item" placeholder="e.g. Blower #3 shear pin, Parka">' +
      '<label>Shift</label><select id="g_shift">' + option(ctx, '', 'choose…', true) +
        entryShifts(nowIso()).map(function (id) { return option(ctx, id, CrewTime.shiftLabel(id), false); }).join('') + '</select>' +
      '<label>Route</label><select id="g_route">' + option(ctx, '', 'none', true) +
        liveRoutes(S).map(function (r) { return option(ctx, r.id, r.name, false); }).join('') + '</select>' +
      '<label>Site</label><input id="g_site">' +
      '<label>Note</label><input id="g_note">' +
      '<div id="g_err" class="err"></div><div class="row"><button id="g_save" class="primary">Save</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    // Where they were that shift, until Matt picks a route himself.
    function guess() {
      if (touched) return;
      var wid = $('g_worker').value, sh = $('g_shift').value;
      $('g_route').value = (wid && sh && CrewHistory.routeOn(S.callouts, S.moves, wid, sh)) || '';
    }
    $('g_worker').onchange = guess; $('g_shift').onchange = guess;
    $('g_route').onchange = function () { touched = true; };
    $('g_save').onclick = async function () {
      if (busy) return;
      var sh = $('g_shift').value, parsed = CrewTime.parseShift(sh);
      var rec = { date: parsed ? parsed.date : '', shift: sh, at: nowIso(), worker: $('g_worker').value, type: $('g_type').value,
        item: $('g_item').value.trim(), route: $('g_route').value || null, site: $('g_site').value.trim() || null, note: $('g_note').value.trim() };
      var errs = [];
      if (!rec.worker) errs.push('Pick a worker');
      if (!rec.item) errs.push('Item is required');
      if (!parsed) errs.push('Pick a shift');
      if (errs.length) { $('g_err').textContent = errs.join(' · '); return; }
      busy = true;
      this.disabled = true;
      try {
        var r = await ctx.call('addGear', { record: rec });
        if (r.ok) { S.gear.push(r.record); ctx.closeDialog(); ctx.render(); }
        else $('g_err').textContent = 'Not saved: ' + (r.reason || 'try again');
      } finally {
        busy = false;
        this.disabled = false;
      }
    };
  }

  // ---------- the crew's Tonight tab ----------
  // Rendered ONLY from the newest post (built by the server from allowed
  // fields): their own route first, then everyone else's. A post older than
  // every shift on offer shows no routes, so nobody drives to last night's.
  function renderTonight(ctx) {
    var S = ctx.S, esc = ctx.esc, post = S.post, me = S.me && S.me.crew_id;
    // Your card (roster self-service, 10/6/26): phone, picture and the rest, theirs to change.
    var html = '<div class="row"><button id="refreshPost" class="small">Refresh</button><button id="yourCard" class="small">Your card</button></div>';
    if (!post || CrewTime.isStale(post.shift, nowIso())) {
      html += '<section class="card"><h2>Not posted yet for this shift</h2><p class="muted">Matt hasn\'t posted the crews yet. Check back, or call your lead.</p></section>' + cardHtml(ctx);
    } else {
      var people = post.people || {};
      var mine = function (r) { return !!me && (r.lead === me || (r.members || []).indexOf(me) !== -1); };
      var routes = (post.routes || []).filter(mine).concat((post.routes || []).filter(function (r) { return !mine(r); }));
      html += '<div id="tonight-head" class="muted">' + esc(CrewTime.shiftLabel(post.shift)) + ', posted ' + esc(clock(post.posted_at)) + '</div>';
      html += cardHtml(ctx);
      if (!(post.routes || []).some(mine)) html += '<section class="card"><h2>You\'re not on a route this shift</h2><p class="muted">Here is everyone\'s.</p></section>';
      // Day order (Part B2): a day post lists ranked sites first; a night post keeps route order. The
      // post's own shift decides, not the clock: tonight's post read at 4 PM is a night list.
      var day = String(post.shift).indexOf('day-') === 0, siteById = {};
      (ctx.S.sites || []).forEach(function (s) { siteById[s.id] = s; });
      html += routes.map(function (r) {
        var byId = {}, ordered;
        (r.sites || []).forEach(function (s) { byId[s.id] = s; });
        // lib/callout.js missing (a cut-off load): route order, never a broken Tonight.
        ordered = typeof SnowCallout === 'undefined' ? (r.sites || []) : SnowCallout.rankOrder((r.sites || []).map(function (s) { return s.id; }), siteById, day).map(function (id) { return byId[id]; });
        function person(id, lead) {
          var p = people[id] || { name: id };
          return '<li>' + (lead ? '<span class="lead">LEAD </span>' : '') + '<span data-no-es>' + esc(p.name) + '</span>' +
            (p.phone ? ' <a class="call" href="tel:' + esc(p.phone) + '" aria-label="Call ' + esc(p.name) + '">☎</a>' : '') + '</li>';
        }
        return '<section class="card tonight-route' + (mine(r) ? ' mine' : '') + '"><div class="route-top"><span class="route-badge" data-no-es>' + esc(r.name) + '</span>' +
          (mine(r) ? '<span class="badge">Your route</span>' : '') + '</div>' +
          // Read-only: the newest Trucks row for this post's shift, else the truck the post carries.
          SnowShiftUI.truckHtml(ctx, r.id, false, post.shift) +
          '<ul class="crewlist">' + (r.lead ? person(r.lead, true) : '') + (r.members || []).map(function (id) { return person(id, false); }).join('') +
          (!r.lead && !(r.members || []).length ? '<li class="muted">Nobody yet</li>' : '') + '</ul>' +
          '<ol class="sitelist">' + ordered.map(function (s) {
            var full = (ctx.S.sites || []).filter(function (x) { return x.id === s.id; })[0]; // the address beside the code (Matt, 10/4/26)
            return '<li><span data-no-es>' + esc(s.name) + (full && full.address ? ' <span class="muted site-addr">' + esc(full.address) + '</span>' : '') + '</span><button class="small" data-map="' + esc(s.id) + '">Map</button></li>';
          }).join('') + '</ol></section>';
      }).join('');
    }
    if (post && post.people) {
      var list = Object.keys(post.people).map(function (id) { return post.people[id]; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      html += '<section class="card" id="shifts-worked"><h2>Shifts worked</h2>' + list.map(function (p) {
        var w = p.shifts || { night: 0, day: 0 };
        return '<div><span data-no-es>' + esc(p.name) + '</span> — ' + plural(w.night, 'night') + ' · ' + plural(w.day, 'day') + '</div>';
      }).join('') + '</section>';
    }
    ctx.$('main').innerHTML = html;
  }

  return { refreshClock: refreshClock, resetClock: resetClock, renderBoard: renderBoard, renderTonight: renderTonight, renderLog: renderLog, onClick: onClick, board: board, pickShift: pickShift,
    placeFromRoster: placeFromRoster, isBusy: function () { return busy; } };
})();
if (typeof window !== 'undefined') window.SnowBoardUI = SnowBoardUI;
