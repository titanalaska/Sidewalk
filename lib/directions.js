(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./points'));
  else root.SnowDirections = factory(root.SnowPoints);
})(this, function (P) {
  'use strict';

  // Directions to a site, and which site is next (Matt, 11/20/26: the crews used Google Maps alone and called him
  // all night). Phone only. This file only builds the link and picks the next site; the screens draw them.
  // point():   the sign-in's own point for the site (one [lng, lat] per site, from points.js) wins; else points.js over the
  //            site and its zones (saved map view centre, else the middle of the first drawn walk); else null.
  //            NEVER pass in the forecast's point: it is rounded to 2 decimals for the NWS and can be a block away.
  // url():     Google Maps' documented "dir" link, destination = "latitude,longitude" (latitude FIRST, 6 decimals) when
  //            there is a usable point, else the address as typed, else '' (no link).
  // linkHtml(): the one anchor every screen draws, so the three screens cannot drift.
  // showNext(): the Next site bar shows on a green Done bar or when the card's latest mark is a Left.
  // next():    the first site in the order given (the route's own order) that nobody has started, never the card's own.
  var BASE = 'https://www.google.com/maps/dir/?api=1&destination=';
  var TAIL = '&travelmode=driving';

  function usable(p) {
    return Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && isFinite(p[0]) && isFinite(p[1]);
  }

  function point(site, serverPoint, zones) {
    if (usable(serverPoint)) return serverPoint;
    var p = site && P ? P.sitePoint(site, zones || []) : null; // no points.js on the page: no point, the address is used
    return usable(p) ? p : null;
  }

  function url(pt, address) {
    if (usable(pt)) return BASE + encodeURIComponent(pt[1].toFixed(6) + ',' + pt[0].toFixed(6)) + TAIL;
    var a = typeof address === 'string' ? address.trim() : '';
    return a ? BASE + encodeURIComponent(a) + TAIL : '';
  }

  function linkHtml(href, esc) {
    if (!href) return '';
    return '<a class="small dirlink" data-directions href="' + esc(href) + '" target="_blank" rel="noopener">Directions</a>';
  }

  // siteLink(): the one call every screen makes (Storm card, Tonight, the map screen, the Next site bar): finds the site in S.sites,
  // works its point and address out, and returns the anchor, or '' when there is no S, no S.sites, no such site, or nothing to go on.
  function siteLink(S, siteId, esc) {
    var site = S && S.sites ? S.sites.filter(function (x) { return x.id === siteId; })[0] : null;
    if (!site) return '';
    return linkHtml(url(point(site, (S.points || {})[siteId], S.zones), site.address), esc);
  }

  function showNext(statusKind, mark) {
    return statusKind === 'done' || !!(mark && mark.state === 'left');
  }

  function next(ordered, kindOf, selfId) {
    var list = ordered || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== selfId && kindOf(list[i]) === 'none') return list[i];
    }
    return null;
  }

  return { point: point, url: url, linkHtml: linkHtml, siteLink: siteLink, showNext: showNext, next: next };
});
