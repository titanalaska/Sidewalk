// The forecast hint on the Storm tab (sub-project 3, 10/3/26), from the US
// National Weather Service. A HINT only: the Snowing/Stopped switch Matt and the
// leads move is what counts, so every failure here is "no hint" and changes
// nothing else.
//
// Privacy: the point sent to the NWS is the site's position rounded to two
// decimals (~1 km). Nothing else leaves the phone, and no key or name goes with it.
//
// A browser cannot set User-Agent, so none is set. api.weather.gov allows
// cross-origin GETs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mapview'));
  else root.SnowWeather = factory(root.SnowMap);
})(this, function (Map) {
  'use strict';

  var HOST = 'https://api.weather.gov/';
  var WINDOW = 12;          // hours looked at
  var TIMEOUT = 8000;       // ms: a hung request must not hold the hint slot forever

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  // Two decimals; "+ 0" turns -0 into 0.
  function round2(n) { return Math.round(n * 100) / 100 + 0; }

  // [lat, lon] for a site, rounded, or null. The saved view's centre is
  // [lng, lat] (MapLibre's order); a site with no saved view falls back to the
  // first zone that has an outline.
  function point(site, zones) {
    var c = site && site.map && site.map.center, lng, lat, i, z;
    if (c && isNum(c[0]) && isNum(c[1])) { lng = c[0]; lat = c[1]; }
    else {
      for (i = 0; i < (zones || []).length; i++) {
        z = zones[i];
        if (z && z.ring && z.ring.length) {
          c = Map.centroid(z.ring);
          if (c && isNum(c[0]) && isNum(c[1])) { lng = c[0]; lat = c[1]; break; }
        }
      }
    }
    if (lng === undefined) return null;
    return [round2(lat), round2(lng)];
  }

  var SNOW = /snow/i;
  function snowy(p) { return SNOW.test(String(p.shortForecast || '')); }
  // The hour on the period's own clock (its offset is the site's), never the phone's.
  function hourText(iso) {
    var h = Number(String(iso).slice(11, 13));
    return (h % 12 || 12) + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  // Periods are hourly: [{startTime, shortForecast, endTime?}, ...]. The ones
  // already over are dropped, so the first left is "now", and the window is the
  // next 12 of them. '' when there is nothing usable (the caller shows no hint).
  function hint(periods, nowIso) {
    var now = Date.parse(nowIso), up = [], i, p, s, e;
    if (!(periods instanceof Array) || isNaN(now)) return '';
    for (i = 0; i < periods.length; i++) {
      p = periods[i];
      s = p && Date.parse(p.startTime);
      if (!p || isNaN(s)) continue;
      e = Date.parse(p.endTime);
      if (isNaN(e) || e <= s) e = s + 3600000;
      if (e > now) up.push(p);
    }
    up = up.slice(0, WINDOW);
    if (!up.length) return '';
    if (snowy(up[0])) {
      for (i = 0; i < up.length && snowy(up[i]); i++);
      // The run reaches the end of the window: it does not end in the next 12 h.
      if (i >= WINDOW) return 'Snow for the next ' + WINDOW + ' h+';
      return 'Snow until ' + hourText(up[i].startTime);
    }
    for (i = 1; i < up.length; i++) if (snowy(up[i])) return 'Snow from ' + hourText(up[i].startTime);
    return 'No snow in the next ' + WINDOW + ' h';
  }

  // GET a JSON body, or null on any failure (network, non-200, bad JSON, timeout).
  function getJson(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT) : null;
    return Promise.resolve().then(function () { return fetch(url, ctl ? { signal: ctl.signal } : undefined); })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) { if (timer) clearTimeout(timer); return j; });
  }

  // lat, lon -> the hint text, or null. nowIso is for tests; the phone's own
  // clock is the default (an instant, so its time zone does not matter).
  function fetchHint(lat, lon, nowIso) {
    if (!isNum(lat) || !isNum(lon)) return Promise.resolve(null);
    return getJson(HOST + 'points/' + lat + ',' + lon).then(function (pt) {
      var url = pt && pt.properties && pt.properties.forecastHourly;
      // The URL is the server's word: follow it only if it stays on the NWS.
      if (typeof url !== 'string' || url.indexOf(HOST) !== 0) return null;
      return getJson(url);
    }).then(function (fc) {
      var periods = fc && fc.properties && fc.properties.periods;
      var text = periods ? hint(periods, nowIso || new Date().toISOString()) : '';
      return text || null;
    }).catch(function () { return null; });
  }

  return { point: point, hint: hint, fetchHint: fetchHint };
});
