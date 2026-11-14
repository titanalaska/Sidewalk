// Print route lists (Matt, 11/10/26): one page per live route, the PLAN on paper, never the log.
// The dispatcher needs something to hand a 3 AM crew that is not in the app yet. Pure: data in, data and
// HTML out; no DOM, no clock, no network. The phone's Print view (lib/shiftlogui.js openRouteLists) puts
// the pages in the same overlay Print sheets uses.
//
// pages(o) -> [{ route_id, name, lead, members, sites: [{ id, name, address, materials, notes,
//                walks: [{ name, heated, priority }] }] }]      o = { routes, sites, zones, crew, moves }
// pageHtml(page, t) -> string. t translates a LABEL (identity in English); everything that came from
// data is escaped and sits under data-no-es, so the app's Spanish pass never touches it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'), require('./board'));
  else root.SnowRouteList = factory(root.CrewShiftLog, root.CrewBoard);
})(this, function (Log, Board) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function text(v) { return String(v == null ? '' : v).trim(); }

  // The same order the Routes tab and the Board list live routes in (lib/app.js renderRoutes,
  // lib/boardui.js liveRoutes): by name, digits compared as numbers, so N2 comes before N10.
  function liveRoutes(routes) {
    return (routes || []).filter(function (r) { return r && !r.archived; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
  }

  function pages(o) {
    o = o || {};
    var routes = liveRoutes(o.routes), sitesById = {}, zonesById = {}, pool = {};
    (o.sites || []).forEach(function (s) { sitesById[s.id] = s; });
    (o.zones || []).forEach(function (z) { zonesById[z.id] = z; });
    // The Board's pool: a card still waiting for Matt's Add to crew is not crew (lib/boardui.js pool).
    (o.crew || []).forEach(function (c) { if (c.pending !== true) pool[c.id] = c; });
    var board = Board.boardFrom(o.moves, routes, pool);
    function nameOf(id) { return pool[id] ? pool[id].name : null; }

    return routes.map(function (r) {
      var slot = board.routes[r.id] || { lead: null, members: [] };
      var sites = [];
      (r.site_ids || []).forEach(function (id) {
        var s = sitesById[id];
        if (!s || s.archived) return;
        var walks = Log.walksFor(s.id, o.zones);
        // Whole site is the Storm tab's stand-in for a site with nothing drawn: on paper that is "no walks".
        if (walks.length === 1 && walks[0].zone_id === 'whole') walks = [];
        sites.push({
          id: s.id, name: s.name, address: text(s.address), materials: text(s.materials_needed),
          notes: String(s.notes == null ? '' : s.notes),
          walks: walks.map(function (w) {
            var z = zonesById[w.zone_id]; // a curb item has no zone of its own: no star
            return { name: w.name, heated: w.type === 'heated', priority: !!(z && z.priority), new_concrete: w.new_concrete === true,
              curbs: /^curbs-\d+$/.test(String(w.zone_id)) };
          })
        });
      });
      return { route_id: r.id, name: r.name, lead: slot.lead ? nameOf(slot.lead) : null,
        members: slot.members.map(nameOf).filter(function (n) { return n; }), sites: sites };
    });
  }

  var BLANK = '____________________';

  function dataSpan(s) { return '<span data-no-es>' + esc(s) + '</span>'; }

  function crewHtml(p, t) {
    if (!p.lead && !p.members.length) {
      return '<div class="rl-crew"><b>' + esc(t('Lead')) + '</b>: <span>' + BLANK + '</span></div>' +
        '<div class="rl-crew"><b>' + esc(t('Crew:')) + '</b> <span>' + BLANK + ' ' + BLANK + '</span></div>';
    }
    return (p.lead ? '<div class="rl-crew"><b>' + esc(t('Lead')) + '</b>: ' + dataSpan(p.lead) + '</div>' : '') +
      (p.members.length ? '<div class="rl-crew"><b>' + esc(t('Crew:')) + '</b> ' + dataSpan(p.members.join(', ')) + '</div>' : '');
  }

  // One line per site (Matt, 11/14/26: 32 pages was far too much; "a page per route", one line per site chosen over every
  // walk in small type). A site is ONE table row, ticked the way the Storm tab's Site done / Site treated buttons work:
  //   Done always; Treated when there is a walk to treat (not heated, not the curb item) or no walks at all (the Whole site),
  //   "—" otherwise (a heated walk is checked, never treated); Curbs done only on a route with a curb item, a box where
  //   the site has one. Plain walks are not listed; a walk is named only when it needs a word.
  // Under the site's name, ONE small paragraph: materials, the walks that need a word, the curb item, the notes, each a span
  // that runs on after the one before (a line each would make 12 sites two pages).
  function walkLine(cls, label, names, t, star) {
    if (!names.length) return '';
    return '<span class="rl-warn ' + cls + '">' + (star ? '★ ' : '') + '<span>' + esc(t(label)) + '</span> <span data-no-es>' + esc(names.join(', ')) + '</span></span>';
  }
  function names(walks, keep) { return walks.filter(keep).map(function (w) { return w.name; }); }
  function hasCurbs(s) { return s.walks.some(function (w) { return w.curbs; }); }
  var BOX = '<span class="rl-box"></span>', NA = '<span class="rl-na">—</span>';

  function siteHtml(s, t, curbCol) {
    var w = s.walks;
    var h = '<div class="rl-sitehead"><b data-no-es>' + esc(s.name) + '</b>' +
      (s.address ? ' <span class="rl-addr" data-no-es>' + esc(s.address) + '</span>' : '') + '</div>';
    var info = '';
    if (s.materials) info += '<span class="rl-materials"><b>' + esc(t('Materials:')) + '</b> <b data-no-es>' + esc(s.materials) + '</b></span>';
    if (w.length) {
      info += walkLine('rl-priority', 'Priority:', names(w, function (x) { return x.priority; }), t, true) +
        walkLine('rl-heated', 'Heated, check only:', names(w, function (x) { return x.heated; }), t) +
        walkLine('rl-nosalt', 'Sand only, no salt:', names(w, function (x) { return x.new_concrete; }), t);
      var curbs = names(w, function (x) { return x.curbs; });
      if (curbs.length) info += '<span class="rl-warn rl-curbs"><span data-no-es>' + esc(curbs.join(' · ')) + '</span></span>';
    } else {
      info += '<span class="rl-nowalks">' + esc(t('No walks drawn yet.')) + '</span>';
    }
    if (s.notes.trim()) info += '<span class="rl-notes"><b>' + esc(t('Notes:')) + '</b> <span data-no-es>' + esc(s.notes.trim()).replace(/\r\n|\r|\n/g, '<br>') + '</span></span>';
    if (info) h += '<div class="rl-info">' + info + '</div>';
    var treat = !w.length || w.some(function (x) { return !x.heated && !x.curbs; });
    return '<tr class="rl-site"><td class="rl-sitecell">' + h + '</td><td class="rl-mark">' + BOX + '</td>' +
      '<td class="rl-mark">' + (treat ? BOX : NA) + '</td>' +
      (curbCol ? '<td class="rl-mark">' + (hasCurbs(s) ? BOX : NA) + '</td>' : '') +
      '<td class="rl-write"></td><td class="rl-write"></td><td class="rl-write rl-usedcell"></td></tr>';
  }

  function pageHtml(p, t) {
    t = t || function (s) { return s; };
    var curbCol = p.sites.some(hasCurbs);
    var th = function (label, cls) { return '<th' + (cls ? ' class="' + cls + '"' : '') + '>' + (label ? esc(t(label)) : '') + '</th>'; };
    return '<section class="rl-page"><h1 data-no-es>' + esc(p.name) + '</h1>' +
      '<div class="rl-date"><b>' + esc(t('Date:')) + '</b> <span>' + BLANK + '</span></div>' + crewHtml(p, t) +
      '<table class="rl-table"><thead><tr>' + th('', 'rl-sitecol') + th('Done', 'rl-mark') + th('Treated', 'rl-mark') +
      (curbCol ? th('Curbs done', 'rl-mark') : '') + th('In:', 'rl-write') + th('Out:', 'rl-write') + th('Materials used', 'rl-write rl-usedcell') +
      '</tr></thead><tbody>' + p.sites.map(function (s) { return siteHtml(s, t, curbCol); }).join('') + '</tbody></table></section>';
  }

  // Under #printsheets by the view (scopeCss in lib/shiftlogui.js), so nothing restyles the app.
  // A page break after every route but the last; the box is a square to tick.
  // One page per route (11/14/26): small type, one table row per site, the boxes in their own columns.
  var css = '.rl-page { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; padding: 4px 2px; break-after: page; page-break-after: always; }\n' +
    '.rl-page:last-child { break-after: auto; page-break-after: auto; }\n' +
    '.rl-page h1 { font-size: 20px; margin: 0 0 4px; }\n' +
    '.rl-date, .rl-crew { display: inline-block; font-size: 13px; margin: 2px 18px 2px 0; }\n' +
    '.rl-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; line-height: 1.2; }\n' +
    '.rl-table th, .rl-table td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; text-align: left; }\n' +
    '.rl-table th { font-size: 11px; color: #000; }\n' +
    '.rl-sitecol { width: auto; }\n' + // the app's own th rule is width: 38% (app.css): the site column takes what the others leave

    '.rl-site { break-inside: avoid; page-break-inside: avoid; }\n' +
    '.rl-sitehead { font-size: 12.5px; }\n' +
    '.rl-addr { font-size: 10.5px; color: #333; }\n' +
    '.rl-info { font-size: 10.5px; }\n' +
    '.rl-info > span { margin-right: 10px; }\n' +
    '.rl-materials { font-weight: bold; }\n' +
    '.rl-nowalks { font-style: italic; }\n' +
    '.rl-mark { width: 1%; white-space: nowrap; text-align: center; }\n' +
    '.rl-write { width: 7%; }\n' +
    '.rl-usedcell { width: 12%; }\n' +
    '.rl-box { display: inline-block; width: 14px; height: 14px; border: 2px solid #000; vertical-align: middle; }\n' +
    '.rl-na { color: #555; }\n';

  return { pages: pages, pageHtml: pageHtml, css: css };
});
