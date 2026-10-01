// Sidewalk snow app -- site maps, Matt's zone editor (admin only; the backend
// refuses zone writes from anyone else). Tap corners on the aerial, drag them,
// undo, pick a type, save. The old route-sheet picture is shown from a local
// blob: URL only: it is never uploaded, stored or put in a request.
var SnowMapEdit = (function () {
  'use strict';
  var BTN = { sidewalk: 'Sidewalk', heated: 'Heated', no_touch: 'Do not touch' };
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var st = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function copy(ring) { return ring.map(function (p) { return [p[0], p[1]]; }); }

  // o: {map, getSite(), call(action, payload), els: {tools, sheet},
  //     onZone(record), onSite(record), onSignin(reason), onDone(), toast(msg)}
  function start(o) {
    stop();
    var map = o.map;
    st = { o: o, map: map, corners: [], markers: [], undo: [], drawing: false, zone: null, type: '', locked: false, busy: false, refUrl: null };
    map._snow.editing = true;
    o.els.sheet.hidden = true;
    if (!map.getSource('draft')) {
      map.addSource('draft', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1] } });
    }
    map.on('click', onMapClick);
    o.els.tools.innerHTML = '<div class="row" id="edbar"><button id="ed_new" class="primary">New zone</button><button id="ed_view">Save view</button>' +
      '<label class="filebtn">Show old map<input id="ed_reffile" type="file" accept="image/*"></label><button id="ed_done">Done</button></div>' +
      '<div id="ed_msg" class="muted">Tap a zone to change it, or New zone to draw one.</div><section class="card" id="zoneform" hidden></section>';
    o.els.tools.onclick = onToolClick;
    $('ed_reffile').onchange = function () { showRef(this.files && this.files[0]); this.value = ''; };
  }

  function stop() {
    if (!st) return;
    var s = st;
    endDraw();
    closeRef();
    try {
      s.map.off('click', onMapClick);
      ['draft-line', 'draft-fill'].forEach(function (id) { if (s.map.getLayer(id)) s.map.removeLayer(id); });
      if (s.map.getSource('draft')) s.map.removeSource('draft');
      s.map._snow.editing = false;
    } catch (e) { /* map already removed */ }
    s.o.els.tools.innerHTML = '';
    s.o.els.tools.onclick = null;
    st = null;
  }

  function onToolClick(ev) {
    var t = ev.target, b;
    if (t.id === 'ed_new') beginDraw(null);
    else if (t.id === 'ed_view') saveView();
    else if (t.id === 'ed_done') { var o = st.o; stop(); o.onDone(); }
    else if (t.id === 'z_undo') undo();
    else if (t.id === 'z_lock') { st.locked = !st.locked; drawCorners(); formButtons(); }
    else if (t.id === 'z_save') saveZone();
    else if (t.id === 'z_archive') archiveZone();
    else if (t.id === 'z_cancel') endDraw();
    else if ((b = t.closest('[data-ztype]'))) { st.type = b.dataset.ztype; formButtons(); }
  }

  function onMapClick(e) {
    if (!st) return;
    // MapLibre also fires the map click for a tap on a corner marker: that tap
    // is grabbing the corner, not adding one (else A,B,C,D,B -- a spike).
    var tgt = e.originalEvent && e.originalEvent.target;
    if (tgt && tgt.closest && tgt.closest('.zone-corner')) return;
    if (st.drawing) {
      pushUndo();
      st.corners.push([e.lngLat.lng, e.lngLat.lat]);
      drawCorners();
      return;
    }
    var f = st.map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
    var z = f && st.map._snow.byId[f.properties.id];
    if (z) beginDraw(z);
  }

  // ---------- drawing ----------
  function beginDraw(z) {
    endDraw();
    st.drawing = true; st.zone = z; st.type = z ? z.type : ''; st.undo = [];
    st.corners = z ? copy(z.ring) : [];
    var f = $('zoneform');
    f.innerHTML = '<h2>' + (z ? 'Edit zone' : 'New zone') + '</h2>' +
      '<p class="muted">Tap the map to add corners. Drag a corner to move it.</p>' +
      '<div class="ztypes">' + Object.keys(BTN).map(function (k) {
        return '<button data-ztype="' + k + '" style="--zc:' + window.SnowMap.TYPES[k].color + '">' + BTN[k] + '</button>';
      }).join('') + '</div>' +
      '<label class="inline"><input type="checkbox" id="z_priority"' + (z && z.priority ? ' checked' : '') + '> Priority: do first</label>' +
      '<label>Name</label><input id="z_name" value="' + esc(z ? z.name : '') + '" placeholder="Main entry">' +
      '<label>Note for the crew (optional)</label><textarea id="z_note" rows="2">' + esc(z ? z.note : '') + '</textarea>' +
      '<div class="row"><button id="z_undo">Undo</button><button id="z_lock"></button></div>' +
      '<div id="z_err" class="err"></div>' +
      '<div class="row"><button id="z_save" class="primary">Save zone</button>' + (z ? '<button id="z_archive">Archive</button>' : '') + '<button id="z_cancel">Cancel</button></div>';
    f.hidden = false;
    $('ed_msg').hidden = true;
    formButtons();
    drawCorners();
  }

  function endDraw() {
    if (!st) return;
    st.drawing = false; st.zone = null; st.corners = []; st.undo = [];
    st.markers.forEach(function (m) { m.remove(); });
    st.markers = [];
    try { st.map.getSource('draft').setData(EMPTY); } catch (e) { /* removed */ }
    if ($('zoneform')) { $('zoneform').hidden = true; $('zoneform').innerHTML = ''; }
    if ($('ed_msg')) $('ed_msg').hidden = false;
  }

  function formButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ztype]'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.ztype === st.type));
    });
    if ($('z_lock')) $('z_lock').textContent = st.locked ? 'Unlock corners' : 'Lock corners';
  }

  function pushUndo() { st.undo.push(copy(st.corners)); }
  function undo() { if (st.undo.length) { st.corners = st.undo.pop(); drawCorners(); } }

  function drawOutline() {
    var c = st.corners, data = EMPTY;
    if (c.length >= 3) data = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c.concat([c[0]])] } };
    else if (c.length === 2) data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } };
    st.map.getSource('draft').setData(data);
  }

  function drawCorners() {
    st.markers.forEach(function (m) { m.remove(); });
    st.markers = st.corners.map(function (p, i) {
      var el = document.createElement('div');
      el.className = 'zone-corner';
      var m = new window.maplibregl.Marker({ element: el, anchor: 'center', draggable: !st.locked }).setLngLat(p).addTo(st.map);
      m.on('dragstart', pushUndo);
      m.on('drag', function () { var ll = m.getLngLat(); st.corners[i] = [ll.lng, ll.lat]; drawOutline(); });
      return m;
    });
    drawOutline();
  }

  // ---------- saving ----------
  function problem() {
    if (st.corners.length < 3) return 'At least 3 corners. Tap the map to add them.';
    if (!st.type) return 'Pick a type: Sidewalk, Heated or Do not touch.';
    if (!$('z_name').value.trim()) return 'Name is required.';
    if (window.SnowGeo.isSelfIntersecting(window.SnowGeo.ringToPins(st.corners))) return 'The outline crosses itself. Move a corner or Undo.';
    return '';
  }

  // One write at a time: a second tap on a slow Apps Script call must not
  // create a second zone.
  async function send(action, payload, errEl) {
    if (st.busy) return null;
    st.busy = true;
    var o = st.o;
    try {
      var r = await o.call(action, payload);
      if (!r.ok) {
        if (r.code === 'signin') { o.onSignin(r.reason); return null; }
        if (errEl) errEl.textContent = r.reason || 'Not saved.';
        return null;
      }
      return r.record;
    } finally { if (st) st.busy = false; }
  }

  async function saveZone() {
    var err = problem();
    if (err) { $('z_err').textContent = err; return; }
    var rec = Object.assign({}, st.zone || { site_id: st.o.getSite().id, rev: 0 }, {
      type: st.type, priority: $('z_priority').checked, name: $('z_name').value.trim(), note: $('z_note').value.trim(), ring: copy(st.corners),
    });
    delete rec.area_sqft; // the server works it out
    var o = st.o;
    var saved = await send('saveZone', { record: rec }, $('z_err'));
    if (!saved) return;
    // The server has it: record it even if Matt tapped Done or Back meanwhile,
    // or he sees no zone and draws it twice.
    o.onZone(saved);
    if (!st) return;
    endDraw();
    backToMap();
    st.o.toast('Zone saved');
  }

  async function archiveZone() {
    var z = st.zone; if (!z) return;
    var o = st.o;
    var saved = await send('archiveZone', { id: z.id, rev: z.rev }, $('z_err'));
    if (!saved) return;
    o.onZone(saved);
    if (!st) return;
    endDraw();
    backToMap();
    st.o.toast('Zone archived');
  }

  // On a phone the form sits below the map; after a save, bring the map back
  // so the next zone can be drawn without scrolling up.
  function backToMap() {
    var c = st.map.getContainer();
    if (c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  }

  async function saveView() {
    var c = st.map.getCenter();
    var rec = Object.assign({}, st.o.getSite(), { map: { center: [c.lng, c.lat], zoom: st.map.getZoom() } });
    var o = st.o;
    var saved = await send('saveSite', { record: rec }, $('ed_msg'));
    if (!saved) return;
    o.onSite(saved); // the site's rev moved on, whether or not the editor is still open
    o.toast('View saved. The crew open here.');
  }

  // ---------- old route-sheet picture (this screen only) ----------
  function showRef(file) {
    if (!file || !st) return;
    closeRef();
    st.refUrl = URL.createObjectURL(file);
    var p = document.createElement('div');
    p.id = 'refpanel';
    p.innerHTML = '<div class="refhead"><span>Old map: on this screen only, never saved</span><button id="ref_min" class="small">Hide</button><button id="ref_close" class="small">Close</button></div>';
    var img = document.createElement('img');
    img.alt = 'Old route-sheet map';
    img.src = st.refUrl;
    p.appendChild(img);
    document.body.appendChild(p);
    document.body.classList.add('has-ref');
    $('ref_close').onclick = closeRef;
    // Phone: the sheet folds down to its bar so the map underneath can be traced.
    $('ref_min').onclick = function () {
      var min = p.classList.toggle('min');
      document.body.classList.toggle('ref-min', min);
      this.textContent = min ? 'Show' : 'Hide';
    };
  }
  function closeRef() {
    if ($('refpanel')) $('refpanel').remove();
    document.body.classList.remove('has-ref', 'ref-min');
    if (st && st.refUrl) { URL.revokeObjectURL(st.refUrl); st.refUrl = null; }
  }

  return { start: start, stop: stop };
})();
if (typeof window !== 'undefined') window.SnowMapEdit = SnowMapEdit;
