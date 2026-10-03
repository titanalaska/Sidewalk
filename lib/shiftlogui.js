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
  // Matt and the leads: the route open from the live view (null = the live view
  // itself), one storm control in flight at a time, and the last refusal.
  var openRoute = null, stormBusy = false, stormErr = '', warnNow = {};
  // The forecast hint (lib/weather.js): one per screen, asked for at most once
  // every 15 minutes whatever the number of redraws and polls, and for a point
  // only. Failure or no answer is no hint, and nothing else on the screen changes.
  var HINT_EVERY = 15 * 60 * 1000;
  var hint = { key: '', text: null, at: 0, busy: false };

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

  function warnHtml(ctx, key) {
    return '<div class="walk-warn" data-warn="' + ctx.esc(key) + '" role="status">It\'s still snowing: treated anyway</div>';
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
    // Treated while it is Snowing is allowed, never blocked: the server saved it
    // with snowing_warned, and the warning stays on the walk from that row.
    if ((row && row.state === 'treated' && row.snowing_warned === true) || warnNow[key]) html += warnHtml(ctx, key);
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
      '<span class="row tight"><button class="small" data-map="' + ctx.esc(site.id) + '">Map</button>' +
      '<button class="small" data-card="' + ctx.esc(site.id) + '">Site card</button></span></div>' +
      walks.map(function (w) { return walkHtml(ctx, site, w, states); }).join('') + '</section>';
  }

  function routeHtml(ctx, r, states) {
    return '<h2 class="shift-route">' + ctx.esc(r.name) + (r.mine ? ' <span class="badge">Your route</span>' : '') + '</h2>' +
      (r.sites.map(function (s) { return siteHtml(ctx, s, states); }).join('') || '<p class="muted">No sites on this route.</p>');
  }

  // ---------- the live view (Matt and the leads) ----------
  // Every route at a glance, from the same rows the crew tap. Nothing here is
  // stored: it is all a replay of Log, Storms and Visits for the current storm.
  function liveRoutes(S) {
    var names = {}, archived = {};
    S.sites.forEach(function (s) { names[s.id] = s.name; archived[s.id] = s.archived === true; });
    return S.routes.filter(function (r) { return !r.archived; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); })
      .map(function (r) {
        return { id: r.id, name: r.name, mine: false,
          sites: (r.site_ids || []).filter(function (id) { return !archived[id]; }).map(function (id) { return { id: id, name: names[id] || id }; }) };
      });
  }

  // Who is on a route comes from the crew's own source, the newest post that is
  // not stale: lead first, then members, by the names the post carries.
  function whoOn(S, routeId) {
    var post = S.post;
    if (!post || CrewTime.isStale(post.shift, nowIso())) return '';
    var r = (post.routes || []).filter(function (x) { return x.id === routeId; })[0];
    if (!r) return '';
    var people = post.people || {};
    function nm(id) { return (people[id] && people[id].name) || id; }
    return (r.lead ? [nm(r.lead) + ' (lead)'] : []).concat((r.members || []).map(nm)).join(', ');
  }

  function walkName(S, siteId, zoneId) {
    var w = CrewShiftLog.walksFor(siteId, S.zones).filter(function (x) { return x.zone_id === zoneId; })[0];
    return w ? w.name : zoneId;
  }

  function problemsHtml(ctx, states) {
    var S = ctx.S, esc = ctx.esc;
    var rows = Object.keys(states).map(function (k) { return states[k]; })
      .filter(function (r) { return r.state === 'problem'; })
      .sort(function (a, b) { return Number(b.seq) - Number(a.seq); });
    if (!rows.length) return '';
    var siteName = {};
    S.sites.forEach(function (s) { siteName[s.id] = s.name; });
    return '<section id="problems" class="card problems"><h2>Problems (' + rows.length + ')</h2><ul>' + rows.map(function (r) {
      return '<li data-problem="' + esc(CrewShiftLog.walkKey(r.site_id, r.zone_id)) + '"><div><b>' + esc(siteName[r.site_id] || r.site_id) + '</b> · ' +
        esc(walkName(S, r.site_id, r.zone_id)) + '</div><div class="problem-note">' + esc(r.note) + '</div>' +
        '<div class="muted">' + esc([r.by_name, clock(r.at)].filter(Boolean).join(' · ')) + '</div></li>';
    }).join('') + '</ul></section>';
  }

  // Minutes summed over the cards, depth and materials per person.
  function totalsHtml(ctx, siteId) {
    var S = ctx.S, esc = ctx.esc, t = CrewShiftLog.visitTotals(S.visits, siteId, dayShift(S)), parts = [];
    var mins = MACHINES.filter(function (m) { return t.minutes[m[0]] !== null; })
      .map(function (m) { return m[1] + ' ' + t.minutes[m[0]] + ' min'; });
    if (mins.length) parts.push(mins.join(' · '));
    var depth = t.cards.filter(function (c) { return shown(c.depth_in) !== ''; })
      .map(function (c) { return (c.by_name || c.by_key) + ' ' + c.depth_in + ' in'; });
    if (depth.length) parts.push('Depth: ' + depth.join(', '));
    var mat = t.cards.filter(function (c) { return String(c.materials_used || '').trim() !== ''; })
      .map(function (c) { return String(c.materials_used).trim() + ' (' + (c.by_name || c.by_key) + ')'; });
    if (mat.length) parts.push('Materials: ' + mat.join(', '));
    return parts.length ? '<div class="live-totals muted">' + parts.map(function (p) { return '<div>' + esc(p) + '</div>'; }).join('') + '</div>' : '';
  }

  function liveSiteHtml(ctx, site, states) {
    var S = ctx.S, esc = ctx.esc, walks = CrewShiftLog.walksFor(site.id, S.zones);
    var rows = walks.map(function (w) { return states[CrewShiftLog.walkKey(site.id, w.zone_id)]; }).filter(Boolean);
    var done = CrewShiftLog.siteDone(site.id, S.zones, states);
    var problem = rows.some(function (r) { return r.state === 'problem'; });
    var doneWalks = rows.filter(function (r) { return r.state === 'cleared' || r.state === 'treated' || r.state === 'checked'; }).length;
    var status = done ? 'Done' : problem ? 'Problem' : doneWalks ? doneWalks + ' of ' + walks.length + ' walks' : 'Not started';
    // Taps by someone off this route are kept and flagged, never refused: say so here.
    var off = [];
    rows.forEach(function (r) { if (r.off_route === true && r.by_name && off.indexOf(r.by_name) === -1) off.push(r.by_name); });
    return '<li class="live-site" data-livesite="' + esc(site.id) + '"><div class="live-siterow"><span class="live-sitename">' + esc(site.name) + '</span>' +
      '<span class="live-status' + (done ? ' done' : problem ? ' bad' : '') + '">' + esc(status) + '</span></div>' +
      (off.length ? '<div class="muted"><span class="offroute">off-route</span> ' + esc(off.join(', ')) + '</div>' : '') +
      totalsHtml(ctx, site.id) + '</li>';
  }

  function liveRouteHtml(ctx, r, st, states) {
    var S = ctx.S, esc = ctx.esc, prog = CrewShiftLog.routeProgress(r.sites.map(function (s) { return s.id; }), S.zones, states);
    var ids = r.sites.map(function (s) { return s.id; });
    var taps = (S.log || []).filter(function (x) { return x.storm_id === st.storm_id && ids.indexOf(x.site_id) !== -1; })
      .sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
    var last = taps.length ? taps[taps.length - 1] : null;
    return '<section class="card live-route" data-liveroute="' + esc(r.id) + '">' +
      '<button class="live-open" data-openroute="' + esc(r.id) + '"><span class="route-badge">' + esc(r.name) + '</span>' +
      '<span class="live-count">' + prog.done + ' of ' + prog.total + ' sites done</span></button>' +
      '<progress value="' + prog.done + '" max="' + prog.total + '"></progress>' +
      '<div class="live-who">' + esc(whoOn(S, r.id) || 'Not posted') + '</div>' +
      '<div class="live-last muted">' + (last ? 'Last tap ' + esc(clock(last.at)) : 'No taps yet') + '</div>' +
      '<ul class="live-sites">' + r.sites.map(function (s) { return liveSiteHtml(ctx, s, states); }).join('') + '</ul></section>';
  }

  // Start / End / Reopen storm, the Snowing|Stopped switch, Night shift on: only
  // the ones valid now. Nothing is offered until the phone has heard the real
  // state once (a Start would otherwise be offered over a storm already open).
  function controlsHtml(ctx, st) {
    if (!loaded) return '';
    var S = ctx.S, esc = ctx.esc;
    var cls = stormBusy ? ' pending' : '', busy = stormBusy ? ' aria-busy="true"' : '';
    function b(kind, label, extra) { return '<button class="stormbtn' + cls + (extra || '') + '" data-storm="' + kind + '"' + busy + '>' + label + '</button>'; }
    var html = '<section id="stormctl" class="card stormctl"><div class="row">';
    if (!st.open) {
      html += b('start', 'Start storm', ' primary') + (st.storm_id ? b('reopen', 'Reopen storm') : '');
    } else {
      var night = CrewShiftLog.shiftFor(nowIso(), S.storms).indexOf('night') === 0;
      html += b('end', 'End storm', ' danger') +
        '<span class="seg" role="group" aria-label="Weather"><button class="stormbtn' + cls + '" data-storm="snowing" aria-pressed="' + st.snowing + '"' + busy + '>Snowing</button>' +
        '<button class="stormbtn' + cls + '" data-storm="stopped" aria-pressed="' + !st.snowing + '"' + busy + '>Stopped</button></span>' +
        '<button class="stormbtn' + cls + '" data-storm="night_on" aria-pressed="' + night + '"' + busy + (night ? ' disabled' : '') + '>Night shift on</button>';
    }
    html += '</div>';
    if (st.open) html += '<div id="shiftnow" class="muted">' + (CrewShiftLog.shiftFor(nowIso(), S.storms).indexOf('night') === 0 ? 'Night shift' : 'Day shift') + '</div>';
    if (stormErr) html += '<div id="stormerr" class="err" role="alert">' + esc(stormErr) + '</div>';
    return html + '</section>';
  }

  // The first site on the screen's routes that has a point (a saved view, or drawn
  // zones), as [lat, lon] rounded; null when none has.
  function hintPoint(S, routes) {
    var i, j, site, p;
    for (i = 0; i < routes.length; i++) {
      for (j = 0; j < routes[i].sites.length; j++) {
        site = S.sites.filter(function (x) { return x.id === routes[i].sites[j].id; })[0];
        if (!site) continue;
        p = SnowWeather.point(site, S.zones.filter(function (z) { return z.site_id === site.id && z.archived !== true; }));
        if (p) return p;
      }
    }
    return null;
  }

  // Ask the NWS if this point has not been asked about in the last 15 minutes
  // (a failed answer counts: a failing service is not hammered).
  function ensureHint(ctx, p) {
    if (!p || typeof SnowWeather === 'undefined' || hint.busy) return;
    var key = p[0] + ',' + p[1];
    if (hint.key === key && Date.now() - hint.at < HINT_EVERY) return;
    hint.busy = true;
    var g = gen;
    SnowWeather.fetchHint(p[0], p[1]).then(function (text) {
      if (g !== gen) return; // signed out meanwhile; reset() already cleared it
      hint = { key: key, text: text, at: Date.now(), busy: false };
      draw(ctxRef || ctx);
    });
  }

  function hintHtml(ctx, p) {
    if (!p || !hint.text || hint.key !== p[0] + ',' + p[1]) return '';
    return '<div id="stormhint" class="stormhint muted">' + ctx.esc(hint.text) + '</div>';
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
    var hp = hintPoint(S, ctx.canRun ? liveRoutes(S) : mine);
    ensureHint(ctx, hp);
    var html = '<div id="stormhead" class="stormhead' + (loaded && st.open ? ' open' : '') + '" role="status">' + ctx.esc(headText(st)) + '</div>' + hintHtml(ctx, hp);
    if (ctx.canRun) {
      // Matt and the leads: the live view, and a route opens as the crew see it.
      var live = liveRoutes(S), opened = openRoute && live.filter(function (r) { return r.id === openRoute; })[0];
      if (opened) {
        html += '<div class="row"><button id="liveBack" class="small">‹ Live view</button></div>' + routeHtml(ctx, opened, states);
      } else {
        // A route that vanished (archived meanwhile) takes its Back step with it.
        if (openRoute) { openRoute = null; if (ctx.syncHistory) ctx.syncHistory(); }
        html += controlsHtml(ctx, st) + problemsHtml(ctx, states) +
          (live.map(function (r) { return liveRouteHtml(ctx, r, st, states); }).join('') || '<p class="muted">No routes yet. Add them on the Routes tab.</p>');
      }
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
    delete warnNow[key]; // from here the saved row carries the warning, or nothing was saved
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
    // Treated while it is Snowing: warn at once, and send it anyway. The server
    // records snowing_warned on the row, which keeps the warning after the save.
    if (state === 'treated' && !inflight[key] && CrewShiftLog.stormState(ctx.S.storms).snowing) {
      warnNow[key] = true;
      var row = findBy('[data-walkrow]', 'data-walkrow', key);
      if (row && !row.querySelector('[data-warn]')) row.insertAdjacentHTML('beforeend', warnHtml(ctx, key));
    }
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
      if (ctx.markMap) ctx.markMap(); // a map left open shows the new taps
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
    openRoute = null; stormBusy = false; stormErr = ''; warnNow = {};
    hint = { key: '', text: null, at: 0, busy: false };
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

  // The route opened from the live view (null = the live view). app.js asks
  // routeOpen() to build the Back stack, and calls closeRoute() when Back pops
  // it or the tab changes.
  function routeOpen() { return openRoute !== null; }
  function closeRoute(ctx) {
    if (openRoute === null) return;
    openRoute = null;
    if (ctx) draw(ctx);
  }

  // ---------- storm controls (Matt and the leads) ----------
  // One request in flight for all of them: a double tap, or End on top of a
  // slow Start, finds the guard up and does nothing. The server stamps who and
  // when from the token; the phone sends only the kind.
  async function stormRun(ctx, kind) {
    if (stormBusy || !ctx.canRun) return;
    stormBusy = true;
    stormErr = '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-storm]'), function (b) { b.classList.add('pending'); b.setAttribute('aria-busy', 'true'); });
    var g = gen, r;
    try { r = await ctx.call('stormAction', { kind: kind }); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== gen) return; // signed out meanwhile; reset() already cleared everything
    stormBusy = false;
    if (r.ok) {
      ctx.S.storms = mergeRows(ctx.S.storms, [r.record]);
      return draw(ctx);
    }
    if (r.code === 'signin') return ctx.signedOut(r.reason);
    stormErr = 'Not saved: ' + (r.code === 'network' ? 'no signal' : (r.reason || 'try again'));
    draw(ctx);
    // A refusal means the phone's picture is out of date (someone else started or ended it).
    if (r.code === 'invalid' || r.code === 'conflict') poll(ctx);
  }

  // Start and End each throw away or stop the crew's work: ask first. The
  // dialog is the app's own (never window.confirm).
  function confirmStorm(ctx, kind) {
    var start = kind === 'start';
    ctx.$('dlgIn').innerHTML = '<h2>' + (start ? 'Start a new storm?' : 'End the storm?') + '</h2><p>Are you sure?</p>' +
      '<p class="muted">' + (start ? 'Every walk goes back to not done. Nothing already logged is deleted.' : 'The crew can no longer mark walks until it is reopened.') + '</p>' +
      '<div class="row"><button id="sc_yes" class="primary">' + (start ? 'Yes, start storm' : 'Yes, end storm') + '</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    ctx.$('sc_yes').onclick = function () { ctx.closeDialog(); stormRun(ctx, kind); };
  }

  // Storm-tab clicks. Returns true when handled.
  function onClick(ev, ctx) {
    if (ctx.S.tab !== 'storm') return false;
    ctxRef = ctx;
    var t = ev.target, el, key;
    if (ctx.canRun) {
      if ((el = t.closest('[data-storm]'))) {
        if (stormBusy) return true;
        if (el.dataset.storm === 'start' || el.dataset.storm === 'end') confirmStorm(ctx, el.dataset.storm); else stormRun(ctx, el.dataset.storm);
        return true;
      }
      // An open route is a step on the phone's Back stack (app.js wantedSteps): Back
      // returns to the live view instead of leaving the app mid-storm.
      if ((el = t.closest('[data-openroute]'))) { openRoute = el.dataset.openroute; draw(ctx); ctx.syncHistory(); window.scrollTo(0, 0); return true; }
      if (t.closest('#liveBack')) { closeRoute(ctx); ctx.syncHistory(); return true; }
    }
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

  return { render: function (ctx) { ctxRef = ctx; draw(ctx); }, poll: poll, start: start, stop: stop, reset: reset, onClick: onClick, routeOpen: routeOpen, closeRoute: closeRoute,
    mergeRows: mergeRows,
    // What this phone holds, for tests: rows, cursor and last-seq per tab.
    state: function () { var S = ctxRef && ctxRef.S; return S ? { log: S.log, storms: S.storms, visits: S.visits, cursor: S.cursor, last: S.last } : null; } };
})();
if (typeof window !== 'undefined') window.SnowShiftUI = SnowShiftUI;
