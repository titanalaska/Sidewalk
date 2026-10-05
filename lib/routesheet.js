(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'), require('./board'), require('./shiftlog'));
  else root.CrewRouteSheet = factory(root.CrewTime, root.CrewBoard, root.CrewShiftLog);
})(this, function (T, B, SL) {
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
  var STATE_LABEL = { cleared: 'Cleared', treated: 'Treated', checked: 'Checked', problem: 'Problem', none: 'Not done' };

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

    var lastTap = taps.length ? taps[taps.length - 1].at : null;
    var end = shiftEndLocal(shiftId, o);
    var moves = (o.moves || []).filter(function (m) {
      return lastTap ? Date.parse(m.at) <= Date.parse(lastTap) : String(m.at).slice(0, 19) < end;
    });
    var slotNow = B.boardFrom(moves, o.routes || [], crewById).routes[route.id] || { lead: null, members: [] };
    var name = function (id) { return nameOf(crewById[id]) || 'Unknown'; };
    return { lead: slotNow.lead ? name(slotNow.lead) : null, members: slotNow.members.map(name), source: 'board' };
  }

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

  function siteData(o, site, shiftId, stormLog, stormVisits) {
    var rows = stormLog.filter(function (r) { return r.site_id === site.id && r.shift_id === shiftId && r.zone_id !== '*'; }).sort(bySeq);

    var entry = function (name, r) {
      var tapped = !!r && r.state !== 'none';
      return {
        name: name,
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
      var list = SL.walksFor(site.id, o.zones).map(function (w) { known[w.zone_id] = true; return entry(w.name, newest[w.zone_id]); });
      // A tap on a zone that has since been archived (or on 'whole', from before
      // zones were drawn) is still the record of what happened: it prints too.
      Object.keys(newest).filter(function (z) { return !known[z] && newest[z].state !== 'none'; })
        .sort(function (a, b) { return bySeq(newest[a], newest[b]); })
        .forEach(function (z) {
          var zone = (o.zones || []).filter(function (x) { return x.id === z; })[0];
          list.push(entry(zone ? zone.name : (z === 'whole' ? 'Whole site' : 'Removed zone'), newest[z]));
        });
      return list;
    };
    var isDone = function (list) { return list.length > 0 && list.every(function (w) { return DONE.indexOf(w.state) !== -1; }); };

    // Clean again (Part B1, Matt 10/4/26): one block per pass in this shift, each
    // with its own times and walks; the site's own fields are the latest pass.
    var passes = SL.passSegments(stormLog, o.storm_id, site.id, shiftId).map(function (seg) {
      var pt = SL.siteTimes(seg.rows, site.id, shiftId), pl = walksOf(seg.rows);
      return { n: seg.n, again: seg.again ? { at: String(seg.again.at || ''), by_name: String(seg.again.by_name || '') } : null,
        start: pt.start, finish: pt.finish, done: isDone(pl), walks: pl };
    });
    var last = passes.length ? passes[passes.length - 1] : null;
    var list = last ? last.walks : walksOf(rows);

    var t = last ? { start: last.start, finish: last.finish } : SL.siteTimes(stormLog, site.id, shiftId);
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
      start: t.start,
      finish: t.finish,
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

    var sites = siteIdsOf(route).map(function (id) { return siteById[id] || { id: id, name: id }; })
      .map(function (s) { return siteData(o, s, shiftId, stormLog, stormVisits); })
      .filter(function (s, i) {
        // A site archived since is no longer on the route, unless it was worked.
        var raw = siteById[siteIdsOf(route)[i]];
        if (!raw || raw.archived !== true) return true;
        // Kept when worked: any tap, or any site card (even one with only materials).
        return s.start !== null || stormVisits.some(function (v) { return v.site_id === raw.id && v.shift_id === shiftId; });
      });

    return {
      route_id: route.id,
      route: String(route.name || route.id),
      shift_id: shiftId,
      shift_label: T.shiftLabel(shiftId),
      storm_started: started ? started.at : null,
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
    '.notdone { margin: 2pt 0; font-weight: bold; }',
    '.site ul { margin: 2pt 0; padding-left: 14pt; }',
    '.site li, .line { margin: 1pt 0; }',
    '.note { margin-left: 8pt; font-style: italic; }',
    '.flag { font-weight: bold; }',
    'footer { margin-top: 10pt; padding-top: 4pt; border-top: 1pt solid #000; font-size: 9pt; color: #333; }',
  ].join('\n');

  function sheetBody(data, madeAt, updated) {
    var h = [];
    h.push('<section class="sheet">');
    h.push('<h1>Route ' + esc(data.route) + '<span>' + esc(data.shift_label) + '</span></h1>');
    if (data.storm_started) h.push('<p class="meta">Storm started ' + esc(stamp(data.storm_started)) + '</p>');

    var crew = data.crew || { lead: null, members: [], source: 'board' };
    h.push('<div class="head">');
    h.push('<div><b>Lead:</b> ' + (crew.lead ? esc(crew.lead) : '—') + '</div>');
    h.push('<div><b>Crew:</b> ' + (crew.members.length ? crew.members.map(esc).join(', ') : '—') +
      (crew.source === 'board' ? ' <i>from the Board (not posted)</i>' : '') + '</div>');
    h.push('<div><b>Truck:</b> ' + (data.truck ? esc(data.truck.truck) + (data.truck.by_name ? ' <i>(set by ' + esc(data.truck.by_name) + ')</i>' : '') : '—') + '</div>');
    h.push('</div>');

    data.sites.forEach(function (s) {
      var noneDone = s.walks.every(function (w) { return w.state === 'none'; });
      h.push('<div class="site">');
      h.push('<h2>' + esc(s.name) + (s.start ? '<span>In ' + esc(stamp(s.start)) + ' &middot; Out ' + esc(stamp(s.finish)) + '</span>' : '') + '</h2>');
      var multi = s.passes && (s.passes.length > 1 || (s.passes[0] && s.passes[0].n > 1));
      var blocks = multi ? s.passes : [{ walks: s.walks }];
      if (noneDone && !multi) {
        h.push('<p class="notdone">Not done this shift</p>');
      } else blocks.forEach(function (p) {
        if (multi) {
          h.push('<h3>Pass ' + esc(p.n) + (p.again ? ' &middot; Clean again ' + esc(stamp(p.again.at)) + (p.again.by_name ? ' by ' + esc(p.again.by_name) : '') : '') +
            (p.start ? '<span>In ' + esc(stamp(p.start)) + ' &middot; Out ' + esc(stamp(p.finish)) + '</span>' : '') + '</h3>');
        }
        h.push('<ul>');
        p.walks.forEach(function (w) {
          var line = '<b>' + esc(w.name) + '</b>: ' + esc(STATE_LABEL[w.state] || w.state);
          if (w.state !== 'none') {
            if (w.by_name) line += ' &middot; ' + esc(w.by_name);
            if (w.at) line += ' &middot; ' + esc(stamp(w.at));
            if (w.snowing_warned) line += ' &middot; <span class="flag">Treated while snowing</span>';
            if (w.off_route) line += ' &middot; <span class="flag">Off route</span>';
          }
          if (!blank(w.note)) line += '<div class="note">' + esc(w.note) + '</div>';
          h.push('<li>' + line + '</li>');
        });
        h.push('</ul>');
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

    h.push('<footer>Made by Sidewalk from crew taps · ' + esc(stamp(madeAt)) + (updated ? ' (updated)' : '') + '</footer>');
    h.push('</section>');
    return h.join('\n');
  }

  // One self-contained page: inline CSS, no external anything.
  function sheetHtml(data, madeAt, updated) {
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
      '<title>' + esc(data.route + ' ' + data.shift_label) + '</title>' +
      '<style>\n' + CSS + '\n</style></head><body>\n' + sheetBody(data, madeAt, updated) + '\n</body></html>';
  }

  // "N3 Night of 12-4.pdf", or "N3 Night of 12-4 (updated 9-12 AM).pdf". A
  // slash or colon cannot live in a file name, so each becomes a dash.
  function fileSafe(s) { return String(s === null || s === undefined ? '' : s).replace(/[\\\/:*?"<>|]/g, '-'); }
  function fileName(data, madeAt, updated) {
    var name = fileSafe(data.route) + ' ' + fileSafe(data.shift_label);
    if (updated) name += ' (updated ' + fileSafe(ISO.test(String(madeAt || '')) ? clock(madeAt) : madeAt) + ')';
    return name + '.pdf';
  }

  return { sheetsFor: sheetsFor, sheetData: sheetData, sheetHtml: sheetHtml, sheetBody: sheetBody, css: CSS, fileName: fileName };
});
