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

  function zoneName(o, siteId, zoneId) {
    var w = SL.walksFor(siteId, o.zones).filter(function (x) { return x.zone_id === zoneId; })[0];
    if (w) return str(w.name);
    var z = (o.zones || []).filter(function (x) { return x.id === zoneId; })[0];
    return z ? str(z.name) : zoneId === 'whole' ? 'Whole site' : str(zoneId);
  }

  // A site's open Problems, found the way the phone's Problems box finds them
  // (shiftlogui problemsHtml): a walk of the current pass whose newest row is a
  // Problem (pass null), and a Problem from an earlier pass, carried with its
  // pass number until someone taps that walk in the new pass. Newest first.
  // rows: the site's rows in this storm, in seq order. live: walkStates now.
  function problemsOf(o, rows, siteId, live) {
    var found = [], seen = {}, info = SL.passInfo(rows, o.storm_id, siteId);
    rows.forEach(function (r) {
      if (r.zone_id === '*' || seen[r.zone_id]) return;
      seen[r.zone_id] = true;
      var now = live[SL.walkKey(siteId, r.zone_id)];
      if (now && now.state === 'problem') found.push({ row: now, pass: null });
    });
    if (info.n >= 2) {
      var before = {};
      rows.forEach(function (r) { if (r.zone_id !== '*' && Number(r.seq) <= info.sinceSeq) before[r.zone_id] = r; });
      Object.keys(before).forEach(function (z) {
        var r = before[z];
        if (r.state !== 'problem' || live[SL.walkKey(siteId, z)]) return;
        found.push({ row: r, pass: SL.passInfo(upTo(rows, Number(r.seq)), o.storm_id, siteId).n });
      });
    }
    found.sort(function (a, b) { return bySeq(b.row, a.row); });
    return found.map(function (p) { return { zone_name: zoneName(o, siteId, p.row.zone_id), note: str(p.row.note), pass: p.pass }; });
  }

  // When a leftover was finished: the real tap (after the handoff, in the
  // site's current pass) after which the site first counts as done. null while
  // it is not done now, so a Clean again after a finish takes it back.
  function doneOf(o, rows, siteId, logSeq, live) {
    if (!SL.siteDone(siteId, o.zones, live)) return null;
    var from = Math.max(logSeq, SL.passInfo(rows, o.storm_id, siteId).sinceSeq);
    var taps = SL.realTaps(rows).filter(function (r) { return Number(r.seq) > from; }).sort(bySeq);
    for (var i = 0; i < taps.length; i++) {
      if (SL.siteDone(siteId, o.zones, SL.walkStates(upTo(rows, Number(taps[i].seq)), o.storm_id))) return { at: str(taps[i].at) };
    }
    // Done with no real tap doing it (a Problem taken back, a Clean again
    // undone): the newest row after the handoff is when it became so.
    var late = rows.filter(function (r) { return Number(r.seq) > logSeq && r.state !== 'depth'; });
    return late.length ? { at: str(late[late.length - 1].at) } : null;
  }

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
      problems: problemsOf(o, rows, site.id, live),
      started: after.length ? { by_name: str(after[0].by_name), at: str(after[0].at) } : null,
      done: doneOf(o, rows, site.id, logSeq, live),
    };
  }

  // ---- the data -------------------------------------------------------------

  // o: what CrewRouteSheet.sheetData takes,
  //   { storm_id, routes, sites, zones, crew, log, visits, posts, moves, trucks, storms }.
  // handoff: a Storms row of kind 'handoff' (newestHandoff). null -> null.
  //
  //   night       { shift_id, at, by_name } of the handoff
  //   dayShift    'day-<night's date + 1>'
  //   dayRoutes   the routes with crew in the day Post, else on the Board (the
  //               route sheet's crew rule), each site with its live walks and
  //               night's walks at the handoff on a site night tapped
  //   leftovers   every site of night's routes not done at the handoff: live
  //               walks, open Problems, started (first real tap after the
  //               mark), done (when it was finished). Not done first, in day
  //               order (night-route order, first appearance); done last.
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

    // Night's routes are the route sheets of that night as they stood at the
    // mark: a late tap on a route night never touched does not add its sites.
    var snap = Object.assign({}, o, { log: upTo(o.log, logSeq), visits: upTo(o.visits, Number(handoff.visit_seq) || 0) });
    var seen = {}, ids = [];
    RS.sheetsFor(snap).forEach(function (sheet) {
      if (sheet.shift_id !== handoff.shift_id) return;
      siteIdsOf(routeById[sheet.route_id]).forEach(function (id) {
        if (seen[id] || archived(byId[id])) return;
        seen[id] = true;
        ids.push(id);
      });
    });
    var left = ids.filter(function (id) { return !SL.siteDone(id, o.zones, atHandoff); });
    var entry = {};
    left.forEach(function (id) { entry[id] = leftoverOf(o, log, byId[id] || { id: id, name: id }, logSeq, live); });
    var ordered = SL.dayOrder(left, byId).map(function (id) { return entry[id]; });
    var open = ordered.filter(function (l) { return !l.done; });
    var finished = ordered.filter(function (l) { return !!l.done; });

    var touched = {};
    SL.realTaps(upTo(log, logSeq)).forEach(function (r) { if (r.shift_id === handoff.shift_id) touched[r.site_id] = true; });
    var dayRoutes = (o.routes || []).filter(function (r) { return r.archived !== true; }).sort(RS.byRouteName)
      .map(function (route) { return { route: route, crew: RS.crewOf(o, route, dayShift) }; })
      .filter(function (x) { return !!x.crew.lead || x.crew.members.length > 0; })
      .map(function (x) {
        var siteIds = siteIdsOf(x.route).filter(function (id) { return !archived(byId[id]); });
        return {
          route_id: x.route.id,
          name: str(x.route.name || x.route.id),
          crew: x.crew,
          sites: SL.dayOrder(siteIds, byId).map(function (id) {
            var site = byId[id] || { id: id, name: id }, now = SL.walkCount(id, o.zones, live);
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
  function leftoverParts(l) {
    var parts = [l.name];
    parts.push(l.walksDone === 0 && !l.problems.length && !l.started ? 'Not started' : walksText(l.walksDone, l.walksTotal));
    l.problems.forEach(function (p) { parts.push('Problem: ' + p.note + (p.pass ? ' (pass ' + p.pass + ')' : '')); });
    if (l.started) parts.push((l.started.by_name ? 'Started by ' + l.started.by_name + ' ' : 'Started ') + hm(l.started.at));
    if (l.done) parts.push(('Done ' + hm(l.done.at)).trim());
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

  return { newestHandoff: newestHandoff, dayShiftOf: dayShiftOf, handoffData: handoffData, handoffHtml: handoffHtml,
    fileName: fileName, heading: heading, leftoverParts: leftoverParts, siteParts: siteParts };
});
