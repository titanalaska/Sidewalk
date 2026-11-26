// Print map (Matt, 11/18/26): one site's map on paper, for the binder and for a crew not in the app yet.
// What prints is what the map shows right now (pan, zoom, turn and photo first, then Print): the photo with
// the zones, each zone numbered, a priority zone's number in gold, a north arrow; under it the legend and
// a numbered list of the zones (name, what it is, its note). The site's address, materials and notes on top.
//
// The page is HTML from plain data (pageHtml: no DOM, no clock), so node checks it. The picture is the map's
// own canvas, copied in the frame MapLibre draws it (capture), with the numbers drawn over it. It opens in the
// same overlay the other print views use (#printview, body.printing in app.css); app.js opens and closes it.
var SnowMapPrint = (function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function text(v) { return v == null ? '' : String(v).trim(); }

  // The zones in print order, numbered from 1: priority zones first, then by name (numbers in names read as
  // numbers: "Walk 2" before "Walk 10"). The input is not sorted.
  function numbered(zones) {
    return (zones || []).slice().sort(function (a, b) {
      return (a.priority ? 0 : 1) - (b.priority ? 0 : 1) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
    }).map(function (z, i) { return { n: i + 1, z: z }; });
  }

  // types: SnowMap.TYPES ({ key: { color, label } }); concreteLabel: SnowMap.NEW_CONCRETE_LABEL.
  // img: a data URL, or null when the picture could not be made (the list still prints). No zones: no picture box, the
  // page says none are drawn. loadFailed: the site's zones could not be had at all (no answer, nothing kept): the page
  // says so, and has no list (an empty one would read as "nothing to do here").
  function pageHtml(o) {
    var s = o.site || {}, types = o.types || {};
    var sub = [text(s.address), text(s.customer)].filter(Boolean).map(function (x) { return '<span data-no-es>' + esc(x) + '</span>'; }).join(' · ');
    var facts = '';
    // Materials and notes are typed (Spanish everywhere, Ship 2): data-typed. Needs clearance is a measurement: as typed.
    if (text(s.materials_needed)) facts += '<div><b>Materials:</b> <b data-no-es data-typed>' + esc(s.materials_needed) + '</b></div>';
    if (text(s.needs_clearance)) facts += '<div><b>Needs clearance:</b> <span data-no-es>' + esc(s.needs_clearance) + '</span></div>';
    if (text(s.notes)) facts += '<div class="mp-notes" data-no-es data-typed>' + esc(s.notes) + '</div>';
    var items = o.items || [];
    var pic = o.loadFailed ? '<div class="mp-noimg">This site\'s map couldn\'t be loaded on this phone. Open it in the app with signal, then print it from there.</div>'
      : !items.length ? ''
      : o.img ? '<img class="mp-img" src="' + esc(o.img) + '" alt="Site map">'
      : '<div class="mp-noimg">The map picture could not be made on this phone. The zone list below is still right.</div>';
    var legend = Object.keys(types).map(function (k) {
      return '<span><i style="background:' + esc(types[k].color) + '"></i>' + esc(types[k].label) + '</span>';
    }).join('') + (o.concreteLabel ? '<span><i class="mp-stripes"></i>' + esc(o.concreteLabel) + '</span>' : '') +
      '<span><b class="mp-num mp-pri">1</b>Priority: do first</span>';
    var rows = items.map(function (it) {
      var z = it.z, t = types[z.type] || { label: z.type || '', color: '#888' };
      var what = esc(t.label) + (z.new_concrete === true ? '<div class="mp-nc"><i class="mp-stripes"></i>New concrete: sand only, no salt</div>' : '');
      return '<tr><td><b class="mp-num' + (z.priority ? ' mp-pri' : '') + '">' + it.n + '</b></td>' +
        // The zone's name and note are typed (Spanish everywhere, Ship 2): data-typed, so lib/estyped.js shows their Spanish; the
        // star stays outside the name's span. An empty note cell carries no mark.
        '<td><b>' + (z.priority ? '★ ' : '') + '<span data-no-es data-typed>' + esc(z.name) + '</span></b></td>' +
        '<td><i class="mp-sw" style="background:' + esc(t.color || '#888') + '"></i>' + what + '</td>' +
        (text(z.note) ? '<td data-no-es data-typed>' + esc(text(z.note)) + '</td>' : '<td></td>') + '</tr>';
    }).join('');
    var table = o.loadFailed ? '' : items.length ? '<table class="mp-zones"><thead><tr><th>#</th><th>Zone</th><th>What</th><th>Note</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<p>No zones drawn on this site yet.</p>';
    return '<div class="sheet mp-sheet"><h1 data-no-es>' + esc(s.name) + '</h1>' + (sub ? '<div class="mp-sub">' + sub + '</div>' : '') +
      (facts ? '<div class="mp-facts">' + facts + '</div>' : '') + pic + (items.length ? '<div class="mp-legend">' + legend + '</div>' : '') + table +
      '<div class="mp-made">Printed <span data-no-es>' + esc(o.madeAt || '') + '</span></div></div>';
  }

  // Under #printsheets already (the overlay's box), so nothing restyles the app. Colours print as drawn.
  var css = [
    '#printsheets .mp-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '#printsheets .mp-sheet h1 { font-size: 20pt; margin: 0 0 2px; }',
    '#printsheets .mp-sub { color: #333; margin-bottom: 6px; }',
    '#printsheets .mp-facts { margin-bottom: 8px; }',
    '#printsheets .mp-notes { white-space: pre-wrap; }',
    '#printsheets .mp-img { display: block; width: 100%; max-height: 5.6in; object-fit: contain; border: 1px solid #000; margin: 6px 0; }',
    '#printsheets .mp-noimg { border: 1px dashed #000; padding: 24px; text-align: center; margin: 6px 0; }',
    '#printsheets .mp-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 9.5pt; margin: 4px 0 10px; }',
    '#printsheets .mp-legend span { display: inline-flex; align-items: center; gap: 5px; }',
    '#printsheets .mp-legend i, #printsheets .mp-sw { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; vertical-align: -2px; margin-right: 5px; }',
    '#printsheets .mp-stripes { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; vertical-align: -2px; margin-right: 5px; background: repeating-linear-gradient(45deg, #b5e61d 0 3px, #fff 3px 7px); }',
    '#printsheets .mp-num { display: inline-block; min-width: 20px; height: 20px; line-height: 18px; border: 1.5px solid #000; border-radius: 10px; text-align: center; font-size: 10pt; background: #fff; }',
    '#printsheets .mp-num.mp-pri { background: #ffd23f; }',
    '#printsheets .mp-zones { width: 100%; border-collapse: collapse; font-size: 10pt; }',
    '#printsheets .mp-zones th, #printsheets .mp-zones td { border: 1px solid #888; padding: 3px 6px; text-align: left; vertical-align: top; }',
    '#printsheets .mp-zones th:nth-child(1) { width: 26px; }',
    '#printsheets .mp-zones th:nth-child(2) { width: 30%; }',
    '#printsheets .mp-zones th:nth-child(3) { width: 30%; }',
    '#printsheets .mp-zones tr { break-inside: avoid; page-break-inside: avoid; }',
    '#printsheets .mp-nc { font-size: 9pt; font-weight: bold; }',
    '#printsheets .mp-sheet + .mp-sheet { break-before: page; page-break-before: always; }',
    '#printsheets .mp-made { color: #555; font-size: 9pt; margin-top: 8px; }',
  ].join('\n');

  // ---- the picture (DOM; the page only) ----
  // The page's shape: a picture 7.5 in wide and 5.6 in tall fills a Letter page's width with room under it. The map is
  // drawn at this size in CSS pixels for the copy, then put back: a phone's tall narrow screen would print a strip.
  var PRINT_W = 1000, PRINT_H = 746;
  // How much to zoom so everything the screen showed (w x h) still shows at the print size: the larger of the two
  // stretches wins, so nothing seen is cut. In zoom levels (one level = twice the size).
  function zoomFor(w, h) {
    if (!(w > 0) || !(h > 0)) return 0;
    return Math.log(Math.min(PRINT_W / w, PRINT_H / h)) / Math.LN2;
  }

  // The map's canvas is a WebGL one: its pixels can be read only in the frame it is drawn, so the copy is made in a
  // 'render' handler after a repaint is asked for. It waits for the photo tiles first (idle), but never longer than
  // waitMs: a photo that never comes still leaves the zones to print. The map's box, size and camera are put back
  // whatever happens. Resolves to a JPEG data URL; rejects when the canvas can't be read (a tainted canvas, a lost context).
  // asIs: the map is already the page's size and framed (Print maps for a route draws each site off screen at PRINT_W x
  // PRINT_H): nothing is resized or moved.
  function capture(map, items, centroid, waitMs, asIs) {
    var box = map.getContainer(), was = { w: box.style.width, h: box.style.height, maxW: box.style.maxWidth, minH: box.style.minHeight, sizing: box.style.boxSizing };
    var cam = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    var shownW = box.clientWidth, shownH = box.clientHeight;
    function restore() {
      box.style.width = was.w; box.style.height = was.h; box.style.maxWidth = was.maxW; box.style.minHeight = was.minH; box.style.boxSizing = was.sizing;
      try { map.resize(); map.jumpTo(cam); } catch (e) { /* the map was removed meanwhile */ }
    }
    return new Promise(function (res, rej) {
      var started = false;
      function shoot() {
        try {
          var src = map.getCanvas();
          var c = document.createElement('canvas');
          c.width = src.width; c.height = src.height;
          var g = c.getContext('2d');
          g.drawImage(src, 0, 0);
          // k: canvas pixels per CSS pixel (where things are); u: the size of the numbers and the arrow, half again
          // as big as on screen so they read at arm's length on paper.
          var k = src.width / (src.clientWidth || src.width), u = 1.5 * k;
          drawNumbers(g, map, items, centroid, k, u, c.width, c.height);
          drawNorth(g, map.getBearing ? map.getBearing() : 0, u, c.width);
          res(c.toDataURL('image/jpeg', 0.9));
        } catch (e) { rej(e); }
      }
      function go() {
        if (started) return;
        started = true;
        map.once('render', shoot);
        map.triggerRepaint();
      }
      if (!asIs) try {
        box.style.maxWidth = 'none'; box.style.minHeight = '0'; box.style.boxSizing = 'content-box'; // the size is the picture's, border aside
        box.style.width = PRINT_W + 'px'; box.style.height = PRINT_H + 'px';
        map.resize();
        map.jumpTo({ center: cam.center, bearing: cam.bearing, pitch: cam.pitch, zoom: Math.min(map.getMaxZoom(), cam.zoom + zoomFor(shownW, shownH)) });
      } catch (e) { rej(e); return; }
      map.once('idle', go);
      map.triggerRepaint();
      setTimeout(go, waitMs == null ? 6000 : waitMs);
    }).then(function (url) { if (!asIs) restore(); return url; }, function (e) { if (!asIs) restore(); throw e; });
  }
  function drawNumbers(g, map, items, centroid, k, u, w, h) {
    var r = 11 * u;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold ' + Math.round(12 * u) + 'px Arial, sans-serif';
    items.forEach(function (it) {
      var p = map.project(centroid(it.z.ring));
      var x = p.x * k, y = p.y * k;
      if (x < -r || y < -r || x > w + r || y > h + r) return; // off this view: the list still names it
      var label = String(it.n), rr = Math.max(r, (g.measureText(label).width / 2) + 5 * u);
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2);
      g.fillStyle = it.z.priority ? '#ffd23f' : '#ffffff'; g.fill();
      g.lineWidth = 2 * u; g.strokeStyle = '#000000'; g.stroke();
      g.fillStyle = '#000000'; g.fillText(label, x, y + 0.5 * u);
    });
  }
  // A north arrow in the top-right corner, turned with the map (a site turned so its entrance faces up).
  function drawNorth(g, bearing, k, w) {
    var cx = w - 26 * k, cy = 30 * k;
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.strokeStyle = '#000'; g.lineWidth = 1.5 * k;
    g.beginPath(); g.arc(cx, cy, 20 * k, 0, Math.PI * 2); g.fill(); g.stroke();
    g.translate(cx, cy); g.rotate(-bearing * Math.PI / 180);
    g.fillStyle = '#000';
    g.beginPath(); g.moveTo(0, -14 * k); g.lineTo(7 * k, 6 * k); g.lineTo(0, 2 * k); g.lineTo(-7 * k, 6 * k); g.closePath(); g.fill();
    g.font = 'bold ' + Math.round(9 * k) + 'px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', 0, 12 * k);
    g.restore();
  }

  return { numbered: numbered, pageHtml: pageHtml, css: css, capture: capture, zoomFor: zoomFor, PRINT_W: PRINT_W, PRINT_H: PRINT_H };
})();
if (typeof window !== 'undefined') window.SnowMapPrint = SnowMapPrint;
if (typeof module !== 'undefined') module.exports = SnowMapPrint;
