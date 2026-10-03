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
    return '<section class="card shift-site" data-shiftsite="' + ctx.esc(site.id) + '"><div class="route-top"><span class="site-name">' + ctx.esc(site.name) + '</span>' +
      '<button class="small" data-card="' + ctx.esc(site.id) + '">Site card</button></div>' +
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
        // `last` is the seq of the reply's LAST row in the order it was sent (the
        // sheet's physical order): the server checks the row at the cursor
        // position. The highest seq is not the same row if Matt re-sorted the Log.
        if (r.reset && r.reset[t]) S[t] = mergeRows([], rows);
        else S[t] = mergeRows(S[t], rows);
        if (rows.length) S.last[t] = Number(rows[rows.length - 1].seq);
        else if (r.reset && r.reset[t]) S.last[t] = null;
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
    inflight = {}; failed = {}; noteOpen = {}; drafts = {}; cardBusy = false;
    S.log = []; S.storms = []; S.visits = [];
    S.cursor = { log: 0, storms: 0, visits: 0 };
    S.last = { log: null, storms: null, visits: null };
  }

  // ---------- the site card ----------
  // The paper sheet's per-site fields: depth, materials used, equipment minutes.
  // Start and finish are only shown: they are the first and last tap here this
  // shift. Everything typed is a judgment value, so it is sent blank when it is
  // blank, never 0. Each person has one card per site per shift; saving again
  // replaces their own (the server files a new row, the newest one wins).
  var MACHINES = [['blower', 'Blower'], ['snowrator', 'Snowrator'], ['bobcat', 'Bobcat'], ['sweepster', 'Sweepster']];
  var cardBusy = false;

  function shown(v) { return v === '' || v === null || v === undefined ? '' : String(v); }
  function dayShift(S) { return CrewShiftLog.shiftFor(nowIso(), S.storms); }

  // This person's newest card for the site in the current shift, never someone else's.
  function myCard(S, siteId, shiftId) {
    var key = (S.me && S.me.crew_id) || 'admin';
    return CrewShiftLog.visitTotals(S.visits, siteId, shiftId).cards.filter(function (c) { return String(c.by_key || 'admin') === key; })[0] || null;
  }

  function openCard(ctx, siteId) {
    var S = ctx.S, esc = ctx.esc, site = S.sites.filter(function (s) { return s.id === siteId; })[0];
    if (!site) return;
    var shiftId = dayShift(S), mine = myCard(S, siteId, shiftId), eq = (mine && mine.equipment) || {};
    var times = CrewShiftLog.siteTimes(S.log, siteId, shiftId);
    ctx.$('dlgIn').innerHTML = '<h2>Site card: ' + esc(site.name) + '</h2>' +
      '<label for="vc_depth">Snow depth (in)</label>' +
      '<input id="vc_depth" type="number" inputmode="decimal" min="0" step="any" value="' + esc(shown(mine && mine.depth_in)) + '">' +
      '<label for="vc_mat">Materials used</label>' +
      '<div class="vc-matrow"><input id="vc_mat" type="text" value="' + esc(shown(mine && mine.materials_used)) + '">' +
      (site.materials_needed ? '<div id="vc_needed" class="muted">Needed: ' + esc(site.materials_needed) + '</div>' : '') + '</div>' +
      '<label>Equipment (minutes)</label>' +
      MACHINES.map(function (m) {
        var v = shown(eq[m[0]]), on = v !== '';
        return '<div class="vc-eq row"><label><input type="checkbox" data-eq="' + m[0] + '"' + (on ? ' checked' : '') + '> ' + m[1] + '</label>' +
          '<input type="number" inputmode="numeric" min="0" step="1" data-eqmin="' + m[0] + '" aria-label="' + m[1] + ' minutes" placeholder="min" value="' + esc(v) + '"' + (on ? '' : ' disabled') + '></div>';
      }).join('') +
      '<div class="vc-times muted">Start <b id="vc_start">' + esc(times.start ? clock(times.start) : '—') + '</b> · Finish <b id="vc_finish">' + esc(times.finish ? clock(times.finish) : '—') + '</b></div>' +
      '<div id="vc_err" class="err" role="alert"></div>' +
      '<div class="row"><button id="vc_save" class="primary">Save</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    Array.prototype.forEach.call(ctx.$('dlgIn').querySelectorAll('[data-eq]'), function (box) {
      box.onchange = function () {
        var min = ctx.$('dlgIn').querySelector('[data-eqmin="' + box.dataset.eq + '"]');
        min.disabled = !box.checked;
        if (box.checked) min.focus();
      };
    });
    ctx.$('vc_save').onclick = function () { saveCard(ctx, siteId); };
  }

  // '' stays '', a typed number is a number; null means "not a valid number".
  function typed(raw, whole) {
    raw = String(raw).trim();
    if (raw === '') return '';
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || (whole && Math.floor(n) !== n)) return null;
    return n;
  }

  async function saveCard(ctx, siteId) {
    if (cardBusy) return;
    var dlg = ctx.$('dlgIn'), err = ctx.$('vc_err'), save = ctx.$('vc_save');
    var depth = typed(ctx.$('vc_depth').value, false);
    if (depth === null) { err.textContent = 'Depth must be a number, zero or more'; return; }
    var equipment = {};
    for (var i = 0; i < MACHINES.length; i++) {
      var k = MACHINES[i][0], box = dlg.querySelector('[data-eq="' + k + '"]'), min = dlg.querySelector('[data-eqmin="' + k + '"]');
      // A tick means "this machine was used": without minutes it would be saved
      // as blank and the tick lost on reopening. Ask, send nothing.
      if (box.checked && min.value.trim() === '') { err.textContent = 'Add minutes for ' + MACHINES[i][1] + ', or untick it'; return; }
      equipment[k] = box.checked ? typed(min.value, true) : '';
      if (equipment[k] === null) { err.textContent = 'Minutes must be a whole number, zero or more'; return; }
    }
    var payload = { site_id: siteId, depth_in: depth, materials_used: ctx.$('vc_mat').value.trim(), equipment: equipment };
    cardBusy = true;
    err.textContent = '';
    save.disabled = true;
    var g = gen, r;
    try { r = await ctx.call('saveVisit', payload); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== gen) return; // signed out meanwhile; reset() already cleared everything
    cardBusy = false;
    if (r.ok) {
      ctx.S.visits = mergeRows(ctx.S.visits, [r.record]);
      ctx.closeDialog();
      ctx.toast('Site card saved');
      return draw(ctx);
    }
    if (r.code === 'signin') { ctx.closeDialog(); return ctx.signedOut(r.reason); }
    var e2 = ctx.$('vc_err'), b2 = ctx.$('vc_save');
    if (e2) e2.textContent = r.code === 'network' ? 'Not saved: no signal' : (r.reason || 'Not saved: try again');
    if (b2) b2.disabled = false;
    if (r.code === 'invalid' || r.code === 'conflict') poll(ctx); // the phone's picture is out of date
  }

  // Storm-tab clicks. Returns true when handled.
  function onClick(ev, ctx) {
    if (ctx.S.tab !== 'storm') return false;
    ctxRef = ctx;
    var t = ev.target, el, key;
    if (t.closest('#otherRoutes')) { showOthers = !showOthers; draw(ctx); return true; }
    if ((el = t.closest('[data-card]'))) { openCard(ctx, el.dataset.card); return true; }
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
