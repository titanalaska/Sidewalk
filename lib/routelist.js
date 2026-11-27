// Print route lists (Matt, 11/10/26): one page per live route, the PLAN on paper, never the log.
// The dispatcher needs something to hand a 3 AM crew that is not in the app yet. Pure: data in, data and
// HTML out; no DOM, no clock, no network. The phone's Print view (lib/shiftlogui.js openRouteLists) puts
// the pages in the same overlay Print sheets uses.
//
// pages(o) -> [{ route_id, name, lead, members, sites: [{ id, name, address, materials, notes, units: { bobcat, snowrator },
//                walks: [{ name, heated, priority }] }] }]      o = { routes, sites, zones, crew, moves }
// pageHtml(page, t) -> string. t translates a LABEL (identity in English); everything that came from
// data is escaped and sits under data-no-es, so the app's Spanish pass never touches it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'), require('./board'), require('./machinepick'));
  // index.html loads lib/machinepick.js BEFORE this file, so the page has SnowMachinePick when this factory runs.
  else root.SnowRouteList = factory(root.CrewShiftLog, root.CrewBoard, root.SnowMachinePick);
})(this, function (Log, Board, MachinePick) {
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
          // The Sites editor's unit numbers, for the Equipment column (route sheet columns, Matt 11/19/26).
          units: { bobcat: text((s.units || {}).bobcat), snowrator: text((s.units || {}).snowrator) },
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
  // walk in small type). A site is ONE table row:
  //   Done always; Shoveled always (route sheet columns, Matt 11/19/26: a Cleared tap does not always mean snow was moved,
  //   so the crew says it); Curbs done only on a route with a curb item, a box where the site has one; In / Out;
  //   Ice melt (bags) and Sand (buckets), whole ones the crew writes in; Equipment, words to circle (equipHtml).
  //   Treated and Materials used were replaced by those columns on 11/19/26. Plain walks are not listed; a walk is named
  //   only when it needs a word.
  // Under the site's name, ONE small paragraph: materials, the walks that need a word, the curb item, the notes, each a span
  // that runs on after the one before (a line each would make 12 sites two pages).
  // Each walk its own span (Spanish everywhere, Ship 2): a zone name is typed (data-no-es + data-typed: lib/estyped.js shows its
  // Spanish); the curb item is the app's own words (a plain span: a rule translates it).
  function walkName(w) { return w.curbs ? '<span>' + esc(w.name) + '</span>' : '<span data-no-es data-typed>' + esc(w.name) + '</span>'; }
  // Route list polish (Matt 11/26/26): each warning line keeps its words and gains its mark before them: a square in the map's
  // colour (heated red, sand-only lime, each with a black edge) or the Priority star in gold. The words stay, so a
  // black-and-white print loses nothing.
  var MARK = { 'rl-priority': '<span class="rl-chip rl-chip-priority">★</span> ', 'rl-heated': '<span class="rl-chip rl-chip-heated"></span>',
    'rl-nosalt': '<span class="rl-chip rl-chip-nosalt"></span>' };
  function walkLine(cls, label, walks, t) {
    if (!walks.length) return '';
    return '<span class="rl-warn ' + cls + '">' + (MARK[cls] || '') + '<span>' + esc(t(label)) + '</span> ' + walks.map(walkName).join(', ') + '</span>';
  }
  // Route list polish (Matt 11/26/26, "Route + site names both ways"): a route or site name prints in Spanish with the name as
  // typed small beside it. The first element is the typed-words layer's "Spanish beside" (lib/estyped.js, data-typed-beside =
  // the name as typed): it holds the Spanish, or nothing (an English print, no Spanish yet, or Google left the name alone, so
  // the name prints once). The second is the name as typed, always printed; the css shrinks it only when the Spanish is there.
  function bothWays(tag, name) {
    return '<' + tag + ' class="rl-es" data-no-es data-typed-beside="' + esc(name) + '"></' + tag + '>' +
      '<' + tag + ' class="rl-en" data-no-es>' + esc(name) + '</' + tag + '>';
  }
  function names(walks, keep) { return walks.filter(keep); }
  function hasCurbs(s) { return s.walks.some(function (w) { return w.curbs; }); }
  var BOX = '<span class="rl-box"></span>', NA = '<span class="rl-na">—</span>';

  // The Equipment cell (Matt, 11/19/26): words the crew CIRCLES, not a blank, so billing gets the same words every night.
  // The Bobcat's attachments (Snowblower or Bucket only: the V blade, Sweepster, Plow and Box are off the list), an operator for the Bobcat and the
  // Snowrator, and the walk-behind blower (it travels with the crew: no operator). Bobcat, Snowrator and Sweepster are
  // brand names: printed as typed under data-no-es. A unit comes from the site (the Sites editor); a blank one is #___.
  var ATTACHMENTS = ['Snowblower', 'Bucket'];
  var BRANDS = { Bobcat: 1, Snowrator: 1, Sweepster: 1 };
  function word(w, t) {
    return BRANDS[w] ? '<span class="rl-pick" data-no-es>' + esc(w) + '</span>' : '<span class="rl-pick">' + esc(t(w)) + '</span>';
  }
  // One unit prints as before; blank prints #___. Several ("BC5, BT13, BC7", split by SnowMachinePick.splitUnits) print each as a
  // word to circle, joined by " · ".
  function unit(u) {
    var us = MachinePick.splitUnits(u);
    if (us.length > 1) return us.map(function (x) { return '<span class="rl-pick" data-no-es>' + esc(x) + '</span>'; }).join(' · ');
    return us.length ? '<span data-no-es>' + esc(us[0]) + '</span>' : '<span>#___</span>';
  }
  function operator(t) { return '<span class="rl-op"><span>' + esc(t('Operator:')) + '</span> ________</span>'; }
  // Two lines, the same words (Matt 11/26/26): the Bobcat with its operator, then the Snowrator with its operator and the
  // walk-behind blower. One line shorter at every site than the three-line cell, at the same width.
  function equipHtml(s, t) {
    var u = s.units || {};
    return '<div class="rl-eqline">' + word('Bobcat', t) + ' ' + unit(u.bobcat) + ': ' +
        ATTACHMENTS.map(function (a) { return word(a, t); }).join(' · ') + ' ' + operator(t) + '</div>' +
      '<div class="rl-eqline">' + word('Snowrator', t) + ' ' + unit(u.snowrator) + ' ' + operator(t) + ' · ' + word('Walk-behind blower', t) + '</div>';
  }

  function siteHtml(s, t, curbCol) {
    var w = s.walks;
    var h = '<div class="rl-sitehead">' + bothWays('b', s.name) +
      (s.address ? ' <span class="rl-addr" data-no-es>' + esc(s.address) + '</span>' : '') + '</div>';
    var info = '';
    if (s.materials) info += '<span class="rl-materials"><b>' + esc(t('Materials:')) + '</b> <b data-no-es data-typed>' + esc(s.materials) + '</b></span>';
    if (w.length) {
      info += walkLine('rl-priority', 'Priority:', names(w, function (x) { return x.priority; }), t) +
        walkLine('rl-heated', 'Heated, check only:', names(w, function (x) { return x.heated; }), t) +
        walkLine('rl-nosalt', 'Sand only, no salt:', names(w, function (x) { return x.new_concrete; }), t);
      var curbs = names(w, function (x) { return x.curbs; });
      if (curbs.length) info += '<span class="rl-warn rl-curbs">' + curbs.map(walkName).join(' · ') + '</span>';
    } else {
      info += '<span class="rl-nowalks">' + esc(t('No walks drawn yet.')) + '</span>';
    }
    // The note's line breaks stay in its text (white-space: pre-line below), never <br> joins: the typed-words layer sets the
    // element's text, and would lose them.
    if (s.notes.trim()) info += '<span class="rl-notes"><b>' + esc(t('Notes:')) + '</b> <span data-no-es data-typed>' + esc(s.notes.trim()) + '</span></span>';
    if (info) h += '<div class="rl-info">' + info + '</div>';
    // Done, then Shoveled at every site (a heated-only site can still have snow shoveled off it).
    return '<tr class="rl-site"><td class="rl-sitecell">' + h + '</td><td class="rl-mark">' + BOX + '</td>' +
      '<td class="rl-mark">' + BOX + '</td>' +
      (curbCol ? '<td class="rl-mark">' + (hasCurbs(s) ? BOX : NA) + '</td>' : '') +
      '<td class="rl-write"></td><td class="rl-write"></td>' +
      '<td class="rl-write rl-amount"></td><td class="rl-write rl-amount"></td>' +
      '<td class="rl-equip">' + equipHtml(s, t) + '</td></tr>';
  }

  function pageHtml(p, t) {
    t = t || function (s) { return s; };
    var curbCol = p.sites.some(hasCurbs);
    var th = function (label, cls) { return '<th' + (cls ? ' class="' + cls + '"' : '') + '>' + (label ? esc(t(label)) : '') + '</th>'; };
    // The route name, the Date blank and the crew are the thead's FIRST row, one cell across every column: a browser repeats a
    // thead on every printed page, so page 2 of a big route still says whose it is (final review, 11/19/26).
    var cols = 8 + (curbCol ? 1 : 0);
    return '<section class="rl-page"><table class="rl-table"><thead><tr><th class="rl-pagehead" colspan="' + cols + '">' +
      '<h1>' + bothWays('span', p.name) + '</h1>' +
      '<div class="rl-date"><b>' + esc(t('Date:')) + '</b> <span>' + BLANK + '</span></div>' + crewHtml(p, t) + '</th></tr>' +
      '<tr class="rl-cols">' + th('', 'rl-sitecol') + th('Done', 'rl-mark') + th('Shoveled', 'rl-mark') +
      (curbCol ? th('Curbs done', 'rl-mark') : '') + th('In:', 'rl-write') + th('Out:', 'rl-write') +
      th('Ice melt (bags)', 'rl-write rl-amount') + th('Sand (buckets)', 'rl-write rl-amount') + th('Equipment', 'rl-equip') +
      '</tr></thead><tbody>' + p.sites.map(function (s) { return siteHtml(s, t, curbCol); }).join('') + '</tbody></table></section>';
  }

  // Under #printsheets by the view (scopeCss in lib/shiftlogui.js), so nothing restyles the app.
  // A page break after every route but the last; the box is a square to tick.
  // One page per route (11/14/26): small type, one table row per site, the boxes in their own columns.
  // Landscape Letter (route sheet columns, Matt 11/19/26): the four new columns need the width. The @page rule comes FIRST:
  // the view's scopeCss (lib/shiftlogui.js) leaves an @-rule alone only at the very start; anywhere later it would be mangled
  // into '#printsheets @page' and the page would print portrait without a word.
  var css = '@page { size: letter landscape; margin: 0.5in; }\n' +
    '.rl-page { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; padding: 4px 2px; break-after: page; page-break-after: always; }\n' +
    '.rl-page:last-child { break-after: auto; page-break-after: auto; }\n' +
    // One line: the route name beside the Date and crew (it repeats on every page, so it must cost one line, not three).
    '.rl-page h1 { display: inline-block; font-size: 20px; margin: 0 18px 0 0; vertical-align: baseline; }\n' +
    '.rl-date, .rl-crew { display: inline-block; font-size: 13px; margin: 2px 18px 2px 0; }\n' +
    '.rl-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; line-height: 1.2; }\n' +
    '.rl-table th, .rl-table td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; text-align: left; }\n' +
    '.rl-table th { font-size: 11px; color: #000; }\n' +
    // The heading cell reads as the page's heading, not a column: no box, the page's own sizes (h1 20px, date and crew 13px).
    // Route list polish (Matt 11/26/26): the heading cell is a Titan gold band, black lettering. Every colour here asks the
    // browser to print it (print-color-adjust; Chrome reads the -webkit- one): a print drops backgrounds otherwise. A printer
    // that still drops them loses only the colour: every warning keeps its words.
    '.rl-table th.rl-pagehead { border: 0; padding: 3px 6px 4px; font-weight: normal; background: #f2b705; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n' +
    '.rl-cols th { background: #fbe7a8; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n' + // pale gold: light grey in black and white
    // A name with its Spanish beside it: the Spanish bold at the name's size, the name as typed small and grey after it. With
    // nothing beside it (an English print, no Spanish, the same name), the name keeps today's look.
    '.rl-es:not(:empty) + .rl-en { font-size: 10.5px; color: #333; font-weight: normal; margin-left: 5px; }\n' +
    '.rl-page h1 .rl-es:not(:empty) + .rl-en { font-size: 13px; }\n' +
    '.rl-sitecol { width: auto; }\n' + // the app's own th rule is width: 38% (app.css): the site column takes what the others leave

    '.rl-site { break-inside: avoid; page-break-inside: avoid; }\n' +
    '.rl-sitehead { font-size: 12.5px; }\n' +
    '.rl-addr { font-size: 10.5px; color: #333; }\n' +
    '.rl-info { font-size: 10.5px; }\n' +
    '.rl-info > span { margin-right: 10px; }\n' +
    '.rl-materials { font-weight: bold; }\n' +
    '.rl-notes [data-typed] { white-space: pre-line; }\n' +
    '.rl-nowalks { font-style: italic; }\n' +
    '.rl-mark { width: 1%; white-space: nowrap; text-align: center; }\n' +
    '.rl-write { width: 5%; }\n' +
    // Narrow write-in columns and an Equipment cell just wide enough to keep the Bobcat line on one line (31%, about 3 in):
    // every other pixel goes to the site column, whose wrapping sets a row's height. Matt 11/19/26: a 12-site route on two landscape pages is fine (about 7 sites a page).
    '.rl-amount { width: 5%; }\n' +
    '.rl-equip { width: 31%; font-size: 10.5px; }\n' +
    '.rl-eqline + .rl-eqline { margin-top: 3px; }\n' +
    '.rl-op { margin-right: 6px; }\n' +
    '.rl-pick, .rl-op { white-space: nowrap; }\n' + // a word to circle (or an operator blank) never splits across two lines
    '.rl-box { display: inline-block; width: 14px; height: 14px; border: 2px solid #000; vertical-align: middle; }\n' +
    // A warning's mark: a 9 px square with a black edge (still a square in black and white) in the map's colour; Priority's is
    // the star itself, gold with a thin black edge.
    '.rl-chip { display: inline-block; width: 9px; height: 9px; border: 1px solid #000; margin-right: 3px; vertical-align: -1px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n' +
    '.rl-chip-heated { background: #d62828; }\n' +
    '.rl-chip-nosalt { background: #b5e61d; }\n' +
    '.rl-chip-priority { width: auto; height: auto; border: 0; margin-right: 0; vertical-align: baseline; color: #f2b705; -webkit-text-stroke: 0.6px #000; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n' +
    '.rl-na { color: #555; }\n';

  return { pages: pages, pageHtml: pageHtml, css: css };
});
