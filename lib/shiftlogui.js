// The Storm tab, crew side (sub-project 3, 10/3/26). During a storm the crew
// tap each walk Cleared / Treated / Problem / Checked; the phone polls for
// everyone else's taps. The page never decides what a tap means: the rules are
// CrewShiftLog (a byte-identical copy of the backend's), and the server stamps
// who, when and which shift. Rows are only ever added, in the server's `seq`
// order, so the screen is a replay of the rows.
//
// ctx (built by app.js on every call): {S, $, esc, call, toast, render,
// signedOut(reason), ...}. S.log / S.storms / S.visits hold the rows,
// S.cursor how many rows of each tab the server has handed over, and S.last
// the seq of the last row it handed over (the server checks that row is still
// where the cursor says: a hand-deleted row makes it answer `reset`).
var SnowShiftUI = (function () {
  'use strict';
  var INTERVAL = 20000, TABS = ['log', 'storms', 'visits'];
  var timer = null, ctxRef = null, polling = false, gen = 0, loaded = false, unreachable = false;
  var inflight = {}, failed = {}, noteOpen = {}, drafts = {}, showOthers = false;

  // Rows from a poll and from this phone's own taps meet here. Same id = same
  // row (rows are never edited), so it is kept once; order is the server's seq.
  function mergeRows(list, rows) {
    var byId = {};
    (list || []).concat(rows || []).forEach(function (r) { byId[r.id] = r; });
    return Object.keys(byId).map(function (k) { return byId[k]; })
      .sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
  }
  function maxSeq(rows) {
    var m = null;
    (rows || []).forEach(function (r) { var n = Number(r.seq); if (m === null || n > m) m = n; });
    return m;
  }

  function stateLabel(s) { return { cleared: 'Cleared', treated: 'Treated', problem: 'Problem', checked: 'Checked', none: 'Not done' }[s] || String(s); }
  function clock(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }
  function nowIso() { return CrewTime.localIso(new Date()); }

  // The routes on offer. The crew's own route is the one in the newest post
  // (not stale) that lists them, as Tonight does; with no usable post there is
  // no "own" route, and the live board's routes are all that is known.
  function routesFor(S) {
    var me = S.me && S.me.crew_id, post = S.post;
    var fresh = !!post && !CrewTime.isStale(post.shift, nowIso());
    var names = {};
    S.sites.forEach(function (s) { names[s.id] = s.name; });
    if (fresh) {
      return (post.routes || []).map(function (r) {
        return { id: r.id, name: r.name, sites: (r.sites || []).map(function (s) { return { id: s.id, name: s.name || names[s.id] || s.id }; }),
          mine: !!me && (r.lead === me || (r.members || []).indexOf(me) !== -1) };
      });
    }
    return S.routes.filter(function (r) { return !r.archived; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); })
      .map(function (r) {
        return { id: r.id, name: r.name, mine: false,
          sites: (r.site_ids || []).map(function (id) { return { id: id, name: names[id] || id }; }) };
      });
  }

  function headText(st) {
    if (!loaded) return unreachable ? "Can't reach the server. Trying again." : 'Checking for a storm…';
    return st.open ? 'Storm open · ' + (st.snowing ? 'Snowing' : 'Stopped') : 'No storm open';
  }

  function walkHtml(ctx, site, w, states) {
    var esc = ctx.esc, key = CrewShiftLog.walkKey(site.id, w.zone_id), row = states[key], f = failed[key];
    var html = '<div class="walk' + (inflight[key] ? ' pending' : '') + '" data-walkrow="' + esc(key) + '"' + (inflight[key] ? ' aria-busy="true"' : '') + '>' +
      '<div class="walk-name">' + esc(w.name) + (w.type === 'heated' ? ' <span class="muted">heated</span>' : '') + '</div>' +
      '<div class="walk-btns">' + CrewShiftLog.statesFor(w.type).map(function (s) {
        return '<button class="walkbtn s-' + s + '" data-walk="' + esc(key) + '" data-state="' + s + '" aria-pressed="' + (!!row && row.state === s) + '">' + stateLabel(s) + '</button>';
      }).join('') + '</div>';
    if (row) {
      html += '<div class="walk-last"><span>' + esc([stateLabel(row.state), row.by_name, clock(row.at)].filter(Boolean).join(' · ')) + '</span>' +
        (row.note ? '<span class="walk-note">— ' + esc(row.note) + '</span>' : '') +
        '<button class="small" data-undo="' + esc(row.seq) + '">Undo</button></div>';
    }
    if (noteOpen[key]) {
      var d = drafts[key] || '';
      html += '<div class="notebox"><textarea data-note="' + esc(key) + '" rows="2" placeholder="What is the problem?">' + esc(d) + '</textarea>' +
        '<div class="row"><button class="primary" data-send="' + esc(key) + '"' + (d.trim() ? '' : ' disabled') + '>Save</button>' +
        '<button data-cancelnote="' + esc(key) + '">Cancel</button></div></div>';
    }
    if (f) {
      html += '<div class="walk-fail err" role="alert">Not saved: ' + esc(f.reason) +
        (f.retry ? ' <button class="small" data-retry="' + esc(key) + '">Retry</button>' : '') + '</div>';
    }
    return html + '</div>';
  }

  function siteHtml(ctx, site, states) {
    var S = ctx.S, walks = CrewShiftLog.walksFor(site.id, S.zones);
    return '<section class="card shift-site" data-shiftsite="' + ctx.esc(site.id) + '"><div class="route-top"><span class="site-name">' + ctx.esc(site.name) + '</span></div>' +
      walks.map(function (w) { return walkHtml(ctx, site, w, states); }).join('') + '</section>';
  }

  function routeHtml(ctx, r, states) {
    return '<h2 class="shift-route">' + ctx.esc(r.name) + (r.mine ? ' <span class="badge">Your route</span>' : '') + '</h2>' +
      (r.sites.map(function (s) { return siteHtml(ctx, s, states); }).join('') || '<p class="muted">No sites on this route.</p>');
  }

  function draw(ctx) {
    var S = ctx.S;
    if (S.tab !== 'storm' || !S.me || S.mapSite) return;
    var main = ctx.$('main'), active = document.activeElement, focusKey = null, selStart = 0;
    // What is being typed survives a redraw (a poll can land mid-sentence).
    Array.prototype.forEach.call(main.querySelectorAll('[data-note]'), function (n) {
      drafts[n.dataset.note] = n.value;
      if (n === active) { focusKey = n.dataset.note; selStart = n.selectionStart; }
    });
    var st = CrewShiftLog.stormState(S.storms), states = CrewShiftLog.walkStates(S.log, st.storm_id);
    var routes = routesFor(S), mine = routes.filter(function (r) { return r.mine; }), others = routes.filter(function (r) { return !r.mine; });
    var admin = S.me.role === 'admin';
    var html = '<div id="stormhead" class="stormhead' + (loaded && st.open ? ' open' : '') + '" role="status">' + ctx.esc(headText(st)) + '</div>';
    if (admin) {
      // Matt has no route of his own: every route is on offer. (Task 6 gives him the live view.)
      html += routes.map(function (r) { return routeHtml(ctx, r, states); }).join('') || '<p class="muted">No routes yet. Add them on the Routes tab.</p>';
    } else {
      html += mine.map(function (r) { return routeHtml(ctx, r, states); }).join('');
      if (!mine.length) html += '<section class="card"><h2>You\'re not on a route this shift</h2><p class="muted">Ask your lead. To help out on another route, open the other routes below.</p></section>';
      if (others.length) {
        html += '<div class="row"><button id="otherRoutes" aria-expanded="' + showOthers + '">' + (showOthers ? 'Hide other routes' : 'Other routes') + '</button></div>';
        if (showOthers) html += others.map(function (r) { return routeHtml(ctx, r, states); }).join('');
      }
    }
    main.innerHTML = html;
    Array.prototype.forEach.call(main.querySelectorAll('[data-note]'), function (n) {
      n.oninput = function () {
        drafts[n.dataset.note] = n.value;
        var b = sendBtn(n.dataset.note);
        if (b) b.disabled = !n.value.trim();
      };
      if (n.dataset.note === focusKey) { n.focus(); try { n.setSelectionRange(selStart, selStart); } catch (e) {} }
    });
  }

  function findBy(sel, attr, key) {
    var list = document.querySelectorAll(sel), i;
    for (i = 0; i < list.length; i++) if (list[i].getAttribute(attr) === key) return list[i];
    return null;
  }
  function sendBtn(key) { return findBy('[data-send]', 'data-send', key); }
  function noteBox(key) { return findBy('[data-note]', 'data-note', key); }

  // Mark a walk as sending WITHOUT replacing its buttons: the guard in run() is
  // what stops a second tap, and a redraw here would hide that from a test.
  function mark(key) {
    var row = findBy('[data-walkrow]', 'data-walkrow', key);
    if (!row) return;
    row.classList.add('pending');
    row.setAttribute('aria-busy', 'true');
    Array.prototype.forEach.call(row.querySelectorAll('.walk-fail'), function (e) { e.remove(); });
  }

  // One request in flight per walk. A double tap, a Retry on top of a tap and
  // an Undo on top of a tap all find the walk busy and do nothing.
  async function run(ctx, key, req) {
    if (inflight[key]) return;
    inflight[key] = true;
    delete failed[key];
    mark(key);
    var g = gen, r;
    try { r = await ctx.call(req.action, req.payload); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== gen) return; // signed out meanwhile; reset() already cleared everything
    delete inflight[key];
    if (r.ok) {
      ctx.S.log = mergeRows(ctx.S.log, [r.record]);
      delete noteOpen[key];
      delete drafts[key];
      return draw(ctx);
    }
    if (r.code === 'signin') return ctx.signedOut(r.reason);
    failed[key] = { req: req, reason: r.code === 'network' ? 'no signal' : (r.reason || 'try again'), retry: r.code !== 'conflict' };
    draw(ctx);
    // A refusal means the phone's picture is out of date (the storm ended, someone tapped first).
    if (r.code === 'invalid' || r.code === 'conflict') poll(ctx);
  }

  function tap(ctx, key, state, note) {
    var i = key.indexOf('|');
    return run(ctx, key, { action: 'tapZone', payload: { site_id: key.slice(0, i), zone_id: key.slice(i + 1), state: state, note: note } });
  }

  async function poll(ctx) {
    ctxRef = ctx;
    if (polling) return;
    polling = true;
    var g = gen, S = ctx.S;
    try {
      var r = await ctx.call('getShiftLog', { cursor: S.cursor, last: S.last });
      if (g !== gen) return;
      if (!r.ok) {
        if (r.code === 'signin') return ctx.signedOut(r.reason);
        if (!loaded) { unreachable = true; draw(ctx); }
        return; // the next tick asks again
      }
      TABS.forEach(function (t) {
        var rows = r[t] || [];
        if (r.reset && r.reset[t]) { S[t] = mergeRows([], rows); S.last[t] = maxSeq(rows); }
        else { S[t] = mergeRows(S[t], rows); if (rows.length) S.last[t] = maxSeq(rows); }
      });
      if (r.cursor) S.cursor = { log: r.cursor.log || 0, storms: r.cursor.storms || 0, visits: r.cursor.visits || 0 };
      loaded = true;
      unreachable = false;
      draw(ctx);
    } finally { if (g === gen) polling = false; }
  }

  function tick() {
    if (document.visibilityState === 'visible' && ctxRef && ctxRef.S.tab === 'storm') poll(ctxRef);
  }
  // Entering the tab polls at once (catch up), then every 20 s while it is on
  // screen. Safe to call on every render: a running timer is left alone.
  function start(ctx) {
    ctxRef = ctx;
    if (timer) return;
    timer = setInterval(tick, INTERVAL);
    poll(ctx);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  // Signed out (or session gone): forget everything this person's phone knew.
  function reset(S) {
    stop();
    gen++;
    polling = false; loaded = false; unreachable = false; showOthers = false;
    inflight = {}; failed = {}; noteOpen = {}; drafts = {};
    S.log = []; S.storms = []; S.visits = [];
    S.cursor = { log: 0, storms: 0, visits: 0 };
    S.last = { log: null, storms: null, visits: null };
  }

  // Storm-tab clicks. Returns true when handled.
  function onClick(ev, ctx) {
    if (ctx.S.tab !== 'storm') return false;
    ctxRef = ctx;
    var t = ev.target, el, key;
    if (t.closest('#otherRoutes')) { showOthers = !showOthers; draw(ctx); return true; }
    if ((el = t.closest('[data-walk]'))) {
      key = el.dataset.walk;
      if (el.dataset.state === 'problem') {
        noteOpen[key] = true;
        draw(ctx);
        var box = noteBox(key);
        if (box) box.focus();
      } else tap(ctx, key, el.dataset.state, '');
      return true;
    }
    if ((el = t.closest('[data-send]'))) {
      key = el.dataset.send;
      var n = noteBox(key), note = n ? n.value.trim() : String(drafts[key] || '').trim();
      if (note) tap(ctx, key, 'problem', note);
      return true;
    }
    if ((el = t.closest('[data-cancelnote]'))) { key = el.dataset.cancelnote; delete noteOpen[key]; delete drafts[key]; draw(ctx); return true; }
    if ((el = t.closest('[data-undo]'))) {
      var seq = Number(el.dataset.undo), row = ctx.S.log.filter(function (r) { return Number(r.seq) === seq; })[0];
      if (row) run(ctx, CrewShiftLog.walkKey(row.site_id, row.zone_id), { action: 'undoTap', payload: { seq: seq } });
      return true;
    }
    if ((el = t.closest('[data-retry]'))) {
      key = el.dataset.retry;
      if (failed[key]) run(ctx, key, failed[key].req);
      return true;
    }
    return false;
  }

  return { render: function (ctx) { ctxRef = ctx; draw(ctx); }, poll: poll, start: start, stop: stop, reset: reset, onClick: onClick,
    mergeRows: mergeRows,
    // What this phone holds, for tests: rows, cursor and last-seq per tab.
    state: function () { var S = ctxRef && ctxRef.S; return S ? { log: S.log, storms: S.storms, visits: S.visits, cursor: S.cursor, last: S.last } : null; } };
})();
if (typeof window !== 'undefined') window.SnowShiftUI = SnowShiftUI;
