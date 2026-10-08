(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'), require('./shiftlog'), require('./routesheet'));
  else root.CrewHandoff = factory(root.CrewTime, root.CrewShiftLog, root.CrewRouteSheet);
})(this, function (T, SL, RS) {
  'use strict';

  // The 8 AM night-to-day handoff (Matt, 10/5/26). Night crews stop at 8 and
  // the day crew starts at 9. A Storms row { kind: 'handoff', shift_id, at,
  // by_name, log_seq, visit_seq, truck_seq } marks the moment; everything here
  // is a replay of rows the phone already polls, cut at that row's seqs: what
  // night had done is the rows up to log_seq, what has happened since is the
  // rows after it (a late night tap at 8:20 included: it is after the mark).
  // Pure, and byte-identical in the phone app and the backend: the day card on
  // the phone and the day PDF in Drive come from the same code. People reach
  // the page by name only (CrewRouteSheet's crew line), never a phone or a PIN.

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }
  function inStorm(rows, stormId) {
    return (rows || []).filter(function (r) { return r.storm_id === stormId; });
  }
  function upTo(rows, seq) {
    return (rows || []).filter(function (r) { return Number(r.seq) <= seq; });
  }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function siteIdsOf(route) { return (route && route.site_ids) || []; }
  function archived(site) { return !!site && site.archived === true; }

  // ---- the handoff row ------------------------------------------------------

  // The storm's newest handoff (highest seq), or null.
  function newestHandoff(stormRows, stormId) {
    var best = null;
    (stormRows || []).forEach(function (r) {
      if (r.kind === 'handoff' && r.storm_id === stormId && (!best || Number(r.seq) > Number(best.seq))) best = r;
    });
    return best;
  }

  function addDays(ymd, n) {
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  // The day a night hands off to, the morning after its evening:
  // 'night-2026-12-04' -> 'day-2026-12-05'. null for anything that is not a night.
  function dayShiftOf(nightShiftId) {
    var s = T.parseShift(nightShiftId);
    return s && s.kind === 'night' ? T.shiftId('day', addDays(s.date, 1)) : null;
  }

  // ---- one leftover ---------------------------------------------------------

  // When a leftover was finished: the row that starts the run of rows it has
  // been done for ever since. Every row after the mark (and after its current
  // pass began) counts, an undo too: a Problem taken back finishes a site, and a
  // mis-tap taken back after a finish starts the run again. null while it is not
  // done now, so a Clean again after a finish takes it back.
  function doneOf(o, rows, siteId, logSeq, live) {
    if (!SL.siteDone(siteId, o.zones, live)) return null;
    var from = Math.max(logSeq, SL.passInfo(rows, o.storm_id, siteId).sinceSeq), start = null;
    rows.forEach(function (r) {
      if (Number(r.seq) <= from || r.state === 'depth') return;
      if (!SL.siteDone(siteId, o.zones, SL.walkStates(upTo(rows, Number(r.seq)), o.storm_id))) start = null;
      else if (!start) start = r;
    });
    return start ? { at: str(start.at) } : null;
  }

  // touched: the site is Touched now (its sidewalks are done; hand work left). Live, like walks and
  // done, so a site moves from untouched to touched to finished as the day crew works it.
  function leftoverOf(o, log, site, logSeq, live) {
    var rows = log.filter(function (r) { return r.site_id === site.id; }).sort(bySeq);
    var walks = SL.walkCount(site.id, o.zones, live);
    var after = SL.realTaps(rows).filter(function (r) { return Number(r.seq) > logSeq; }).sort(bySeq);
    return {
      site_id: site.id,
      name: str(site.name || site.id),
      address: str(site.address),
      walksDone: walks.done,
      walksTotal: walks.total,
      touched: SL.siteTouched(site.id, o.zones, live),
      problems: SL.openProblems(rows, o.storm_id, site.id, live).map(function (p) {
        return { zone_name: SL.zoneName(site.id, p.row.zone_id, o.zones), note: str(p.row.note), pass: p.pass };
      }),
      started: after.length ? { by_name: str(after[0].by_name), at: str(after[0].at) } : null,
      done: doneOf(o, rows, site.id, logSeq, live),
    };
  }

  // ---- night's routes --------------------------------------------------------

  // Night's routes (ruling 10/5/26): the routes the night's Post puts a lead or
  // a member on, so a stray night tap on a day route adds nothing. Only with no
  // night Post: that night's route sheets as they stood at the mark (Log <=
  // log_seq, Visits <= visit_seq), so a late tap adds nothing either. Route ids,
  // in route-name order (the route sheets' order).
  // The server works this out once, when it writes the handoff row, and freezes
  // it there as night_routes (fix round 10/5/26): a crew phone holds only the
  // newest Post, so once the day Post is up it could not work it out the same.
  // o needs storm_id, routes, posts, storms, log and visits (trucks optional).
  function nightRouteIds(o, handoff) {
    var liveRoutes = (o.routes || []).filter(function (r) { return r.archived !== true; }).sort(RS.byRouteName);
    var nightPost = RS.newestPost(o.posts, handoff.shift_id);
    var snap = Object.assign({}, o, { log: upTo(o.log, Number(handoff.log_seq) || 0), visits: upTo(o.visits, Number(handoff.visit_seq) || 0) });
    return nightPost
      ? liveRoutes.filter(function (r) { return RS.postHasCrew(o, r, handoff.shift_id); }).map(function (r) { return r.id; })
      : RS.sheetsFor(snap).filter(function (sheet) { return sheet.shift_id === handoff.shift_id; }).map(function (sheet) { return sheet.route_id; });
  }

  // ---- the handoff moment -----------------------------------------------------

  // A handoff's sheets are the handoff moment (spec: "a snapshot of the handoff
  // moment"), whenever they are made: the Log, Visits and Trucks rows up to the
  // row's marks, and the Posts and Board moves made by its time (one at the very
  // time is in). A late night tap at 8:20 is after the mark: it is Close storm's
  // "(updated ...)" sheet, never the handoff's, and a Retry hours later makes the
  // page the 8:01 run would have made. The rest of o is as given.
  // One copy of the rule (final review 10/5/26): the server's sheet job makes a
  // handoff's set from it, and Matt's sheets line counts that set from it.
  function snapshot(o, h) {
    var at = Date.parse(h.at);
    function mark(v) { return Number(v) || 0; }
    function byThen(rows, field) { return (rows || []).filter(function (r) { return !(Date.parse(r[field]) > at); }); }
    return Object.assign({}, o, { log: upTo(o.log, mark(h.log_seq)), visits: upTo(o.visits, mark(h.visit_seq)), trucks: upTo(o.trucks, mark(h.truck_seq)),
      posts: byThen(o.posts, 'posted_at'), moves: byThen(o.moves, 'at') });
  }

  // The night route sheets a handoff's set holds, [{ route_id, shift_id }] in
  // route order: sheetsFor of the handoff moment, that night's sheets on the
  // night's routes (night_routes, frozen in the row; nightRouteIds of the moment
  // for a row written before the freeze). o: what handoffData takes.
  function nightSheets(o, h) {
    var snap = snapshot(o, h);
    var routes = Array.isArray(h.night_routes) ? h.night_routes : nightRouteIds(snap, h);
    return RS.sheetsFor(snap).filter(function (p) {
      return p.shift_id === h.shift_id && routes.indexOf(p.route_id) !== -1;
    });
  }

  // ---- the data -------------------------------------------------------------

  // o: what CrewRouteSheet.sheetData takes,
  //   { storm_id, routes, sites, zones, crew, log, visits, posts, moves, trucks, storms }.
  // handoff: a Storms row of kind 'handoff' (newestHandoff). null -> null.
  //
  //   night       { shift_id, at, by_name } of the handoff
  //   dayShift    'day-<night's date + 1>'
  //   dayRoutes   the routes with crew in the day Post, else on the Board when
  //               it was moved after the night was set (the route sheet's crew
  //               rule), each site with its live walks and night's walks at
  //               the handoff on a site night tapped by the mark
  //   leftovers   every site of night's routes (the row's night_routes, else
  //               nightRouteIds) not done at the handoff: live walks, open Problems, started (first real tap
  //               after the mark), done (since when it has been done). Not
  //               done first, in day order (night-route order, first
  //               appearance); done last.
  function handoffData(o, handoff) {
    if (!handoff) return null;
    var logSeq = Number(handoff.log_seq) || 0;
    var log = inStorm(o.log, o.storm_id);
    var live = SL.walkStates(log, o.storm_id);
    var atHandoff = SL.walkStates(upTo(log, logSeq), o.storm_id);
    var dayShift = dayShiftOf(handoff.shift_id);
    var byId = {}, routeById = {};
    (o.sites || []).forEach(function (s) { byId[s.id] = s; });
    (o.routes || []).forEach(function (r) { routeById[r.id] = r; });

    // Night's routes: frozen in the row (night_routes), else (a row written
    // before the freeze) the rule, worked out live (nightRouteIds).
    var liveRoutes = (o.routes || []).filter(function (r) { return r.archived !== true; }).sort(RS.byRouteName);
    var nightPost = RS.newestPost(o.posts, handoff.shift_id);
    var nightIds = Array.isArray(handoff.night_routes) ? handoff.night_routes.slice() : nightRouteIds(o, handoff);
    // A site the data does not know is skipped like an archived one (final
    // review 10/5/26): a crew phone gets live sites only, so to it an archived
    // site is unknown, and Matt's phone and the server skip it as archived.
    var seen = {}, ids = [];
    nightIds.forEach(function (routeId) {
      siteIdsOf(routeById[routeId]).forEach(function (id) {
        if (seen[id] || !byId[id] || archived(byId[id])) return;
        seen[id] = true;
        ids.push(id);
      });
    });
    var left = ids.filter(function (id) { return !SL.siteDone(id, o.zones, atHandoff); });
    var entry = {};
    left.forEach(function (id) { entry[id] = leftoverOf(o, log, byId[id], logSeq, live); });
    var ordered = SL.dayOrder(left, byId).map(function (id) { return entry[id]; });
    // Three groups (Touched, Matt 10/8/26): sites night never got the sidewalks of, then sites
    // whose sidewalks are done and hand work is left, each in day order; finished ones last.
    var open = ordered.filter(function (l) { return !l.done && !l.touched; })
      .concat(ordered.filter(function (l) { return !l.done && l.touched; }));
    var finished = ordered.filter(function (l) { return !!l.done; });

    // Day routes: the day Post's crews. With no day Post, the Board's, but only
    // when someone was moved after the night was set (ruling 10/5/26): a Move
    // after the night Post went up, or with no night Post, a Move later than 12 h
    // before the handoff. Otherwise the Board still holds night's crews: no day
    // route, and the day gets only the left-by-night sheet.
    var boardSince = nightPost ? Date.parse(nightPost.posted_at) : Date.parse(handoff.at) - 12 * 3600000;
    var dayPlanned = !!RS.newestPost(o.posts, dayShift) ||
      (o.moves || []).some(function (m) { return Date.parse(m.at) > boardSince; });
    var touched = {};
    SL.realTaps(upTo(log, logSeq)).forEach(function (r) { if (r.shift_id === handoff.shift_id) touched[r.site_id] = true; });
    var dayRoutes = (dayPlanned ? liveRoutes : [])
      .map(function (route) { return { route: route, crew: RS.crewOf(o, route, dayShift) }; })
      .filter(function (x) { return !!x.crew.lead || x.crew.members.length > 0; })
      .map(function (x) {
        var siteIds = siteIdsOf(x.route).filter(function (id) { return !!byId[id] && !archived(byId[id]); });
        return {
          route_id: x.route.id,
          name: str(x.route.name || x.route.id),
          crew: x.crew,
          sites: SL.dayOrder(siteIds, byId).map(function (id) {
            var site = byId[id], now = SL.walkCount(id, o.zones, live);
            return {
              site_id: id, name: str(site.name || id), address: str(site.address),
              walksDone: now.done, walksTotal: now.total, done: SL.siteDone(id, o.zones, live),
              night: touched[id] ? SL.walkCount(id, o.zones, atHandoff) : null,
            };
          }),
        };
      });

    return {
      night: { shift_id: str(handoff.shift_id), at: str(handoff.at), by_name: str(handoff.by_name) },
      dayShift: dayShift,
      dayRoutes: dayRoutes,
      leftovers: open.concat(finished),
    };
  }

  // ---- words (the card and the PDF say the same thing) ----------------------

  function hm(iso) { return RS.clock(iso).replace(/ [AP]M$/, ''); }
  function walksText(done, total) { return done + ' of ' + total + ' walks'; }

  // "Handoff from Night of 12/4 · 8:00 AM", plus " · by Alex" unless the 8 AM run did it.
  function heading(data) {
    var by = data.night.by_name;
    return 'Handoff from ' + T.shiftLabel(data.night.shift_id) + ' · ' + RS.clock(data.night.at) +
      (by && by !== 'Sidewalk' ? ' · by ' + by : '');
  }

  // A leftover's line: [site, walks or "Not started", "Problem: …"…, "Started by …", "Done …"].
  // Started is real taps only (an undo is a correction, not work: Matt 10/4), so
  // a started after the done time means an undo finished the site: the line then
  // says only "Done <h:mm>" (ruling 10/5/26).
  function leftoverParts(l) {
    var parts = [l.name];
    if (l.touched && !l.done) parts.push('Sidewalks done, ' + walksText(l.walksDone, l.walksTotal));
    else parts.push(l.walksDone === 0 && !l.problems.length && !l.started ? 'Not started' : walksText(l.walksDone, l.walksTotal));
    l.problems.forEach(function (p) { parts.push('Problem: ' + p.note + (p.pass ? ' (pass ' + p.pass + ')' : '')); });
    var startedLate = !!l.started && !!l.done && Date.parse(l.started.at) > Date.parse(l.done.at);
    if (l.started && !startedLate) parts.push((l.started.by_name ? 'Started by ' + l.started.by_name + ' ' : 'Started ') + hm(l.started.at));
    if (l.done) parts.push('Done ' + hm(l.done.at));
    return parts;
  }

  // A day route site's line: [site, walks, "Night: d of t walks" on a site night tapped].
  function siteParts(s) {
    var parts = [s.name, walksText(s.walksDone, s.walksTotal)];
    if (s.night) parts.push('Night: ' + walksText(s.night.done, s.night.total));
    return parts;
  }

  // ---- the day PDF ----------------------------------------------------------

  var CSS = RS.css + '\n' + 'h2.part { font-size: 13pt; margin: 12pt 0 5pt; padding-bottom: 2pt; border-bottom: 1pt solid #000; }';

  // A route id the data has no crewed day route for gets the left-by-night sheet.
  function dayRouteOf(data, routeId) {
    if (routeId === null || routeId === undefined) return null;
    return data.dayRoutes.filter(function (r) { return r.route_id === routeId; })[0] || null;
  }

  function block(parts, address) {
    var esc = RS.esc;
    return '<div class="site"><h2>' + esc(parts[0]) + (address ? '<span>' + esc(address) + '</span>' : '') + '</h2>' +
      (parts.length > 1 ? '<div class="line">' + parts.slice(1).map(esc).join(' · ') + '</div>' : '') + '</div>';
  }

  function handoffBody(data, routeId, madeAt) {
    var esc = RS.esc, route = dayRouteOf(data, routeId), h = [];
    h.push('<section class="sheet">');
    h.push('<h1>' + (route ? 'Route ' + esc(route.name) : 'Day handoff') + '<span>' + esc(T.shiftLabel(data.dayShift)) + '</span></h1>');
    h.push('<p class="meta">' + esc(heading(data)) + '</p>');
    if (route) {
      var crew = route.crew;
      h.push('<div class="head">');
      h.push('<div><b>Lead:</b> ' + (crew.lead ? esc(crew.lead) : '—') + '</div>');
      h.push('<div><b>Crew:</b> ' + (crew.members.length ? crew.members.map(esc).join(', ') : '—') +
        (crew.source === 'board' ? ' <i>from the Board (not posted)</i>' : '') + '</div>');
      h.push('</div>');
      h.push('<h2 class="part">Your route</h2>');
      route.sites.forEach(function (s) { h.push(block(siteParts(s), s.address)); });
      if (!route.sites.length) h.push('<p class="notdone">No sites on this route.</p>');
    }
    h.push('<h2 class="part">Left by night (' + data.leftovers.length + ')</h2>');
    data.leftovers.forEach(function (l) { h.push(block(leftoverParts(l), l.address)); });
    if (!data.leftovers.length) h.push('<p class="notdone">Night left nothing.</p>');
    h.push('<footer>Made by Sidewalk from crew taps · ' + esc(RS.stamp(madeAt)) + '</footer>');
    h.push('</section>');
    return h.join('\n');
  }

  // One day PDF's page: a crewed day route's sheet, or (routeId null) the
  // left-by-night sheet. Self-contained: inline CSS, no external anything.
  function handoffHtml(data, routeId, madeAt) {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
      '<title>' + RS.esc(fileName(data, routeId).replace(/\.pdf$/, '')) + '</title>' +
      '<style>\n' + CSS + '\n</style></head><body>\n' + handoffBody(data, routeId, madeAt) + '\n</body></html>';
  }

  // "D1 Day handoff 12-5.pdf", or "Day handoff 12-5 (left by night).pdf";
  // 12-5 is the day post's date.
  function fileName(data, routeId) {
    var route = dayRouteOf(data, routeId), s = T.parseShift(data.dayShift);
    var md = s ? Number(s.date.slice(5, 7)) + '-' + Number(s.date.slice(8, 10)) : '';
    return route ? RS.fileSafe(route.name) + ' Day handoff ' + md + '.pdf' : 'Day handoff ' + md + ' (left by night).pdf';
  }

  return { newestHandoff: newestHandoff, dayShiftOf: dayShiftOf, nightRouteIds: nightRouteIds, snapshot: snapshot, nightSheets: nightSheets,
    handoffData: handoffData, handoffHtml: handoffHtml, fileName: fileName, heading: heading, leftoverParts: leftoverParts, siteParts: siteParts };
});
