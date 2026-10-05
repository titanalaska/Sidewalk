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
  // Route sheets: what is typed in a truck box (kept across redraws until it is saved), a save in
  // flight per route, the last refusal per route; the Print view; Matt's Retry and its message.
  // pickedShift: the shift Matt picked for his Board's trucks when nothing was posted (asked once).
  var truckDrafts = {}, truckBusy = {}, truckErr = {}, printing = false, retryBusy = false, sheetsMsg = '', pickedShift = null;
  // The forecast hint (lib/weather.js): one per screen, asked for at most once
  // every 15 minutes whatever the number of redraws and polls, and for a point
  // only. Failure or no answer is no hint, and nothing else on the screen changes.
  var HINT_EVERY = 15 * 60 * 1000;
  var hint = { key: '', text: null, at: 0, busy: false };
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
  // Only the newest End counts: a sheet from an earlier End is an older set. Of the rows for that End,
  // the newest per route and shift is the one that stands (a Retry adds a row; it never edits one).
  // No row yet for the newest End = the job has not got to it: making.
  function sheetsStatus(S, st) {
    if (!st.storm_id || st.open) return null;
    var ends = (S.storms || []).filter(function (r) { return r.storm_id === st.storm_id && r.kind === 'end'; });
    if (!ends.length) return null;
    var endSeq = Math.max.apply(null, ends.map(function (r) { return Number(r.seq); }));
    var newest = {}, saved = 0, failed = 0;
    (S.sheets || []).forEach(function (r) {
      if (r.storm_id !== st.storm_id || Number(r.end_seq) !== endSeq) return;
      var k = r.route_id + '|' + r.shift_id;
      if (!newest[k] || Number(r.seq) > Number(newest[k].seq)) newest[k] = r;
    });
    Object.keys(newest).forEach(function (k) { if (newest[k].status === 'saved') saved++; else failed++; });
    // Ten minutes after the newest End, a sheet that is still missing is not "being made": the job never
    // ran, or died part way. Retry is offered then (the server counts what is owed from the rows).
    var end = ends.filter(function (r) { return Number(r.seq) === endSeq; })[0];
    var late = Date.parse(nowIso()) - Date.parse(end.at) >= MAKING_MS;
    // Saved rows alone can hide a sheet that was never made (a run cut short): compare with the sheets
    // this phone expects, the same list the Print view builds.
    var expected = null;
    try { expected = CrewRouteSheet.sheetsFor(sheetOpts(S, st)).length; } catch (e) { expected = null; }
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

  function openPrint(ctx) {
    var S = ctx.S, st = CrewShiftLog.stormState(S.storms);
    if (printing || !canPrint(S) || !st.storm_id) return;
    var o = sheetOpts(S, st);
    var pages;
    try {
      var madeAt = nowIso();
      pages = CrewRouteSheet.sheetsFor(o).map(function (p) {
        return CrewRouteSheet.sheetBody(CrewRouteSheet.sheetData(o, p.route_id, p.shift_id), madeAt, false);
      });
    } catch (e) { ctx.toast("The sheets couldn't be built on this phone. Try again."); return; }
    var style = document.getElementById('printstyle');
    if (!style) { style = document.createElement('style'); style.id = 'printstyle'; document.head.appendChild(style); }
    style.textContent = scopeCss(CrewRouteSheet.css);
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

  function siteHtml(ctx, site, states) {
    var S = ctx.S, walks = CrewShiftLog.walksFor(site.id, S.zones);
    return '<section class="card shift-site" data-shiftsite="' + ctx.esc(site.id) + '"><div class="route-top"><span class="site-name">' + ctx.esc(site.name) + '</span>' +
      '<span class="row tight"><button class="small" data-map="' + ctx.esc(site.id) + '">Map</button>' +
      (readOnly ? '' : '<button class="small" data-card="' + ctx.esc(site.id) + '">Site card</button>') +
      (canRunNow(ctx) ? '<button class="small" data-bt="' + ctx.esc(site.id) + '">Copy for BT</button>' : '') + '</span></div>' +
      walks.map(function (w) { return walkHtml(ctx, site, w, states); }).join('') + '</section>';
  }

  function routeHtml(ctx, r, states) {
    return '<h2 class="shift-route">' + ctx.esc(r.name) + (r.mine ? ' <span class="badge">Your route</span>' : '') + '</h2>' +
      truckHtml(ctx, r.id, canSetTruck(ctx.S, r.id)) +
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
      truckHtml(ctx, r.id, canSetTruck(S, r.id)) +
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
      html += b('end', 'Close storm (cleanup done)', ' danger') +
        '<span class="seg" role="group" aria-label="Weather"><button class="stormbtn' + cls + '" data-storm="snowing" aria-pressed="' + st.snowing + '"' + busy + '>Snowing</button>' +
        '<button class="stormbtn' + cls + '" data-storm="stopped" aria-pressed="' + !st.snowing + '"' + busy + '>Snow stopped (melt + rock OK)</button></span>' +
        '<button class="stormbtn' + cls + '" data-storm="night_on" aria-pressed="' + night + '"' + busy + (night ? ' disabled' : '') + '>Night shift on</button>';
    }
    html += '</div>';
    if (st.open) html += '<div id="shiftnow" class="muted">' + (CrewShiftLog.shiftFor(nowIso(), S.storms).indexOf('night') === 0 ? 'Night shift' : 'Day shift') + '</div>';
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
    var st = CrewShiftLog.stormState(S.storms), states = CrewShiftLog.walkStates(S.log, st.storm_id);
    var routes = routesFor(S), mine = routes.filter(function (r) { return r.mine; }), others = routes.filter(function (r) { return !r.mine; });
    readOnly = standing(S) === null;
    var hp = hintPoint(S, canRunNow(ctx) ? liveRoutes(S) : mine);
    ensureHint(ctx, hp);
    var html = '<div id="stormhead" class="stormhead' + (loaded && st.open ? ' open' : '') + '" role="status">' + ctx.esc(headText(st)) + '</div>' + hintHtml(ctx, hp);
    if (canRunNow(ctx)) {
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
      if (readOnly) html += "<section class=\"card\"><h2>You're not on tonight's posted Board.</h2><p class=\"muted\">You can see the routes, but not mark walks. If Matt just added you, ask him to Post again.</p></section>";
      else if (!mine.length) html += '<section class="card"><h2>You\'re not on a route this shift</h2><p class="muted">Ask your lead. To help out on another route, open the other routes below.</p></section>';
      if (others.length) {
        html += '<div class="row"><button id="otherRoutes" aria-expanded="' + showOthers + '">' + (showOthers ? 'Hide other routes' : 'Other routes') + '</button></div>';
        if (showOthers) html += others.map(function (r) { return routeHtml(ctx, r, states); }).join('');
      }
    }
    main.innerHTML = html;
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
    openRoute = null; stormBusy = false; stormErr = ''; warnNow = {};
    hint = { key: '', text: null, at: 0, busy: false };
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
    }
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
    // What this phone holds, for tests: rows, cursor and last-seq per tab.
    state: function () { var S = ctxRef && ctxRef.S; return S ? { log: S.log, storms: S.storms, visits: S.visits, trucks: S.trucks, sheets: S.sheets, posts: S.posts, cursor: S.cursor, last: S.last } : null; } };
})();
if (typeof window !== 'undefined') window.SnowShiftUI = SnowShiftUI;
