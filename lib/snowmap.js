// The snow map (Matt, 10/6/26): one map of Anchorage on the Storm tab's live view, a dot per
// site coloured by the next 12 hours' forecast snowfall (the NWS gridpoint series the Callouts
// box already fetches), each dot taking the crews' measured depths (New snow, site cards) as
// they come in with the poll. The pure parts take their inputs as data and node tests them;
// `open` and `setDots` touch MapLibre (loaded by lib/mapview.js on first use).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./weather'), require('./shiftlog'), require('./mapview'));
  else root.SnowMapOverview = factory(root.SnowWeather, root.CrewShiftLog, root.SnowMap);
})(this, function (Weather, Log, Map) {
  'use strict';
  // A plain base for a city at a glance; the aerial is for one site. Esri's, the aerial's host.
  var GRAY = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  var ANCHORAGE = [-149.9003, 61.2181];
  var MM_PER_IN = 25.4, HOURS = 12;
  var DONE = ['cleared', 'treated', 'checked'];

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function round1(n) { return Math.round(n * 10) / 10; }

  // Every live site with a point (SnowWeather.point: the saved view's centre, else the first
  // outline's centroid, rounded to two decimals as the NWS is asked), and the ones without.
  function pointsFor(sites, zones) {
    var points = [], missing = [];
    (sites || []).forEach(function (s) {
      if (!s || s.archived === true) return;
      var p = Weather.point(s, (zones || []).filter(function (z) { return z.site_id === s.id && z.archived !== true; }));
      if (p) points.push({ id: s.id, name: s.name, address: s.address || '', lat: p[0], lon: p[1] });
      else missing.push({ id: s.id, name: s.name });
    });
    return { points: points, missing: missing };
  }

  // The forecast new snow in [now, now + hours]: each period counts by the fraction of it inside
  // the window (the Callouts' arithmetic); a period with no snow still counts as covered. null
  // when nothing overlaps (no forecast to show), else inches to one decimal.
  function forecastInches(series, nowMs, hours) {
    if (!Array.isArray(series) || !isNum(nowMs)) return null;
    var end = nowMs + (hours || HOURS) * 3600000, mm = 0, any = false;
    series.forEach(function (p) {
      if (!p || !isNum(p.start) || !isNum(p.end) || p.end <= p.start) return;
      var lo = Math.max(p.start, nowMs), hi = Math.min(p.end, end);
      if (hi <= lo) return;
      any = true;
      mm += (isNum(p.mm) ? p.mm : 0) * ((hi - lo) / (p.end - p.start));
    });
    return any ? round1(mm / MM_PER_IN) : null;
  }

  function reading(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // The newest measured depth per site this storm: a New snow row ('*', depth) or a site card's
  // depth_in; the newer `at` wins. 0 is a reading ("I measured, nothing new"); blank is none.
  function measuredDepths(log, visits, stormId) {
    var out = {};
    if (!stormId) return out;
    function take(site, inches, at, by) {
      if (inches === null) return;
      var cur = out[site];
      if (!cur || Date.parse(at) > Date.parse(cur.at)) out[site] = { inches: inches, at: at, by_name: by || '' };
    }
    (log || []).forEach(function (r) { if (r && r.storm_id === stormId && r.zone_id === '*' && r.state === 'depth') take(r.site_id, reading(r.depth_in), r.at, r.by_name); });
    (visits || []).forEach(function (v) { if (v && v.storm_id === stormId) take(v.site_id, reading(v.depth_in), v.at, v.by_name); });
    return out;
  }

  // The colour step for a forecast: no forecast, none, under 1", 1 to 3", 3 to 6", 6" and over.
  function dotStep(inches) {
    if (!isNum(inches)) return 'nofc';
    if (inches <= 0) return 'none';
    if (inches < 1) return 'light';
    if (inches < 3) return 'mid';
    if (inches < 6) return 'heavy';
    return 'severe';
  }

  // Under the dot: a measured depth (when, who), else the forecast as a guess, else a question mark.
  function dotLabel(forecast, measured, clock) {
    if (measured) return [measured.inches.toFixed(1) + '"', clock(measured.at), measured.by_name].filter(Boolean).join(' ');
    return isNum(forecast) ? '~' + forecast.toFixed(1) + '"' : '?';
  }

  // The live view's words for a site: Done, Problem, k of n walks, Not started.
  function siteStatus(siteId, zones, states) {
    var walks = Log.walksFor(siteId, zones);
    var rows = walks.map(function (w) { return (states || {})[Log.walkKey(siteId, w.zone_id)]; }).filter(Boolean);
    if (Log.siteDone(siteId, zones, states)) return 'Done';
    if (rows.some(function (r) { return r.state === 'problem'; })) return 'Problem';
    var done = rows.filter(function (r) { return DONE.indexOf(r.state) !== -1; }).length;
    return done ? done + ' of ' + walks.length + ' walks' : 'Not started';
  }

  // ---- the map ----
  // els: {box, info}. points: pointsFor().points. Resolves to the map once it exists; the dots are
  // DOM markers (.snowdot[data-site]) so a test can count and read them, and a tap on one puts its
  // words in els.info.
  async function open(els, points) {
    await Map.loadLib();
    var gl = window.maplibregl;
    var map = new gl.Map({
      container: els.box, center: ANCHORAGE, zoom: 10, maxZoom: 16, attributionControl: false,
      style: { version: 8,
        sources: { gray: { type: 'raster', tiles: [GRAY], tileSize: 256, maxzoom: 16, attribution: 'Esri, HERE, Garmin' } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e6e1' } }, { id: 'gray', type: 'raster', source: 'gray' }] },
    });
    map.addControl(new gl.NavigationControl({ showCompass: false }), 'bottom-right');
    if (points.length) {
      var b = new gl.LngLatBounds();
      points.forEach(function (p) { b.extend([p.lon, p.lat]); });
      map.fitBounds(b, { padding: 36, duration: 0, maxZoom: 13 });
    }
    map._dots = {};
    points.forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'snowdot nofc';
      el.dataset.site = p.id;
      el.innerHTML = '<span class="snowdot-pin"></span><span class="snowdot-label">?</span>';
      // els.info may be a function: the info line is redrawn with the page, so it is looked up at tap time.
      el.onclick = function () {
        var info = typeof els.info === 'function' ? els.info() : els.info;
        if (info) info.textContent = el.dataset.words || p.name;
      };
      map._dots[p.id] = { el: el, marker: new gl.Marker({ element: el, anchor: 'top' }).setLngLat([p.lon, p.lat]).addTo(map), point: p };
    });
    return map;
  }

  // dots: { siteId: { step, label, measured, words } }. A site not in `dots` reads as no forecast.
  function setDots(map, dots) {
    Object.keys(map._dots || {}).forEach(function (id) {
      var d = map._dots[id], v = (dots || {})[id] || { step: 'nofc', label: '?', measured: false, words: '' };
      d.el.className = 'snowdot ' + v.step + (v.measured ? ' measured' : '');
      d.el.querySelector('.snowdot-label').textContent = v.label;
      d.el.dataset.words = v.words || '';
    });
  }

  return { HOURS: HOURS, pointsFor: pointsFor, forecastInches: forecastInches, measuredDepths: measuredDepths, dotStep: dotStep,
    dotLabel: dotLabel, siteStatus: siteStatus, open: open, setDots: setDots };
});
