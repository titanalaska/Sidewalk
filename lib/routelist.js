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
            return { name: w.name, heated: w.type === 'heated', priority: !!(z && z.priority), new_concrete: w.new_concrete === true };
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

  function siteHtml(s, t) {
    var h = '<div class="rl-site"><div class="rl-sitehead"><b data-no-es>' + esc(s.name) + '</b>' +
      (s.address ? ' <span class="rl-addr" data-no-es>' + esc(s.address) + '</span>' : '') + '</div>';
    if (s.materials) h += '<div class="rl-materials"><b>' + esc(t('Materials:')) + '</b> <b data-no-es>' + esc(s.materials) + '</b></div>';
    if (s.notes.trim()) h += '<div class="rl-notes"><b>' + esc(t('Notes:')) + '</b> <span data-no-es>' + esc(s.notes.trim()).replace(/\r\n|\r|\n/g, '<br>') + '</span></div>';
    if (s.walks.length) {
      h += s.walks.map(function (w) {
        return '<div class="rl-walk"><span class="rl-box"></span> <span data-no-es>' + (w.priority ? '★ ' : '') + esc(w.name) + '</span>' +
          (w.heated ? ' <span class="rl-heated">' + esc(t('(heated: check only)')) + '</span>' : '') +
          (w.new_concrete ? ' <span class="rl-nosalt">' + esc(t('(sand only, no salt)')) + '</span>' : '') + '</div>';
      }).join('');
    } else {
      h += '<div class="rl-nowalks">' + esc(t('No walks drawn yet.')) + '</div>';
    }
    return h + '<div class="rl-used"><span>' + esc(t('Materials used')) + '</span>: ____________ &nbsp; <span>' + esc(t('In:')) +
      '</span> ________ &nbsp; <span>' + esc(t('Out:')) + '</span> ________</div></div>';
  }

  function pageHtml(p, t) {
    t = t || function (s) { return s; };
    return '<section class="rl-page"><h1 data-no-es>' + esc(p.name) + '</h1>' +
      '<div class="rl-date"><b>' + esc(t('Date:')) + '</b> <span>' + BLANK + '</span></div>' +
      crewHtml(p, t) + p.sites.map(function (s) { return siteHtml(s, t); }).join('') + '</section>';
  }

  // Under #printsheets by the view (scopeCss in lib/shiftlogui.js), so nothing restyles the app.
  // A page break after every route but the last; the box is a square to tick.
  var css = '.rl-page { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; padding: 12px 8px; break-after: page; page-break-after: always; }\n' +
    '.rl-page:last-child { break-after: auto; page-break-after: auto; }\n' +
    '.rl-page h1 { font-size: 26px; margin: 0 0 10px; }\n' +
    '.rl-date, .rl-crew { font-size: 16px; margin: 6px 0; }\n' +
    '.rl-site { margin-top: 14px; padding-top: 8px; border-top: 2px solid #000; break-inside: avoid; page-break-inside: avoid; }\n' +
    '.rl-sitehead { font-size: 18px; }\n' +
    '.rl-addr { font-size: 14px; color: #333; }\n' +
    '.rl-materials { font-size: 18px; font-weight: bold; margin: 6px 0; }\n' +
    '.rl-notes { font-size: 14px; margin: 4px 0; }\n' +
    '.rl-walk { font-size: 16px; margin: 6px 0; }\n' +
    '.rl-box { display: inline-block; width: 16px; height: 16px; border: 2px solid #000; vertical-align: middle; margin-right: 6px; }\n' +
    '.rl-heated, .rl-nosalt { font-size: 14px; color: #333; }\n' +
    '.rl-nowalks { font-size: 15px; margin: 6px 0; font-style: italic; }\n' +
    '.rl-used { font-size: 14px; margin-top: 10px; }\n';

  return { pages: pages, pageHtml: pageHtml, css: css };
});
