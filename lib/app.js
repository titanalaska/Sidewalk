// Sidewalk snow app -- Foundation. Sign in, routes and sites for everyone;
// roster, sites and routes editors for Matt. Every screen is drawn from what
// the backend sent for THIS person's role: the page never hides private
// fields, because a crew member's phone never receives them.
(function () {
  'use strict';
  var F = window.CrewForms, API = window.SnowApi;
  var OPERATE = ['blower', 'sweepster', 'bobcat', 'snowrator', 'shovel'];
  var TRI = [['is_lead', 'Lead'], ['good_lead', 'Good lead'], ['can_drive', 'Can drive'], ['valid_id', 'Valid ID'],
    ['cold_rated', 'Cold-rated'], ['smokes', 'Smokes'], ['logs_own_work', 'Logs own work'], ['on_call', 'On call'],
    ['reliable_3am', 'Reliable at 3 AM']];
  var S = { me: null, sites: [], routes: [], crew: [], zones: [], moves: [], callouts: [], gear: [], post: null, tab: 'routes', profiles: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function option(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function isAdmin() { return S.me && S.me.role === 'admin'; }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }
  function site(id) { return S.sites.filter(function (s) { return s.id === id; })[0]; }
  function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0].toUpperCase(); }).join(''); }
  function avatar(w) {
    return w && w.photo_thumb && /^data:image\//.test(w.photo_thumb) ? '<img class="av" alt="" src="' + esc(w.photo_thumb) + '">' : '<span class="av">' + esc(initials(w && w.name)) + '</span>';
  }
  function showDialog() { if (!$('dlg').open) { $('dlg').showModal(); syncHistory(); } }
  function closeDialog() { if ($('dlg').open) $('dlg').close(); }

  // ---------- the phone's Back button ----------
  // One page, so Back used to leave the app (Matt, 10/1/26). The browser's
  // history now mirrors what is open, as a stack: map, then a zone being
  // drawn, then a box. Back pops one step and closes whatever sat above it.
  // history.go() answers later (popstate), so our own pops are counted and the
  // stack is re-matched once they land: a drawing started in the meantime is
  // pushed back on, never cancelled by a stale pop.
  var popping = 0, handlingBack = false;
  function wantedSteps() {
    var w = [];
    if (S.mapSite) w.push('map');
    if (window.SnowMapEdit && window.SnowMapEdit.drawing()) w.push('draw');
    if ($('dlg').open) w.push('dlg');
    return w;
  }
  function historySteps() { return (history.state && history.state.snow) || []; }
  function syncHistory() {
    if (popping || handlingBack) return;
    var want = wantedSteps(), have = historySteps(), same = 0;
    while (same < want.length && same < have.length && want[same] === have[same]) same++;
    if (same < have.length) { popping++; history.go(same - have.length); return; }
    for (var i = same; i < want.length; i++) history.pushState({ snow: want.slice(0, i + 1) }, '');
  }
  window.addEventListener('popstate', function () {
    if (popping) { popping--; syncHistory(); return; }
    var have = historySteps();
    handlingBack = true; // half-closed screens must not re-push steps mid-way
    try {
      if ($('dlg').open && have.indexOf('dlg') === -1) closeDialog();
      if (window.SnowMapEdit && window.SnowMapEdit.drawing() && have.indexOf('draw') === -1) window.SnowMapEdit.cancelDraw();
      if (S.mapSite && have.indexOf('map') === -1) render();
    } finally { handlingBack = false; }
    syncHistory();
  });
  $('dlg').addEventListener('close', syncHistory);
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, 5000); }
  function chrome(signedIn) {
    $('tabs').hidden = !signedIn; $('signout').hidden = !signedIn;
    $('who').textContent = signedIn && S.me ? S.me.name + (isAdmin() ? ' · admin' : S.me.role === 'lead' ? ' · lead' : '') : '';
  }

  // ---------- load ----------
  async function load() {
    $('main').innerHTML = '<p class="muted">Loading…</p>';
    if (!API.hasToken()) return showSignIn();
    var r = await API.call('bootstrap');
    $('verwarn').hidden = !r.versionMismatch || r.code === 'network';
    if (r.ok) { S.me = r.me; S.sites = r.sites; S.routes = r.routes; S.crew = r.crew; S.zones = r.zones || [];
      S.moves = r.moves || []; S.callouts = r.callouts || []; S.gear = r.gear || []; S.post = r.post || null; return render(); }
    if (r.code === 'signin') return showSignIn(r.reason);
    if (r.code === 'not_on_roster') return showNotOnRoster(r.name, r.reason);
    chrome(false);
    $('main').innerHTML = '<section class="card"><h2>Couldn\'t reach the server</h2><p class="muted">' + esc(r.reason) +
      '</p><button id="retry" class="primary">Try again</button></section>';
  }

  // ---------- sign in ----------
  async function showSignIn(why) {
    S.me = null; chrome(false);
    $('main').innerHTML = '<section class="card" id="signin"><h2>Sign in</h2>' +
      '<p class="muted">Same name and PIN as Titan Inventory.</p>' +
      '<label>Your name</label><select id="si_who"><option value="">Loading names…</option></select>' +
      '<label id="si_pinlabel">PIN</label><input id="si_pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off">' +
      '<div id="si_err" class="err">' + (why ? esc(why) : '') + '</div>' +
      '<div class="row"><button id="si_go" class="primary">Sign in</button><button id="si_req">Request access</button></div></section>';
    var list = await API.profiles();
    if (!$('si_who')) return;
    if (!list) { $('si_who').innerHTML = option('', 'Couldn\'t load names', true); $('si_err').textContent = "Couldn't reach the server. Try again."; return; }
    S.profiles = list;
    $('si_who').innerHTML = option('', 'Choose your name', true) + list.map(function (p) {
      return option(p.id, p.name + (p.status === 'pending' ? ' (waiting for approval)' : ''), false);
    }).join('');
    $('si_who').onchange = function () {
      var p = profileById(this.value);
      $('si_pinlabel').textContent = p && p.status === 'approved' && p.hasPin === false ? 'First time: Choose a 4-digit PIN' : 'PIN';
    };
  }
  function profileById(id) { return (S.profiles || []).filter(function (p) { return String(p.id) === String(id); })[0]; }

  async function doSignIn() {
    var id = $('si_who').value, pin = $('si_pin').value.trim(), p = profileById(id);
    if (!id) { $('si_err').textContent = 'Choose your name.'; return; }
    // Pending: say so without spending one of Inventory's six PIN tries.
    if (p && p.status === 'pending') { $('si_err').textContent = 'Your access is still waiting for Matt to approve it.'; return; }
    if (!/^\d{4}$/.test(pin)) { $('si_err').textContent = 'PIN is 4 digits.'; return; }
    $('si_go').disabled = true;
    var r = await API.signIn(id, pin, !!(p && p.hasPin === false));
    if ($('si_go')) $('si_go').disabled = false;
    if (!r.ok) { $('si_err').textContent = r.reason; return; }
    load();
  }

  function showRequest() {
    $('main').innerHTML = '<section class="card" id="request"><h2>Request access</h2>' +
      '<p class="muted">This goes to Matt in Titan Inventory. Once he approves it, sign in with your name and this PIN.</p>' +
      '<label>Your name</label><input id="rq_name"><label>Position</label><input id="rq_pos" placeholder="Sidewalk crew">' +
      '<label>Choose a 4-digit PIN</label><input id="rq_pin" type="password" inputmode="numeric" maxlength="4">' +
      '<div id="rq_err" class="err"></div><div class="row"><button id="rq_go" class="primary">Send request</button><button id="rq_back">Back</button></div></section>';
  }
  async function doRequest() {
    var name = $('rq_name').value.trim(), pos = $('rq_pos').value.trim() || 'Sidewalk crew', pin = $('rq_pin').value.trim();
    if (!name) { $('rq_err').textContent = 'Name is required.'; return; }
    if (!/^\d{4}$/.test(pin)) { $('rq_err').textContent = 'PIN is 4 digits.'; return; }
    var r = await API.requestAccess(name, pos, pin);
    if (!r.ok) { $('rq_err').textContent = r.reason; return; }
    $('main').innerHTML = '<section class="card"><h2>Request sent</h2><p class="muted">Matt will approve it in Titan Inventory. Then sign in here.</p><button id="rq_back">Back to sign in</button></section>';
  }

  function showNotOnRoster(name, reason) {
    chrome(false); $('signout').hidden = false;
    $('main').innerHTML = '<section class="card" id="notroster"><h2>Hi ' + esc(name || '') + '</h2><p>' + esc(reason) + '</p></section>';
  }

  // ---------- signed-in screens ----------
  function render() {
    closeMap();
    chrome(true);
    var tabs = [['routes', 'Routes'], ['sites', 'Sites']].concat(isAdmin() ? [['board', 'Board'], ['roster', 'Roster']] : []);
    if (!tabs.some(function (t) { return t[0] === S.tab; })) S.tab = 'routes';
    $('tabs').innerHTML = tabs.map(function (t) { return '<button data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>'; }).join('');
    if (S.tab === 'routes') renderRoutes(); else if (S.tab === 'sites') renderSites();
    else if (S.tab === 'board') SnowBoardUI.renderBoard(boardCtx()); else renderRoster();
  }

  // What the pairings screens (lib/boardui.js) may use of this file.
  function boardCtx() {
    return { S: S, $: $, esc: esc, call: API.call, toast: toast, render: render, avatar: avatar, openWorker: openWorker };
  }

  function renderRoutes() {
    var live = S.routes.filter(function (r) { return !r.archived; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
    $('main').innerHTML = (live.map(function (r) {
      return '<section class="card route-card" data-route="' + esc(r.id) + '"><div class="route-top"><span class="route-badge">' + esc(r.name) + '</span>' +
        (isAdmin() ? '<button class="small" data-edit="route:' + esc(r.id) + '">Edit</button>' : '') + '</div>' +
        '<ol class="sitelist">' + (r.site_ids || []).map(function (id) { var s = site(id); return '<li><span>' + esc(s ? s.name : id) + '</span>' + (s ? '<button class="small" data-map="' + esc(id) + '">Map</button>' : '') + '</li>'; }).join('') + '</ol></section>';
    }).join('') || '<p class="muted">No routes yet.</p>') + (isAdmin() ? '<div class="row"><button class="primary" data-edit="route:">Add route</button></div>' : '');
  }

  function renderSites() {
    var live = S.sites.filter(function (s) { return !s.archived; }).sort(byName);
    $('main').innerHTML = (live.map(function (s) {
      return '<section class="card site-card" data-site="' + esc(s.id) + '"><div class="route-top"><span class="site-name">' + esc(s.name) + '</span>' +
        '<span class="row tight"><button class="small" data-map="' + esc(s.id) + '">Map</button>' + (isAdmin() ? '<button class="small" data-edit="site:' + esc(s.id) + '">Edit</button>' : '') + '</span></div>' +
        (s.address ? '<div class="muted">' + esc(s.address) + '</div>' : '') + (s.notes ? '<div>' + esc(s.notes) + '</div>' : '') + '</section>';
    }).join('') || '<p class="muted">No sites yet.</p>') + (isAdmin() ? '<div class="row"><button class="primary" data-edit="site:">Add site</button></div>' : '');
  }

  function renderRoster() {
    var list = S.crew.filter(function (w) { return !w.archived; }).sort(byName);
    $('main').innerHTML = '<div class="row" style="margin-top:0"><button class="primary" id="addWorker">Add worker</button></div><div class="grid">' +
      list.map(function (w) { return '<div class="tile" role="button" tabindex="0" data-open="' + esc(w.id) + '">' + avatar(w) + '<div>' + esc(w.name) + '</div></div>'; }).join('') + '</div>';
  }

  // ---------- site map (everyone) ----------
  // window.SnowMapView is the open map, and only while it is on screen.
  var mapSeq = 0;
  function closeMap() {
    mapSeq++;
    if (window.SnowMapEdit) window.SnowMapEdit.stop();
    if (window.SnowMapView) { window.SnowMapView.remove(); window.SnowMapView = null; }
    if (S.mapSite) { S.mapSite = null; syncHistory(); }
  }
  function siteZones(id) { return S.zones.filter(function (z) { return z.site_id === id && !z.archived; }); }
  // In place, so editing a zone doesn't move it to the top of the drawing stack.
  function replaceIn(list, rec) {
    var i = S[list].findIndex(function (x) { return x.id === rec.id; });
    if (i === -1) S[list] = S[list].concat([rec]); else { S[list] = S[list].slice(); S[list][i] = rec; }
  }
  function startEdit(id) {
    $('mapedit').hidden = true;
    var m = window.SnowMapView;
    window.SnowMapEdit.start({
      map: m, getSite: function () { return site(id); }, call: API.call,
      els: { tools: $('maptools'), sheet: $('zonesheet') },
      // May arrive after Back (a slow save): keep the record; redraw only if THIS
      // map is still up -- never onto another site's map opened meanwhile.
      onZone: function (rec) { replaceIn('zones', rec); if (window.SnowMapView === m) window.SnowMap.setZones(m, siteZones(id)); },
      onSite: function (rec) { replaceIn('sites', rec); },
      onSignin: function (reason) { closeMap(); showSignIn(reason); },
      onDone: function () { if ($('mapedit')) $('mapedit').hidden = false; },
      onDraw: syncHistory,
      toast: toast,
    });
  }
  async function openMap(id) {
    var s = site(id); if (!s) return;
    closeMap();
    var seq = mapSeq;
    var zones = siteZones(id);
    var info = (s.materials_needed ? '<div><b>Materials:</b> ' + esc(s.materials_needed) + '</div>' : '') +
      (s.notes ? '<div>' + esc(s.notes) + '</div>' : '');
    // Matt gets the map even with no zones: it's where the first one is drawn.
    var drawn = zones.length || isAdmin();
    $('main').innerHTML = '<div class="route-top"><button id="mapback" class="small">‹ Back</button><span class="site-name">' + esc(s.name) + '</span>' +
      (isAdmin() ? '<button id="mapedit" class="small" data-site="' + esc(s.id) + '" disabled>Edit map</button>' : '') + '</div>' +
      '<section class="card" id="mapsite">' + (s.address ? '<div class="muted">' + esc(s.address) + '</div>' : '') + info + '</section>' +
      (drawn ? '<div id="mapwarn" class="banner" hidden>Aerial photo unavailable. The zones below are still right.</div>' +
        '<div id="mapbox"><div id="maplegend" class="maplegend"></div></div><div id="maptools"></div><section class="card" id="zonesheet" hidden></section>'
        : '<section class="card"><h2>Map not drawn yet</h2><p class="muted">Matt hasn\'t drawn this site\'s zones. Use the site notes for now.</p></section>');
    S.mapSite = id;
    syncHistory();
    if (!drawn) return;
    try {
      var map = await window.SnowMap.open({ map: $('mapbox'), legend: $('maplegend'), warn: $('mapwarn'), sheet: $('zonesheet') }, s, zones);
      if (seq !== mapSeq) { map.remove(); return; } // left the screen while it loaded
      window.SnowMapView = map;
      if ($('mapedit')) $('mapedit').disabled = false;
    } catch (e) {
      if (seq === mapSeq && $('mapwarn')) { $('mapwarn').textContent = "The map couldn't load on this phone. Use the site notes."; $('mapwarn').hidden = false; }
    }
  }

  // ---------- roster (admin) ----------
  function worker(id) { return S.crew.filter(function (w) { return w.id === id; })[0]; }
  function openWorker(id, extraHtml) {
    var w = worker(id); if (!w) return;
    function yn(v) { return v === true ? 'yes' : v === false ? 'no' : '<span class="muted">not set</span>'; }
    function names(ids) { return (ids || []).map(function (x) { return esc((worker(x) || { name: x }).name); }).join(', ') || '<span class="muted">none</span>'; }
    var rows = [['Phone', esc(w.phone) || '<span class="muted">none</span>']].concat(TRI.map(function (t) { return [t[1], yn(w[t[0]])]; }))
      .concat([['Operates', esc((w.can_operate || []).join(', ')) || '<span class="muted">none</span>'],
        ['Traits', esc(w.traits) || '<span class="muted">none</span>'], ['Weaknesses', esc(w.weaknesses) || '<span class="muted">none</span>'],
        ['Clearances', esc(F.formatClearances(w.clearances)) || '<span class="muted">none</span>'],
        ['Rides with', w.rides_with ? esc((worker(w.rides_with) || { name: w.rides_with }).name) : '<span class="muted">nobody</span>'],
        ['Gear', w.gear === 'own' ? 'own' : w.gear === 'needs_issued' ? 'needs issued' : '<span class="muted">not set</span>'],
        ['Works well with', names(w.works_well_with)], ['Keep apart from', names(w.keep_apart_from)],
        ['Seasons', w.seasons == null ? '<span class="muted">not set</span>' : esc(w.seasons)]]);
    $('dlgIn').innerHTML = '<div class="who-head">' + avatar(w) + '<h2>' + esc(w.name) + '</h2></div><table>' +
      rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' + (extraHtml || '') +
      '<div class="row"><button id="w_edit" class="primary">Edit</button><button id="dlgClose">Close</button></div>';
    showDialog();
    $('w_edit').onclick = function () { editWorker(id); };
  }

  // Photos live inside the record as a ~160 px JPEG data URL.
  async function thumb(file) {
    var bmp = await createImageBitmap(file);
    var scale = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  async function editWorker(id) {
    var w = id ? JSON.parse(JSON.stringify(worker(id))) : { name: '', phone: '', rev: 0, can_operate: [], clearances: [] };
    if (!S.profiles) S.profiles = await API.profiles();
    // Only approved people can be linked. If the names couldn't load, the picker
    // is locked and the existing link is kept -- a phone-number fix on weak
    // signal must never unlink someone and lock them out.
    var loaded = !!S.profiles;
    var profiles = (S.profiles || []).filter(function (p) { return p.status === 'approved'; });
    var shown = !w.profile_id || profiles.some(function (p) { return String(p.id) === String(w.profile_id); });
    function tri(key, label) { var v = F.formatTri(w[key]); return '<label>' + label + '</label><select id="f_' + key + '">' + option('', 'not set', v === '') + option('yes', 'yes', v === 'yes') + option('no', 'no', v === 'no') + '</select>'; }
    var others = S.crew.filter(function (o) { return o.id !== w.id && !o.archived; }).sort(byName);
    function checks(key) {
      return others.map(function (o) {
        return '<label class="inline"><input type="checkbox" data-list="' + key + '" value="' + esc(o.id) + '"' + ((w[key] || []).indexOf(o.id) !== -1 ? ' checked' : '') + '>' + esc(o.name) + '</label>';
      }).join('') || '<span class="muted">nobody else yet</span>';
    }
    $('dlgIn').innerHTML = '<h2>' + (id ? 'Edit ' + esc(w.name) : 'Add worker') + '</h2>' +
      '<label>Name</label><input id="f_name" value="' + esc(w.name) + '">' +
      '<label>Phone</label><input id="f_phone" type="tel" value="' + esc(w.phone) + '">' +
      '<label>Sign-in (Titan Inventory name)</label><select id="f_profile"' + (loaded ? '' : ' disabled') + '>' + option('', 'No sign-in yet', !w.profile_id) +
        (shown ? '' : option(w.profile_id, 'Current link (#' + w.profile_id + ', not approved right now)', true)) +
        profiles.map(function (p) { return option(p.id, p.name, String(w.profile_id) === String(p.id)); }).join('') + '</select>' +
        (loaded ? '' : '<div class="muted">Names couldn\'t load, so the sign-in link stays as it is.</div>') +
      '<label>Photo</label><input id="f_photo" type="file" accept="image/*"><div class="muted" id="f_photo_msg">' + (w.photo_thumb ? 'Has a photo' : 'No photo') + '</div>' +
      TRI.map(function (t) { return tri(t[0], t[1]); }).join('') +
      '<label>Can operate</label>' + OPERATE.map(function (o) { return '<label class="inline"><input type="checkbox" data-op value="' + o + '"' + ((w.can_operate || []).indexOf(o) !== -1 ? ' checked' : '') + '>' + o + '</label>'; }).join('') +
      '<label>Clearances, one per line: SITE | yes/no | cleared date | expires (YYYY-MM-DD)</label><textarea id="f_clearances" rows="3">' + esc(F.formatClearances(w.clearances)) + '</textarea>' +
      // The Crew Board's fields (moved in 10/1/26). All private; all start empty.
      '<label>Rides with</label><select id="f_rides_with">' + option('', 'nobody', !w.rides_with) +
        others.map(function (o) { return option(o.id, o.name, w.rides_with === o.id); }).join('') + '</select>' +
      '<label>Gear</label><select id="f_gear">' + option('', 'not set', !w.gear) + option('own', 'own', w.gear === 'own') +
        option('needs_issued', 'needs issued', w.gear === 'needs_issued') + '</select>' +
      '<label>Works well with</label>' + checks('works_well_with') +
      '<label>Keep apart from</label>' + checks('keep_apart_from') +
      '<label>Seasons with Titan</label><input id="f_seasons" inputmode="numeric" value="' + (w.seasons == null ? '' : esc(w.seasons)) + '">' +
      '<label>Traits</label><textarea id="f_traits" rows="2">' + esc(w.traits) + '</textarea>' +
      '<label>Weaknesses</label><textarea id="f_weaknesses" rows="2">' + esc(w.weaknesses) + '</textarea>' +
      '<div id="f_err" class="err"></div><div class="row"><button id="f_save" class="primary">Save</button>' +
      (id ? '<button id="f_archive">Archive</button>' : '') + '<button id="dlgClose">Cancel</button></div>';
    showDialog();
    $('f_photo').onchange = async function () {
      var file = this.files[0]; if (!file) return;
      try { w.photo_thumb = await thumb(file); $('f_photo_msg').textContent = 'Photo ready. Save to keep it.'; }
      catch (e) { $('f_photo_msg').textContent = "That file isn't a photo this phone can read."; }
    };
    $('f_save').onclick = async function () {
      var cl = F.parseClearances($('f_clearances').value);
      if (cl.errors.length) { $('f_err').textContent = cl.errors.join(' · '); return; }
      var seasons = $('f_seasons').value.trim();
      if (seasons && !/^\d+$/.test(seasons)) { $('f_err').textContent = 'Seasons must be a whole number'; return; }
      function listed(key) { return Array.prototype.map.call(document.querySelectorAll('#dlgIn input[data-list="' + key + '"]:checked'), function (i) { return i.value; }); }
      var rec = Object.assign({}, w, {
        rides_with: $('f_rides_with').value || null, gear: $('f_gear').value || null, seasons: seasons === '' ? null : Number(seasons),
        works_well_with: listed('works_well_with'), keep_apart_from: listed('keep_apart_from'), name: $('f_name').value.trim(), phone: $('f_phone').value.trim(), profile_id: $('f_profile').disabled ? (w.profile_id || null) : ($('f_profile').value || null),
        clearances: cl.list, traits: $('f_traits').value, weaknesses: $('f_weaknesses').value,
        can_operate: Array.prototype.map.call(document.querySelectorAll('#dlgIn input[data-op]:checked'), function (i) { return i.value; }) });
      TRI.forEach(function (t) { rec[t[0]] = F.parseTri($('f_' + t[0]).value); });
      await save('saveCrew', rec, 'crew', $('f_err'));
    };
    if ($('f_archive')) $('f_archive').onclick = function () { archive('archiveCrew', w, 'crew', $('f_err')); };
  }

  // One save path for every record: send the rev it was edited from; only a
  // confirmed reply changes what is on screen. A refusal leaves the old record.
  // One write path for every record. Only one write at a time: a second tap on
  // a slow Apps Script call must not create a duplicate record.
  var busy = false;
  async function write(action, payload, list, errEl, done) {
    if (busy) return false;
    busy = true;
    try {
      var r = await API.call(action, payload);
      if (!r.ok) {
        // Session died mid-edit: say so on the sign-in screen, never a blank one.
        if (r.code === 'signin') { closeDialog(); showSignIn(r.reason); return false; }
        errEl.textContent = r.reason || 'Not saved.';
        // Someone else saved first: fetch the latest so the next attempt carries the new rev.
        if (r.code === 'conflict') refresh();
        return false;
      }
      S[list] = S[list].filter(function (x) { return x.id !== r.record.id; }).concat([r.record]);
      closeDialog(); render(); toast(done);
      return true;
    } finally { busy = false; }
  }
  function save(action, rec, list, errEl) { return write(action, { record: rec }, list, errEl, 'Saved'); }
  function archive(action, rec, list, errEl) { return write(action, { id: rec.id, rev: rec.rev }, list, errEl, 'Archived'); }

  async function refresh() {
    var r = await API.call('bootstrap');
    if (r.ok) { S.me = r.me; S.sites = r.sites; S.routes = r.routes; S.crew = r.crew; S.zones = r.zones || [];
      S.moves = r.moves || []; S.callouts = r.callouts || []; S.gear = r.gear || []; S.post = r.post || null; render(); }
  }

  // ---------- sites and routes (admin) ----------
  function editSite(id) {
    var s = id ? JSON.parse(JSON.stringify(site(id))) : { name: '', address: '', materials_needed: '', notes: '', rev: 0 };
    $('dlgIn').innerHTML = '<h2>' + (id ? 'Edit ' + esc(s.name) : 'Add site') + '</h2>' +
      '<label>Name</label><input id="s_name" value="' + esc(s.name) + '"><label>Address</label><input id="s_addr" value="' + esc(s.address) + '">' +
      '<label>Needs clearance (e.g. JBER), blank if none</label><input id="s_clear" value="' + esc(s.needs_clearance) + '">' +
      '<label>Materials needed (shown to the crew on the map)</label><input id="s_mat" value="' + esc(s.materials_needed) + '" placeholder="e.g. 2-4 bags IceMelt">' +
      '<label>Notes</label><textarea id="s_notes" rows="3">' + esc(s.notes) + '</textarea>' +
      '<div id="s_err" class="err"></div><div class="row"><button id="s_save" class="primary">Save</button>' + (id ? '<button id="s_archive">Archive</button>' : '') + '<button id="dlgClose">Cancel</button></div>';
    showDialog();
    $('s_save').onclick = function () { save('saveSite', Object.assign({}, s, { name: $('s_name').value.trim(), address: $('s_addr').value.trim(), materials_needed: $('s_mat').value.trim(), needs_clearance: $('s_clear').value.trim() || null, notes: $('s_notes').value }), 'sites', $('s_err')); };
    if ($('s_archive')) $('s_archive').onclick = function () { archive('archiveSite', s, 'sites', $('s_err')); };
  }

  function editRoute(id) {
    var r = id ? JSON.parse(JSON.stringify(S.routes.filter(function (x) { return x.id === id; })[0])) : { name: '', site_ids: [], rev: 0 };
    function draw() {
      var unused = S.sites.filter(function (s) { return !s.archived && r.site_ids.indexOf(s.id) === -1; }).sort(byName);
      $('dlgIn').innerHTML = '<h2>' + (id ? 'Edit ' + esc(r.name) : 'Add route') + '</h2><label>Name</label><input id="r_name" value="' + esc(r.name) + '">' +
        '<label>Sites, in driving order</label><div id="r_hint" class="muted">To rename a site, use its Edit on the Sites tab.</div><ol class="sitelist edit">' + r.site_ids.map(function (sid, i) {
          var s = site(sid);
          return '<li><span>' + esc(s ? s.name : sid) + '</span><button class="small" data-up="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="small" data-down="' + i + '" aria-label="Move down"' + (i === r.site_ids.length - 1 ? ' disabled' : '') + '>↓</button><button class="small" data-del="' + i + '" aria-label="Remove">✕</button></li>';
        }).join('') + '</ol>' +
        '<div class="row"><select id="r_add">' + option('', 'Add a site…', true) + unused.map(function (s) { return option(s.id, s.name, false); }).join('') + '</select><button id="r_addbtn">Add</button></div>' +
        '<div id="r_err" class="err"></div><div class="row"><button id="r_save" class="primary">Save</button>' + (id ? '<button id="r_archive">Archive</button>' : '') + '<button id="dlgClose">Cancel</button></div>';
      $('r_name').oninput = function () { r.name = this.value; };
      $('r_addbtn').onclick = function () { var v = $('r_add').value; if (v) { r.site_ids.push(v); draw(); } };
      $('r_save').onclick = function () { save('saveRoute', Object.assign({}, r, { name: $('r_name').value.trim() }), 'routes', $('r_err')); };
      if ($('r_archive')) $('r_archive').onclick = function () { archive('archiveRoute', r, 'routes', $('r_err')); };
    }
    draw(); showDialog();
    $('dlgIn').onclick = function (ev) {
      var b = ev.target.closest('[data-up],[data-down],[data-del]'); if (!b) return;
      var i;
      if (b.dataset.up != null) { i = Number(b.dataset.up); r.site_ids.splice(i - 1, 0, r.site_ids.splice(i, 1)[0]); }
      else if (b.dataset.down != null) { i = Number(b.dataset.down); r.site_ids.splice(i + 1, 0, r.site_ids.splice(i, 1)[0]); }
      else { r.site_ids.splice(Number(b.dataset.del), 1); }
      draw();
    };
  }

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target, el;
    if (t.id === 'dlgClose') { closeDialog(); return; }
    if (SnowBoardUI.onClick(ev, boardCtx())) return;
    if (t.id === 'retry') { load(); return; }
    if (t.id === 'si_go') { doSignIn(); return; }
    if (t.id === 'si_req') { showRequest(); return; }
    if (t.id === 'rq_go') { doRequest(); return; }
    if (t.id === 'rq_back') { showSignIn(); return; }
    if (t.id === 'signout') { closeMap(); API.signOut(); S.profiles = null; showSignIn(); return; }
    if (t.id === 'addWorker') { editWorker(null); return; }
    if (t.id === 'mapback') { render(); return; }
    if (t.id === 'mapedit') { startEdit(t.dataset.site); return; }
    if ((el = t.closest('[data-map]'))) { openMap(el.dataset.map); return; }
    if ((el = t.closest('#tabs [data-tab]'))) { S.tab = el.dataset.tab; render(); return; }
    if ((el = t.closest('[data-open]'))) { openWorker(el.dataset.open); return; }
    if ((el = t.closest('[data-edit]'))) {
      var p = el.dataset.edit.split(':');
      if (p[0] === 'route') editRoute(p[1] || null); else if (p[0] === 'site') editSite(p[1] || null);
    }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.id === 'si_pin') doSignIn(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  load();
})();
