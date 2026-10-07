// Sidewalk snow app -- site maps, crew view. One site's zones over live aerial
// imagery. MapLibre is loaded on first use, not on every page load: it is
// ~900 KB and most opens of the app never look at a map.
//
// Zones never depend on the imagery. They are a GeoJSON source over a plain
// background; the photo tiles are underneath and may fail on their own.
var SnowMap = (function () {
  'use strict';
  var ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var MOA = 'https://www.ancgis.com/arcgis/rest/services/imagery_public/Photo_2024/MapServer/tile/{z}/{y}/{x}';
  var ANCHORAGE = [-149.9003, 61.2181]; // first open of an undrawn site: Matt pans from here, then Save view
  var MOA_BOUNDS = [-150.09, 60.85, -149.04, 61.47]; // Bootprint's, so MOA is never asked for tiles it can't have
  // Bootprint's colours (Matt, 10/4/26): what he traces there looks the same here.
  // Hand work is the sidewalk crew's lot rows, curbs and pullouts; storage only
  // shows the Bobcat operator where snow goes. Parking lots are the plow crew's
  // and are not a type here. Key order is the legend's order.
  var TYPES = {
    sidewalk: { color: '#1c6fb0', label: 'Sidewalk' },
    hand: { color: '#d98c00', label: 'Hand work' },
    heated: { color: '#d62828', label: 'Heated: check only, no melt' },
    storage: { color: '#7d5ba6', label: 'Snow storage' },
    no_touch: { color: '#e0218a', label: 'Do not touch' },
  };

  // MapLibre 5 fires NO error for a 404 raster tile (sparse sources 404 by
  // design), so the map can't tell us the photo is missing. Ask the servers:
  // fetch the one tile under the site's centre from each source.
  function tileUrl(tpl, lng, lat, z) {
    var n = Math.pow(2, z), r = lat * Math.PI / 180;
    var x = Math.floor((lng + 180) / 360 * n);
    var y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }
  function fetchOk(u) {
    return fetch(u, { cache: 'force-cache' }).then(function (r) { return r.ok; }, function () { return false; });
  }
  function probePhotos(c, zoom) {
    var moaCovers = c.lng >= MOA_BOUNDS[0] && c.lng <= MOA_BOUNDS[2] && c.lat >= MOA_BOUNDS[1] && c.lat <= MOA_BOUNDS[3];
    return Promise.all([
      fetchOk(tileUrl(ESRI, c.lng, c.lat, Math.min(19, Math.round(zoom)))),
      moaCovers ? fetchOk(tileUrl(MOA, c.lng, c.lat, Math.max(13, Math.min(21, Math.round(zoom))))) : Promise.resolve(false),
    ]).then(function (r) { return { esriOk: r[0], moaOk: r[1], moaCovers: moaCovers }; });
  }

  // Should the crew see "Aerial photo unavailable"?
  //   esriOk    -- Esri answered with a photo (Esri is the base layer, everywhere)
  //   moaOk     -- MOA answered with a photo (it sits on top where it has one)
  //   moaCovers -- the site is inside MOA's area at all
  // Matt, 10/1/26: warn only when NO photo loads at all. A blurrier Esri photo
  // is still a photo, and a banner that cries wolf gets ignored.
  function photoUnavailable(esriOk, moaOk, moaCovers) {
    return !esriOk && !(moaCovers && moaOk);
  }

  var loading = null;
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    if (loading) return loading;
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'vendor/maplibre-gl.css';
    document.head.appendChild(css);
    loading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/maplibre-gl.js';
      s.onload = function () { res(); };
      s.onerror = function () { loading = null; rej(new Error('map library did not load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Area-weighted centroid in the lng/lat plane: plenty at site scale, and it
  // stays inside an L-shaped walk where the corner average can fall outside.
  function centroid(ring) {
    var a = 0, x = 0, y = 0, n = ring.length;
    for (var i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
      a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
    }
    if (!a) return ring[0];
    return [x / (3 * a), y / (3 * a)];
  }

  function featureCollection(zones) {
    return { type: 'FeatureCollection', features: zones.map(function (z) {
      return { type: 'Feature', properties: { id: z.id, type: z.type },
        geometry: { type: 'Polygon', coordinates: [z.ring.concat([z.ring[0]])] } };
    }) };
  }

  function legendHtml() {
    return Object.keys(TYPES).map(function (k) {
      return '<span><i style="background:' + TYPES[k].color + '"></i>' + esc(TYPES[k].label) + '</span>';
    }).join('');
  }

  function sheetHtml(z) {
    var t = TYPES[z.type] || { label: z.type };
    return '<h2>' + (z.priority ? '★ ' : '') + esc(z.name) + '</h2>' +
      '<div><span class="swatch" style="background:' + (t.color || '#888') + '"></span>' + esc(t.label) + '</div>' +
      (z.priority ? '<div><b>Priority: do first</b></div>' : '') +
      (z.note ? '<div>' + esc(z.note) + '</div>' : '') +
      (z.area_sqft != null ? '<div class="muted">≈ ' + Math.round(z.area_sqft).toLocaleString('en-US') + ' sq ft</div>' : '');
  }

  function drawStars(map, zones) {
    map._snow.byId = {};
    zones.forEach(function (z) { map._snow.byId[z.id] = z; });
    map._snow.stars.forEach(function (m) { m.remove(); });
    map._snow.stars = zones.filter(function (z) { return z.priority; }).map(function (z) {
      var el = document.createElement('div');
      el.className = 'zone-star'; el.textContent = '★'; el.title = 'Priority: ' + z.name;
      return new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(centroid(z.ring)).addTo(map);
    });
  }
  // Walk marks (the Storm tab): a tick on a walk that is done, a bang on a problem.
  // The colours of the zones themselves (Matt's types) are not touched.
  var DONE = ['cleared', 'treated', 'checked'];
  function markOf(row) {
    var s = row && row.state;
    return DONE.indexOf(s) !== -1 ? '✓' : s === 'problem' ? '!' : '';
  }
  // statesByZone: CrewShiftLog.walkStates, keyed 'siteId|zoneId'. A zone with no
  // row, or an undone one, gets no mark; a 'whole' walk has no zone, so none.
  function drawMarks(map, zones, states) {
    map._snow.marks.forEach(function (m) { m.remove(); });
    map._snow.marks = [];
    zones.forEach(function (z) {
      var t = markOf(states && states[z.site_id + '|' + z.id]);
      if (!t) return;
      var el = document.createElement('div');
      el.className = 'zone-mark ' + (t === '!' ? 'bad' : 'done'); el.textContent = t; el.setAttribute('data-zone', z.id);
      el.title = (t === '!' ? 'Problem: ' : 'Done: ') + z.name;
      // Below the priority star, which sits on the same centroid.
      map._snow.marks.push(new window.maplibregl.Marker({ element: el, anchor: 'center', offset: [0, 30] }).setLngLat(centroid(z.ring)).addTo(map));
    });
  }
  function setStates(map, zones, states) {
    map._snow.states = states || {};
    drawMarks(map, zones, map._snow.states);
  }
  // After a save or archive: the same map, redrawn from the new zone list.
  function setZones(map, zones) {
    map.getSource('zones').setData(featureCollection(zones));
    drawStars(map, zones);
    drawMarks(map, zones, map._snow.states);
  }

  // els: {map, legend, warn, sheet}. Resolves to the map as soon as it exists.
  async function open(els, site, zones) {
    await loadLib();
    var gl = window.maplibregl;
    var view = site.map || {};
    var colour = ['match', ['get', 'type']];
    Object.keys(TYPES).forEach(function (k) { colour.push(k, TYPES[k].color); });
    colour.push('#888888');
    // The zones are part of the starting style, not added on 'load': 'load'
    // waits for the photo tiles, and with no signal it may never come.
    var map = new gl.Map({
      container: els.map,
      center: view.center || (zones.length ? zones[0].ring[0] : ANCHORAGE),
      zoom: view.zoom || (zones.length ? 18 : 15),
      bearing: view.bearing || 0, // Matt may turn a site so its main entrance faces him; the crew open it the same way
      maxZoom: 22,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' },
          moa: { type: 'raster', tiles: [MOA], tileSize: 256, minzoom: 13, maxzoom: 21, bounds: MOA_BOUNDS, attribution: 'Municipality of Anchorage' },
          zones: { type: 'geojson', data: featureCollection(zones) },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#20241f' } },
          { id: 'esri', type: 'raster', source: 'esri' },
          { id: 'moa', type: 'raster', source: 'moa' },
          { id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': colour, 'fill-opacity': 0.35 } },
          { id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': colour, 'line-width': 3 } },
        ],
      },
    });
    // The compass turns a rotated map back to north in one tap.
    map.addControl(new gl.NavigationControl({ showCompass: true }), 'bottom-right');
    // No saved view yet: frame the zones rather than open on an empty corner.
    if (!view.center && zones.length) {
      var b = new gl.LngLatBounds();
      zones.forEach(function (z) { z.ring.forEach(function (p) { b.extend(p); }); });
      map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 20 });
    }

    probePhotos(map.getCenter(), map.getZoom()).then(function (p) {
      els.warn.hidden = !photoUnavailable(p.esriOk, p.moaOk, p.moaCovers);
    });

    els.legend.innerHTML = legendHtml();

    // One tap flips the photo. Tall buildings lean over the walks in one flight
    // and not the same way in the other (Matt, tracing PAC, 10/1/26). Esri is
    // always underneath, so hiding the city layer is the whole switch.
    var sw = document.createElement('button');
    sw.id = 'photoswitch'; sw.className = 'photoswitch'; sw.type = 'button';
    // Never ask the map: right after new Map() it has not built the layer yet,
    // and MapLibre logs "non-existing layer moa" on every open (10/4/26). It
    // starts visible.
    var moaOn = true;
    function showSwitch() { sw.textContent = moaOn ? 'Photo: City 2024' : 'Photo: Esri'; }
    sw.onclick = function () {
      moaOn = !moaOn;
      map.setLayoutProperty('moa', 'visibility', moaOn ? 'visible' : 'none');
      showSwitch();
    };
    showSwitch();
    els.map.appendChild(sw);

    // editing: set by the zone editor, so a tap edits instead of showing the sheet.
    map._snow = { byId: {}, stars: [], marks: [], states: {}, editing: false };
    drawStars(map, zones);
    map.on('click', 'zones-fill', function (e) {
      if (map._snow.editing) return;
      var z = e.features && e.features[0] && map._snow.byId[e.features[0].properties.id];
      if (!z) return;
      els.sheet.innerHTML = sheetHtml(z);
      els.sheet.hidden = false;
    });
    map.on('mouseenter', 'zones-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'zones-fill', function () { map.getCanvas().style.cursor = ''; });
    // Hand the map over once the zones are painted (not when the photo is:
    // that may never happen). A tap before this would find nothing to hit.
    await new Promise(function (res) {
      var done = false;
      function finish() { if (!done) { done = true; map.off('render', check); res(); } }
      function check() {
        var ok = false;
        try { ok = map.isSourceLoaded('zones'); } catch (e) { /* style not parsed yet */ }
        if (ok) map.once('render', finish);
      }
      map.on('render', check);
      map.triggerRepaint();
      setTimeout(finish, 8000); // never leave the screen half-open
    });
    return map;
  }

  return { open: open, setZones: setZones, setStates: setStates, markOf: markOf, TYPES: TYPES, centroid: centroid, photoUnavailable: photoUnavailable,
    loadLib: loadLib }; // the snow map (lib/snowmap.js, 10/6/26) loads MapLibre the same way
})();
if (typeof window !== 'undefined') window.SnowMap = SnowMap;
if (typeof module !== 'undefined') module.exports = SnowMap;
