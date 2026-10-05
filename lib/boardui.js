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
    var placedAny = Object.keys(b.routes).some(function (id) { return b.routes[id].lead || b.routes[id].members.length; });
    var changed = SnowPairing.changedSincePost(b, S.post) && (placedAny || !!S.post);
    var html = '<div class="row boardhead" style="margin-top:0">' +
      '<span id="crewsees" class="badge">' + (S.post ? 'Crew sees ' + esc(CrewTime.shiftLabel(S.post.shift)) + ', posted ' + esc(clock(S.post.posted_at)) : 'Not posted') + '</span>' +
      '<span id="changed" class="badge off"' + (changed ? '' : ' hidden') + '>Changed since post</span>' +
      '<button id="post" class="primary"' + (busy ? ' disabled' : '') + '>Post</button>' +
      '<button id="callout"' + (busy ? ' disabled' : '') + '>Callout</button></div>';
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
      var ws = CrewWarnings.warningsFor(warnRoutes[r.id], crew, workers, S.gear, today, {});
      html += '<section class="card board-route" data-route="' + esc(r.id) + '"><div class="route-top"><span class="route-badge">' + esc(r.name) + '</span></div>' +
        '<div class="sites">' + esc((r.site_ids || []).map(function (id) { return siteById[id] ? siteById[id].name : id; }).join(' · ')) + '</div>' +
        // The truck for this route (Matt sets any route's; the lead can change their own on the Storm tab),
        // for the shift named above.
        SnowShiftUI.truckHtml(ctx, r.id, true) +
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
    if (ctx.S.tab !== 'board') return false;
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
    if (busy) return !!t.closest('[data-worker],[data-place],[data-act],#post,#callout');
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
        S.crew.slice().sort(byName).map(function (w) { return option(ctx, w.id, w.name, logWorker === w.id); }).join('') + '</select>' +
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
        S.crew.filter(function (w) { return !w.archived; }).sort(byName).map(function (w) { return option(ctx, w.id, w.name, false); }).join('') + '</select>' +
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
    var html = '<div class="row"><button id="refreshPost" class="small">Refresh</button></div>';
    if (!post || CrewTime.isStale(post.shift, nowIso())) {
      html += '<section class="card"><h2>Not posted yet for this shift</h2><p class="muted">Matt hasn\'t posted the crews yet. Check back, or call your lead.</p></section>';
    } else {
      var people = post.people || {};
      var mine = function (r) { return !!me && (r.lead === me || (r.members || []).indexOf(me) !== -1); };
      var routes = (post.routes || []).filter(mine).concat((post.routes || []).filter(function (r) { return !mine(r); }));
      html += '<div id="tonight-head" class="muted">' + esc(CrewTime.shiftLabel(post.shift)) + ', posted ' + esc(clock(post.posted_at)) + '</div>';
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
          return '<li>' + (lead ? '<span class="lead">LEAD </span>' : '') + esc(p.name) +
            (p.phone ? ' <a class="call" href="tel:' + esc(p.phone) + '" aria-label="Call ' + esc(p.name) + '">☎</a>' : '') + '</li>';
        }
        return '<section class="card tonight-route' + (mine(r) ? ' mine' : '') + '"><div class="route-top"><span class="route-badge">' + esc(r.name) + '</span>' +
          (mine(r) ? '<span class="badge">Your route</span>' : '') + '</div>' +
          // Read-only: the newest Trucks row for this post's shift, else the truck the post carries.
          SnowShiftUI.truckHtml(ctx, r.id, false, post.shift) +
          '<ul class="crewlist">' + (r.lead ? person(r.lead, true) : '') + (r.members || []).map(function (id) { return person(id, false); }).join('') +
          (!r.lead && !(r.members || []).length ? '<li class="muted">Nobody yet</li>' : '') + '</ul>' +
          '<ol class="sitelist">' + ordered.map(function (s) {
            var full = (ctx.S.sites || []).filter(function (x) { return x.id === s.id; })[0]; // the address beside the code (Matt, 10/4/26)
            return '<li><span>' + esc(s.name) + (full && full.address ? ' <span class="muted site-addr">' + esc(full.address) + '</span>' : '') + '</span><button class="small" data-map="' + esc(s.id) + '">Map</button></li>';
          }).join('') + '</ol></section>';
      }).join('');
    }
    if (post && post.people) {
      var list = Object.keys(post.people).map(function (id) { return post.people[id]; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      html += '<section class="card" id="shifts-worked"><h2>Shifts worked</h2>' + list.map(function (p) {
        var w = p.shifts || { night: 0, day: 0 };
        return '<div>' + esc(p.name) + ' — ' + plural(w.night, 'night') + ' · ' + plural(w.day, 'day') + '</div>';
      }).join('') + '</section>';
    }
    ctx.$('main').innerHTML = html;
  }

  return { renderBoard: renderBoard, renderTonight: renderTonight, renderLog: renderLog, onClick: onClick, board: board, pickShift: pickShift,
    isBusy: function () { return busy; } };
})();
if (typeof window !== 'undefined') window.SnowBoardUI = SnowBoardUI;
