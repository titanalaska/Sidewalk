// Sidewalk snow app -- site maps, Matt's zone editor (admin only; the backend
// refuses zone writes from anyone else). Tap corners on the aerial, drag them,
// undo, pick a type, save. The old route-sheet picture is shown from a local
// blob: URL only: it is never uploaded, stored or put in a request.
var SnowMapEdit = (function () {
  'use strict';
  var BTN = { sidewalk: 'Sidewalk', hand: 'Hand', heated: 'Heated', storage: 'Snow storage', no_touch: 'Do not touch' };
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
    // moving: taps move the map instead of adding corners. sel: the corner tapped for Delete (-1: none).
    st = { o: o, map: map, corners: [], markers: [], undo: [], drawing: false, zone: null, type: '', locked: false, busy: false, refUrl: null,
      moving: false, sel: -1, float: null };
    map._snow.editing = true;
    o.els.sheet.hidden = true;
    map.on('click', onMapClick);
    ensureDraft(); // now, or when the style is parsed; the bar below never waits for it
    o.els.tools.innerHTML = '<div class="row" id="edbar"><button id="ed_new" class="primary">New zone</button><button id="ed_view">Save view</button>' +
      '<label class="filebtn">Show old map<input id="ed_reffile" type="file" accept="image/*"></label>' +
      '<label class="filebtn">Import from Bootprint<input id="ed_bpfile" type="file" accept=".json,application/json"></label><button id="ed_done">Done</button></div>' +
      '<div id="ed_msg" class="muted">Tap a zone to change it, or New zone to draw one.</div><section class="card" id="zoneform" hidden></section>' +
      '<section class="card" id="bpimport" hidden></section>';
    o.els.tools.onclick = onToolClick;
    // A file picker opens before any click handler can refuse it, so the refusal
    // is on the label's click (it is what opens the picker).
    Array.prototype.forEach.call(o.els.tools.querySelectorAll('label.filebtn'), function (l) {
      l.addEventListener('click', function (ev) { if (importBusy()) ev.preventDefault(); });
    });
    $('ed_reffile').onchange = function () { showRef(this.files && this.files[0]); this.value = ''; };
    $('ed_bpfile').onchange = function () { var f = this.files && this.files[0]; this.value = ''; if (f) readBootprint(f); };
    // On the map itself, within thumb reach (Matt, first real trace 10/1/26):
    // turn buttons for a touchpad that can't right-drag, and while drawing, the
    // Move/Add switch and Delete corner.
    var f = st.float = document.createElement('div');
    f.className = 'edfloat';
    f.innerHTML = '<button id="ed_rotl" type="button" aria-label="Turn the map left">⟲</button><button id="ed_rotr" type="button" aria-label="Turn the map right">⟳</button>' +
      '<span id="ed_drawctl" hidden><button id="z_mode" type="button"></button><button id="z_delcorner" type="button" disabled>Delete corner</button></span>';
    f.onclick = onFloatClick;
    map.getContainer().appendChild(f);
  }

  // ---------- the draft layer: the outline being drawn, or the import preview ----------
  // MapLibre parses an inline style on the NEXT ANIMATION FRAME, and a page off screen
  // gets none (10/9/26, Fire Station #10: the phone's screen off, the app behind
  // another, the desktop pane's window hidden). SnowMap.open still hands the map over
  // after its 8 s fallback, so start() can meet a style that is not parsed yet, and
  // addSource and addLayer throw on it ("Style is not done loading"). The draft goes on
  // once the style is there, and whatever it should show by then is drawn. The probe is
  // the site's own zones source, which the parse puts there -- NOT isStyleLoaded(): that
  // also waits for the photo tiles, and the photo may never come. The draft draws over a
  // plain background just the same.
  function styleParsed(map) { return !!map.getSource('zones'); }
  function onStyle() { if (st) ensureDraft(); }
  function ensureDraft() {
    var map = st.map;
    if (!styleParsed(map)) { map.once('styledata', onStyle); return; }
    if (!map.getSource('draft')) {
      map.addSource('draft', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1] } });
    }
    if (st.drawing) setDraft(outlineData());
    else if (st.bp && st.bp.pick) setDraft(previewData(st.bp.pick));
  }
  // Nothing while the draft is not there yet (ensureDraft draws it when it is), or the map is gone.
  function setDraft(data) {
    try { var s = st.map.getSource('draft'); if (s) s.setData(data); } catch (e) { /* map removed */ }
  }

  function onFloatClick(ev) {
    var t = ev.target;
    // Snap to whole 15-degree steps: a second tap during the turn animation
    // would otherwise start from a half-turned bearing and drift.
    if (t.id === 'ed_rotl' || t.id === 'ed_rotr') st.map.rotateTo(Math.round(st.map.getBearing() / 15) * 15 + (t.id === 'ed_rotr' ? 15 : -15), { duration: 200 });
    else if (t.id === 'z_mode') { st.moving = !st.moving; drawControls(); }
    else if (t.id === 'z_delcorner' && st.sel >= 0) { pushUndo(); st.corners.splice(st.sel, 1); st.sel = -1; drawCorners(); }
  }

  function drawControls() {
    if (!$('ed_drawctl')) return;
    $('ed_drawctl').hidden = !st.drawing;
    $('z_mode').textContent = st.moving ? 'Moving map: tap to add corners' : 'Adding corners: tap to move map';
    $('z_mode').classList.toggle('on', !st.moving);
    $('z_delcorner').disabled = st.sel < 0;
  }

  function stop() {
    if (!st) return;
    var s = st;
    endDraw();
    closeRef();
    try {
      s.map.off('click', onMapClick);
      s.map.off('styledata', onStyle);
      ['draft-line', 'draft-fill'].forEach(function (id) { if (s.map.getLayer(id)) s.map.removeLayer(id); });
      if (s.map.getSource('draft')) s.map.removeSource('draft');
      s.map._snow.editing = false;
    } catch (e) { /* map already removed */ }
    s.o.els.tools.innerHTML = '';
    s.o.els.tools.onclick = null;
    if (s.float) s.float.remove();
    st = null;
  }

  // Corners on the map that no Save has kept. New zone and Done used to drop
  // them without a word (Matt lost a whole trace of PAC this way, 10/1/26).
  // Only Save, Cancel or the phone's Back may end a zone with corners.
  function unsavedWork() {
    if (!(st.drawing && st.corners.length)) return false;
    st.o.toast('Save or Cancel this zone first. It has ' + st.corners.length + ' corners that are not saved.');
    return true;
  }

  // An import saves one zone every 2-3 s. Done used to stop it halfway with
  // only "Added 2 of 5. Stopped: not saved" to show for it (Matt, 10/4/26).
  // While st.importing is set, New zone, Save view, Done, both file pickers, the
  // tabs, ‹ Back and the phone's Back come here first (app.js calls it through
  // refuse()); true means "refused, and he's been told".
  function importBusy() {
    if (!(st && st.importing)) return false;
    st.o.toast('Still adding zones. Wait for it to finish.');
    return true;
  }

  function onToolClick(ev) {
    var t = ev.target, b;
    if ((t.id === 'ed_new' || t.id === 'ed_view' || t.id === 'ed_done') && importBusy()) return;
    if (t.id === 'ed_new') { if (!unsavedWork()) beginDraw(null); }
    else if (t.id === 'ed_view') saveView();
    else if (t.id === 'ed_done') { if (!unsavedWork()) { var o = st.o; stop(); o.onDone(); } }
    else if (t.id === 'z_undo') undo();
    else if (t.id === 'z_lock') { st.locked = !st.locked; drawCorners(); formButtons(); }
    else if (t.id === 'z_save') saveZone();
    else if (t.id === 'z_archive') archiveZone();
    else if (t.id === 'z_cancel') endDraw();
    else if ((b = t.closest('[data-bpjob]'))) previewJob(Number(b.dataset.bpjob));
    else if (t.id === 'bp_add') addImported();
    else if (t.id === 'bp_cancel') closeImport();
    else if ((b = t.closest('[data-ztype]'))) { st.type = b.dataset.ztype; formButtons(); }
  }

  function onMapClick(e) {
    if (!st) return;
    // MapLibre also fires the map click for a tap on a corner marker: that tap
    // is grabbing the corner, not adding one (else A,B,C,D,B -- a spike).
    var tgt = e.originalEvent && e.originalEvent.target;
    if (tgt && tgt.closest && tgt.closest('.zone-corner')) return;
    if (st.drawing) {
      if (st.moving) return; // Move map mode: a tap (or a touchpad's drag-tap) never adds a corner
      pushUndo();
      st.corners.push([e.lngLat.lng, e.lngLat.lat]);
      drawCorners();
      return;
    }
    if (!styleParsed(st.map)) return; // no zone to hit yet, and MapLibre logs an error for the missing layer
    var f = st.map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
    var z = f && st.map._snow.byId[f.properties.id];
    if (z) beginDraw(z);
  }

  // ---------- drawing ----------
  function beginDraw(z) {
    closeImport(); // the import preview and a drawing share the draft layer
    endDraw();
    st.drawing = true; st.zone = z; st.type = z ? z.type : ''; st.undo = []; st.moving = false; st.sel = -1;
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
    if (st.o.onDraw) st.o.onDraw(); // the phone's Back now cancels this drawing first
  }

  function endDraw() {
    if (!st) return;
    var was = st.drawing;
    st.drawing = false; st.zone = null; st.corners = []; st.undo = [];
    st.markers.forEach(function (m) { m.remove(); });
    st.markers = [];
    setDraft(EMPTY);
    if ($('zoneform')) { $('zoneform').hidden = true; $('zoneform').innerHTML = ''; }
    if ($('ed_msg')) $('ed_msg').hidden = false;
    st.sel = -1;
    drawControls();
    if (was && st.o.onDraw) st.o.onDraw();
  }

  function formButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ztype]'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.ztype === st.type));
    });
    if ($('z_lock')) $('z_lock').textContent = st.locked ? 'Unlock corners' : 'Lock corners';
  }

  function pushUndo() { st.undo.push(copy(st.corners)); }
  function undo() { if (st.undo.length) { st.corners = st.undo.pop(); st.sel = -1; drawCorners(); } }

  function outlineData() {
    var c = st.corners;
    if (c.length >= 3) return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c.concat([c[0]])] } };
    if (c.length === 2) return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } };
    return EMPTY;
  }
  function drawOutline() { setDraft(outlineData()); }

  function drawCorners() {
    st.markers.forEach(function (m) { m.remove(); });
    st.markers = st.corners.map(function (p, i) {
      var el = document.createElement('div');
      el.className = 'zone-corner' + (i === st.sel ? ' sel' : '');
      // Tap a corner to choose it for Delete corner; tap it again to let go.
      el.addEventListener('click', function () { st.sel = st.sel === i ? -1 : i; drawCorners(); });
      var m = new window.maplibregl.Marker({ element: el, anchor: 'center', draggable: !st.locked }).setLngLat(p).addTo(st.map);
      m.on('dragstart', pushUndo);
      m.on('drag', function () { var ll = m.getLngLat(); st.corners[i] = [ll.lng, ll.lat]; drawOutline(); });
      return m;
    });
    drawOutline();
    drawControls();
  }

  // ---------- saving ----------
  function problem() {
    if (st.corners.length < 3) return 'At least 3 corners. Tap the map to add them.';
    if (!st.type) return 'Pick a type: Sidewalk, Hand, Heated, Snow storage or Do not touch.';
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
        if (typeof errEl === 'function') errEl(r.reason || 'Not saved.');   // e.g. the toast
        else if (errEl) errEl.textContent = r.reason || 'Not saved.';
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
    var rec = Object.assign({}, st.o.getSite(), { map: { center: [c.lng, c.lat], zoom: st.map.getZoom(), bearing: st.map.getBearing() } });
    var o = st.o;
    if (st.busy) { o.toast('Still saving. Try Save view again in a moment.'); return; }
    // The editor's message line is hidden while a zone is drawn, so a refusal
    // goes to the toast, which always shows.
    var saved = await send('saveSite', { record: rec }, o.toast);
    if (!saved) return;
    o.onSite(saved); // the site's rev moved on, whether or not the editor is still open
    o.toast('View saved. The crew open here.');
  }

  // ---------- import from Bootprint ----------
  // The export file is read here and held only while this panel is open. Only
  // the outlines that become zones are sent, one save at a time.
  function readBootprint(file) {
    if (unsavedWork()) return;
    if (st.drawing) endDraw();
    file.text().then(function (text) {
      if (!st) return;
      var p = window.SnowBpImport.parseExport(text);
      if (p.error) { closeImport(); st.o.toast(p.error); return; }
      var c = st.map.getCenter();
      st.bp = { list: window.SnowBpImport.byDistance(p.jobs, [c.lng, c.lat]), pick: null };
      $('bpimport').innerHTML = '<h2>Import from Bootprint</h2><p class="muted">Nearest this site first. Pick the job that measured it.</p><div id="bp_jobs">' +
        st.bp.list.map(function (it, i) {
          var zs = window.SnowBpImport.convertJob(it.job, []).zones;
          return '<button class="bpjob" data-bpjob="' + i + '"><b>' + esc(it.job.name || 'Unnamed job') + '</b>' +
            '<span class="muted">' + away(it.meters) + ' · ' + walksAndPiles(zs) + '</span></button>';
        }).join('') + '</div><div id="bp_sum"></div>' +
        '<div class="row"><button id="bp_add" class="primary" disabled>Pick a job</button><button id="bp_cancel">Cancel</button></div>';
      $('bpimport').hidden = false;
      $('ed_msg').hidden = true;
      // The list renders below the map buttons, off a phone's screen: Matt picked a
      // file 10/4/26, saw nothing happen, and the import never ran.
      if ($('bpimport').scrollIntoView) $('bpimport').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  // A pile is not a walk (10/4/26): "26 walks · 3 snow piles", never "29 walks".
  function walksAndPiles(zones) {
    var piles = zones.filter(function (z) { return z.type === 'storage'; }).length;
    return plural(zones.length - piles, 'walk') + (piles ? ' · ' + plural(piles, 'snow pile') : '');
  }
  function away(m) { return !isFinite(m) ? 'no corners' : m < 1000 ? Math.round(m) + ' m away' : (m / 1000).toFixed(1) + ' km away'; }
  function existingFroms() {
    var byId = st.map._snow.byId;
    return Object.keys(byId).map(function (k) { return byId[k].from; }).filter(Boolean);
  }

  function previewData(r) {
    return { type: 'FeatureCollection', features: r.zones.map(function (z) {
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [z.ring.concat([z.ring[0]])] } };
    }) };
  }
  function previewJob(i) {
    var it = st.bp && st.bp.list[i]; if (!it) return;
    var r = st.bp.pick = window.SnowBpImport.convertJob(it.job, existingFroms());
    Array.prototype.forEach.call(document.querySelectorAll('[data-bpjob]'), function (b) { b.classList.toggle('sel', Number(b.dataset.bpjob) === i); });
    setDraft(previewData(r));
    if (r.zones.length) {
      var b = new window.maplibregl.LngLatBounds();
      r.zones.forEach(function (z) { z.ring.forEach(function (p) { b.extend(p); }); });
      st.map.fitBounds(b, { padding: 40, maxZoom: 20, duration: 300 });
    }
    var s = r.skipped, out = [];
    if (s.lots) out.push(plural(s.lots, 'lot') + ' (the plow crew\'s)');
    if (s.cutouts) out.push(plural(s.cutouts, 'cut-out'));
    if (s.noWidth) out.push(plural(s.noWidth, 'run') + ' with no width (set it in Bootprint)');
    if (s.tooSharp) out.push(plural(s.tooSharp, 'run') + ' that turn too sharply (trace as an area)');
    if (s.unfinished) out.push(plural(s.unfinished, 'unfinished shape'));
    if (s.already) out.push(s.already + ' already imported');
    var n = r.zones.length;
    $('bp_sum').innerHTML = '<b>' + walksAndPiles(r.zones) + ' to add</b>' + (out.length ? '<div class="muted">Left out: ' + esc(out.join(', ')) + '</div>' : '');
    $('bp_add').disabled = !n;
    $('bp_add').textContent = n ? 'Add ' + plural(n, 'zone') : 'Nothing to add';
  }

  async function addImported() {
    var r = st.bp && st.bp.pick; if (!r || !r.zones.length) return;
    var o = st.o, siteId = o.getSite().id, done = 0, reason = '', n = r.zones.length;
    st.importing = true;
    // Nothing in the panel may change the pick mid-way: the job buttons, Cancel and Add lock.
    Array.prototype.forEach.call(document.querySelectorAll('#bpimport button'), function (b) { b.disabled = true; });
    if (o.onDraw) o.onDraw(); // Back is now an 'import' step that importBusy() refuses
    try {
      for (var i = 0; i < n && st; i++) {
        var z = r.zones[i];
        // On the button Matt just tapped, and in words: 'Adding 7 of 18…'
        if ($('bp_add')) $('bp_add').textContent = 'Adding ' + (i + 1) + ' of ' + n + '…';
        var saved = await send('saveZone', { record: { site_id: siteId, type: z.type, priority: false, name: z.name, note: '',
          ring: z.ring, from: z.from, rev: 0 } }, function (m) { reason = m; });
        if (!saved) break;
        o.onZone(saved);
        done++;
      }
    } finally {
      if (st) st.importing = false;
      if (o.onDraw) o.onDraw();
    }
    if (st) closeImport();
    o.toast(done === r.zones.length
      ? 'Added ' + plural(done, 'zone') + ' from Bootprint. Tap any heated or do-not-touch one to change it.'
      : 'Added ' + done + ' of ' + r.zones.length + '. Stopped: ' + (reason || 'not saved') + '. Import again for the rest.');
  }

  function closeImport() {
    if (!st) return;
    st.bp = null;
    if ($('bpimport')) { $('bpimport').hidden = true; $('bpimport').innerHTML = ''; }
    if ($('ed_msg') && !st.drawing) $('ed_msg').hidden = false;
    if (!st.drawing) setDraft(EMPTY);
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

  return { start: start, stop: stop,
    drawing: function () { return !!(st && st.drawing); },
    importing: function () { return !!(st && st.importing); },
    refuse: function () { importBusy(); },
    cancelDraw: function () { endDraw(); } };
})();
if (typeof window !== 'undefined') window.SnowMapEdit = SnowMapEdit;
