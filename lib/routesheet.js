(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'), require('./board'), require('./shiftlog'), require('./clock'));
  else root.CrewRouteSheet = factory(root.CrewTime, root.CrewBoard, root.CrewShiftLog, root.CrewClock);
})(this, function (T, B, SL, CK) {
  'use strict';

  // The printable route sheet (sub-project 5): one route, one shift, built only
  // from what the app already records. It is the office's paper trail for
  // slip-and-fall claims, so two rules matter more than the layout:
  //   - a site on the route is never left off: no taps that shift prints
  //     "Not done this shift";
  //   - a sheet prints names and nothing else about a person. Every person
  //     goes through nameOf(), so a roster field added later (phone, PIN,
  //     weaknesses) cannot reach the page by accident.
  // Pure, and byte-identical in the phone app and the backend: the Print view
  // and the PDF in Drive come from the same code.

  var DONE = ['cleared', 'treated', 'checked'];
  var MACHINES = ['blower', 'snowrator', 'bobcat', 'sweepster'];
  // Bobcat and Snowrator are stationed at a site, so the site carries their
  // unit number. Blowers and Sweepsters travel with the crew: no unit.
  var STATIONED = ['snowrator', 'bobcat'];
  var MACHINE_LABEL = { blower: 'Blower', snowrator: 'Snowrator', bobcat: 'Bobcat', sweepster: 'Sweepster' };

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }
  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function text(v) { return blank(v) ? '' : String(v).trim(); }

  // The only way a person reaches a sheet.
  function nameOf(p) { return p && !blank(p.name) ? String(p.name) : ''; }

  function inStorm(rows, stormId) {
    return (rows || []).filter(function (r) { return r.storm_id === stormId; });
  }

  // ---- time: read off the string, never the machine's zone ------------------

  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  // "2026-12-04T23:55:00.000-09:00" -> "11:55 PM"
  function clock(iso) {
    if (!ISO.test(String(iso || ''))) return '';
    var h = Number(iso.slice(11, 13)), m = iso.slice(14, 16);
    return (h % 12 === 0 ? 12 : h % 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }
  // -> "12/4 11:55 PM". Anything that is not an iso time prints as it came.
  function stamp(iso) {
    if (!iso) return '';
    if (!ISO.test(String(iso))) return String(iso);
    return Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) + ' ' + clock(iso);
  }
  function addDays(ymd, n) {
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  // Local wall-clock end of a shift, as a string comparable with an `at`'s
  // first 19 characters. A night runs to the next 9 AM. A day ends when that
  // evening's night_on was logged (the weather says when the night starts, and
  // Matt sets up the night crew then), else at midnight. Only used to pick
  // which board moves a no-taps sheet's crew line counts.
  function shiftEndLocal(shiftId, o) {
    var s = T.parseShift(shiftId);
    if (s.kind === 'night') return addDays(s.date, 1) + 'T09:00:00';
    var ons = (o.storms || []).filter(function (r) {
      return r.kind === 'night_on' && r.storm_id === o.storm_id && String(r.at).slice(0, 10) === s.date &&
        Number(String(r.at).slice(11, 13)) >= T.SHIFT_CUTOVER_HOUR;
    }).map(function (r) { return String(r.at).slice(0, 19); }).sort();
    return ons.length ? ons[0] : addDays(s.date, 1) + 'T00:00:00';
  }

  // ---- routes ---------------------------------------------------------------

  // "N10" sorts after "N3": by the letters, then the number, then the whole name.
  function routeKey(name) {
    var m = /^(\D*)(\d+)/.exec(String(name || ''));
    return m ? { prefix: m[1].toLowerCase(), num: Number(m[2]) } : { prefix: String(name || '').toLowerCase(), num: Infinity };
  }
  function byRouteName(a, b) {
    var x = routeKey(a.name), y = routeKey(b.name);
    if (x.prefix !== y.prefix) return x.prefix < y.prefix ? -1 : 1;
    if (x.num !== y.num) return x.num < y.num ? -1 : 1;
    return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0;
  }
  function liveRoutes(o) {
    return (o.routes || []).filter(function (r) { return r.archived !== true; });
  }
  function siteIdsOf(route) { return (route && route.site_ids) || []; }

  // What one route did in one shift of one storm.
  function activity(o, route, shiftId) {
    var ids = siteIdsOf(route);
    var onRoute = function (r) { return ids.indexOf(r.site_id) !== -1 && r.shift_id === shiftId; };
    var taps = inStorm(o.log, o.storm_id).filter(onRoute).sort(bySeq);
    var visits = inStorm(o.visits, o.storm_id).filter(onRoute);
    var trucks = (o.trucks || []).filter(function (t) { return t.route_id === route.id && t.shift_id === shiftId; });
    return { taps: taps, visits: visits, trucks: trucks };
  }

  // ---- crew -----------------------------------------------------------------

  function newestPost(posts, shiftId) {
    var best = null, bestAt = -Infinity;
    (posts || []).forEach(function (p) {
      if (p.shift !== shiftId) return;
      var t = Date.parse(p.posted_at);
      if (isNaN(t)) t = -Infinity;
      if (!best || t >= bestAt) { best = p; bestAt = t; }
    });
    return best;
  }

  // {lead, members, source}: the shift's post if it lists this route, else
  // the board replayed from the moves made by the route's last tap that shift
  // (or, with no taps, by the end of the shift).
  function crewFor(o, route, shiftId, taps) {
    var crewById = {};
    (o.crew || []).forEach(function (c) { crewById[c.id] = c; });

    var post = newestPost(o.posts, shiftId);
    var slot = post && (post.routes || []).filter(function (r) { return r.id === route.id; })[0];
    if (slot) {
      var pname = function (id) { return nameOf((post.people || {})[id]) || nameOf(crewById[id]) || 'Unknown'; };
      return { lead: slot.lead ? pname(slot.lead) : null, members: (slot.members || []).map(pname), source: 'post' };
    }

    // R24: a typed row's own time is when it was submitted (maybe the next
    // day), so it never sets the cut-off; with only typed rows the end of the
    // shift does, as with no taps.
    var lastTap = null;
    for (var i = taps.length - 1; i >= 0; i--) {
      if (taps[i].state !== 'typed') { lastTap = taps[i].at; break; }
    }
    var end = shiftEndLocal(shiftId, o);
    // M2: and never past the shift's own end: R28 files a Left tapped at 9:10 AM under the night, and a helper moved on at 9:05 AM
    // was on the night's crew, not the day's.
    var moves = (o.moves || []).filter(function (m) {
      return (lastTap ? Date.parse(m.at) <= Date.parse(lastTap) : true) && String(m.at).slice(0, 19) < end;
    });
    var slotNow = B.boardFrom(moves, o.routes || [], crewById).routes[route.id] || { lead: null, members: [] };
    var name = function (id) { return nameOf(crewById[id]) || 'Unknown'; };
    return { lead: slotNow.lead ? name(slotNow.lead) : null, members: slotNow.members.map(name), source: 'board' };
  }

  // One route's crew line in one shift, by the sheet's own rule (handoff.js:
  // the day routes of a handoff).
  function crewOf(o, route, shiftId) { return crewFor(o, route, shiftId, activity(o, route, shiftId).taps); }

  // ---- which sheets ---------------------------------------------------------

  // The shifts the storm covers, as shiftKeys: from the shift its start row
  // falls in, through the shift its End falls in (or, while it is still open,
  // the latest shift anyone logged). null when the storm has no start row.
  function stormSpan(o, seenKeys) {
    var rows = (o.storms || []).filter(function (r) { return r.storm_id === o.storm_id; }).sort(bySeq);
    var start = rows.filter(function (r) { return r.kind === 'start'; })[0];
    if (!start) return null;
    var lo = T.shiftKey(SL.shiftFor(start.at, o.storms));
    var last = rows.filter(function (r) { return r.kind === 'start' || r.kind === 'end' || r.kind === 'reopen'; }).pop();
    var hi = lo;
    if (last.kind === 'end') hi = T.shiftKey(SL.shiftFor(last.at, o.storms));
    else seenKeys.forEach(function (k) { if (k > hi) hi = k; });
    return { lo: lo, hi: hi };
  }

  // Does the newest Post for exactly this shift put anyone on this route?
  function postHasCrew(o, route, shiftId) {
    var post = newestPost(o.posts, shiftId);
    var slot = post && (post.routes || []).filter(function (r) { return r.id === route.id; })[0];
    return !!slot && (!!slot.lead || (slot.members || []).length > 0);
  }

  // One entry per live route and shift where
  //   (a) the route has a Log row or a site card in that shift, or
  //   (b) the newest Post for that exact shift puts a lead or members on it.
  // The Board never makes a sheet: it is a plan, and it keeps its crews all
  // storm, so it would print a sheet for every route in every shift. (It does
  // fill in the crew line of a sheet that exists for another reason.)
  // Nor does a Truck row (final review C1): a truck is header data on a sheet
  // that exists for its taps, cards or Post. A truck set ahead for a shift
  // nobody worked made a sheet of "Not done" for a crew that never went out.
  // The storm's shifts: the ones its Log and Visits rows name, and any shift
  // inside the storm's span that has a Post (a posted crew that logged
  // nothing is a true "Not done").
  function sheetsFor(o) {
    var shifts = {};
    inStorm(o.log, o.storm_id).concat(inStorm(o.visits, o.storm_id)).forEach(function (r) {
      if (T.parseShift(r.shift_id)) shifts[r.shift_id] = true;
    });
    var span = stormSpan(o, Object.keys(shifts).map(T.shiftKey));
    if (span) {
      (o.posts || []).forEach(function (p) {
        var k = T.shiftKey(p.shift);
        if (k && k >= span.lo && k <= span.hi) shifts[p.shift] = true;
      });
    }

    var order = Object.keys(shifts).sort(function (a, b) { return T.shiftKey(a) < T.shiftKey(b) ? -1 : T.shiftKey(a) > T.shiftKey(b) ? 1 : 0; });
    var routes = liveRoutes(o).slice().sort(byRouteName);
    var out = [];
    order.forEach(function (shiftId) {
      routes.forEach(function (route) {
        var a = activity(o, route, shiftId);
        var has = a.taps.length || a.visits.length || postHasCrew(o, route, shiftId);
        if (has) out.push({ route_id: route.id, shift_id: shiftId });
      });
    });
    return out;
  }

  // ---- one sheet's data -----------------------------------------------------

  function minutesOf(v) {
    if (blank(v)) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // ---- who helped (help visits, Matt 11/15/26) ----------------------------------------------------------------------------
  // A crew member the Board has on a route may tap at any site; off the route the Board has them on, the server saves the row with
  // off_route: true (Code.js offRoute_), walk taps and Arrived / Left / Undo alike. The people who helped at a site that shift: the
  // flagged rows there, once per person (by_key; a row with no by_key is keyed by its name), in the order of each person's first
  // flagged row, with the route the Board had them on AT THAT ROW'S TIME (a person moved on afterwards helped from the route they
  // were on). A typed row is the dispatcher's note, never a person on the ground. Built from the Log, the Moves and the Routes,
  // and tolerant of a world without any of them (the phone's copy may not carry moves, routes or crew): a person with no route
  // found prints the name alone. { name, route }, route '' when unknown.
  function helpersAt(o, siteId, shiftId, stormLog) {
    var flagged = stormLog.filter(function (r) {
      return r.site_id === siteId && r.shift_id === shiftId && r.off_route === true && r.state !== 'typed';
    }).sort(bySeq);
    if (!flagged.length) return [];

    // A card gone or archived since still gives the route the person was on then: the Board is replayed from the Moves alone, so
    // each card is read for its name only, and a person with no card at all is placed by id.
    var crewById = {};
    (o.crew || []).forEach(function (c) { crewById[c.id] = { id: c.id, name: c.name }; });
    var routes = o.routes || [];

    var seen = {}, out = [];
    flagged.forEach(function (r) {
      var id = text(r.by_key);
      var key = id ? 'key:' + id : 'name:' + text(r.by_name);
      if (seen[key]) return;
      seen[key] = true;
      var route = '';
      if (id) {
        if (!crewById[id]) crewById[id] = { id: id };
        var asOf = (o.moves || []).filter(function (m) { return Date.parse(m.at) <= Date.parse(r.at); });
        var where = B.whereIs(B.boardFrom(asOf, routes, crewById), id);
        var found = where ? routes.filter(function (x) { return x.id === where.route; })[0] : null;
        route = found ? String(found.name || found.id) : '';
      }
      out.push({ name: text(r.by_name) || nameOf(crewById[id]) || 'Unknown', route: route });
    });
    return out;
  }

  function siteData(o, site, shiftId, stormLog, stormVisits) {
    var rows = stormLog.filter(function (r) { return r.site_id === site.id && r.shift_id === shiftId && r.zone_id !== '*'; }).sort(bySeq);

    var entry = function (name, r, striped, zoneId) {
      var tapped = !!r && r.state !== 'none';
      return {
        name: name,
        kind: zoneId === 'whole' ? 'whole' : (/^curbs-\d+$/.test(zoneId) ? 'curb' : 'walk'),
        new_concrete: striped === true,
        state: r ? r.state : 'none',
        note: tapped ? String(r.note || '') : '',
        by_name: tapped ? String(r.by_name || '') : '',
        at: tapped ? String(r.at || '') : '',
        off_route: tapped && r.off_route === true,
        snowing_warned: tapped && r.snowing_warned === true,
      };
    };

    var walksOf = function (passRows) {
      var newest = {};
      passRows.forEach(function (r) { newest[r.zone_id] = r; });
      var known = {};
      var list = SL.walksFor(site.id, o.zones).map(function (w) { known[w.zone_id] = true; return entry(w.name, newest[w.zone_id], w.new_concrete, w.zone_id); });
      // A tap on a zone that has since been archived (or on 'whole', from before
      // zones were drawn) is still the record of what happened: it prints too.
      Object.keys(newest).filter(function (z) { return !known[z] && newest[z].state !== 'none'; })
        .sort(function (a, b) { return bySeq(newest[a], newest[b]); })
        .forEach(function (z) {
          var zone = (o.zones || []).filter(function (x) { return x.id === z; })[0];
          list.push(entry(zone ? zone.name : (z === 'whole' ? 'Whole site' : (/^curbs-\d+$/.test(z) ? 'Curbs' : 'Removed zone')), newest[z], !!zone && zone.new_concrete === true, z));
        });
      return list;
    };
    var isDone = function (list) { return list.length > 0 && list.every(function (w) { return DONE.indexOf(w.state) !== -1; }); };

    // Check night (design 11/24/26): in a check block at a visited site, a walk nobody tapped is checked by the visit
    // itself. Derived, so the sheet can say "the rest checked" and print no name or time on it.
    var mode = SL.checkShift(o.log, o.storms, o.storm_id, shiftId);
    var cut = mode === 'storm' ? null : SL.checkCut(o.log, o.storm_id);
    var visited = mode !== 'storm' && SL.checkVisited(o.log, o.storms, o.storm_id, site.id, shiftId);
    var derive = function (list, isCheck) {
      if (!isCheck || !visited) return list;
      return list.map(function (w) { return w.state === 'none' ? Object.assign({}, w, { state: 'checked', derived: true }) : w; });
    };

    // Clean again (Part B1, Matt 10/4/26): one block per pass in this shift, each
    // with its own times and walks; the site's own fields are the latest pass.
    // A check pass starts before the cut (a Clean again's seq, or 0 for the first pass); the pass that began at the stormed
    // row is the storm's. On a night that is not split every pass is a check pass (check) or none is (storm).
    var passes = SL.passSegments(stormLog, o.storm_id, site.id, shiftId).map(function (seg) {
      var isCheck = mode === 'check' || (mode === 'split' && (seg.again ? Number(seg.again.seq) : 0) < Number(cut.seq));
      var pt = SL.siteTimes(seg.rows, site.id, shiftId), pl = derive(walksOf(seg.rows), isCheck);
      return { n: seg.n, again: seg.again ? { at: String(seg.again.at || ''), by_name: String(seg.again.by_name || '') } : null,
        check: isCheck, stormed: !!seg.again && seg.again.state === 'stormed',
        start: pt.start, finish: pt.finish, done: isDone(pl), walks: pl };
    });
    // A split night always has a check pass first, even a site with only Arrived / Left rows (they make no pass).
    if (mode === 'split' && !passes.some(function (p) { return p.check; })) {
      var firstWalks = derive(walksOf([]), true);
      passes.unshift({ n: 1, again: null, check: true, stormed: false, start: null, finish: null, done: isDone(firstWalks), walks: firstWalks });
    }
    var last = passes.length ? passes[passes.length - 1] : null;
    var list = last ? last.walks : derive(walksOf(rows), mode === 'check');

    var t = last ? { start: last.start, finish: last.finish } : SL.siteTimes(stormLog, site.id, shiftId);
    // The heading's In and Out (times, 11/10/26): a side that was typed or tapped (Arrived / Left) comes from
    // siteClock; a side that is neither keeps what this sheet printed before (the walk taps, a Clean again's last
    // pass). The per-pass lines above stay on walk taps.
    var clk = SL.siteClock(stormLog, site.id, shiftId);
    var marked = function (how) { return how === 'typed' || how === 'tapped'; };
    var inAt = marked(clk.startHow) ? clk.start : t.start, outAt = marked(clk.finishHow) ? clk.finish : t.finish;
    var inHow = marked(clk.startHow) ? clk.startHow : (t.start !== null ? 'walk' : null);
    var outHow = marked(clk.finishHow) ? clk.finishHow : (t.finish !== null ? 'walk' : null);
    var cards = SL.visitTotals(stormVisits, site.id, shiftId).cards;
    var units = site.units || {};

    var equipment = [];
    MACHINES.forEach(function (machine) {
      var minutes = [];
      cards.forEach(function (c) {
        var m = minutesOf((c.equipment || {})[machine]);
        if (m !== null) minutes.push({ by_name: String(c.by_name || ''), min: m });
      });
      if (minutes.length) equipment.push({ machine: machine, unit: STATIONED.indexOf(machine) !== -1 ? text(units[machine]) : '', minutes: minutes });
    });

    return {
      id: site.id,
      name: String(site.name || site.id),
      start: inAt,
      finish: outAt,
      startHow: inHow,
      finishHow: outHow,
      done: isDone(list),
      walks: list,
      passes: passes,
      depth: cards.filter(function (c) { return !blank(c.depth_in); })
        .map(function (c) { return { by_name: String(c.by_name || ''), depth_in: text(c.depth_in) }; }),
      materials: {
        needed: text(site.materials_needed),
        used: cards.filter(function (c) { return !blank(c.materials_used); })
          .map(function (c) { return { by_name: String(c.by_name || ''), materials_used: text(c.materials_used) }; }),
      },
      equipment: equipment,
      helpers: helpersAt(o, site.id, shiftId, stormLog),
      check: mode === 'check',
      visited: visited,
    };
  }

  function sheetData(o, routeId, shiftId) {
    var route = (o.routes || []).filter(function (r) { return r.id === routeId; })[0] || { id: routeId, name: routeId, site_ids: [] };
    var a = activity(o, route, shiftId);
    var stormLog = inStorm(o.log, o.storm_id);
    var stormVisits = inStorm(o.visits, o.storm_id);
    var siteById = {};
    (o.sites || []).forEach(function (s) { siteById[s.id] = s; });

    var truckRow = a.trucks.slice().sort(bySeq).pop();
    var started = (o.storms || []).filter(function (r) { return r.kind === 'start' && r.storm_id === o.storm_id; }).sort(bySeq)[0];
    var checkMode = SL.checkShift(o.log, o.storms, o.storm_id, shiftId);
    var cutRow = checkMode === 'storm' ? null : SL.checkCut(o.log, o.storm_id);

    var sites = siteIdsOf(route).map(function (id) { return siteById[id] || { id: id, name: id }; })
      .map(function (s) { return siteData(o, s, shiftId, stormLog, stormVisits); })
      .filter(function (s, i) {
        // A site archived since is no longer on the route, unless it was worked.
        var raw = siteById[siteIdsOf(route)[i]];
        if (!raw || raw.archived !== true) return true;
        // Kept when worked: any tap, or any site card (even one with only materials).
        return s.start !== null || s.finish !== null || stormVisits.some(function (v) { return v.site_id === raw.id && v.shift_id === shiftId; });
      });

    return {
      route_id: route.id,
      route: String(route.name || route.id),
      shift_id: shiftId,
      shift_label: T.shiftLabel(shiftId),
      storm_started: started ? started.at : null,
      check_night: checkMode !== 'storm',
      check_mode: checkMode,
      stormed_at: cutRow ? cutRow.at : null,
      crew: crewFor(o, route, shiftId, a.taps),
      truck: truckRow && !blank(truckRow.truck) ? { truck: String(truckRow.truck), by_name: String(truckRow.by_name || '') } : null,
      sites: sites,
    };
  }

  // ---- the page -------------------------------------------------------------

  function esc(s) {
    var t = String(s === null || s === undefined ? '' : s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var CSS = [
    '@page { size: letter; margin: 0.5in; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; color: #000; background: #fff; font: 11pt/1.35 Arial, Helvetica, sans-serif; }',
    '.sheet { page-break-after: always; }',
    '.sheet:last-child { page-break-after: auto; }',
    'h1 { font-size: 20pt; margin: 0 0 2pt; }',
    'h1 span { font-weight: normal; font-size: 14pt; margin-left: 8pt; }',
    '.meta { margin: 0 0 8pt; color: #333; }',
    '.head { border-top: 2pt solid #000; border-bottom: 1pt solid #000; padding: 4pt 0; margin-bottom: 10pt; }',
    '.head div { margin: 1pt 0; }',
    '.site { border: 1pt solid #000; padding: 5pt 7pt; margin: 0 0 7pt; page-break-inside: avoid; }',
    '.site h2 { font-size: 12.5pt; margin: 0 0 3pt; }',
    '.site h2 span { font-weight: normal; font-size: 10pt; margin-left: 8pt; }',
    '.site h3 span { font-weight: normal; margin-left: 8pt; }',
    '.notdone { margin: 2pt 0; font-weight: bold; }',
    '.site ul { margin: 2pt 0; padding-left: 14pt; }',
    '.site li, .line { margin: 1pt 0; }',
    '.note { margin-left: 8pt; font-style: italic; }',
    '.flag { font-weight: bold; }',
    'table.times { border-collapse: collapse; width: 100%; }',
    'table.times th, table.times td { border: 1pt solid #000; padding: 3pt 6pt; text-align: left; }',
    'footer { margin-top: 10pt; padding-top: 4pt; border-top: 1pt solid #000; font-size: 9pt; color: #333; }',
  ].join('\n');

  // " 12/4 9:55 PM" or " 12/4 9:55 PM (typed)"; nothing at all for a side with no time (the word before it stands alone).
  function timeText(iso, how) {
    if (blank(iso)) return '';
    return ' ' + esc(stamp(iso)) + (how === 'typed' ? ' (typed)' : '');
  }

  // A visit's times (Matt, 11/14/26, "Print one time"): when BOTH sides come from walk taps and print the same text, as after
  // one Site done tap (every row saved at one time), the time prints once, "Done 12/5 2:14 AM", not an In and an Out that
  // read like a zero-minute visit. A typed or tapped side (Arrived / Left) always prints In and Out. Which walks were done
  // is the walk lines' job, not this one's.
  function timesHtml(start, startHow, finish, finishHow) {
    if (startHow === 'walk' && finishHow === 'walk' && stamp(start) === stamp(finish)) return 'Done ' + esc(stamp(start));
    return 'In' + timeText(start, startHow) + ' &middot; Out' + timeText(finish, finishHow);
  }

  // One walk's line, as the sheet has always printed it. The walk record prints it in a list; the billing page prints
  // it alone for a walk that needs its own line (a Problem or a note), so the two parts read the same text.
  function walkLine(w) {
    var line = '<b>' + esc(w.name) + '</b>: ' + esc(SL.stateWord(w.state, w.new_concrete));
    if (w.new_concrete === true) line += ' &middot; ' + esc(SL.NO_SALT);
    if (w.state !== 'none') {
      if (w.by_name) line += ' &middot; ' + esc(w.by_name);
      if (w.at) line += ' &middot; ' + esc(stamp(w.at));
      if (w.snowing_warned) line += ' &middot; <span class="flag">' + esc(SL.stateWord('treated', w.new_concrete)) + ' while snowing</span>';
      if (w.off_route) line += ' &middot; <span class="flag">Off route</span>';
    }
    if (!blank(w.note)) line += '<div class="note">' + esc(w.note) + '</div>';
    return line;
  }

  function siteHeading(s) {
    return '<h2>' + esc(s.name) + (s.start || s.finish ? '<span>' + timesHtml(s.start, s.startHow, s.finish, s.finishHow) + '</span>' : '') + '</h2>';
  }
  function passHeading(p, split) {
    var times = p.start ? '<span>' + timesHtml(p.start, 'walk', p.finish, 'walk') + '</span>' : '';
    var again = p.again ? ' &middot; Clean again ' + esc(stamp(p.again.at)) + (p.again.by_name ? ' by ' + esc(p.again.by_name) : '') : '';
    // A check night that became a storm (design 11/24/26): the pass that began at the stormed row is the storm's, the passes
    // before it are the check. A night that did not split keeps "Pass N".
    if (p.stormed) return '<h3>Storm &middot; became a storm ' + esc(stamp(p.again.at)) + (p.again.by_name ? ' by ' + esc(p.again.by_name) : '') + times + '</h3>';
    if (split && p.check) return '<h3>Check night' + again + times + '</h3>';
    return '<h3>Pass ' + esc(p.n) + again + times + '</h3>';
  }
  function footer(madeAt, updated) {
    return '<footer>Made by Shovel Command from crew taps · ' + esc(stamp(madeAt)) + (updated ? ' (updated)' : '') + '</footer>';
  }
  function isMulti(s) { return s.passes && (s.passes.length > 1 || (s.passes[0] && s.passes[0].n > 1)); }
  // A site prints one block of walks, or one block per pass when it was cleaned again.
  function blocksOf(s) { return isMulti(s) ? s.passes : [{ walks: s.walks, check: s.check === true }]; }

  // What a block says when it has nothing else to say: a check block at a site nobody visited is "Not checked"; a storm block
  // nobody tapped is "Not done this shift" (a site's only block too, as ever); '' when the block has walks to print.
  function emptyNote(p, s, multi) {
    if (p.check) return s.visited ? '' : 'Not checked';
    var untouched = p.walks.every(function (w) { return w.state === 'none'; });
    return untouched && (p.stormed === true || !multi) ? 'Not done this shift' : '';
  }

  // A check block at a visited site, as the billing page prints it (design 11/24/26): what was tapped, counted, then "the rest
  // checked" for walks the visit covered. Nothing tapped: "Checked, nothing needed". A Problem or a note keeps its own line.
  function checkLines(walks) {
    var f = fold(walks), h = [], parts = [];
    var real = (walks || []).filter(function (w) { return w.state !== 'none' && w.derived !== true; });
    if (!real.length) {
      h.push('<div class="line">Checked, nothing needed</div>');
    } else {
      var plain = real.filter(function (w) { return w.kind !== 'curb'; }), curbs = real.filter(function (w) { return w.kind === 'curb'; });
      var derivedPlain = (walks || []).some(function (w) { return w.derived === true && w.kind !== 'curb'; });
      var derivedCurb = (walks || []).some(function (w) { return w.derived === true && w.kind === 'curb'; });
      var n = function (test) { return plain.filter(test).length; };
      var counts = [];
      [['cleared', n(function (w) { return w.state === 'cleared'; })],
        ['treated', n(function (w) { return w.state === 'treated' && !w.new_concrete; })],
        ['sanded', n(function (w) { return w.state === 'treated' && w.new_concrete; })],
        ['checked', n(function (w) { return w.state === 'checked'; })]].forEach(function (c) { if (c[1]) counts.push(c[1] + ' ' + c[0]); });
      if (derivedPlain) counts.push('the rest checked');
      if (counts.length) parts.push('<b>Walks:</b> ' + counts.join(' &middot; '));
      if (curbs.length) {
        var done = curbs.filter(function (w) { return DONE.indexOf(w.state) !== -1; }).length;
        parts.push('<b>Curbs:</b> ' + done + ' done' + (derivedCurb ? ' &middot; the rest checked' : ''));
      }
      if (parts.length) h.push('<div class="line">' + parts.join(' &middot; ') + '</div>');
    }
    f.lines.forEach(function (w) { h.push('<div class="line">' + walkLine(w) + '</div>'); });
    if (f.offRoute.length) h.push('<div class="line"><b>Off route:</b> ' + f.offRoute.map(function (o) { return esc(o.by_name) + ' ' + plural(o.n, 'walk'); }).join(', ') + '</div>');
    if (f.snowing.treated) h.push('<div class="line"><b>Treated while snowing:</b> ' + plural(f.snowing.treated, 'walk') + '</div>');
    if (f.snowing.sanded) h.push('<div class="line"><b>Sanded while snowing:</b> ' + plural(f.snowing.sanded, 'walk') + '</div>');
    return h;
  }

  function metaLine(data) {
    if (!data.storm_started) return '';
    if (!data.check_night) return '<p class="meta">Storm started ' + esc(stamp(data.storm_started)) + '</p>';
    return '<p class="meta">Check night started ' + esc(stamp(data.storm_started)) +
      (data.stormed_at ? ' &middot; Became a storm ' + esc(stamp(data.stormed_at)) : '') + '</p>';
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // One block of walks (a site's, or one pass's) as the billing page prints it: a count, the names left Not done, a full
  // line for each walk that needs one (a Problem or a note, curb items too), then the flags as counts. A curb item left
  // Not done with no note is never named.
  function billingLines(walks) {
    var f = fold(walks), h = [], parts = [];
    var wholeWalk = f.whole ? (walks || []).filter(function (w) { return w.kind === 'whole'; })[0] : null;
    if (wholeWalk) {
      if (f.lines.indexOf(wholeWalk) === -1) parts.push('<b>Whole site</b>: ' + esc(SL.stateWord(wholeWalk.state, wholeWalk.new_concrete)));
    } else if (f.total > 0) {
      parts.push('<b>Walks:</b> ' + f.done + ' of ' + f.total + ' done' + (f.treated ? ' &middot; ' + f.treated + ' treated' : '') + (f.sanded ? ' &middot; ' + f.sanded + ' sanded' : ''));
    }
    if (f.curbTotal > 0) parts.push('<b>Curbs:</b> ' + f.curbDone + ' of ' + f.curbTotal);
    if (parts.length) h.push('<div class="line">' + parts.join(' &middot; ') + '</div>');
    if (f.notDone.length) h.push('<div class="line"><b>Not done:</b> ' + f.notDone.map(esc).join(', ') + '</div>');
    f.lines.forEach(function (w) { h.push('<div class="line">' + walkLine(w) + '</div>'); });
    if (f.offRoute.length) h.push('<div class="line"><b>Off route:</b> ' + f.offRoute.map(function (o) { return esc(o.by_name) + ' ' + plural(o.n, 'walk'); }).join(', ') + '</div>');
    if (f.snowing.treated) h.push('<div class="line"><b>Treated while snowing:</b> ' + plural(f.snowing.treated, 'walk') + '</div>');
    if (f.snowing.sanded) h.push('<div class="line"><b>Sanded while snowing:</b> ' + plural(f.snowing.sanded, 'walk') + '</div>');
    return h;
  }

  // The billing page: one short section per route and shift. A site on the route is never left off ("Not done this shift").
  function sheetBody(data, madeAt, updated) {
    var h = [];
    h.push('<section class="sheet">');
    h.push('<h1>Route ' + esc(data.route) + '<span>' + esc(data.shift_label) + '</span></h1>');
    if (data.storm_started) h.push(metaLine(data));

    var crew = data.crew || { lead: null, members: [], source: 'board' };
    h.push('<div class="head">');
    h.push('<div><b>Lead:</b> ' + (crew.lead ? esc(crew.lead) : '—') + '</div>');
    h.push('<div><b>Crew:</b> ' + (crew.members.length ? crew.members.map(esc).join(', ') : '—') +
      (crew.source === 'board' ? ' <i>from the Board (not posted)</i>' : '') + '</div>');
    h.push('<div><b>Truck:</b> ' + (data.truck ? esc(data.truck.truck) + (data.truck.by_name ? ' <i>(set by ' + esc(data.truck.by_name) + ')</i>' : '') : '—') + '</div>');
    h.push('</div>');

    data.sites.forEach(function (s) {
      h.push('<div class="site">');
      h.push(siteHeading(s));
      if (s.helpers && s.helpers.length) {
        h.push('<div class="line"><b>Helped by:</b> ' + s.helpers.map(function (p) { return esc(p.name) + (p.route ? ' (' + esc(p.route) + ')' : ''); }).join(', ') + '</div>');
      }
      var multi = isMulti(s), blocks = blocksOf(s), split = data.check_mode === 'split';
      blocks.forEach(function (p) {
        if (multi) h.push(passHeading(p, split));
        var note = emptyNote(p, s, multi);
        if (note) h.push('<p class="notdone">' + note + '</p>');
        else (p.check ? checkLines(p.walks) : billingLines(p.walks)).forEach(function (l) { h.push(l); });
      });
      if (s.depth.length) {
        h.push('<div class="line"><b>Snow depth:</b> ' + s.depth.map(function (d) { return esc(d.by_name || '—') + ' ' + esc(d.depth_in) + '&quot;'; }).join(', ') + '</div>');
      }
      if (s.materials.needed || s.materials.used.length) {
        h.push('<div class="line"><b>Materials needed:</b> ' + (s.materials.needed ? esc(s.materials.needed) : '—') +
          ' &middot; <b>Used:</b> ' + (s.materials.used.length
            ? s.materials.used.map(function (m) { return esc(m.by_name || '—') + ' ' + esc(m.materials_used); }).join('; ') : '—') + '</div>');
      }
      s.equipment.forEach(function (e) {
        h.push('<div class="line"><b>' + esc(MACHINE_LABEL[e.machine] || e.machine) + (e.unit ? ' ' + esc(e.unit) : '') + '</b>: ' +
          e.minutes.map(function (m) { return esc(m.by_name || '—') + ' ' + esc(m.min) + ' min'; }).join(', ') + '</div>');
      });
      h.push('</div>');
    });
    if (!data.sites.length) h.push('<p class="notdone">No sites on this route.</p>');

    h.push(footer(madeAt, updated));
    h.push('</section>');
    return h.join('\n');
  }

  // The walk record: every walk, one line each, exactly as the sheet has always printed them. The office's paper trail.
  function recordBody(data, madeAt, updated) {
    var h = [];
    h.push('<section class="sheet record">');
    h.push('<h1>Walk record<span>Route ' + esc(data.route) + ' &middot; ' + esc(data.shift_label) + '</span></h1>');
    data.sites.forEach(function (s) {
      h.push('<div class="site">');
      h.push(siteHeading(s));
      var multi = isMulti(s), blocks = blocksOf(s), split = data.check_mode === 'split';
      blocks.forEach(function (p) {
        if (multi) h.push(passHeading(p, split));
        var note = emptyNote(p, s, multi);
        if (note) { h.push('<p class="notdone">' + note + '</p>'); return; }
        h.push('<ul>');
        p.walks.forEach(function (w) { h.push('<li>' + walkLine(w) + '</li>'); });
        h.push('</ul>');
      });
      h.push('</div>');
    });
    if (!data.sites.length) h.push('<p class="notdone">No sites on this route.</p>');
    h.push(footer(madeAt, updated));
    h.push('</section>');
    return h.join('\n');
  }

  // One self-contained page: inline CSS, no external anything. The billing page, then the walk record.
  function sheetHtml(data, madeAt, updated) {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
      '<title>' + esc(data.route + ' ' + data.shift_label) + '</title>' +
      '<style>\n' + CSS + '\n</style></head><body>\n' + sheetBody(data, madeAt, updated) + '\n' + recordBody(data, madeAt, updated) + '\n</body></html>';
  }

  // "N3 Night of 12-4.pdf", or "N3 Night of 12-4 (updated 9-12 AM).pdf". A
  // slash or colon cannot live in a file name, so each becomes a dash.
  function fileSafe(s) { return String(s === null || s === undefined ? '' : s).replace(/[\\\/:*?"<>|]/g, '-'); }
  function fileName(data, madeAt, updated) {
    var name = fileSafe(data.route) + ' ' + fileSafe(data.shift_label);
    if (updated) name += ' (updated ' + fileSafe(ISO.test(String(madeAt || '')) ? clock(madeAt) : madeAt) + ')';
    return name + '.pdf';
  }

  // ---- the Crew times sheet (times, 11/10/26) --------------------------------

  function clockShiftsOf(o) {
    var shifts = {};
    inStorm(o.log, o.storm_id).concat(inStorm(o.visits, o.storm_id)).forEach(function (r) {
      if (T.parseShift(r.shift_id)) shifts[r.shift_id] = true;
    });
    return shifts;
  }

  // Each shift the storm covers where somebody worked: [{ shift_id }], oldest first. The Clock tab is not cut at a
  // storm (two storms can share a night), so the caller hands over the rows of ONE storm's span, and a night counts
  // only inside the span the storm's own rows make. A night whose rows print no line (every start taken back) is none.
  // The ONE shift before the storm's start shift also counts, when a line that would print in it is still open (a
  // Start and no End) or ends at or after the storm's start: a crew already on the clock when the storm is called
  // (R19). Clock rows are not cut by storm_id (a Start tapped before the storm opened carries none).
  function shiftBefore(shiftId) {
    var s = T.parseShift(shiftId);
    if (!s) return null;
    if (s.kind === 'night') return T.shiftId('day', s.date);
    return T.shiftId('night', addDays(s.date, -1));
  }
  function onTheClockAtStart(o, shiftId, startAt) {
    return CK.nightRows(o.clock, shiftId, o.crew).some(function (r) {
      return (r.start !== null && r.end === null) || (r.end !== null && CK.minutes(startAt, r.end) !== null);
    });
  }

  function clockSheetsFor(o) {
    var seen = clockShiftsOf(o), named = {};
    (o.clock || []).forEach(function (r) {
      if (r && T.parseShift(r.shift_id)) { named[r.shift_id] = true; seen[r.shift_id] = true; }
    });
    var span = stormSpan(o, Object.keys(seen).map(T.shiftKey));
    var logged = clockShiftsOf(o);
    var first = (o.storms || []).filter(function (r) { return r.storm_id === o.storm_id && r.kind === 'start'; }).sort(bySeq)[0];
    var before = first ? shiftBefore(SL.shiftFor(first.at, o.storms)) : null;
    return Object.keys(named).filter(function (id) {
      var k = T.shiftKey(id);
      if (span && id === before && k < span.lo) return onTheClockAtStart(o, id, first.at);
      return (span ? k >= span.lo && k <= span.hi : !!logged[id]) && CK.nightRows(o.clock, id, o.crew).length > 0;
    }).sort(function (a, b) { return T.shiftKey(a) < T.shiftKey(b) ? -1 : T.shiftKey(a) > T.shiftKey(b) ? 1 : 0; })
      .map(function (id) { return { shift_id: id }; });
  }

  // One night's people: a card's name if the caller has that card, else the crew id (an archived person who worked
  // is never left off). By name (case-insensitive), then crew id.
  function clockSheetData(o, shiftId) {
    var cardOf = {};
    (o.crew || []).forEach(function (c) { cardOf[String(c.id)] = c; });
    // M5: a person whose roster card is gone prints the name their newest Clock row carries (the name the row was written with);
    // the crew id only when no row of theirs carries one.
    var rowName = {};
    (o.clock || []).slice().sort(bySeq).forEach(function (r) { if (r && !blank(r.name)) rowName[String(r.crew_id)] = String(r.name); });
    var rows = CK.nightRows(o.clock, shiftId, o.crew).map(function (r) {
      var card = cardOf[String(r.crew_id)];
      return { crew_id: r.crew_id, name: card && !blank(card.name) ? String(card.name) : (rowName[String(r.crew_id)] || String(r.crew_id)),
        start: r.start, end: r.end, startHow: r.startHow, endHow: r.endHow, minutes: r.minutes, hours: r.minutes === null ? '' : CK.hhmm(r.minutes) };
    });
    rows.sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
      return String(a.crew_id) < String(b.crew_id) ? -1 : String(a.crew_id) > String(b.crew_id) ? 1 : 0;
    });
    return { title: 'Crew times', shift_id: shiftId, shiftLabel: T.shiftLabel(shiftId), rows: rows };
  }

  function clockSheetBody(data, madeAt) {
    var h = [];
    h.push('<section class="sheet">');
    h.push('<h1>' + esc(data.title) + '<span>' + esc(data.shiftLabel) + '</span></h1>');
    h.push('<table class="times"><thead><tr><th>Name</th><th>Start</th><th>End</th><th>Hours</th></tr></thead><tbody>');
    data.rows.forEach(function (r) {
      var cell = function (iso, how) { return blank(iso) ? '' : esc(stamp(iso)) + (how === 'typed' ? ' (typed)' : ''); };
      h.push('<tr><td>' + esc(r.name) + '</td><td>' + cell(r.start, r.startHow) + '</td><td>' + cell(r.end, r.endHow) + '</td><td>' + esc(r.hours) + '</td></tr>');
    });
    h.push('</tbody></table>');
    h.push('<footer>Made by Shovel Command from crew taps · ' + esc(stamp(madeAt)) + '</footer>');
    h.push('</section>');
    return h.join('\n');
  }

  function clockSheetHtml(data, madeAt) {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
      '<title>' + esc(data.title + ' ' + data.shiftLabel) + '</title>' +
      '<style>\n' + CSS + '\n</style></head><body>\n' + clockSheetBody(data, madeAt) + '\n</body></html>';
  }

  function clockFileName(data) { return fileSafe(data.title) + ' ' + fileSafe(data.shiftLabel) + '.pdf'; }

  // Counts a block of walk entries (a site's walks or one pass's) without printing anything.
  function fold(walks) {
    var f = { total: 0, done: 0, treated: 0, sanded: 0, curbTotal: 0, curbDone: 0, whole: false, notDone: [], lines: [], offRoute: [], snowing: { treated: 0, sanded: 0 } };
    var plain = [], byName = {};
    (walks || []).forEach(function (w) {
      var isDone = DONE.indexOf(w.state) !== -1, tapped = w.state !== 'none';
      if (w.kind === 'curb') { f.curbTotal++; if (isDone) f.curbDone++; }
      else {
        plain.push(w); f.total++;
        if (isDone) f.done++;
        if (w.state === 'treated') { if (w.new_concrete) f.sanded++; else f.treated++; }
      }
      if (w.state === 'problem' || String(w.note || '').trim() !== '') f.lines.push(w);
      if (tapped && w.off_route) {
        var nm = String(w.by_name || '') || '—';
        if (!byName[nm]) { byName[nm] = { by_name: nm, n: 0 }; f.offRoute.push(byName[nm]); }
        byName[nm].n++;
      }
      if (tapped && w.snowing_warned) f.snowing[w.new_concrete ? 'sanded' : 'treated']++;
    });
    f.whole = plain.length === 1 && plain[0].kind === 'whole';
    if (f.done > 0) f.notDone = plain.filter(function (w) { return w.kind === 'walk' && w.state === 'none'; }).map(function (w) { return w.name; });
    return f;
  }

  return { fold: fold, sheetsFor: sheetsFor, sheetData: sheetData, sheetHtml: sheetHtml, sheetBody: sheetBody, recordBody: recordBody, walkLine: walkLine, css: CSS, fileName: fileName,
    crewOf: crewOf, newestPost: newestPost, postHasCrew: postHasCrew, byRouteName: byRouteName, esc: esc, clock: clock, stamp: stamp, fileSafe: fileSafe,
    clockSheetsFor: clockSheetsFor, clockSheetData: clockSheetData, clockSheetBody: clockSheetBody, clockSheetHtml: clockSheetHtml, clockFileName: clockFileName };
});
