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
  // card: one's own roster card (the self view the server sends crew and leads; roster self-service, 10/6/26).
  // pendingName: the sign-in name shown while a card is being made or waits for Matt.
  // points: { site_id: [lng, lat] }, the slim sign-in's one point per site (outlines on demand,
  // 10/9/26); {} until bootstrap answers, and {} from a backend that ignores `slim`. zones carry
  // no ring after a slim reply: the outlines live in SnowOutlines (the kept copies), never here.
  var S = { me: null, sites: [], routes: [], crew: [], zones: [], points: {}, moves: [], callouts: [], gear: [], post: null, tab: 'routes', profiles: null, card: null, pendingName: '',
    // The shift log (lib/shiftlogui.js): rows by tab, how many the server has handed over, and the seq of the last one.
    // Trucks (everyone) and Sheets (Matt's phone only) are two more tabs of the same log. Posts (Matt's
    // phone only, slimmed, for the route sheets) ride the same cursor but carry no seq, so no `last`.
    log: [], storms: [], visits: [], trucks: [], sheets: [], posts: [],
    cursor: { log: 0, storms: 0, visits: 0, trucks: 0, sheets: 0, posts: 0 }, last: { log: null, storms: null, visits: null, trucks: null, sheets: null } };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function option(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function isAdmin() { return S.me && S.me.role === 'admin'; }
  // Matt and the leads run the storm and get the live view; the server enforces the same rule.
  // Storm controls, the live view, trucks: Matt, or whoever LEADS a route on tonight's posted
  // Board (Part A, 10/4/26). The roster's lead flag grants nothing; the server checks the live Board.
  function canRunStorm() { return !!S.me && (S.me.role === 'admin' || window.SnowShiftUI.standing(S) === 'lead'); }
  // Short site codes ("PH", "PG") are unreadable on their own (Matt, 10/4/26): lists show
  // the address beside the code. The name stays the code the crew know.
  function addrTag(s) { return s && s.address ? ' <span class="muted site-addr" data-no-es>' + esc(s.address) + '</span>' : ''; }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }
  function site(id) { return S.sites.filter(function (s) { return s.id === id; })[0]; }
  function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0].toUpperCase(); }).join(''); }
  function avatar(w) {
    return w && w.photo_thumb && /^data:image\//.test(w.photo_thumb) ? '<img class="av" alt="" src="' + esc(w.photo_thumb) + '">' : '<span class="av">' + esc(initials(w && w.name)) + '</span>';
  }
  function showDialog() { if (!$('dlg').open) { $('dlg').showModal(); syncHistory(); } }
  function closeDialog() { if ($('dlg').open) $('dlg').close(); }
  // Share (Matt, 10/5/26): the phone's share sheet, else the clipboard, else the
  // link on screen to copy by hand. Always the fixed address (lib/share.js).
  async function shareApp() {
    var how = await SnowShare.share(navigator);
    if (how === 'copied') toast('Link copied. Paste it in a text.');
    if (how !== 'show') return;
    $('dlgIn').innerHTML = '<h2>Share Shovel Command</h2><p class="muted">Copy this and text it:</p>' +
      '<textarea id="sharetext" rows="5" readonly>' + esc(SnowShare.message() + ' ' + SnowShare.APP_URL) + '</textarea>' +
      '<div class="row"><button id="dlgClose">Close</button></div>';
    showDialog();
    $('sharetext').select();
  }

  // ---------- the phone's Back button ----------
  // One page, so Back used to leave the app (Matt, 10/1/26). The browser's
  // history now mirrors what is open, as a stack: a route opened on the Storm
  // tab, then a map, then a zone being drawn, then a box. Back pops one step
  // and closes whatever sat above it.
  // history.go() answers later (popstate), so our own pops are counted and the
  // stack is re-matched once they land: a drawing started in the meantime is
  // pushed back on, never cancelled by a stale pop.
  var popping = 0, handlingBack = false;
  function wantedSteps() {
    var w = [];
    // A route opened from the live view sits under anything opened from it (a site
    // map), so it is the lower step: Back leaves the map first, then the route.
    if (S.tab === 'storm' && SnowShiftUI.routeOpen()) w.push('route');
    // The print view sits over the live view (Print sheets): Back closes it.
    if (S.tab === 'storm' && SnowShiftUI.printOpen()) w.push('print');
    if (S.mapSite) w.push('map');
    if (window.SnowMapEdit && window.SnowMapEdit.drawing()) w.push('draw');
    // Back mid-import closed the map and silently stopped the saves (10/4/26). This
    // step is never cancelled below: syncHistory pushes it straight back on.
    if (window.SnowMapEdit && window.SnowMapEdit.importing()) w.push('import');
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
      // Mid-import, Back only explains: the map (under it) stays open.
      if (window.SnowMapEdit && window.SnowMapEdit.importing() && have.indexOf('import') === -1) { window.SnowMapEdit.refuse(); handlingBack = false; syncHistory(); return; }
      if (window.SnowMapEdit && window.SnowMapEdit.drawing() && have.indexOf('draw') === -1) window.SnowMapEdit.cancelDraw();
      if (SnowShiftUI.printOpen() && have.indexOf('print') === -1) SnowShiftUI.closePrint();
      if (SnowShiftUI.routeOpen() && have.indexOf('route') === -1) SnowShiftUI.closeRoute(boardCtx());
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
    // slim: the zones without their outlines, and one point per site (outlines on demand, 10/9/26:
    // the outlines were 225 KB of a 341 KB sign-in). A backend that ignores it answers as before.
    // A READ: tried once more by itself when Google drops it (10/22/26), and a failure never says "Not saved".
    var r = await API.read('bootstrap', { slim: true });
    $('verwarn').hidden = !r.versionMismatch || r.code === 'network';
    if (r.ok) { S.me = r.me; S.sites = r.sites; S.routes = r.routes; S.crew = r.crew; S.zones = r.zones || []; S.points = r.points || {};
      S.moves = r.moves || []; S.callouts = r.callouts || []; S.gear = r.gear || []; S.post = r.post || null; S.card = r.card || null;
      render();
      refreshWaiting(); // Matt's Roster count, from the first screen on
      return; }
    if (r.code === 'signin') return showSignIn(r.reason);
    if (r.code === 'not_on_roster') return showNotOnRoster(r.name);
    if (r.code === 'pending_card') return showPending(r.name, r.card);
    chrome(false);
    $('main').innerHTML = '<section class="card"><h2>Couldn\'t reach the server</h2><p class="muted">' + esc(r.reason) +
      '</p><button id="retry" class="primary">Try again</button></section>';
  }

  // ---------- sign in ----------
  async function showSignIn(why) {
    sessionSeq++; // a getZones reply or a zone save still on its way writes no outline after this
    S.me = null; chrome(false);
    delete document.body.dataset.tab; // no tab is up: the wide Storm layout goes with it
    SnowShiftUI.reset(S); // stops the Storm tab's polling and forgets the last person's rows
    syncHistory(); // and drops a route's Back step
    $('main').innerHTML = '<section class="card" id="signin"><h2>Sign in</h2>' +
      '<p class="muted">Pick your name, then your PIN. If you use Titan Inventory, it\'s the same PIN.</p>' +
      '<label>Your name</label><select id="si_who"><option value="">Loading names…</option></select>' +
      '<label id="si_pinlabel">PIN</label><input id="si_pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off">' +
      '<div id="si_err" class="err">' + (why ? esc(why) : '') + '</div>' +
      '<div class="row"><button id="si_go" class="primary">Sign in</button></div>' +
      // A new person who has never used Titan Inventory is not on the list (Matt, 10/20/26): they type their name.
      '<p class="muted" style="margin-top:16px">Not on the list?</p><div class="row" style="margin-top:4px"><button id="si_req">Type your name</button></div></section>';
    var list = await askProfiles();
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

  // A new person types their name (Matt, 10/20/26). This is Inventory's own requestProfile, the way its new hires
  // ask: one pending row, and the person's Roster count on Matt's phone, where he taps Approve. The snow backend is
  // not asked. First AND last name (Matt): two Joses must be two names on his Roster. The keyboard's extra spaces
  // are not the name. A name already on the list (Inventory refuses those, ignoring case) is caught here first.
  function showRequest() {
    $('main').innerHTML = '<section class="card" id="request"><h2>Type your name</h2>' +
      '<p class="muted">Type your first and last name and choose a 4-digit PIN. Matt approves it here in Shovel Command. Then sign in with your name and this PIN.</p>' +
      '<label for="rq_name">Your first and last name</label><input id="rq_name" autocomplete="name" autocapitalize="words">' +
      '<label for="rq_pos">Position</label><input id="rq_pos" placeholder="Sidewalk crew">' +
      '<label for="rq_pin">Choose a 4-digit PIN</label><input id="rq_pin" type="password" inputmode="numeric" maxlength="4">' +
      '<div id="rq_err" class="err"></div><div class="row"><button id="rq_go" class="primary">Send request</button><button id="rq_back">Back</button></div></section>';
  }
  function cleanName(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  // Two words or more, each with a letter in it: "Rosa M." is a name, "Rosa" and "Rosa 2" are not.
  function firstAndLast(name) {
    var words = name.split(' ');
    return words.length >= 2 && words.every(function (w) { return /\p{L}/u.test(w); });
  }
  function onTheList(name) {
    var key = name.toLowerCase();
    return (S.profiles || []).some(function (p) { return cleanName(p.name).toLowerCase() === key; });
  }
  async function doRequest() {
    var name = cleanName($('rq_name').value), pos = $('rq_pos').value.trim() || 'Sidewalk crew', pin = $('rq_pin').value.trim();
    if (!name) { $('rq_err').textContent = 'Name is required.'; return; }
    if (!firstAndLast(name)) { $('rq_err').textContent = 'Type your first and last name.'; return; }
    if (onTheList(name)) { $('rq_err').textContent = API.ON_THE_LIST; return; }
    if (!/^\d{4}$/.test(pin)) { $('rq_err').textContent = 'PIN is 4 digits.'; return; }
    $('rq_go').disabled = true; // one tap, one request
    var r = await API.requestAccess(name, pos, pin);
    if (!$('rq_go')) return; // they went Back meanwhile
    $('rq_go').disabled = false;
    if (!r.ok) { $('rq_err').textContent = r.reason; return; }
    $('main').innerHTML = '<section class="card" id="reqsent"><h2>Request sent</h2><p class="muted">Matt approves it in Shovel Command. Then come back, pick your name and sign in with your PIN.</p><button id="rq_back">Back to sign in</button></section>';
  }

  // Approved in Inventory, not on the roster yet: fill out your own card (roster self-service, 10/6/26).
  function showNotOnRoster(name) {
    S.me = null; chrome(false); $('signout').hidden = false;
    S.pendingName = name || '';
    SnowRosterUI.notOnRosterScreen(rosterCtx(), name);
  }
  // The card is in, waiting for Matt's Add to crew: show it, let them fix it.
  function showPending(name, card) {
    S.me = null; chrome(false); $('signout').hidden = false;
    S.pendingName = name || '';
    SnowRosterUI.pendingScreen(rosterCtx(), card || { name: name });
  }
  // What the roster screens (lib/rosterui.js) may use of this file. saveRecord goes through
  // the one write path: a refusal lands in a toast (no form is open), a success re-renders.
  var toastErr = { set textContent(v) { if (v) toast(v); } };
  function rosterCtx() {
    return { S: S, $: $, esc: esc, call: API.call, toast: toast, render: render, avatar: avatar, showDialog: showDialog, closeDialog: closeDialog,
      signedOut: function (why) { showSignIn(why); }, load: load, profiles: askProfiles, approve: API.approveProfile, reject: API.rejectProfile,
      saveRecord: function (action, rec, list, done) { return write(action, { record: rec }, list, toastErr, done); } };
  }

  // ---------- signed-in screens ----------
  function render() {
    closeMap();
    chrome(true);
    // Crew land on Tonight: on a storm night, their route is the first thing they need.
    var tabs = isAdmin() ? [['storm', 'Storm'], ['routes', 'Routes'], ['sites', 'Sites'], ['board', 'Board'], ['log', 'Log'], ['roster', 'Roster']]
      : [['storm', 'Storm'], ['tonight', 'Tonight'], ['routes', 'Routes'], ['sites', 'Sites']];
    if (!S.tabChosen && !isAdmin()) S.tab = 'tonight';
    if (!tabs.some(function (t) { return t[0] === S.tab; })) S.tab = tabs[0][0];
    $('tabs').innerHTML = tabs.map(function (t) { return '<button data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + (t[0] === 'roster' ? rosterLabel() : t[1]) + '</button>'; }).join('');
    if (S.tab === 'routes') renderRoutes(); else if (S.tab === 'sites') renderSites();
    else if (S.tab === 'storm') SnowShiftUI.render(boardCtx());
    else if (S.tab === 'board') SnowBoardUI.renderBoard(boardCtx());
    else if (S.tab === 'tonight') SnowBoardUI.renderTonight(boardCtx());
    else if (S.tab === 'log') SnowBoardUI.renderLog(boardCtx()); else renderRoster();
    // The page knows which tab is up (live window, 10/6/26): app.css opens the Storm tab out to a wide screen.
    document.body.dataset.tab = S.tab;
    // The Storm tab polls while it is on screen, and only then.
    if (S.tab === 'storm') SnowShiftUI.start(boardCtx()); else SnowShiftUI.stop();
  }

  // What the pairings screens (lib/boardui.js) may use of this file.
  function boardCtx() {
    return { S: S, $: $, esc: esc, call: API.call, toast: toast, render: render, avatar: avatar, openWorker: openWorker, canRun: canRunStorm(),
      showDialog: showDialog, closeDialog: closeDialog, syncHistory: syncHistory, markMap: markMap, signedOut: function (why) { showSignIn(why); } };
  }

  // A site map opened from the Storm tab shows each walk's state (a tick for done,
  // a bang for a problem; a done zone fades) and its zone card's buttons show the
  // newest tap. Called when the map opens and on every redraw of the Storm tab
  // (a poll, a tap's reply), so a tap by someone else lands on a map already on
  // screen. Maps opened from the other tabs carry no marks.
  function markMap() {
    var m = window.SnowMapView;
    if (!m || !S.mapSite || S.tab !== 'storm') return;
    window.SnowMap.setStates(m, shown, CrewShiftLog.walkStates(S.log, CrewShiftLog.stormState(S.storms).storm_id)); // the zones the map draws: they carry the rings
  }

  // The crew's copy changes only when Matt posts: fetch it when Tonight opens.
  // Tonight is fetched on the tab, on Refresh, and whenever the app comes back
  // on screen (Android keeps it in memory for hours). Always re-rendered: a
  // post can go stale at 9 AM without a new one arriving.
  async function refreshPost(byHand) {
    var r = await API.call('getPost');
    if (r.ok) S.post = r.post;
    else if (byHand) toast('Could not check for a new post: ' + (r.reason || 'no signal'));
    if (S.tab === 'tonight' && S.me) render();
  }
  // ---------- who is waiting (Matt, 10/19/26: "when I have new people signing in, will I get a notification?") ----------
  // Matt's Roster tab carries a count of the people waiting on him (SnowRosterUI.waitingCount: requests from the
  // sign-in screen plus cards not added yet; no count at all when nobody waits). Both lists are read again while the
  // app is open: after sign-in, every 5 minutes it is on screen, and whenever it comes back on screen. Only the
  // newest ask for the sign-in names keeps its reply: Approve and Reject ask again, and an older reply would bring
  // back a request just decided. A record only JOINS S.crew from here (one this phone has not seen: a card filled out
  // meanwhile): every other change to the roster comes back in its own save's reply, which a check that left before
  // the save must not undo.
  var WAIT_EVERY = 5 * 60 * 1000, waitBusy = false, profileAsks = 0;
  function askProfiles() { profileAsks++; return API.profiles(); }
  function rosterLabel() {
    var n = SnowRosterUI.waitingCount(S);
    return 'Roster' + (n ? ' <span class="tabcount">' + n + '</span>' : '');
  }
  function markRosterTab() { var b = document.querySelector('#tabs [data-tab="roster"]'); if (b) b.innerHTML = rosterLabel(); }
  async function refreshWaiting() {
    if (!isAdmin() || waitBusy) return;
    waitBusy = true;
    var epoch = sessionSeq, mine = ++profileAsks, before = SnowRosterUI.waitingCount(S);
    try {
      var got = await Promise.all([API.profiles(), API.call('getCrew')]);
      if (epoch !== sessionSeq || !isAdmin()) return; // signed out meanwhile
      if (got[0] && profileAsks === mine) S.profiles = got[0];
      var r = got[1];
      if (r && r.ok && Array.isArray(r.crew)) {
        var have = {};
        S.crew.forEach(function (c) { have[c.id] = true; });
        var fresh = r.crew.filter(function (c) { return c && !have[c.id]; });
        if (fresh.length) S.crew = S.crew.concat(fresh);
      }
      // On the Roster tab the lists themselves change; anywhere else only the count does.
      if (S.tab === 'roster' && SnowRosterUI.waitingCount(S) !== before) render(); else markRosterTab();
    } catch (e) { /* no signal: the next check asks again */ }
    finally { waitBusy = false; }
  }
  setInterval(function () { if (document.visibilityState === 'visible' && S.me) refreshWaiting(); }, WAIT_EVERY);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !S.me) return;
    refreshWaiting(); // Matt's only: who is waiting now
    if (S.tab === 'tonight') refreshPost(false);
    else if (S.tab === 'storm') SnowShiftUI.wake(boardCtx()); // back on screen: rows, post and zones, now
    else if (S.tab === 'board') SnowShiftUI.catchUp(boardCtx()); // the trucks a lead set meanwhile
  });

  function renderRoutes() {
    var live = S.routes.filter(function (r) { return !r.archived; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
    $('main').innerHTML = (live.map(function (r) {
      return '<section class="card route-card" data-route="' + esc(r.id) + '"><div class="route-top"><span class="route-badge" data-no-es>' + esc(r.name) + '</span>' +
        (isAdmin() ? '<button class="small" data-edit="route:' + esc(r.id) + '">Edit</button>' : '') + '</div>' +
        '<ol class="sitelist">' + (r.site_ids || []).map(function (id) { var s = site(id); return '<li><span>' + esc(s ? s.name : id) + addrTag(s) + '</span>' + (s ? '<button class="small" data-map="' + esc(id) + '">Map</button>' : '') + '</li>'; }).join('') + '</ol></section>';
    }).join('') || '<p class="muted">No routes yet.</p>') + (isAdmin() ? '<div class="row"><button class="primary" data-edit="route:">Add route</button></div>' : '') + archivedHtml('routes');
  }

  // Matt's way back for what he archived (10/10/26): a closed list under the live one, a Restore on each. Matt's alone:
  // the server puts archived records in HIS replies only, and this is drawn for no one else even if one arrived. Nothing
  // archived, nothing drawn. It stays open across the redraw a Restore causes, so several can come back in a row.
  function archivedHtml(list) {
    var open = S.archOpen || (S.archOpen = {});
    var gone = isAdmin() ? S[list].filter(function (r) { return !!r.archived; }) : [];
    if (!gone.length) { delete open[list]; return ''; }
    var sites = list === 'sites', one = sites ? 'site' : 'route';
    gone.sort(sites ? byName : byRouteName);
    return '<details class="archived" id="archived' + (sites ? 'Sites' : 'Routes') + '"' + (open[list] ? ' open' : '') + '><summary>Archived (' + gone.length + ')</summary><ul class="archlist">' +
      gone.map(function (r) {
        return '<li><span><span data-no-es>' + esc(r.name) + '</span>' + (sites ? addrTag(r) : ' <span class="muted">' + plural((r.site_ids || []).length, 'site') + '</span>') + '</span>' +
          '<button class="small" data-restore="' + one + ':' + esc(r.id) + '">Restore</button></li>';
      }).join('') + '</ul></details>';
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function byRouteName(a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); }

  function renderSites() {
    var live = S.sites.filter(function (s) { return !s.archived; }).sort(byName);
    // Grouped by customer (Matt, 10/4/26), so the hospital sites sit together; customers A-Z,
    // sites A-Z inside, and the ones with no customer yet last.
    var groups = {};
    live.forEach(function (s) { var c = String(s.customer || '').trim(); (groups[c] = groups[c] || []).push(s); });
    var order = Object.keys(groups).filter(function (c) { return c; }).sort(function (a, b) { return a.localeCompare(b); });
    if (groups['']) order.push('');
    $('main').innerHTML = (order.map(function (c) {
      return (order.length > 1 || c ? '<h2 class="site-group">' + esc(c || 'No customer yet') + '</h2>' : '') + groups[c].map(siteCard).join('');
    }).join('') || '<p class="muted">No sites yet.</p>') + (isAdmin() ? '<div class="row"><button class="primary" data-edit="site:">Add site</button></div>' : '') + archivedHtml('sites');
  }
  function siteCard(s) {
      return '<section class="card site-card" data-site="' + esc(s.id) + '"><div class="route-top"><span class="site-name" data-no-es>' + esc(s.name) + '</span>' +
        '<span class="row tight"><button class="small" data-map="' + esc(s.id) + '">Map</button>' + (isAdmin() ? '<button class="small" data-edit="site:' + esc(s.id) + '">Edit</button>' : '') + '</span></div>' +
        (s.address ? '<div class="muted" data-no-es>' + esc(s.address) + '</div>' : '') + (s.notes ? '<div data-no-es>' + esc(s.notes) + '</div>' : '') + (isAdmin() ? curbLine(s) : '') + '</section>';
  }
  // Matt's line (curb roll-up, 10/8/26): the site's curb feet and how many check-off items they make,
  // flagged when the items run over the per-item feet (more curb than the item cap can hold).
  function curbLine(s) {
    if (typeof CrewShiftLog === 'undefined' || !CrewShiftLog.curbSummary) return '';
    var c = CrewShiftLog.curbSummary(s.id, S.zones), R = CrewShiftLog.CURB_ROLLUP;
    if (!c.items) return '';
    var per = Math.round(R.feetPerItem * (1 + R.allowance));
    return '<div class="curbline' + (c.overSize ? ' warn' : ' muted') + '">Curbs: ' + c.feet.toLocaleString('en-US') + ' ft in ' + c.items +
      (c.items === 1 ? ' item' : ' items') + (c.overSize ? ' · over ' + per.toLocaleString('en-US') + ' ft per item' : '') + '</div>';
  }

  // Live routes by id, for the placement words (place from the roster, Matt 10/6/26).
  function routesById() { var m = {}; S.routes.forEach(function (r) { if (!r.archived) m[r.id] = r; }); return m; }
  function renderRoster() {
    // Matt's two waiting lists first (roster self-service, 10/6/26): Inventory requests to approve,
    // and self-made cards to add. The grid below is the crew: never a card still waiting.
    SnowRosterUI.ensureProfiles(rosterCtx());
    var list = S.crew.filter(function (w) { return !w.archived && w.pending !== true; }).sort(byName);
    // Each tile says where tonight's Board has the person (place from the roster, 10/6/26): the Board replayed from Moves, as the Board tab does.
    var b = SnowBoardUI.board(S), rb = routesById();
    $('main').innerHTML = SnowRosterUI.waitingHtml(rosterCtx()) + '<div class="row" style="margin-top:0"><button class="primary" id="addWorker">Add worker</button></div><div class="grid">' +
      list.map(function (w) {
        return '<div class="tile" role="button" tabindex="0" data-open="' + esc(w.id) + '">' + avatar(w) + '<div data-no-es>' + esc(w.name) + '</div>' +
          '<div class="where muted">' + esc(SnowPairing.placementLabel(b, rb, w.id)) + '</div></div>';
      }).join('') + '</div>';
  }

  // ---------- site map (everyone) ----------
  // window.SnowMapView is the open map, and only while it is on screen.
  var mapSeq = 0;
  // The zones the open map is drawing, each carrying its ring. Rings are never in S.zones (a slim sign-in
  // has none): the Storm tab's marks and the editor's redraws read them here.
  var shown = [];
  // The archived zones of the site whose map is open (Matt's getZones reply carries them), for the editor's Archived list:
  // Restore brings one back. They are never drawn and never kept; only the editor reads them.
  var archivedHere = [];
  // Moves on whenever the sign-in screen comes up: an explicit sign-out, which wipes the kept outlines
  // (Kept.forget), or a session that expired, which keeps them (by design: the spec wipes on sign-out only).
  // Either way a reply or a save that was on its way then writes nothing, so a late write can never bring
  // back what a sign-out just wiped.
  var sessionSeq = 0;
  // How many times each site's map has been opened (getZones asked). Only the newest ask keeps its reply: an
  // older reply was answered before whatever the newer map has kept since (an editor save), and would undo it.
  var asked = Object.create(null);
  // This phone's kept outlines (lib/outlines.js). A cut-off load without the file still runs: nothing is
  // kept, so every map waits for its reply.
  var NOTHING_KEPT = { keep: function () { return false; }, keepOne: function () { return false; }, withRings: function () { return []; }, forget: function () {} };
  var Kept = window.SnowOutlines ? window.SnowOutlines.local : NOTHING_KEPT;
  function closeMap() {
    mapSeq++;
    shown = [];
    archivedHere = [];
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
  // Edit map stays on until Done (Matt, 10/4/26: mapping site after site, the
  // editor dropped back to view after every Back or reload). One flag on this
  // device, not per site; only Matt's sign-in reads it, and sign-out clears it.
  var EDIT_KEY = 'titan-snow-editing';
  function editingPref() { try { return localStorage.getItem(EDIT_KEY) === '1'; } catch (e) { return false; } }
  function setEditingPref(on) { try { if (on) localStorage.setItem(EDIT_KEY, '1'); else localStorage.removeItem(EDIT_KEY); } catch (e) {} }
  // The list the map shows, after a saved or archived zone: the record in its old place (it keeps its place
  // in the drawing stack), a new one at the end, an archived one taken off. A saved record carries its ring.
  function withZone(list, rec) {
    var out = list.filter(function (z) { return z.id !== rec.id; });
    if (rec.archived) return out;
    var i = list.findIndex(function (z) { return z.id === rec.id; });
    if (i === -1) out.push(rec); else out.splice(i, 0, rec);
    return out;
  }
  function startEdit(id) {
    setEditingPref(true);
    $('mapedit').hidden = true;
    var m = window.SnowMapView, epoch = sessionSeq;
    window.SnowMapEdit.start({
      map: m, getSite: function () { return site(id); }, call: API.call,
      els: { tools: $('maptools'), sheet: $('zonesheet') },
      // May arrive after Back (a slow save): keep the record; redraw only if THIS
      // map is still up -- never onto another site's map opened meanwhile. The outline goes in
      // this phone's kept copy too, unless the person signed out while the save was on its way.
      // The redraw is from what the map shows (rings are not in S.zones), not from the kept copy,
      // which a full store may have refused.
      onZone: function (rec) {
        replaceIn('zones', rec);
        if (epoch === sessionSeq && !rec.archived) Kept.keepOne(id, rec);
        if (window.SnowMapView === m) {
          shown = withZone(shown, rec); window.SnowMap.setZones(m, shown);
          // An archived zone goes on the Archived list; a restored (or any live) one comes off it.
          archivedHere = archivedHere.filter(function (z) { return z.id !== rec.id; }).concat(rec.archived ? [rec] : []);
        }
      },
      archived: function () { return archivedHere.slice(); },
      onSite: function (rec) { replaceIn('sites', rec); },
      onSignin: function (reason) { closeMap(); showSignIn(reason); },
      onDone: function () { setEditingPref(false); if ($('mapedit')) $('mapedit').hidden = false; },
      onDraw: syncHistory,
      toast: toast,
    });
  }
  // ---- outlines on demand (10/9/26): a map draws what this phone kept, and asks the server in the background ----
  function hasRing(z) { return !!z && Array.isArray(z.ring) && z.ring.length > 0; }
  // The zones to draw and keep from a getZones reply, or null when the reply is not an answer: not ok, no
  // list, or zones that carry no outline (a slim reply: a map asks with site_id and NO slim to get them). Matt's
  // replies include archived zones, which are dropped. Only this site's zones are this map's.
  function zonesOf(r, id) {
    if (!r || r.ok !== true || !Array.isArray(r.zones)) return null;
    var live = r.zones.filter(function (z) { return z && z.site_id === id && z.archived !== true; });
    if (live.length && !live.some(hasRing)) return null;
    return live.filter(hasRing);
  }
  // The archived zones in a getZones reply for this site: Matt's reply includes them, a crew member's never does. Only a
  // reply that is an answer (zonesOf) is believed. They are listed for the editor, never drawn, never kept.
  function archivedOf(r, id) {
    if (!isAdmin() || zonesOf(r, id) === null) return null;
    return r.zones.filter(function (z) { return z && z.site_id === id && z.archived === true; });
  }
  // True when `fresh` (a reply's zones) differs from `have` (what the map is showing): a zone added or gone, or
  // a corner moved. It is SnowOutlines' own `changed`, run against a scratch store holding what is on SCREEN
  // instead of what is on disk. A map is judged by what it shows: another open of the same site may have kept
  // the newer copy meanwhile, and that must not hide the news from this map. Without lib/outlines.js: yes.
  function differsFrom(have, fresh) {
    if (!window.SnowOutlines) return true;
    var cell = {};
    var scratch = window.SnowOutlines.store({
      getItem: function (k) { return k in cell ? cell[k] : null; },
      setItem: function (k, v) { cell[k] = String(v); },
      removeItem: function (k) { delete cell[k]; } });
    scratch.keep('map', have);
    return scratch.changed('map', fresh);
  }
  async function openMap(id) {
    var s = site(id); if (!s) return;
    closeMap();
    var seq = mapSeq, epoch = sessionSeq;
    var mine = asked[id] = (asked[id] || 0) + 1; // this open's place in line for the site
    var live = siteZones(id);
    // The sign-in lists the site's zones WITHOUT rings. The kept copy lends them: these are the zones that
    // have one. A zone never kept is left out until the reply brings it.
    var kept = Kept.withRings(id, live);
    var info = (s.materials_needed ? '<div><b>Materials:</b> <span data-no-es>' + esc(s.materials_needed) + '</span></div>' : '') +
      (s.notes ? '<div data-no-es>' + esc(s.notes) + '</div>' : '');
    // Matt gets the map even with no zones: it's where the first one is drawn.
    var drawn = live.length || isAdmin();
    // Something kept (or nothing to draw): the map opens now. A site with zones and none kept waits for the reply.
    var openNow = kept.length > 0 || live.length === 0;
    $('main').innerHTML = '<div class="route-top"><button id="mapback" class="small">‹ Back</button><span class="site-name" data-no-es>' + esc(s.name) + '</span>' +
      (isAdmin() ? '<button id="mapedit" class="small" data-site="' + esc(s.id) + '" disabled>Edit map</button>' : '') + '</div>' +
      '<section class="card" id="mapsite">' + (s.address ? '<div class="muted" data-no-es>' + esc(s.address) + '</div>' : '') + info + '</section>' +
      (drawn ? '<div id="mapwarn" class="banner" hidden>Aerial photo unavailable. The zones below are still right.</div>' +
        '<div id="mapbox"><div id="maplegend" class="maplegend"></div><div id="maploading" class="mapnote"' + (openNow ? ' hidden' : '') + '>Loading map…</div>' +
        '<div id="mapnosignal" class="mapnote" hidden>This map hasn\'t been opened on this phone yet. It needs signal the first time.</div></div>' +
        '<div id="maptools"></div><section class="card" id="zonesheet" hidden></section>'
        : '<section class="card"><h2>Map not drawn yet</h2><p class="muted">Matt hasn\'t drawn this site\'s zones. Use the site notes for now.</p></section>');
    S.mapSite = id;
    syncHistory();
    if (!drawn) return;
    // The check: this site's zones, rings and all (no slim). Judged and kept the moment it lands, whatever the
    // page is doing by then -- even after Back, so the next open is up to date. A reply that is not an answer
    // is never kept, so it can't wipe the copy a map draws offline. Nothing is written once the sign-in screen
    // is up: an explicit sign-out has wiped the kept copies and a late reply must not bring them back (a
    // session that merely expired keeps its copies, by design, but a reply landing after it is not kept either).
    // And only the newest ask for a site keeps: an older reply would overwrite what a newer map saved meanwhile.
    var answer = API.call('getZones', { site_id: id }).then(function (r) {
      if (epoch !== sessionSeq) return { gone: true };
      var zones = zonesOf(r, id);
      if (zones && asked[id] === mine) Kept.keep(id, zones);
      return { zones: zones, archived: archivedOf(r, id), code: r && r.code, reason: r && r.reason };
    }, function () { return { zones: null }; });
    // The reply did not come (or was no answer). The session may be what died: then it's the sign-in screen.
    function noAnswer(res) { if (res.code === 'signin') { closeMap(); showSignIn(res.reason); } }
    try {
      var first = kept;
      if (!openNow) {
        var res = await answer;
        if (seq !== mapSeq || res.gone) return;
        if (!res.zones) {
          noAnswer(res);
          if (seq === mapSeq) { $('maploading').hidden = true; $('mapnosignal').hidden = false; }
          return;
        }
        first = res.zones;
        archivedHere = res.archived || [];
      }
      shown = first;
      var map = await window.SnowMap.open({ map: $('mapbox'), legend: $('maplegend'), warn: $('mapwarn'), sheet: $('zonesheet') }, s, first);
      // Left the screen while it loaded, or the session ended meanwhile (the sign-in screen has replaced the page
      // without closeMap, so mapSeq did not move): either way the map is nobody's, and is freed here.
      if (seq !== mapSeq || epoch !== sessionSeq) { map.remove(); return; }
      if ($('maploading')) $('maploading').hidden = true;
      window.SnowMapView = map;
      // Map taps (Matt, 10/19/26): opened from the Storm tab, a zone's card carries its walk's buttons, drawn by the
      // Storm tab's own code. A map opened from Sites or Routes shows the zone's details only.
      if (S.tab === 'storm') window.SnowMap.setCard(map, function (z, el) { SnowShiftUI.mapCard(boardCtx(), el, z.site_id, z.id); });
      markMap();
      if (openNow) {
        // The quiet check: redraw only if the news differs from what the map shows. No answer: the copy stays,
        // and Edit map stays off (he would be editing what may be stale).
        var news = await answer;
        if (seq !== mapSeq || news.gone) return;
        if (!news.zones) { noAnswer(news); return; }
        archivedHere = news.archived || [];
        if (differsFrom(first, news.zones)) { shown = news.zones; window.SnowMap.setZones(map, shown); }
      }
      if ($('mapedit')) $('mapedit').disabled = false;
      if (isAdmin() && editingPref() && $('mapedit')) startEdit(id);
    } catch (e) {
      if (window.console) console.error('Site map failed to open:', e); // name the real cause next time
      if (seq === mapSeq && $('maploading')) $('maploading').hidden = true;
      if (seq === mapSeq && $('mapwarn')) { $('mapwarn').textContent = "The map couldn't load on this phone. Use the site notes."; $('mapwarn').hidden = false; }
    }
  }

  // ---------- roster (admin) ----------
  function worker(id) { return S.crew.filter(function (w) { return w.id === id; })[0]; }
  function openWorker(id, extraHtml) {
    var w = worker(id); if (!w) return;
    function yn(v) { return v === true ? 'yes' : v === false ? 'no' : '<span class="muted">not set</span>'; }
    function names(ids) { return (ids || []).map(function (x) { return esc((worker(x) || { name: x }).name); }).join(', ') || '<span class="muted">none</span>'; }
    // Emergency contact (roster-2, 10/7/26): theirs to fill from their own card, Matt's to see and correct here.
    // Lives in (roster-3, 10/8/26): Valley or Anchorage, theirs to say; Matt uses it to see who not to call in for a short night.
    var rows = [['Phone', esc(w.phone) || '<span class="muted">none</span>'],
      ['Lives in', w.home_area === 'valley' ? 'Valley' : w.home_area === 'anchorage' ? 'Anchorage' : '<span class="muted">not set</span>'],
      ['Emergency contact', esc(SnowRosterUI.contactText(w)) || '<span class="muted">not set</span>']].concat(TRI.map(function (t) { return [t[1], yn(w[t[0]])]; }))
      .concat([['Operates', esc((w.can_operate || []).join(', ')) || '<span class="muted">none</span>'],
        ['Traits', esc(w.traits) || '<span class="muted">none</span>'], ['Weaknesses', esc(w.weaknesses) || '<span class="muted">none</span>'],
        ['Clearances', esc(F.formatClearances(w.clearances)) || '<span class="muted">none</span>'],
        ['Rides with', w.rides_with ? esc((worker(w.rides_with) || { name: w.rides_with }).name) : '<span class="muted">nobody</span>'],
        ['Gear', w.gear === 'own' ? 'own' : w.gear === 'needs_issued' ? 'needs issued' : '<span class="muted">not set</span>'],
        ['Works well with', names(w.works_well_with)], ['Keep apart from', names(w.keep_apart_from)],
        ['Seasons', w.seasons == null ? '<span class="muted">not set</span>' : esc(w.seasons)]]);
    // A self-made card still waiting (roster self-service, 10/6/26): say so, and offer Add to crew here too.
    var waiting = w.pending === true ? '<div class="row"><span class="badge off">Waiting to be added</span><button class="primary" data-addcrew="' + esc(w.id) + '">Add to crew</button></div>' : '';
    // Place from the roster (Matt, 10/6/26): where tonight's Board has them, and the moves, right here.
    // A card still waiting to be added is not crew: no Place row.
    var b = SnowBoardUI.board(S), rb = routesById(), at = CrewBoard.whereIs(b, w.id);
    var liveR = S.routes.filter(function (r) { return !r.archived; }).sort(function (x, y) { return String(x.name).localeCompare(String(y.name), undefined, { numeric: true }); });
    var place = w.pending === true ? '' : '<div class="place"><div class="muted">Tonight: <b id="w_where">' + esc(SnowPairing.placementLabel(b, rb, w.id)) + '</b></div>' +
      '<div class="row"><select id="w_route">' + option('', 'Pick a route…', !at) + liveR.map(function (r) { return option(r.id, r.name, !!at && at.route === r.id); }).join('') + '</select>' +
      '<button id="w_place">Place</button><button id="w_lead">Make lead</button>' + (at ? '<button id="w_unassign">Unassign</button>' : '') + '</div><div id="w_err" class="err"></div></div>';
    $('dlgIn').innerHTML = '<div class="who-head">' + avatar(w) + '<h2>' + esc(w.name) + '</h2></div>' + waiting + place + '<table>' +
      rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' + (extraHtml || '') +
      '<div class="row"><button id="w_edit" class="primary">Edit</button><button id="dlgClose">Close</button></div>';
    showDialog();
    $('w_edit').onclick = function () { editWorker(id); };
    // The move closes the card first: the roster redraws under the toast, and a slow save is never doubled from a stale card.
    function move(routeId, role) {
      if (role && !routeId) { $('w_err').textContent = 'Pick a route'; return; }
      closeDialog();
      SnowBoardUI.placeFromRoster(boardCtx(), id, routeId, role);
    }
    if ($('w_place')) $('w_place').onclick = function () { move($('w_route').value, 'member'); };
    if ($('w_lead')) $('w_lead').onclick = function () { move($('w_route').value || (at ? at.route : ''), 'lead'); };
    if ($('w_unassign')) $('w_unassign').onclick = function () { move(null, null); };
  }

  // Photos live inside the record as a ~160 px JPEG data URL (lib/rosterui.js makes it; the self-service card uses the same).
  function thumb(file) { return SnowRosterUI.thumb(file); }

  async function editWorker(id) {
    var w = id ? JSON.parse(JSON.stringify(worker(id))) : { name: '', phone: '', rev: 0, can_operate: [], clearances: [] };
    if (!S.profiles) S.profiles = await askProfiles();
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
      '<label>Emergency contact: name</label><input id="f_emergency_name" value="' + esc(w.emergency_name) + '" maxlength="60">' +
      '<label>Emergency contact: phone</label><input id="f_emergency_phone" type="tel" value="' + esc(w.emergency_phone) + '" maxlength="30">' +
      '<label>Where they live</label><select id="f_home_area">' + option('', 'not set', !w.home_area) + option('valley', 'Valley', w.home_area === 'valley') +
        option('anchorage', 'Anchorage', w.home_area === 'anchorage') + '</select>' +
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
        emergency_name: $('f_emergency_name').value.trim(), emergency_phone: $('f_emergency_phone').value.trim(),
        home_area: $('f_home_area').value || null,
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

  // Restore a site or a route from the Archived list (Matt, 10/10/26): the id and the rev it was archived at, nothing
  // else. Every Restore button is off while one is on the way (one write at a time, and a second tap must not send a
  // second restore); they come back if it was refused. The refusal's own words go to the toast, as a roster save's do;
  // a stale rev reads the newest copy (write() does that), so the next tap carries it. On ok the record replaces the
  // archived one and the lists are drawn again, the site in its customer group.
  async function restoreRecord(btn) {
    var p = btn.dataset.restore.split(':'), list = p[0] === 'route' ? 'routes' : 'sites';
    var rec = S[list].filter(function (x) { return x.id === p[1]; })[0];
    if (!rec || !isAdmin()) return;
    function buttons(off) { Array.prototype.forEach.call(document.querySelectorAll('[data-restore]'), function (b) { b.disabled = off; }); }
    buttons(true);
    (S.archOpen || (S.archOpen = {}))[list] = true; // the list was open to be tapped: it stays open when redrawn
    var ok = await write(list === 'routes' ? 'restoreRoute' : 'restoreSite', { id: rec.id, rev: rec.rev }, list, toastErr, 'Restored');
    if (!ok) buttons(false);
  }

  async function refresh() {
    var r = await API.call('bootstrap', { slim: true }); // as load(): no outlines, one point per site
    if (r.ok) { S.me = r.me; S.sites = r.sites; S.routes = r.routes; S.crew = r.crew; S.zones = r.zones || []; S.points = r.points || {};
      S.moves = r.moves || []; S.callouts = r.callouts || []; S.gear = r.gear || []; S.post = r.post || null; S.card = r.card || null; render(); }
  }

  // ---------- sites and routes (admin) ----------
  // A number box Matt decides: blank is null (never 0); a number is sent as a number. Anything else
  // is sent as typed, so the server refuses it in its own words: the phone invents no rule of its own.
  function numShown(v) { return v === null || v === undefined ? '' : String(v); }
  function numBox(raw) {
    raw = String(raw).trim();
    if (raw === '') return null;
    var n = Number(raw);
    return isFinite(n) ? n : raw;
  }
  function editSite(id) {
    var s = id ? JSON.parse(JSON.stringify(site(id))) : { name: '', address: '', materials_needed: '', notes: '', rev: 0 };
    var units = s.units || {};
    $('dlgIn').innerHTML = '<h2>' + (id ? 'Edit ' + esc(s.name) : 'Add site') + '</h2>' +
      '<label>Name</label><input id="s_name" value="' + esc(s.name) + '"><label>Address</label><input id="s_addr" value="' + esc(s.address) + '">' +
      '<label>Customer (groups the Sites tab, e.g. ANTHC), blank if not set</label><input id="s_cust" value="' + esc(s.customer) + '" maxlength="40">' +
      '<label>Needs clearance (e.g. JBER), blank if none</label><input id="s_clear" value="' + esc(s.needs_clearance) + '">' +
      '<label>Materials needed (shown to the crew on the map)</label><input id="s_mat" value="' + esc(s.materials_needed) + '" placeholder="e.g. 2-4 bags IceMelt">' +
      // Callouts and day order (Matt, 10/4/26): his numbers, blank until he types them. A site saved
      // before these existed has no key at all: undefined shows as an empty box, never "undefined".
      '<label for="s_callout">Callout depth (inches), blank = no nudge</label><input id="s_callout" type="text" inputmode="decimal" autocomplete="off" value="' + esc(numShown(s.callout_in)) + '">' +
      '<label for="s_rank">Day rank (1 = first on day shift), blank = by choice</label><input id="s_rank" type="text" inputmode="numeric" autocomplete="off" value="' + esc(numShown(s.day_rank)) + '">' +
      // Bobcat and Snowrator stay at a site, so the site carries their unit numbers (they print on the
      // route sheet). Blank until Matt types them; never a made-up number.
      '<label>Bobcat unit # (blank if none)</label><input id="s_bobcat" value="' + esc(units.bobcat) + '" maxlength="20">' +
      '<label>Snowrator unit # (blank if none)</label><input id="s_snowrator" value="' + esc(units.snowrator) + '" maxlength="20">' +
      '<label>Notes</label><textarea id="s_notes" rows="3">' + esc(s.notes) + '</textarea>' +
      '<div id="s_err" class="err"></div><div class="row"><button id="s_save" class="primary">Save</button>' + (id ? '<button id="s_archive">Archive</button>' : '') + '<button id="dlgClose">Cancel</button></div>';
    showDialog();
    // Both fields are always sent, blank when blank: the server keeps stored units only when none are
    // sent at all, so this is how Matt clears one on purpose.
    $('s_save').onclick = function () {
      save('saveSite', Object.assign({}, s, { name: $('s_name').value.trim(), address: $('s_addr').value.trim(), materials_needed: $('s_mat').value.trim(), needs_clearance: $('s_clear').value.trim() || null, customer: $('s_cust').value.trim(), notes: $('s_notes').value,
        callout_in: numBox($('s_callout').value), day_rank: numBox($('s_rank').value),
        units: { bobcat: $('s_bobcat').value.trim(), snowrator: $('s_snowrator').value.trim() } }), 'sites', $('s_err'));
    };
    if ($('s_archive')) $('s_archive').onclick = function () { archive('archiveSite', s, 'sites', $('s_err')); };
  }

  function editRoute(id) {
    var r = id ? JSON.parse(JSON.stringify(S.routes.filter(function (x) { return x.id === id; })[0])) : { name: '', site_ids: [], rev: 0 };
    function draw() {
      var unused = S.sites.filter(function (s) { return !s.archived && r.site_ids.indexOf(s.id) === -1; }).sort(byName);
      $('dlgIn').innerHTML = '<h2>' + (id ? 'Edit ' + esc(r.name) : 'Add route') + '</h2><label>Name</label><input id="r_name" value="' + esc(r.name) + '">' +
        '<label>Sites, in driving order</label><div id="r_hint" class="muted">To rename a site, use its Edit on the Sites tab.</div><ol class="sitelist edit">' + r.site_ids.map(function (sid, i) {
          var s = site(sid);
          return '<li><span>' + esc(s ? s.name : sid) + addrTag(s) + '</span><button class="small" data-up="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="small" data-down="' + i + '" aria-label="Move down"' + (i === r.site_ids.length - 1 ? ' disabled' : '') + '>↓</button><button class="small" data-del="' + i + '" aria-label="Remove">✕</button></li>';
        }).join('') + '</ol>' +
        '<div class="row"><select id="r_add">' + option('', 'Add a site…', true) + unused.map(function (s) { return option(s.id, s.name + (s.address ? ' · ' + s.address : ''), false); }).join('') + '</select><button id="r_addbtn">Add</button></div>' +
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
    if (t.id === 'share') { shareApp(); return; }
    if (SnowRosterUI.onClick(ev, rosterCtx())) return;
    if (SnowBoardUI.onClick(ev, boardCtx())) return;
    if (SnowShiftUI.onClick(ev, boardCtx())) return;
    if (t.id === 'retry') { load(); return; }
    if (t.id === 'si_go') { doSignIn(); return; }
    if (t.id === 'si_req') { showRequest(); return; }
    if (t.id === 'rq_go') { doRequest(); return; }
    if (t.id === 'rq_back') { showSignIn(); return; }
    // Signing out wipes this phone's kept outlines along with the token. (A session that merely expires keeps
    // them, by design: the spec wipes on sign-out only.)
    if (t.id === 'signout') { closeMap(); setEditingPref(false); API.signOut(); Kept.forget(); S.profiles = null; showSignIn(); return; }
    if (t.id === 'addWorker') { editWorker(null); return; }
    // ‹ Back and the tabs close the map, which would stop an import halfway.
    if ((t.id === 'mapback' || t.closest('#tabs [data-tab]')) && window.SnowMapEdit && window.SnowMapEdit.importing()) { window.SnowMapEdit.refuse(); return; }
    if (t.id === 'mapback') { render(); return; }
    if (t.id === 'refreshPost') { refreshPost(true); return; }
    if (t.id === 'mapedit') { startEdit(t.dataset.site); return; }
    if ((el = t.closest('[data-map]'))) { openMap(el.dataset.map); return; }
    if ((el = t.closest('#tabs [data-tab]'))) {
      S.tab = el.dataset.tab; S.tabChosen = true;
      SnowShiftUI.closePrint();
      SnowShiftUI.closeRoute(); // Storm -> Board -> Storm lands on the live view
      render(); syncHistory();
      if (S.tab === 'tonight') refreshPost();
      // The Board shows each route's truck: read the rows once on entering it (a lead may have set one).
      if (S.tab === 'board') SnowShiftUI.catchUp(boardCtx());
      return;
    }
    if ((el = t.closest('[data-open]'))) { openWorker(el.dataset.open); return; }
    if ((el = t.closest('[data-restore]'))) { restoreRecord(el); return; }
    if ((el = t.closest('[data-edit]'))) {
      var p = el.dataset.edit.split(':');
      if (p[0] === 'route') editRoute(p[1] || null); else if (p[0] === 'site') editSite(p[1] || null);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target.id === 'si_pin') { doSignIn(); return; }
    if (S.me) SnowShiftUI.onKeydown(ev, boardCtx()); // Enter in a truck box, on the Board or the Storm tab
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  // Spanish (10/9/26): the engine reads this phone's choice, paints EN / ES, translates what is on
  // screen and watches everything after. Once, before the first render; the app runs English without it.
  if (window.SnowEs) window.SnowEs.start('langWrap');
  load();
})();
