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
  // Trucks come to everyone (the crew see them); Sheets rows only to Matt's phone (the server sends
  // everyone else []). Both ride the same cursor as the other tabs. So do the Posts (Matt's only, slimmed),
  // but they carry no seq: S.posts is kept apart from these seq-merged tabs (see pull()).
  var INTERVAL = 20000, TABS = ['log', 'storms', 'visits', 'trucks', 'sheets'];
  var timer = null, ctxRef = null, polling = false, gen = 0, loaded = false, unreachable = false;
  var inflight = {}, failed = {}, noteOpen = {}, drafts = {}, showOthers = false;
  // Matt and the leads: the route open from the live view (null = the live view
  // itself), one storm control in flight at a time, and the last refusal.
  var openRoute = null, stormBusy = false, stormErr = '', warnNow = {};
  // The site opened from the handoff card's Left by night list (null = none), for everyone. It is the
  // same Back step as a route opened from the live view (routeOpen); the two are never open together.
  var openSite = null;
  // Hand off now goes through run() on this key, as Clean again goes on a site's '*' key.
  var HANDOFF_KEY = '*handoff';
  // Route sheets: what is typed in a truck box (kept across redraws until it is saved), a save in
  // flight per route, the last refusal per route; the Print view; Matt's Retry and its message.
  // pickedShift: the shift Matt picked for his Board's trucks when nothing was posted (asked once).
  var truckDrafts = {}, truckBusy = {}, truckErr = {}, printing = false, retryBusy = false, sheetsMsg = '', pickedShift = null;
  // The forecast hint (lib/weather.js): one per screen, asked for at most once
  // every 15 minutes whatever the number of redraws and polls, and for a point
  // only. Failure or no answer is no hint, and nothing else on the screen changes.
  var HINT_EVERY = 15 * 60 * 1000;
  var hint = { key: '', text: null, at: 0, busy: false };
  // Callouts (Part B2, Matt 10/4/26): the NWS gridpoint snowfall behind the new-snow estimate. One
  // fetch per distinct point (2 dp), kept 30 minutes whatever the redraws and polls; a failure (null)
  // is kept too, so a failing service is not hammered. Only Matt's and the Board leads' phones ask,
  // only while a storm is open, and only for sites with a callout set.
  var SNOW_EVERY = 30 * 60 * 1000;
  var snowfall = {}; // 'lat,lon' -> { series: [...] | null, at: ms, busy }
  // The snow map (lib/snowmap.js, Matt 10/6/26): open or closed (null = not chosen: open on a wide
  // screen), one MapLibre map kept across redraws (its box is moved back into the page after each
  // draw), the points it was built for, and the NWS fetches queued 150 ms apart.
  var showMap = null, mapHost = null, mapObj = null, mapKey = '', mapOpening = false, mapQueue = null;
  var FETCH_GAP = 150;
  // The post (who is on which route) and the zones (which walks a site has) change
  // under an open Storm tab too: Matt re-posts, or draws a site's first zone mid-storm.
  // The post is read on entering the tab, every 3rd tick (~60 s) and back on screen;
  // the zones back on screen and when the server refuses a walk the phone still shows.
  var POST_EVERY = 3, ticks = 0, postBusy = false, zonesBusy = false;
  var NOT_WALKED = 'That zone is not walked at this site'; // Code.js tapZone_, word for word

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

  // Where this phone's person stands on tonight's posted Board (Part A, Matt
  // 10/4/26): 'admin', 'lead', 'member', null (a fresh post that does not list
  // them: read-only), or 'unposted' (no fresh post: the phone cannot see the
  // live Board, so it offers the buttons and the server decides).
  function standing(S) {
    if (!S.me) return null;
    if (S.me.role === 'admin') return 'admin';
    var post = S.post, me = S.me.crew_id;
    if (!post || CrewTime.isStale(post.shift, nowIso())) return 'unposted';
    var r = (post.routes || []).filter(function (x) { return x.lead === me || (x.members || []).indexOf(me) !== -1; })[0];
    return !me || !r ? null : r.lead === me ? 'lead' : 'member';
  }
  var readOnly = false; // set by draw(): off the posted Board
  // Worked out from the current post every time, never cached: the 60 s post
  // check can make someone a lead (or stop them being one) mid-session.
  function canRunNow(ctx) { var S = ctx.S; return !!S.me && (S.me.role === 'admin' || standing(S) === 'lead'); }

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
    return st.open ? 'Storm open · ' + (st.snowing ? 'Snowing' : 'Snow stopped') : 'No storm open';
  }

  // ---------- trucks ----------
  // The truck for a route and shift is the newest Trucks row (higher seq wins); with none, the one
  // the post carries for that same shift; with neither, blank (it prints as a dash, never a guess).
  function truckFor(S, routeId, shiftId) {
    var best = null, post = S.post, slot = null;
    (S.trucks || []).forEach(function (t) {
      if (t.route_id === routeId && t.shift_id === shiftId && (!best || Number(t.seq) > Number(best.seq))) best = t;
    });
    if (best && String(best.truck || '').trim() !== '') return String(best.truck);
    if (post && post.shift === shiftId) slot = (post.routes || []).filter(function (r) { return r.id === routeId; })[0];
    return slot && slot.truck ? String(slot.truck) : '';
  }

  // Which shift a truck is for (final review C1). Matt sets trucks ahead, in the afternoon, for the night
  // he is about to post, while the shift RUNNING is still the day. So the shift is the current post's (not
  // stale); with no current post, the one Matt picked for his Board (asked once); else none yet. The
  // Board sends it, and the Board, Tonight, the live view and a lead's route all SHOW that same shift's
  // truck (with nothing posted or picked: the shift running), so a saved truck never blanks.
  function postShift(S) { var p = S.post; return p && !CrewTime.isStale(p.shift, nowIso()) ? p.shift : null; }
  // 10/4/26: in the afternoon the DAY post is still current while Matt plans TONIGHT, so "the post's shift"
  // filed his trucks under the day. When a LATER shift is on offer, the post's shift is no longer a safe
  // guess: use the shift he picked (still on offer, at or after the post's), else none, and Save asks
  // Day or Night. With nothing later on offer, the post's shift is the only sensible one. The pick lasts
  // until reload, never stored.
  function boardShift(S) {
    var ps = postShift(S), now = nowIso(), offer = CrewTime.shiftChoices(now);
    if (!ps) return pickedShift && !CrewTime.isStale(pickedShift, now) ? pickedShift : null;
    var later = offer.some(function (id) { return CrewTime.shiftKey(id) > CrewTime.shiftKey(ps); });
    if (!later) return ps;
    return pickedShift && offer.indexOf(pickedShift) !== -1 && CrewTime.shiftKey(pickedShift) >= CrewTime.shiftKey(ps) ? pickedShift : null;
  }
  // Change (the Board's #truckchange): the pick, offered from the post's shift on.
  function setPickedShift(s) { pickedShift = s; }
  function shownShift(S) { return boardShift(S) || dayShift(S); }

  // A lead changes the truck of the route the post has them leading, and no other. (The server checks
  // the live Board, and says so if the two disagree.) Crew never; Matt sets them on the Board.
  // A lead's truck is always filed under the shift RUNNING (the server's), so the box is offered only
  // while the posted shift is the one running: a post for tonight, read at 4 PM, shows tonight's truck
  // read-only (Matt's to set), instead of a box whose save would land on the day.
  function canSetTruck(S, routeId) {
    var me = S.me && S.me.crew_id, post = S.post;
    if (!S.me || !me || !post || CrewTime.isStale(post.shift, nowIso())) return false; // the Board, not the roster flag
    if (post.shift !== dayShift(S)) return false;
    var slot = (post.routes || []).filter(function (r) { return r.id === routeId; })[0];
    return !!slot && slot.lead === me;
  }

  // One truck line per route: read-only text, or (edit) a box and Save. Used by the Storm tab and Matt's
  // Board. The shift shown is shownShift() unless one is named (Tonight names its post's).
  function truckHtml(ctx, routeId, edit, shiftId) {
    var S = ctx.S, esc = ctx.esc, id = esc(routeId), cur = truckFor(S, routeId, shiftId === undefined ? shownShift(S) : shiftId);
    if (!edit) return '<div class="truckrow" data-truckrow="' + id + '">Truck: <b>' + (cur ? esc(cur) : '—') + '</b></div>';
    var val = truckDrafts[routeId] !== undefined ? truckDrafts[routeId] : cur;
    return '<div class="truckrow edit" data-truckrow="' + id + '"><label>Truck <input data-truckinput="' + id + '" maxlength="20" autocomplete="off" value="' + esc(val) + '"></label>' +
      '<button class="small" data-settruck="' + id + '"' + (truckBusy[routeId] ? ' disabled aria-busy="true"' : '') + '>Save</button>' +
      (truckErr[routeId] ? '<div class="err" role="alert">' + esc(truckErr[routeId]) + '</div>' : '') + '</div>';
  }

  // Redraw whichever screen the box is on. The Storm tab's own draw leaves an open map alone.
  function redraw(ctx) {
    if (ctx.S.tab === 'storm') draw(ctx);
    else if (ctx.S.tab === 'board') ctx.render();
  }

  async function saveTruck(ctx, routeId) {
    if (truckBusy[routeId]) return;
    var box = findBy('[data-truckinput]', 'data-truckinput', routeId);
    var value = String(box ? box.value : (truckDrafts[routeId] || '')).trim();
    if (value === '') { truckErr[routeId] = 'Type the truck first'; return redraw(ctx); }
    // Matt names the shift (the server refuses his truck without one on offer now): the current post's,
    // else the one he picked. Nothing posted and nothing picked: ask once, with the Post's own picker.
    // A lead sends none: theirs is always the shift running, the server's.
    var payload = { route_id: routeId, truck: value };
    if (ctx.S.me && ctx.S.me.role === 'admin') {
      payload.shift = boardShift(ctx.S);
      if (!payload.shift) {
        truckDrafts[routeId] = value;
        return SnowBoardUI.pickShift(ctx, 'Trucks for which shift?', function (s) { pickedShift = s; saveTruck(ctx, routeId); }, postShift(ctx.S));
      }
    }
    truckBusy[routeId] = true;
    delete truckErr[routeId];
    var btn = findBy('[data-settruck]', 'data-settruck', routeId);
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    var g = gen, r;
    // The route, the truck and (Matt) the shift: the server stamps who set it and when.
    try { r = await ctx.call('setTruck', payload); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== gen) return; // signed out meanwhile; reset() already cleared everything
    delete truckBusy[routeId];
    if (r.ok) {
      ctx.S.trucks = mergeRows(ctx.S.trucks, [r.record]);
      delete truckDrafts[routeId];
      if (ctx.toast) ctx.toast('Truck saved');
      return redraw(ctx);
    }
    if (r.code === 'signin') return ctx.signedOut(r.reason);
    truckErr[routeId] = 'Not saved: ' + (r.code === 'network' ? 'no signal' : (r.reason || 'try again'));
    redraw(ctx);
  }

  // What is typed survives a redraw (a poll can land mid-typing), and Enter saves.
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t && t.dataset && t.dataset.truckinput !== undefined) truckDrafts[t.dataset.truckinput] = t.value;
  });
  // Enter in a truck box (app.js hands every keydown here with its ctx, as it does clicks): it must work
  // on the Board even if the Storm tab was never drawn, so it never leans on ctxRef.
  function onKeydown(ev, ctx) {
    var t = ev.target;
    if (ev.key !== 'Enter' || !t || !t.dataset || t.dataset.truckinput === undefined) return false;
    if (ctx.S.tab !== 'storm' && ctx.S.tab !== 'board') return false;
    // preventDefault: Save may open the shift picker, whose first button takes focus; without this the
    // same Enter's keypress lands on it and picks the earliest shift: the silent guess Matt does not want.
    ev.preventDefault();
    saveTruck(ctx, t.dataset.truckinput);
    return true;
  }

  // On Matt's Board: a poll that lands puts the newest trucks in the boxes, but never over what is being
  // typed (a box with focus, or a draft not yet saved) or a save on its way.
  function refreshBoardTrucks(ctx) {
    var S = ctx.S;
    if (S.tab !== 'board') return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-truckinput]'), function (box) {
      var id = box.getAttribute('data-truckinput');
      if (box === document.activeElement || truckDrafts[id] !== undefined || truckBusy[id]) return;
      box.value = truckFor(S, id, shownShift(S));
    });
  }

  // ---------- Sheets status (Matt) ----------
  var MAKING_MS = 10 * 60 * 1000;
  // Every Sheets row belongs to one set (handoff sheets, 10/5/26): one End's or one handoff's, named by
  // made_for and for_seq. A row from before then has neither: it is its End's, for_seq its end_seq. kind
  // is 'route' (a route sheet) or 'day' (a day handoff sheet); a row from before then is a route sheet.
  // Take each row's name as given: the server can add " (2)" to it.
  function madeFor(r) { return r.made_for || 'end'; }
  function forSeq(r) { return Number(r.made_for ? r.for_seq : r.end_seq); }
  function sheetKind(r) { return r.kind || 'route'; }
  // The newest row per sheet (a Retry adds a row; it never edits one) among the storm's rows keep() takes.
  function newestSheets(S, stormId, keep) {
    var newest = {};
    (S.sheets || []).forEach(function (r) {
      if (r.storm_id !== stormId || !keep(r)) return;
      var k = sheetKind(r) + '|' + r.route_id + '|' + r.shift_id;
      if (!newest[k] || Number(r.seq) > Number(newest[k].seq)) newest[k] = r;
    });
    return newest;
  }
  // Ten minutes after the row that queued them, sheets still missing are not "being made": the job never
  // ran, or died part way. Retry is offered then (the server counts what is owed from the rows).
  function lateSince(at) { return Date.parse(nowIso()) - Date.parse(at) >= MAKING_MS; }

  // The sheets a handoff's set holds, by the server's own rule (snow-app-script Code.js handoffJobs_), in the
  // keys newestSheets makes: its night route sheets (CrewHandoff.nightSheets: the shared rule, the handoff
  // moment on its frozen night_routes) and its day sheets, one per crewed day route of the handoff moment
  // (CrewHandoff.handoffData of CrewHandoff.snapshot), or the one left-by-night sheet (route '') when there is
  // none or the day part cannot be worked out, as the server makes it. Throws when the night part cannot be.
  // Only Matt's phone asks (his rows carry truck_seq; his poll carries every Post, with posted_at).
  function handoffSet(S, st, h) {
    var o = sheetOpts(S, st), keys = {}, nights = CrewHandoff.nightSheets(o, h), dayIds = [];
    nights.forEach(function (p) { keys['route|' + p.route_id + '|' + p.shift_id] = true; });
    try { dayIds = CrewHandoff.handoffData(CrewHandoff.snapshot(o, h), h).dayRoutes.map(function (r) { return r.route_id; }); }
    catch (e) { dayIds = []; }
    if (!dayIds.length) dayIds = [''];
    var dayShift = CrewHandoff.dayShiftOf(h.shift_id);
    dayIds.forEach(function (id) { keys['day|' + id + '|' + dayShift] = true; });
    return { nights: nights.length, keys: keys };
  }

  // While the storm is open: the newest handoff's set (rows made_for 'handoff', for_seq its seq). The count
  // Matt reads is the night's route sheets, held against the night sheets the handoff owes (as the End's
  // "k of M"); a failed sheet of either kind is "not saved", with Retry (the server retries an open storm's
  // handoff set). No row yet: the job has not got to it, making. Day sheets are not counted against a total.
  // Only a sheet still in the set counts (final review M3, 10/5/26): the server owes only those (owedIn_), so a
  // failed row for a route archived since, or a left-by-night row from a run that could not work out the day
  // routes, would show a Retry the server can only answer "That storm is open". When the set cannot be worked out
  // on this phone, every row counts (the server, which cannot work it out either, takes that set's Retry).
  function handoffStatus(S, st) {
    if (typeof CrewHandoff === 'undefined') return null; // lib/handoff.js missing: no line, as with no handoff
    var h = CrewHandoff.newestHandoff(S.storms, st.storm_id);
    if (!h) return null;
    var newest = newestSheets(S, st.storm_id, function (r) { return madeFor(r) === 'handoff' && forSeq(r) === Number(h.seq); });
    var keys = Object.keys(newest), nights = 0, failed = 0, late = lateSince(h.at), set = null;
    if (!keys.length) return { text: 'Handoff sheets: making…', retry: late };
    try { set = handoffSet(S, st, h); } catch (e) { set = null; }
    keys.forEach(function (k) {
      if (set && !set.keys[k]) return;
      if (newest[k].status !== 'saved') failed++;
      else if (sheetKind(newest[k]) === 'route') nights++;
    });
    if (failed) return { text: 'Handoff sheets: ' + failed + ' not saved', retry: true };
    if (set && nights < set.nights) {
      var of = 'Handoff sheets: ' + nights + ' of ' + set.nights + ' saved';
      return late ? { text: of, retry: true } : { text: of + ' · making…', retry: false };
    }
    return { text: 'Night sheets saved at handoff ' + CrewRouteSheet.clock(h.at) + ' (' + nights + ')', retry: false };
  }

  // Once the storm is closed, only the newest End counts: a sheet from an earlier End is an older set. Of
  // the rows for that End, the newest per sheet is the one that stands. No row yet = making.
  function sheetsStatus(S, st) {
    if (!st.storm_id) return null;
    if (st.open) return handoffStatus(S, st);
    var ends = (S.storms || []).filter(function (r) { return r.storm_id === st.storm_id && r.kind === 'end'; });
    if (!ends.length) return null;
    var endSeq = Math.max.apply(null, ends.map(function (r) { return Number(r.seq); }));
    var newest = newestSheets(S, st.storm_id, function (r) { return madeFor(r) === 'end' && forSeq(r) === endSeq; });
    var saved = 0, failed = 0;
    var end = ends.filter(function (r) { return Number(r.seq) === endSeq; })[0];
    var late = lateSince(end.at);
    // Saved rows alone can hide a sheet that was never made (a run cut short): compare with the sheets
    // this phone expects, the same list the Print view builds.
    var pairs = null;
    try { pairs = CrewRouteSheet.sheetsFor(sheetOpts(S, st)); } catch (e) { pairs = null; }
    var expected = pairs ? pairs.length : null;
    // A night a handoff saved is not made again at Close unless it changed after the handoff (the server's
    // rule), so the End may write no row for it. An expected sheet with no End row stands on the newest
    // handoff copy of that route and night, from any handoff of the storm.
    if (pairs) {
      var copies = newestSheets(S, st.storm_id, function (r) { return madeFor(r) === 'handoff' && sheetKind(r) === 'route'; });
      pairs.forEach(function (p) {
        var k = 'route|' + p.route_id + '|' + p.shift_id;
        if (!newest[k] && copies[k]) newest[k] = copies[k];
      });
    }
    Object.keys(newest).forEach(function (k) { if (newest[k].status === 'saved') saved++; else failed++; });
    if (!Object.keys(newest).length) {
      // Nothing was tapped, carded or posted: no sheet is owed and the job writes no row. Saying
      // "making…" (and later Retry, which can only answer "Nothing to retry") would wait forever.
      if (expected === 0) return { text: 'Sheets: none (nothing logged)', retry: false };
      return { text: 'Sheets: making…', retry: late };
    }
    if (failed) return { text: 'Sheets: ' + failed + ' not saved', retry: true };
    if (expected !== null && saved < expected) {
      var of = 'Sheets: ' + saved + ' of ' + expected + ' saved';
      return late ? { text: of, retry: true } : { text: of + ' · making…', retry: false };
    }
    return { text: 'Sheets: ' + saved + ' saved', retry: false };
  }

  // What the sheets are built from: the phone's own rows, and every Post (final review I1): an earlier
  // shift's crew line comes from THAT shift's Post, as in the PDF. Matt's poll brings them all (S.posts,
  // slimmed); the post he just made, not polled yet, is added from S.post. With none polled, the newest.
  function postsFor(S) {
    var list = (S.posts || []).slice();
    if (S.post && !list.some(function (p) { return p.id === S.post.id; })) list.push(S.post);
    return list;
  }
  function sheetOpts(S, st) {
    return { storm_id: st.storm_id, routes: S.routes, sites: S.sites, zones: S.zones, crew: S.crew, log: S.log, visits: S.visits,
      posts: postsFor(S), moves: S.moves || [], trucks: S.trucks || [], storms: S.storms };
  }

  function sheetsHtml(ctx, st) {
    var S = ctx.S, s = S.me && S.me.role === 'admin' ? sheetsStatus(S, st) : null;
    if (!s) return '';
    if (!s.retry) sheetsMsg = ''; // a Retry's answer is about failed sheets; none are left
    return '<div id="sheetsstatus" class="sheetsstatus" role="status"><span>' + ctx.esc(s.text) + (s.retry ? ' ·' : '') + '</span>' +
      (s.retry ? ' <button id="retrySheets" class="small"' + (retryBusy ? ' disabled aria-busy="true"' : '') + '>Retry</button>' : '') + '</div>' +
      (sheetsMsg ? '<div id="sheetsmsg" class="muted" role="status">' + ctx.esc(sheetsMsg) + '</div>' : '');
  }

  async function retrySheets(ctx) {
    var st = CrewShiftLog.stormState(ctx.S.storms);
    if (retryBusy || !st.storm_id) return;
    retryBusy = true;
    var g = gen, r;
    try { r = await ctx.call('retrySheets', { storm_id: st.storm_id }); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== gen) return;
    retryBusy = false;
    if (r.ok) {
      sheetsMsg = r.running ? 'Sheets are being made now; your Retry is queued'
        : r.scheduled ? 'Retrying the sheets that were not saved. They are made in about a minute.' : 'Nothing to retry.';
    } else if (r.code === 'signin') return ctx.signedOut(r.reason);
    else sheetsMsg = 'Retry not sent: ' + (r.code === 'network' ? 'no signal' : (r.reason || 'try again'));
    draw(ctx);
  }

  // ---------- Print sheets ----------
  // Every sheet of the current or last storm, one per page, in an overlay on this page (never a new
  // window), then the phone's print. The sheets are built by CrewRouteSheet, the same file that makes
  // the PDFs in Drive, from what this phone holds. Back closes it (a step on the Back stack).
  // The sheet's stylesheet is written for a page of its own (a body rule, a bare *), so every rule is
  // put under #printsheets: it must not restyle the app.
  function scopeCss(css) {
    return String(css).replace(/(^|\})\s*([^{}@][^{}]*)\{/g, function (m, pre, sel) {
      return pre + '\n' + sel.split(',').map(function (s) {
        s = s.trim();
        return s === 'body' ? '#printsheets' : '#printsheets ' + s;
      }).join(', ') + ' {';
    });
  }

  // Print is Matt's (the spec: "Matt's live view"; final review I2). Only his phone holds every Post.
  function canPrint(S) { return !!S.me && S.me.role === 'admin'; }
  function printOpen() { return printing; }
  // body.printing scopes the @media print rule that hides the app (app.css): only while this view is open.
  function closePrint() {
    printing = false;
    document.body.classList.remove('printing');
    var box = document.getElementById('printview');
    if (box) box.remove();
  }

  // The day handoff sheets (10/5/26), after the route sheets: the storm's newest handoff, one sheet per
  // crewed day route, else the one left-by-night sheet, drawn by CrewHandoff.handoffHtml (the code that
  // makes the PDFs) from this phone's rows as they are now. Each page is that document's body, under the
  // name its PDF has; its stylesheet (the route sheet's plus the part headings) is handed back for the
  // view. lib/handoff.js missing or no handoff: none. broken counts the sheets left out: a page that throws
  // or comes back with no body is never printed as a bare name (null: the data itself could not be built).
  function handoffPages(ctx, o, stormId, madeAt) {
    var out = { pages: [], css: null, broken: 0 }, data, ids;
    if (typeof CrewHandoff === 'undefined') return out;
    try {
      var h = CrewHandoff.newestHandoff(o.storms, stormId);
      if (!h) return out;
      data = CrewHandoff.handoffData(o, h);
      ids = data.dayRoutes.length ? data.dayRoutes.map(function (r) { return r.route_id; }) : [null];
    } catch (e) { return { pages: [], css: null, broken: null }; }
    ids.forEach(function (id) {
      try {
        var html = String(CrewHandoff.handoffHtml(data, id, madeAt));
        var css = /<style>([\s\S]*?)<\/style>/.exec(html), body = /<body>([\s\S]*)<\/body>/.exec(html);
        if (!body) throw new Error('no page body');
        if (css) out.css = css[1];
        out.pages.push('<div class="printname">' + ctx.esc(CrewHandoff.fileName(data, id)) + '</div>' + body[1]);
      } catch (e) { out.broken++; }
    });
    return out;
  }

  function openPrint(ctx) {
    var S = ctx.S, st = CrewShiftLog.stormState(S.storms);
    if (printing || !canPrint(S) || !st.storm_id) return;
    var o = sheetOpts(S, st);
    var pages, madeAt = nowIso();
    try {
      pages = CrewRouteSheet.sheetsFor(o).map(function (p) {
        return CrewRouteSheet.sheetBody(CrewRouteSheet.sheetData(o, p.route_id, p.shift_id), madeAt, false);
      });
    } catch (e) { ctx.toast("The sheets couldn't be built on this phone. Try again."); return; }
    // The route sheets still print when the day handoff sheets cannot be built.
    var day = handoffPages(ctx, o, st.storm_id, madeAt);
    if (day.broken === null) ctx.toast("The day handoff sheets couldn't be built on this phone.");
    else if (day.broken) ctx.toast(day.broken + (day.broken === 1 ? ' day handoff sheet' : ' day handoff sheets') + " couldn't be built on this phone.");
    pages = pages.concat(day.pages);
    var style = document.getElementById('printstyle');
    if (!style) { style = document.createElement('style'); style.id = 'printstyle'; document.head.appendChild(style); }
    style.textContent = scopeCss(day.css || CrewRouteSheet.css);
    var box = document.createElement('div');
    box.id = 'printview';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Print sheets');
    box.innerHTML = '<div id="printbar"><button id="printBack" class="small">‹ Back</button>' +
      '<span class="muted">' + pages.length + (pages.length === 1 ? ' sheet' : ' sheets') + '</span>' +
      '<button id="printNow" class="primary">Print</button></div>' +
      '<div id="printsheets">' + (pages.join('\n') || '<p>No sheets yet: no route has a tap, a site card or a posted crew this storm.</p>') + '</div>';
    document.body.appendChild(box);
    document.body.classList.add('printing');
    printing = true;
    ctx.syncHistory();
    box.scrollTop = 0;
    if (pages.length) window.print();
  }

  function warnHtml(ctx, key) {
    return '<div class="walk-warn" data-warn="' + ctx.esc(key) + '" role="status">It\'s still snowing: treated anyway</div>';
  }

  function walkHtml(ctx, site, w, states) {
    var esc = ctx.esc, key = CrewShiftLog.walkKey(site.id, w.zone_id), row = states[key], f = failed[key];
    var html = '<div class="walk' + (inflight[key] ? ' pending' : '') + '" data-walkrow="' + esc(key) + '"' + (inflight[key] ? ' aria-busy="true"' : '') + '>' +
      '<div class="walk-name">' + esc(w.name) + (w.type === 'heated' ? ' <span class="muted">heated</span>' : '') + '</div>' +
      (readOnly ? '' : '<div class="walk-btns">' + CrewShiftLog.statesFor(w.type).map(function (s) {
        return '<button class="walkbtn s-' + s + '" data-walk="' + esc(key) + '" data-state="' + s + '" aria-pressed="' + (!!row && row.state === s) + '">' + stateLabel(s) + '</button>';
      }).join('') + '</div>');
    if (row) {
      html += '<div class="walk-last"><span>' + esc([stateLabel(row.state), row.by_name, clock(row.at)].filter(Boolean).join(' · ')) + '</span>' +
        (row.note ? '<span class="walk-note">— ' + esc(row.note) + '</span>' : '') +
        (readOnly ? '' : '<button class="small" data-undo="' + esc(row.seq) + '">Undo</button>') + '</div>';
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

  // Clean again (Part B1, Matt 10/4/26): the pass line under a site, with Undo for
  // Matt or a posted lead while nothing has been tapped since; a refusal shows here.
  function passHtml(ctx, site, st) {
    var S = ctx.S, esc = ctx.esc, f = failed[CrewShiftLog.walkKey(site.id, '*')], html = '';
    var info = st.storm_id ? CrewShiftLog.passInfo(S.log, st.storm_id, site.id) : { n: 1, again: null };
    if (info.n > 1 && info.again) {
      var canUndo = canRunNow(ctx) && !readOnly && CrewShiftLog.undoTarget(S.log, st.storm_id, info.again.seq).ok;
      html += '<div class="pass-line" data-passline="' + esc(site.id) + '"><span>' +
        esc('Pass ' + info.n + ' · Clean again ' + clock(info.again.at) + (info.again.by_name ? ' by ' + info.again.by_name : '')) + '</span>' +
        (canUndo ? '<button class="small" data-undo="' + esc(info.again.seq) + '">Undo</button>' : '') + '</div>';
    }
    return html + siteFailHtml(ctx, site.id, f);
  }

  // A Clean again or New snow that was not saved, under its site: Retry as a walk has (B2 review).
  function siteFailHtml(ctx, siteId, f) {
    if (!f) return '';
    return '<div class="err" role="alert">Not saved: ' + ctx.esc(f.reason) +
      (f.retry ? ' <button class="small" data-retry="' + ctx.esc(CrewShiftLog.walkKey(siteId, '*')) + '">Retry</button>' : '') + '</div>';
  }

  function confirmAgain(ctx, siteId) {
    var S = ctx.S, site = S.sites.filter(function (x) { return x.id === siteId; })[0], name = site ? site.name : siteId;
    var st = CrewShiftLog.stormState(S.storms), n = st.storm_id ? CrewShiftLog.passInfo(S.log, st.storm_id, siteId).n : 1;
    ctx.$('dlgIn').innerHTML = '<h2>' + ctx.esc('Clean ' + name + ' again?') + '</h2>' +
      '<p>' + ctx.esc('Every walk at ' + name + ' goes back to not done for pass ' + (n + 1) + '. Pass ' + n + ' stays on the record.') + '</p>' +
      '<p class="muted">' + ctx.esc('Copy for BT first if pass ' + n + " isn't posted yet.") + '</p>' +
      '<div class="row"><button id="ag_yes" class="primary">Yes, clean again</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    ctx.$('ag_yes').onclick = function () {
      ctx.closeDialog();
      run(ctx, CrewShiftLog.walkKey(siteId, '*'), { action: 'cleanAgain', payload: { site_id: siteId } });
    };
  }

  // New snow (Part B2, Matt 10/4/26): Matt or a lead measures the inches since the last cleaning.
  // Sent as a number through run(), on the site's '*' key as Clean again is: one in flight, and a
  // refusal shows under the site. A blank box is never sent (Number('') would be a reading of 0).
  function confirmDepth(ctx, siteId) {
    var S = ctx.S, site = S.sites.filter(function (x) { return x.id === siteId; })[0], name = site ? site.name : siteId;
    ctx.$('dlgIn').innerHTML = '<h2>' + ctx.esc('New snow at ' + name) + '</h2>' +
      '<label for="dn_in">Inches since the last cleaning</label>' +
      '<input id="dn_in" type="number" inputmode="decimal" min="0" step="any" autocomplete="off">' +
      '<div id="dn_err" class="err" role="alert"></div>' +
      '<div class="row"><button id="dn_save" class="primary">Save</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    ctx.$('dn_save').onclick = function () {
      var raw = String(ctx.$('dn_in').value).trim();
      if (raw === '') { ctx.$('dn_err').textContent = 'Type the inches first'; return; }
      ctx.closeDialog();
      run(ctx, CrewShiftLog.walkKey(siteId, '*'), { action: 'depthNow', payload: { site_id: siteId, depth_in: Number(raw) } });
    };
  }

  // The address beside a short site code (Matt, 10/4/26); a post's sites carry no address.
  function addrOf(ctx, siteId) {
    var s = ctx.S.sites.filter(function (x) { return x.id === siteId; })[0];
    return s && s.address ? ' <span class="muted site-addr">' + ctx.esc(s.address) + '</span>' : '';
  }

  function siteHtml(ctx, site, states) {
    var S = ctx.S, walks = CrewShiftLog.walksFor(site.id, S.zones), st = CrewShiftLog.stormState(S.storms);
    var full = S.sites.filter(function (x) { return x.id === site.id; })[0];
    return '<section class="card shift-site" data-shiftsite="' + ctx.esc(site.id) + '"><div class="route-top"><span class="site-name">' + ctx.esc(site.name) + addrOf(ctx, site.id) + '</span>' +
      '<span class="row tight"><button class="small" data-map="' + ctx.esc(site.id) + '">Map</button>' +
      (readOnly ? '' : '<button class="small" data-card="' + ctx.esc(site.id) + '">Site card</button>') +
      (canRunNow(ctx) ? '<button class="small" data-bt="' + ctx.esc(site.id) + '">Copy for BT</button>' : '') +
      (canRunNow(ctx) && st.open && !readOnly ? '<button class="small" data-again="' + ctx.esc(site.id) + '">Clean again</button>' : '') +
      (calloutsOn(ctx, st) && !readOnly && full && typeof full.callout_in === 'number' ? '<button class="small" data-depth="' + ctx.esc(site.id) + '">New snow</button>' : '') + '</span></div>' +
      passHtml(ctx, site, st) +
      walks.map(function (w) { return walkHtml(ctx, site, w, states); }).join('') + '</section>';
  }

  function routeHtml(ctx, r, states) {
    return '<h2 class="shift-route">' + ctx.esc(r.name) + (r.mine ? ' <span class="badge">Your route</span>' : '') + '</h2>' +
      truckHtml(ctx, r.id, canSetTruck(ctx.S, r.id)) +
      (inOrder(ctx.S, r.sites).map(function (s) { return siteHtml(ctx, s, states); }).join('') || '<p class="muted">No sites on this route.</p>');
  }

  // ---------- day order (Part B2, Matt 10/4/26) ----------
  // On day shift ranked sites come first (SnowCallout.rankOrder); night keeps route order. Worked out
  // on every draw from the clock, so the first draw after 9 AM re-orders the lists with no reload.
  // The paper route sheets are not touched: they keep route order.
  function siteMap(S) { var m = {}; (S.sites || []).forEach(function (s) { m[s.id] = s; }); return m; }
  function isDay(S) { return CrewShiftLog.shiftFor(nowIso(), S.storms).indexOf('day-') === 0; }
  function inOrder(S, sites) {
    var byId = {};
    // lib/callout.js missing (a cut-off load): route order, never a broken tab.
    if (typeof SnowCallout === 'undefined') return sites.slice();
    sites.forEach(function (s) { byId[s.id] = s; });
    return SnowCallout.rankOrder(sites.map(function (s) { return s.id; }), siteMap(S), isDay(S)).map(function (id) { return byId[id]; });
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
  // With no current post, Matt's phone (the only one that holds the Board)
  // shows the Board instead, marked as not posted (Matt, 10/3/26).
  function whoOn(S, routeId) {
    var post = S.post;
    if (!post || CrewTime.isStale(post.shift, nowIso())) return S.me && S.me.role === 'admin' ? onBoard(S, routeId) : '';
    var r = (post.routes || []).filter(function (x) { return x.id === routeId; })[0];
    if (!r) return '';
    var people = post.people || {};
    function nm(id) { return (people[id] && people[id].name) || id; }
    return (r.lead ? [nm(r.lead) + ' (lead)'] : []).concat((r.members || []).map(nm)).join(', ');
  }

  function onBoard(S, routeId) {
    var slot = SnowBoardUI.board(S).routes[routeId];
    if (!slot || (!slot.lead && !slot.members.length)) return '';
    function nm(id) { var w = S.crew.filter(function (c) { return c.id === id; })[0]; return w ? w.name : id; }
    return 'Board, not posted yet: ' + (slot.lead ? [nm(slot.lead) + ' (lead)'] : []).concat(slot.members.map(nm)).join(', ');
  }

  // Open Problems, by the one rule the day handoff sheet also uses (CrewShiftLog.openProblems):
  // an open Problem from an earlier pass is carried, marked with its pass, until someone taps
  // that walk in the new pass (Matt, 10/4/26): Clean again never hides it. Newest first.
  function problemsHtml(ctx, states) {
    var S = ctx.S, esc = ctx.esc;
    var st = CrewShiftLog.stormState(S.storms), found = [], siteIds = {};
    if (st.storm_id) S.log.forEach(function (r) { if (r.storm_id === st.storm_id) siteIds[r.site_id] = true; });
    Object.keys(siteIds).forEach(function (id) { found = found.concat(CrewShiftLog.openProblems(S.log, st.storm_id, id, states)); });
    found.sort(function (a, b) { return Number(b.row.seq) - Number(a.row.seq); });
    if (!found.length) return '';
    var siteName = {};
    S.sites.forEach(function (s) { siteName[s.id] = s.name; });
    return '<section id="problems" class="card problems"><h2>Problems (' + found.length + ')</h2><ul>' + found.map(function (p) {
      var r = p.row;
      return '<li data-problem="' + esc(CrewShiftLog.walkKey(r.site_id, r.zone_id)) + '"><div><b>' + esc(siteName[r.site_id] || r.site_id) + '</b> · ' +
        esc(CrewShiftLog.zoneName(r.site_id, r.zone_id, S.zones)) + '</div><div class="problem-note">' + esc(r.note) + '</div>' +
        '<div class="muted">' + esc([r.by_name, clock(r.at), p.pass ? '(pass ' + p.pass + ')' : ''].filter(Boolean).join(' · ')) + '</div></li>';
    }).join('') + '</ul></section>';
  }

  // ---------- the summary line (live window, Matt 10/6/26) ----------
  // One line at the top of the live view: sites done, open Problems, callouts, the newest real tap,
  // routes with a tap. The numbers are lib/livesum.js's (shared with its node test); the words are here.
  function livesumHtml(ctx, st, states, calloutCount) {
    var S = ctx.S, esc = ctx.esc;
    if (typeof SnowLiveSum === 'undefined') return ''; // lib/livesum.js missing (a cut-off load): no line, never a broken view
    var routes = liveRoutes(S).map(function (r) { return { id: r.id, siteIds: r.sites.map(function (s) { return s.id; }) }; });
    var s = SnowLiveSum.liveSummary({ routes: routes, zones: S.zones, log: S.log, stormId: st.open ? st.storm_id : null, states: states });
    var parts;
    if (!st.open) parts = ['No storm open', s.sitesTotal + ' sites on ' + s.routesTotal + ' routes'];
    else {
      parts = [s.sitesDone + ' of ' + s.sitesTotal + ' sites done', s.problems + (s.problems === 1 ? ' problem' : ' problems')];
      if (calloutCount) parts.push(calloutCount + (calloutCount === 1 ? ' callout' : ' callouts'));
      parts.push(s.lastTapAt ? 'last tap ' + clock(s.lastTapAt) : 'no taps yet', s.routesStarted + ' of ' + s.routesTotal + ' routes started');
    }
    return '<div id="livesum" class="livesum" role="status">' + parts.map(esc).join(' · ') + '</div>';
  }

  // ---------- the snow map (Matt, 10/6/26) ----------
  // A dot per site over a plain map of Anchorage: the next 12 hours' forecast snowfall as the
  // colour (the Callouts' NWS series, through the same 30-minute gate), the crews' measured depths
  // as the label, as they come in with the poll. Matt and the Board leads, on the live view.
  function mapOn() { return showMap === null ? (typeof window !== 'undefined' && window.innerWidth >= 1000) : showMap; }
  var LEGEND = [['nofc', 'no forecast'], ['none', 'none'], ['light', 'under 1"'], ['mid', '1-3"'], ['heavy', '3-6"'], ['severe', '6"+']];

  function snowMapHtml(ctx, st) {
    if (typeof SnowMapOverview === 'undefined') return ''; // lib/snowmap.js missing (a cut-off load): no card, never a broken view
    var on = mapOn(), pts = SnowMapOverview.pointsFor(ctx.S.sites, ctx.S.zones);
    var legend = LEGEND.map(function (l) { return '<span><i class="' + l[0] + '"></i>' + l[1] + '</span>'; }).join('');
    return '<section class="card" id="snowmapcard"><div class="row"><h2>Snow map</h2>' +
      '<button id="snowmaptoggle" class="small" aria-expanded="' + on + '">' + (on ? 'Hide map' : 'Snow map') + '</button></div>' +
      (on ? '<div id="snowmapslot"></div><div id="snowmapinfo" class="muted">Tap a dot.</div><div class="snowmapfoot muted">' + legend +
        (pts.missing.length ? '<span id="snowmapmissing">' + pts.missing.length + (pts.missing.length === 1 ? ' site' : ' sites') + ' not mapped yet</span>' : '') + '</div>' : '') +
      '</section>';
  }

  // What each dot shows now: colour from the forecast, label from a measured depth or the forecast,
  // and the words a tap brings up.
  function dotsFor(ctx, st, states, points) {
    var S = ctx.S, now = Date.now(), dots = {};
    var measured = SnowMapOverview.measuredDepths(S.log, S.visits, st.open ? st.storm_id : null);
    points.forEach(function (p) {
      var c = snowfall[pointKey([p.lat, p.lon])];
      var fc = c && c.series ? SnowMapOverview.forecastInches(c.series, now, SnowMapOverview.HOURS) : null;
      var m = measured[p.id] || null;
      var words = [p.name + (p.address ? ' · ' + p.address : ''),
        fc === null ? 'No forecast' : 'Forecast ~' + fc.toFixed(1) + '" next ' + SnowMapOverview.HOURS + ' h',
        m ? 'Measured ' + m.inches.toFixed(1) + '" at ' + clock(m.at) + (m.by_name ? ' by ' + m.by_name : '') : 'No reading yet',
        st.open ? SnowMapOverview.siteStatus(p.id, S.zones, states) : 'No storm open'].join(' · ');
      dots[p.id] = { step: SnowMapOverview.dotStep(fc), label: SnowMapOverview.dotLabel(fc, m, clock), measured: !!m, words: words };
    });
    return dots;
  }

  // The NWS, one point at a time, FETCH_GAP apart, through ensureSnowfall's 30-minute gate: the first
  // right away, the rest queued. A point already asked (or asked and failed) inside the gate is skipped.
  function scheduleSnowfall(ctx, points) {
    if (mapQueue) return;
    var todo = [], seen = {};
    points.forEach(function (p) {
      var key = pointKey([p.lat, p.lon]), c = snowfall[key];
      if (seen[key] || (c && (c.busy || Date.now() - c.at < SNOW_EVERY))) return;
      seen[key] = true;
      todo.push([p.lat, p.lon]);
    });
    if (!todo.length) return;
    ensureSnowfall(ctx, todo[0]);
    if (todo.length === 1) return;
    var g = gen, i = 1;
    mapQueue = setInterval(function () {
      if (g !== gen || i >= todo.length) { clearInterval(mapQueue); mapQueue = null; return; }
      ensureSnowfall(ctx, todo[i++]);
    }, FETCH_GAP);
  }

  // After every draw: put the map's box back into the page, open the map if there is none for these
  // points, and set the dots. Nothing to mount when the card is closed or not on the screen.
  function mountSnowMap(ctx, st, states) {
    var slot = document.getElementById('snowmapslot');
    if (!slot || typeof SnowMapOverview === 'undefined') return;
    var pts = SnowMapOverview.pointsFor(ctx.S.sites, ctx.S.zones);
    var key = JSON.stringify(pts.points.map(function (p) { return [p.id, p.lat, p.lon]; }));
    if (!mapHost) { mapHost = document.createElement('div'); mapHost.id = 'snowmapbox'; }
    slot.appendChild(mapHost);
    scheduleSnowfall(ctx, pts.points);
    if (mapObj && mapKey === key) {
      try { mapObj.resize(); } catch (e) { /* a detached map: the next draw tries again */ }
      SnowMapOverview.setDots(mapObj, dotsFor(ctx, st, states, pts.points));
      return;
    }
    if (mapOpening) return;
    if (mapObj) { try { mapObj.remove(); } catch (e) { /* already gone */ } mapObj = null; }
    mapOpening = true;
    var g = gen;
    SnowMapOverview.open({ box: mapHost, info: function () { return document.getElementById('snowmapinfo'); } }, pts.points).then(function (map) {
      mapOpening = false;
      if (g !== gen) { try { map.remove(); } catch (e) { /* signed out meanwhile */ } return; }
      mapObj = map; mapKey = key;
      draw(ctxRef || ctx); // the dots, now that the map exists
    }, function (e) {
      mapOpening = false;
      if (window.console) console.error('Snow map failed to open:', e); // name the real cause next time
    });
  }

  // ---------- Callouts (Part B2, Matt 10/4/26) ----------
  // Sites whose new snow since their last cleaning has reached their callout depth: a measured
  // reading if one was taken after it, else the NWS estimate (SnowCallout.calloutList). Matt's and
  // the Board leads' phones only, while a storm is open; worked out from the rows on every draw.
  function calloutsOn(ctx, st) { return canRunNow(ctx) && st.open; }
  function sitePoint(S, site) {
    return SnowWeather.point(site, S.zones.filter(function (z) { return z.site_id === site.id && z.archived !== true; }));
  }
  function pointKey(p) { return p[0] + ',' + p[1]; }

  function ensureSnowfall(ctx, p) {
    if (!p || typeof SnowWeather === 'undefined') return;
    var key = pointKey(p), c = snowfall[key];
    if (c && (c.busy || Date.now() - c.at < SNOW_EVERY)) return;
    // While a refresh is on its way the last answer stands, so the box does not flicker.
    snowfall[key] = { series: c ? c.series : null, at: c ? c.at : 0, busy: true };
    var g = gen;
    SnowWeather.fetchSnowfall(p[0], p[1]).then(function (series) {
      if (g !== gen) return; // signed out meanwhile; reset() already cleared it
      snowfall[key] = { series: series, at: Date.now(), busy: false };
      draw(ctxRef || ctx);
    });
  }

  // The live view's sites in its own order, each once (a site on two routes keeps its first place).
  // A callout site with no point (no saved view, no outline) gets no fetch and no estimate; a
  // measured reading still lists it.
  function calloutRows(ctx, st) {
    var S = ctx.S, m = siteMap(S), ids = [], points = {};
    if (!calloutsOn(ctx, st) || typeof SnowCallout === 'undefined') return []; // no lib/callout.js: no box
    liveRoutes(S).forEach(function (r) { inOrder(S, r.sites).forEach(function (s) { ids.push(s.id); }); });
    ids.forEach(function (id) {
      var site = m[id];
      if (!site || typeof site.callout_in !== 'number' || points.hasOwnProperty(id)) return;
      points[id] = sitePoint(S, site);
      ensureSnowfall(ctx, points[id]);
    });
    return SnowCallout.calloutList({ siteIds: ids, siteById: m, log: S.log, storms: S.storms, stormId: st.storm_id, nowIso: nowIso(),
      seriesFor: function (id) { var p = points[id], c = p && snowfall[pointKey(p)]; return c ? c.series : null; }, isDay: isDay(S) });
  }

  // One callout's words: the Callouts box's line, and the same line under a leftover on the handoff card.
  function calloutText(S, c) {
    var m = siteMap(S), name = m[c.site_id] ? m[c.site_id].name : c.site_id;
    var what = c.measured ? c.inches + '" measured ' + clock(c.since) + (c.measured.by_name ? ' by ' + c.measured.by_name : '')
      : '~' + c.inches + '" since ' + clock(c.since) + ' (estimate)';
    return name + ' · ' + what + ' · callout ' + c.callout + '"';
  }

  // One line per site; Clean again (the site card's own data-again) only once its pass has a real tap.
  // A refused Clean again from here says so on the line (the live view shows no site cards).
  function calloutsHtml(ctx, rows, st) {
    var S = ctx.S, esc = ctx.esc;
    if (!rows.length) return '';
    return '<section id="callouts" class="card callouts"><h2>Callouts (' + rows.length + ')</h2><ul>' + rows.map(function (c) {
      var f = failed[CrewShiftLog.walkKey(c.site_id, '*')];
      var again = CrewShiftLog.checkAgain(S.log, st.storm_id, c.site_id) === null;
      return '<li data-callout="' + esc(c.site_id) + '"><div class="callout-row"><span>' + esc(calloutText(S, c)) + '</span>' +
        (again ? '<button class="small" data-again="' + esc(c.site_id) + '">Clean again</button>' : '') + '</div>' +
        siteFailHtml(ctx, c.site_id, f) + '</li>';
    }).join('') + '</ul></section>';
  }

  // ---------- the day handoff card (handoff sheets, Matt 10/5/26) ----------
  // From a handoff until Close storm, at the top of the Storm tab for everyone signed in. All of it is
  // CrewHandoff's: handoffData replays the rows this phone already polls, cut at the handoff's marks, and
  // heading / siteParts / leftoverParts are the day PDF's own words. Built from what the Print view uses
  // (sheetOpts): on a crew phone that is the newest Post only and no Board, so a day route shows once the
  // day Post is up. Names only. Anything that throws while it is built (a bad copy of lib/handoff.js)
  // costs the card, never the rest of the tab. lib/handoff.js missing: no card.
  function handoffCard(ctx, st) {
    if (typeof CrewHandoff === 'undefined' || !st.open) return '';
    try { return handoffCardHtml(ctx, st); } catch (e) { return ''; }
  }

  // When (ruling, fix round 1, 10/5/26): the shift running is the night the handoff closed (the 8-9 AM
  // truck swap after the 8:00 run, or the rest of the night after an early Hand off now) or the day it
  // hands off to. Nothing before a handoff; and after a quiet next night (no new handoff) the old card
  // does not come back on the later day. The next night's handoff, the newest by seq, replaces it.
  function cardShift(S, h) {
    var now = CrewShiftLog.shiftFor(nowIso(), S.storms);
    return now === h.shift_id || now === CrewHandoff.dayShiftOf(h.shift_id);
  }

  function handoffCardHtml(ctx, st) {
    var S = ctx.S, esc = ctx.esc;
    var h = CrewHandoff.newestHandoff(S.storms, st.storm_id);
    if (!h || !cardShift(S, h)) return '';
    var o = sheetOpts(S, st), data = CrewHandoff.handoffData(o, h);
    var admin = S.me.role === 'admin', routes = dayRoutesFor(S, o, data);
    var callouts = leftoverCallouts(ctx, st, data.leftovers.map(function (l) { return l.site_id; }));
    var html = '<section id="handoff" class="card handoff"><h2>' + esc(CrewHandoff.heading(data)) + '</h2>';
    if (routes.length) {
      html += '<h3 class="handoff-part">' + (admin ? 'Day routes' : 'Your route') + '</h3>' + routes.map(function (r) { return dayRouteHtml(ctx, r); }).join('');
    }
    html += '<h3 class="handoff-part">Left by night (' + data.leftovers.length + ')</h3>';
    html += data.leftovers.length ? '<ul class="handoff-left">' + data.leftovers.map(function (l) { return leftoverHtml(ctx, l, callouts[l.site_id]); }).join('') + '</ul>'
      : '<p class="muted">Night left nothing.</p>';
    return html + '</section>';
  }

  // Matt sees every day route. Anyone else sees the day Post's route(s) that list them: none until they are
  // on the day Post (a crew phone holds no Board to replay).
  function dayRoutesFor(S, o, data) {
    if (S.me.role === 'admin') return data.dayRoutes;
    var me = S.me.crew_id, post = CrewRouteSheet.newestPost(o.posts, data.dayShift);
    var ids = ((post && post.routes) || []).filter(function (r) { return !!me && (r.lead === me || (r.members || []).indexOf(me) !== -1); })
      .map(function (r) { return r.id; });
    return data.dayRoutes.filter(function (r) { return ids.indexOf(r.route_id) !== -1; });
  }

  // A line's parts, as CrewHandoff words them: [site, ...the rest]. The address goes beside the site's
  // short code, as on every other list.
  function partsHtml(ctx, parts, address) {
    var esc = ctx.esc;
    return '<span class="site-name">' + esc(parts[0]) + '</span>' + (address ? ' <span class="muted site-addr">' + esc(address) + '</span>' : '') +
      (parts.length > 1 ? ' · ' + esc(parts.slice(1).join(' · ')) : '');
  }

  function dayRouteHtml(ctx, r) {
    var esc = ctx.esc, crew = r.crew;
    return '<div class="handoff-day" data-handoffroute="' + esc(r.route_id) + '"><div class="handoff-route"><b>' + esc(r.name) + '</b> · Lead: ' +
      esc(crew.lead || '—') + ' · Crew: ' + esc(crew.members.length ? crew.members.join(', ') : '—') +
      (crew.source === 'board' ? ' <i>from the Board (not posted)</i>' : '') + '</div>' +
      (r.sites.length ? '<ul class="handoff-sites">' + r.sites.map(function (s) {
        return '<li data-daysite="' + esc(s.site_id) + '">' + partsHtml(ctx, CrewHandoff.siteParts(s), s.address) + '</li>';
      }).join('') + '</ul>' : '<p class="muted">No sites on this route.</p>') + '</div>';
  }

  // A leftover's line opens its site, with the walk buttons (openSite). A done one keeps its place at the
  // end, greyed. Under it, the Callouts box's line when its new snow has reached its callout.
  function leftoverHtml(ctx, l, callout) {
    var esc = ctx.esc;
    return '<li data-leftsite="' + esc(l.site_id) + '"><button class="handoff-line' + (l.done ? ' done' : '') + '" data-leftover="' + esc(l.site_id) + '">' +
      partsHtml(ctx, CrewHandoff.leftoverParts(l), l.address) + '</button>' +
      (callout ? '<div class="handoff-callout">' + esc(calloutText(ctx.S, callout)) + '</div>' : '') + '</li>';
  }

  // The leftovers whose new snow has reached their callout, by the Callouts box's rule (calloutList). A
  // measured reading counts on every phone. An estimate only where this phone already holds the forecast:
  // Matt's and the Board leads' phones, which the Callouts box fetches for. The card never asks the NWS
  // itself, so a crew phone never does. lib/callout.js missing: no lines.
  function leftoverCallouts(ctx, st, ids) {
    var S = ctx.S, m = siteMap(S), out = {};
    if (typeof SnowCallout === 'undefined' || !ids.length) return out;
    var held = calloutsOn(ctx, st) && typeof SnowWeather !== 'undefined';
    SnowCallout.calloutList({ siteIds: ids, siteById: m, log: S.log, storms: S.storms, stormId: st.storm_id, nowIso: nowIso(), isDay: true,
      seriesFor: function (id) {
        var p = held && m[id] ? sitePoint(S, m[id]) : null, c = p && snowfall[pointKey(p)];
        return c ? c.series : null;
      } }).forEach(function (c) { out[c.site_id] = c; });
    return out;
  }

  // Hand off now (handoff sheets, Matt 10/5/26): in the storm controls, so for Matt and the posted leads
  // (canRunNow), during night shift while the storm is open. It goes through run(), as Clean again does:
  // one in flight, and a refusal shows here (only one made this night). Once this night has a handoff,
  // its line takes the button's place: the server would only answer "Already handed off".
  function handOffHtml(ctx, st) {
    var S = ctx.S, esc = ctx.esc, shift = CrewShiftLog.shiftFor(nowIso(), S.storms), f = failed[HANDOFF_KEY], html = '', done = null;
    // lib/handoff.js missing or broken: no line, and the button (the server decides).
    try {
      var h = typeof CrewHandoff === 'undefined' ? null : CrewHandoff.newestHandoff(S.storms, st.storm_id);
      if (h && h.shift_id === shift) done = CrewHandoff.heading({ night: h });
    } catch (e) { done = null; }
    if (done) html += '<div id="handoffdone" class="muted">' + esc(done) + '</div>';
    else html += '<div class="row"><button id="handOffNow" class="stormbtn"' + (inflight[HANDOFF_KEY] ? ' disabled aria-busy="true"' : '') + '>Hand off now</button></div>';
    if (f && f.req.shift === shift) html += '<div id="handofferr" class="err" role="alert">Not saved: ' + esc(f.reason) + '</div>';
    return html;
  }

  // The dialog is the app's own (never window.confirm), in Matt's words.
  function confirmHandoff(ctx) {
    ctx.$('dlgIn').innerHTML = '<h2>Hand off to day now?</h2><p>The night\'s sheets are saved and the day crew sees what\'s left.</p>' +
      '<div class="row"><button id="ho_yes" class="primary">Yes, hand off</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    ctx.$('ho_yes').onclick = function () {
      ctx.closeDialog();
      // The server stamps who, when, which night and the marks: the phone sends the action alone. The
      // reply is a Storms row (tab); shift files a refusal under this night only.
      run(ctx, HANDOFF_KEY, { action: 'handOff', payload: {}, tab: 'storms', shift: CrewShiftLog.shiftFor(nowIso(), ctx.S.storms) });
      draw(ctx); // the button shows it is busy
    };
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
    return '<li class="live-site" data-livesite="' + esc(site.id) + '"><div class="live-siterow"><span class="live-sitename">' + esc(site.name) + addrOf(ctx, site.id) + '</span>' +
      '<span class="live-status' + (done ? ' done' : problem ? ' bad' : '') + '">' + esc(status) + '</span></div>' +
      (off.length ? '<div class="muted"><span class="offroute">off-route</span> ' + esc(off.join(', ')) + '</div>' : '') +
      totalsHtml(ctx, site.id) + '</li>';
  }

  function liveRouteHtml(ctx, r, st, states) {
    var S = ctx.S, esc = ctx.esc, prog = CrewShiftLog.routeProgress(r.sites.map(function (s) { return s.id; }), S.zones, states);
    var ids = r.sites.map(function (s) { return s.id; });
    // A Clean again or a depth row ('*') is not a tap on a walk: "Last tap" is the crew's last one.
    var taps = (S.log || []).filter(function (x) { return x.storm_id === st.storm_id && x.zone_id !== '*' && ids.indexOf(x.site_id) !== -1; })
      .sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
    var last = taps.length ? taps[taps.length - 1] : null;
    return '<section class="card live-route" data-liveroute="' + esc(r.id) + '">' +
      '<button class="live-open" data-openroute="' + esc(r.id) + '"><span class="route-badge">' + esc(r.name) + '</span>' +
      '<span class="live-count">' + prog.done + ' of ' + prog.total + ' sites done</span></button>' +
      '<progress value="' + prog.done + '" max="' + prog.total + '"></progress>' +
      '<div class="live-who">' + esc(whoOn(S, r.id) || 'Not posted') + '</div>' +
      truckHtml(ctx, r.id, canSetTruck(S, r.id)) +
      '<div class="live-last muted">' + (last ? 'Last tap ' + esc(clock(last.at)) : 'No taps yet') + '</div>' +
      '<ul class="live-sites">' + inOrder(S, r.sites).map(function (s) { return liveSiteHtml(ctx, s, states); }).join('') + '</ul></section>';
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
      html += b('end', 'Close storm (cleanup done)', ' danger') +
        '<span class="seg" role="group" aria-label="Weather"><button class="stormbtn' + cls + '" data-storm="snowing" aria-pressed="' + st.snowing + '"' + busy + '>Snowing</button>' +
        '<button class="stormbtn' + cls + '" data-storm="stopped" aria-pressed="' + !st.snowing + '"' + busy + '>Snow stopped (melt + rock OK)</button></span>' +
        '<button class="stormbtn' + cls + '" data-storm="night_on" aria-pressed="' + night + '"' + busy + (night ? ' disabled' : '') + '>Night shift on</button>';
    }
    html += '</div>';
    if (st.open) html += '<div id="shiftnow" class="muted">' + (CrewShiftLog.shiftFor(nowIso(), S.storms).indexOf('night') === 0 ? 'Night shift' : 'Day shift') + '</div>';
    if (st.open && CrewShiftLog.shiftFor(nowIso(), S.storms).indexOf('night-') === 0) html += handOffHtml(ctx, st);
    // Route sheets (Matt's): the Print view for this storm (or the last one), and the Drive status.
    if (st.storm_id && canPrint(S)) html += '<div class="row"><button id="printSheets">Print sheets</button></div>';
    html += sheetsHtml(ctx, st);
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
    var main = ctx.$('main'), active = document.activeElement, focusKey = null, selStart = 0, truckFocus = null, truckSel = 0;
    if (active && active.dataset && active.dataset.truckinput !== undefined) { truckFocus = active.dataset.truckinput; truckSel = active.selectionStart; }
    // What is being typed survives a redraw (a poll can land mid-sentence).
    Array.prototype.forEach.call(main.querySelectorAll('[data-note]'), function (n) {
      drafts[n.dataset.note] = n.value;
      if (n === active) { focusKey = n.dataset.note; selStart = n.selectionStart; }
    });
    stale(S);
    var st = CrewShiftLog.stormState(S.storms), states = CrewShiftLog.walkStates(S.log, st.storm_id);
    var routes = routesFor(S), mine = routes.filter(function (r) { return r.mine; }), others = routes.filter(function (r) { return !r.mine; });
    readOnly = standing(S) === null;
    var hp = hintPoint(S, canRunNow(ctx) ? liveRoutes(S) : mine);
    ensureHint(ctx, hp);
    var callouts = calloutRows(ctx, st); // also asks for the snowfall, through its 30-minute gate
    var html = '<div id="stormhead" class="stormhead' + (loaded && st.open ? ' open' : '') + '" role="status">' + ctx.esc(headText(st)) + '</div>' + hintHtml(ctx, hp);
    // A site opened from the handoff card: its walks, as on a route. One archived meanwhile takes its Back step with it.
    var site = openSite === null ? null : S.sites.filter(function (x) { return x.id === openSite; })[0];
    if (openSite !== null && !site) { openSite = null; if (ctx.syncHistory) ctx.syncHistory(); }
    if (site) {
      html += '<div class="row"><button id="siteBack" class="small">‹ Back</button></div>' + siteHtml(ctx, { id: site.id, name: site.name }, states);
    } else if (canRunNow(ctx)) {
      // Matt and the leads: the live view, and a route opens as the crew see it.
      var live = liveRoutes(S), opened = openRoute && live.filter(function (r) { return r.id === openRoute; })[0];
      if (opened) {
        html += '<div class="row"><button id="liveBack" class="small">‹ Live view</button></div>' + routeHtml(ctx, opened, states);
      } else {
        // A route that vanished (archived meanwhile) takes its Back step with it.
        if (openRoute) { openRoute = null; if (ctx.syncHistory) ctx.syncHistory(); }
        // The live window (10/6/26): the summary line first; Problems and Callouts share a row on a wide
        // screen (.live-top); the routes sit in a grid there (.live-grid) and in one column on a phone.
        // The Snow map card (10/6/26) sits under the storm controls.
        var top = problemsHtml(ctx, states) + calloutsHtml(ctx, callouts, st);
        html += livesumHtml(ctx, st, states, callouts.length) + handoffCard(ctx, st) + controlsHtml(ctx, st) + snowMapHtml(ctx, st) + (top ? '<div class="live-top">' + top + '</div>' : '') +
          (live.length ? '<div class="live-grid">' + live.map(function (r) { return liveRouteHtml(ctx, r, st, states); }).join('') + '</div>'
            : '<p class="muted">No routes yet. Add them on the Routes tab.</p>');
      }
    } else {
      html += handoffCard(ctx, st) + mine.map(function (r) { return routeHtml(ctx, r, states); }).join('');
      if (readOnly) html += "<section class=\"card\"><h2>You're not on tonight's posted Board.</h2><p class=\"muted\">You can see the routes, but not mark walks. If Matt just added you, ask him to Post again.</p></section>";
      else if (!mine.length) html += '<section class="card"><h2>You\'re not on a route this shift</h2><p class="muted">Ask your lead. To help out on another route, open the other routes below.</p></section>';
      if (others.length) {
        html += '<div class="row"><button id="otherRoutes" aria-expanded="' + showOthers + '">' + (showOthers ? 'Hide other routes' : 'Other routes') + '</button></div>';
        if (showOthers) html += others.map(function (r) { return routeHtml(ctx, r, states); }).join('');
      }
    }
    main.innerHTML = html;
    mountSnowMap(ctx, st, states); // the live view's Snow map card, when it is open
    if (truckFocus !== null) {
      var tb = findBy('[data-truckinput]', 'data-truckinput', truckFocus);
      if (tb) { tb.focus(); try { tb.setSelectionRange(truckSel, truckSel); } catch (e) {} }
    }
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

  // The newest Log seq at one site, and the site refusals a newer row has made out of date
  // (a Clean again refused with "Nothing to clean again yet" stays only until someone taps there).
  function topSeqAt(S, siteId) {
    return S.log.reduce(function (m, r) { return r.site_id === siteId ? Math.max(m, Number(r.seq) || 0) : m; }, 0);
  }
  function stale(S) {
    Object.keys(failed).forEach(function (key) {
      var f = failed[key];
      if (f.site && topSeqAt(S, f.site) > f.siteSeq) delete failed[key];
    });
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
      // The saved row joins its own tab: a tap, an undo, Clean again or a depth reading the Log; a handoff Storms.
      var tab = req.tab || 'log';
      ctx.S[tab] = mergeRows(ctx.S[tab], [r.record]);
      delete noteOpen[key];
      delete drafts[key];
      return draw(ctx);
    }
    if (r.code === 'signin') return ctx.signedOut(r.reason);
    // Not allowed (not on tonight's Board, not a lead) is refused again however often it is sent: no Retry.
    failed[key] = { req: req, reason: r.code === 'network' ? 'no signal' : (r.reason || 'try again'), retry: r.code !== 'conflict' && r.code !== 'forbidden' };
    // A refused Clean again or New snow (the site's '*' key) was refused on the rows the phone had
    // then; it is kept only until a newer row at that site comes in (stale(), on every draw).
    // One that never reached the server is still wanted, and keeps its Retry.
    if (r.code === 'invalid' && req.payload && key === CrewShiftLog.walkKey(req.payload.site_id, '*')) {
      failed[key].site = req.payload.site_id;
      failed[key].siteSeq = topSeqAt(ctx.S, req.payload.site_id);
    }
    draw(ctx);
    // A refusal means the phone's picture is out of date (the storm ended, someone tapped first).
    if (r.code === 'invalid' || r.code === 'conflict') poll(ctx);
    // A walk the server says this site does not have: Matt drew (or archived) its zones
    // since this phone loaded them. Fetch them again; the walk on screen may be gone after.
    if (r.code === 'invalid' && r.reason === NOT_WALKED) {
      var site = ctx.S.sites.filter(function (s) { return s.id === req.payload.site_id; })[0];
      if (ctx.toast) ctx.toast('Not saved: the map for ' + (site ? site.name : 'this site') + ' has changed. Mark the walk again.');
      refreshZones(ctx);
    }
  }

  async function refreshPost(ctx) {
    if (postBusy) return;
    postBusy = true;
    var g = gen, r;
    try { r = await ctx.call('getPost'); } catch (e) { r = { ok: false }; }
    if (g !== gen) return; // signed out meanwhile
    postBusy = false;
    if (!r.ok) return; // no signal or a lapsed session: the poll says so, this stays quiet
    ctx.S.post = r.post || null;
    draw(ctxRef || ctx);
  }

  async function refreshZones(ctx) {
    if (zonesBusy) return;
    zonesBusy = true;
    var g = gen, r;
    try { r = await ctx.call('getZones'); } catch (e) { r = { ok: false }; }
    if (g !== gen) return;
    zonesBusy = false;
    // Not under an open map: Matt's zone editor keeps its own saves in S.zones, and a
    // read sent before one of them landed would drop it. The next return reads again.
    if (!r.ok || !Array.isArray(r.zones) || ctx.S.mapSite) return;
    ctx.S.zones = r.zones;
    draw(ctxRef || ctx);
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
    return pull(ctx);
  }
  // Matt's Board reads the rows once on entering it (final review C1): trucks a lead set, and a truck
  // Matt just saved, show there without the Storm tab ever being opened. Not the Storm tab's ctxRef.
  function catchUp(ctx) { return pull(ctx); }

  async function pull(ctx) {
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
      // Posts (Matt's phone only; final review I1) are not seq rows, so they are never merged by seq:
      // kept in the order the server sent them, replaced on a reset. The cursor alone says where we are.
      var posts = Array.isArray(r.posts) ? r.posts : [];
      S.posts = r.reset && r.reset.posts ? posts.slice() : (S.posts || []).concat(posts);
      if (r.cursor) S.cursor = { log: r.cursor.log || 0, storms: r.cursor.storms || 0, visits: r.cursor.visits || 0,
        trucks: r.cursor.trucks || 0, sheets: r.cursor.sheets || 0, posts: r.cursor.posts || 0 };
      loaded = true;
      unreachable = false;
      draw(ctx);
      refreshBoardTrucks(ctx);
      if (ctx.markMap) ctx.markMap(); // a map left open shows the new taps
    } finally { if (g === gen) polling = false; }
  }

  function tick() {
    if (document.visibilityState !== 'visible' || !ctxRef || ctxRef.S.tab !== 'storm') return;
    poll(ctxRef);
    if (++ticks % POST_EVERY === 0) refreshPost(ctxRef);
  }
  // Entering the tab polls at once (catch up) and reads the post, then polls
  // every 20 s while it is on screen. Safe to call on every render: a running
  // timer is left alone.
  function start(ctx) {
    ctxRef = ctx;
    if (timer) return;
    ticks = 0;
    timer = setInterval(tick, INTERVAL);
    poll(ctx);
    refreshPost(ctx);
  }
  // Back on screen (Android keeps the app in memory for hours): catch up on all three.
  function wake(ctx) {
    ctxRef = ctx;
    poll(ctx);
    refreshPost(ctx);
    refreshZones(ctx);
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
    ticks = 0; postBusy = false; zonesBusy = false;
    inflight = {}; failed = {}; noteOpen = {}; drafts = {}; cardBusy = false;
    openRoute = null; openSite = null; stormBusy = false; stormErr = ''; warnNow = {};
    hint = { key: '', text: null, at: 0, busy: false };
    snowfall = {};
    showMap = null; mapKey = ''; mapOpening = false;
    if (mapQueue) { clearInterval(mapQueue); mapQueue = null; }
    if (mapObj) { try { mapObj.remove(); } catch (e) { /* already gone */ } mapObj = null; }
    truckDrafts = {}; truckBusy = {}; truckErr = {}; retryBusy = false; sheetsMsg = ''; pickedShift = null;
    closePrint();
    S.log = []; S.storms = []; S.visits = []; S.trucks = []; S.sheets = []; S.posts = [];
    S.cursor = { log: 0, storms: 0, visits: 0, trucks: 0, sheets: 0, posts: 0 };
    S.last = { log: null, storms: null, visits: null, trucks: null, sheets: null };
  }

  // ---------- the site card ----------
  // The paper sheet's per-site fields: depth, materials used, equipment minutes.
  // Start and finish are only shown: they are the first and last tap here this
  // shift. Everything typed is a judgment value, so it is sent blank when it is
  // blank, never 0. Each person has one card per site per shift; saving again
  // replaces their own (the server files a new row, the newest one wins).
  var MACHINES = [['blower', 'Blower'], ['snowrator', 'Snowrator'], ['bobcat', 'Bobcat'], ['sweepster', 'Sweepster']];
  // Every card opened gets its own token (on its Save button). A save answers only
  // into the card it was sent from, and only while that card is still on screen: a
  // slow save that was cancelled must never close, or write into, the next card.
  // cardBusy = the token of the card whose save is on its way (false = none).
  var cardSeq = 0, cardBusy = false;
  var STILL_SAVING = 'Still saving the last card… try again in a moment';
  function cardShown(ctx, token) {
    var b = ctx.$('vc_save');
    return !!ctx.$('dlg').open && !!b && b.getAttribute('data-cardtoken') === String(token);
  }

  function shown(v) { return v === '' || v === null || v === undefined ? '' : String(v); }
  function dayShift(S) { return CrewShiftLog.shiftFor(nowIso(), S.storms); }

  // This person's newest card for the site in the current shift, never someone else's.
  function myCard(S, siteId, shiftId) {
    var key = (S.me && S.me.crew_id) || 'admin';
    return CrewShiftLog.visitTotals(S.visits, siteId, shiftId).cards.filter(function (c) { return String(c.by_key || 'admin') === key; })[0] || null;
  }

  // Copy for BT (Matt, 10/3/26): the lead's text for this site's BuilderTrend
  // post. The app fills the clipboard and nothing else; the lead posts as
  // themselves in BT, with their photos. Leads and Matt only.
  function openBt(ctx, siteId) {
    var S = ctx.S, esc = ctx.esc, site = S.sites.filter(function (s) { return s.id === siteId; })[0];
    if (!site || !canRunNow(ctx)) return;
    var n = SnowBtNote.btNote({ site: site, zones: S.zones, storm_id: CrewShiftLog.stormState(S.storms).storm_id,
      log: S.log, visits: S.visits }, dayShift(S));
    ctx.$('dlgIn').innerHTML = '<h2>BT post: ' + esc(site.name) + '</h2>' +
      '<div class="row">Time In <b id="bt_in">' + esc(n.timeIn || '—') + '</b> · Time Out <b id="bt_out">' + esc(n.timeOut || '—') + '</b></div>' +
      '<label for="bt_text">Notes</label><textarea id="bt_text" rows="6" readonly>' + esc(n.text) + '</textarea>' +
      '<p class="muted">Paste into the site\'s Daily Log in BuilderTrend, pick crew and equipment there, add your photos.</p>' +
      '<div class="row"><button id="bt_copy" class="primary">Copy notes</button><button id="dlgClose">Close</button></div>';
    ctx.showDialog();
    ctx.$('bt_copy').onclick = function () {
      var box = ctx.$('bt_text');
      function manual() { box.focus(); box.select(); ctx.toast('Press and hold the text to copy it'); }
      if (!navigator.clipboard || !navigator.clipboard.writeText) return manual();
      navigator.clipboard.writeText(box.value).then(function () { ctx.toast('Copied. Paste it into the BT Notes'); }, manual);
    };
  }

  function openCard(ctx, siteId) {
    var S = ctx.S, esc = ctx.esc, site = S.sites.filter(function (s) { return s.id === siteId; })[0];
    if (!site) return;
    var token = ++cardSeq;
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
      '<div class="row"><button id="vc_save" class="primary" data-cardtoken="' + token + '">Save</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    Array.prototype.forEach.call(ctx.$('dlgIn').querySelectorAll('[data-eq]'), function (box) {
      box.onchange = function () {
        var min = ctx.$('dlgIn').querySelector('[data-eqmin="' + box.dataset.eq + '"]');
        min.disabled = !box.checked;
        if (box.checked) min.focus();
      };
    });
    ctx.$('vc_save').onclick = function () { saveCard(ctx, siteId, token); };
  }

  // '' stays '', a typed number is a number; null means "not a valid number".
  function typed(raw, whole) {
    raw = String(raw).trim();
    if (raw === '') return '';
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || (whole && Math.floor(n) !== n)) return null;
    return n;
  }

  async function saveCard(ctx, siteId, token) {
    if (cardBusy) {
      // Another card's save is still on its way: say so, never swallow the tap. (This
      // card's own second tap finds its button already disabled.)
      if (cardBusy !== token && ctx.$('vc_err')) ctx.$('vc_err').textContent = STILL_SAVING;
      return;
    }
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
    cardBusy = token;
    err.textContent = '';
    save.disabled = true;
    var g = gen, r;
    try { r = await ctx.call('saveVisit', payload); }
    catch (e) { r = { ok: false, code: 'network' }; }
    if (g !== gen) return; // signed out meanwhile; reset() already cleared everything
    cardBusy = false;
    var here = cardShown(ctx, token);
    var site = ctx.S.sites.filter(function (s) { return s.id === siteId; })[0], name = site ? site.name : siteId;
    if (!here) {
      // Another card is open (or none): its "still saving" note no longer holds.
      var other = ctx.$('vc_err');
      if (other && other.textContent === STILL_SAVING) other.textContent = '';
    }
    if (r.ok) {
      ctx.S.visits = mergeRows(ctx.S.visits, [r.record]); // the record always counts
      if (here) { ctx.closeDialog(); ctx.toast('Site card saved'); }
      else ctx.toast('Site card saved: ' + name); // it was cancelled; say which one landed
      return draw(ctx);
    }
    if (r.code === 'signin') { ctx.closeDialog(); return ctx.signedOut(r.reason); }
    if (here) {
      ctx.$('vc_err').textContent = r.code === 'network' ? 'Not saved: no signal' : (r.reason || 'Not saved: try again');
      ctx.$('vc_save').disabled = false;
    } else {
      ctx.toast('Site card for ' + name + ' not saved: ' + (r.code === 'network' ? 'no signal' : (r.reason || 'try again')));
    }
    if (r.code === 'invalid' || r.code === 'conflict') poll(ctx); // the phone's picture is out of date
  }

  // The route opened from the live view (null = the live view). app.js asks
  // routeOpen() to build the Back stack, and calls closeRoute() when Back pops
  // it or the tab changes.
  // A site opened from the handoff card is the same step, and closes the same way.
  function routeOpen() { return openRoute !== null || openSite !== null; }
  function closeRoute(ctx) {
    if (openRoute === null && openSite === null) return;
    openRoute = null;
    openSite = null;
    if (ctx) draw(ctx);
  }

  // ---------- storm controls (Matt and the leads) ----------
  // One request in flight for all of them: a double tap, or End on top of a
  // slow Start, finds the guard up and does nothing. The server stamps who and
  // when from the token; the phone sends only the kind.
  async function stormRun(ctx, kind) {
    if (stormBusy || !canRunNow(ctx)) return;
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
    ctx.$('dlgIn').innerHTML = '<h2>' + (start ? 'Start a new storm?' : 'Close the storm?') + '</h2><p>Are you sure?</p>' +
      '<p class="muted">' + (start ? 'Every walk goes back to not done. Nothing already logged is deleted.' : 'The crew can no longer mark walks until it is reopened.') + '</p>' +
      '<div class="row"><button id="sc_yes" class="primary">' + (start ? 'Yes, start storm' : 'Yes, close storm') + '</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    ctx.$('sc_yes').onclick = function () { ctx.closeDialog(); stormRun(ctx, kind); };
  }

  // Storm-tab clicks. Returns true when handled.
  function onClick(ev, ctx) {
    var t = ev.target, el, key;
    // The Snow map card opens and closes (Matt, 10/6/26); the map itself is kept.
    if (ctx.S.tab === 'storm' && t.id === 'snowmaptoggle') { showMap = !mapOn(); ctxRef = ctx; draw(ctx); return true; }
    // The truck box is on the Storm tab (leads) and on Matt's Board.
    if ((ctx.S.tab === 'storm' || ctx.S.tab === 'board') && (el = t.closest('[data-settruck]'))) {
      ctxRef = ctx;
      saveTruck(ctx, el.dataset.settruck);
      return true;
    }
    if (ctx.S.tab !== 'storm') return false;
    ctxRef = ctx;
    if (t.closest('#printSheets')) { openPrint(ctx); return true; }
    if (t.closest('#printBack')) { closePrint(); ctx.syncHistory(); return true; }
    if (t.closest('#printNow')) { window.print(); return true; }
    if (t.closest('#retrySheets')) { retrySheets(ctx); return true; }
    if (canRunNow(ctx)) {
      if ((el = t.closest('[data-storm]'))) {
        if (stormBusy) return true;
        if (el.dataset.storm === 'start' || el.dataset.storm === 'end') confirmStorm(ctx, el.dataset.storm); else stormRun(ctx, el.dataset.storm);
        return true;
      }
      // An open route is a step on the phone's Back stack (app.js wantedSteps): Back
      // returns to the live view instead of leaving the app mid-storm.
      if ((el = t.closest('[data-openroute]'))) { openRoute = el.dataset.openroute; draw(ctx); ctx.syncHistory(); window.scrollTo(0, 0); return true; }
      if (t.closest('#liveBack')) { closeRoute(ctx); ctx.syncHistory(); return true; }
      if (t.closest('#handOffNow')) { if (!inflight[HANDOFF_KEY]) confirmHandoff(ctx); return true; }
    }
    // A leftover on the handoff card opens its site (everyone): a step on the Back stack, as a route is.
    if ((el = t.closest('[data-leftover]'))) { openSite = el.dataset.leftover; draw(ctx); ctx.syncHistory(); window.scrollTo(0, 0); return true; }
    if (t.closest('#siteBack')) { closeRoute(ctx); ctx.syncHistory(); return true; }
    if (t.closest('#otherRoutes')) { showOthers = !showOthers; draw(ctx); return true; }
    if ((el = t.closest('[data-card]'))) { openCard(ctx, el.dataset.card); return true; }
    if ((el = t.closest('[data-bt]'))) { openBt(ctx, el.dataset.bt); return true; }
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
    if ((el = t.closest('[data-again]'))) { confirmAgain(ctx, el.dataset.again); return true; }
    if ((el = t.closest('[data-depth]'))) { if (canRunNow(ctx)) confirmDepth(ctx, el.dataset.depth); return true; }
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

  return { standing: standing, render: function (ctx) { ctxRef = ctx; draw(ctx); }, poll: poll, catchUp: catchUp, wake: wake, start: start, stop: stop, reset: reset, onClick: onClick, onKeydown: onKeydown,
    routeOpen: routeOpen, closeRoute: closeRoute,
    printOpen: printOpen, closePrint: closePrint, truckFor: truckFor, truckHtml: truckHtml, boardShift: boardShift, postShift: postShift, setPickedShift: setPickedShift,
    mergeRows: mergeRows,
    // What this phone holds, for tests: rows, cursor and last-seq per tab, and per snowfall point whether
    // its answer is in (busy false: the reply landed, and the redraw that follows it has run).
    state: function () {
      var S = ctxRef && ctxRef.S, sf = {};
      Object.keys(snowfall).forEach(function (k) { var c = snowfall[k]; sf[k] = { busy: c.busy, periods: c.series ? c.series.length : null }; });
      return S ? { log: S.log, storms: S.storms, visits: S.visits, trucks: S.trucks, sheets: S.sheets, posts: S.posts, cursor: S.cursor, last: S.last, snowfall: sf } : null;
    } };
})();
if (typeof window !== 'undefined') window.SnowShiftUI = SnowShiftUI;
