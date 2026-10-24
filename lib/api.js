// Everything that talks to a server. The snow backend gets POSTed text/plain
// JSON (no CORS preflight, the Inventory pattern). Apps Script answers 200 even
// when it refuses, so every reply's BODY decides success -- never the status.
(function (root) {
  'use strict';
  var C = root.SNOW_CONFIG;
  var TOKEN_KEY = 'titan-snow-token';

  function getToken() { try { return root.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) {
    try { if (t) root.localStorage.setItem(TOKEN_KEY, t); else root.localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // A request with no answer after 45 s is given up as no signal. Apps Script
  // waits up to 25 s for its lock, so by then the answer is not coming; without
  // this a hung request froze its walk (and the Storm tab's polling) for good.
  // A save that did land and is retried writes a second, identical row: harmless.
  var TIMEOUT_MS = 45000;
  var NO_SIGNAL = "Couldn't reach the server. Not saved, try again.";

  async function call(action, body) {
    var payload = Object.assign({}, body || {}, { action: action, token: getToken() });
    var res, out;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    try {
      try {
        res = await fetch(C.SNOW_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload),
          signal: ctl ? ctl.signal : undefined });
      } catch (e) {
        return { ok: false, code: 'network', reason: NO_SIGNAL };
      }
      try { out = await res.json(); } catch (e) {
        if (ctl && ctl.signal.aborted) return { ok: false, code: 'network', reason: NO_SIGNAL };
        return { ok: false, code: 'network', reason: 'The server sent something unreadable. Try again.' };
      }
    } finally { if (timer) clearTimeout(timer); }
    if (!out || typeof out.ok !== 'boolean') return { ok: false, code: 'error', reason: 'Unexpected reply from the server.' };
    // The "not saved" guard (10/10/26). Twice the live app was handed the GET health reply, { ok: true, version },
    // for a POST (a Google redirect hiccup), and any ok:true counts as success here: a save looked saved and was
    // never written. From outlines-1 on, every POST reply names the action it answers; the health check never
    // does. So a reply from the version this phone expects that answers some other action is not an answer: it
    // is no signal. A reply from another version (an older server, mid-deploy) never sent `action` and is not
    // checked; the version banner covers that window.
    if (out.version === C.EXPECTED_BACKEND && out.action !== action) return { ok: false, code: 'network', reason: NO_SIGNAL };
    out.versionMismatch = out.version !== C.EXPECTED_BACKEND;
    if (out.code === 'signin') setToken('');
    return out;
  }

  // A READ, given up to two quiet retries (Matt, 10/22/26; two since 10/24/26: "you retry, sometimes you do it again").
  // Google now and then fails a call in 0 s, before the script's code runs (3 of 22 on 10/22); its error page has no CORS
  // header, so the phone sees "no signal", and the same call a moment later answers. The waits are 1500 ms, then 4000 ms.
  // Only code 'network' is tried again, and only while the whole read has used under 10 s (waits included): a call that
  // ran out the 45 s limit has cost a minute already, and another would double it before the card. Never for a write
  // (call() itself never retries): a save that failed may have landed. A read's failure never says "Not saved":
  // opening the app saves nothing.
  var RETRY_WAITS_MS = [1500, 4000];
  var RETRY_ONLY_IF_FASTER_THAN_MS = 10000;
  var NO_SIGNAL_READ = "Couldn't reach the server. Try again.";
  async function read(action, body) {
    var t0 = Date.now();
    var r = await call(action, body);
    for (var i = 0; i < RETRY_WAITS_MS.length; i++) {
      if (r.ok || r.code !== 'network' || Date.now() - t0 >= RETRY_ONLY_IF_FASTER_THAN_MS) break;
      await new Promise(function (go) { setTimeout(go, RETRY_WAITS_MS[i]); });
      r = await call(action, body);
    }
    if (!r.ok && r.reason === NO_SIGNAL) r.reason = NO_SIGNAL_READ;
    return r;
  }

  // Inventory's own sign-in endpoints (GET, as the Inventory app calls them).
  async function inv(params) {
    try {
      var r = await fetch(C.INV_URL + '?' + new URLSearchParams(params).toString());
      return await r.json();
    } catch (e) { return null; }
  }

  // Approved AND pending people (a pending person must be able to find their own
  // name and hear "waiting"). Rejected are left out. Inventory's getProfiles
  // sends names, status and hasPin -- never PINs. null = couldn't load.
  async function profiles() {
    var r = await inv({ action: 'getProfiles' });
    if (!r || !Array.isArray(r.profiles)) return null;
    return r.profiles.filter(function (p) { return p.status === 'approved' || p.status === 'pending'; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  // `claim`: an approved profile with no PIN yet sets one (Inventory's claimPin).
  // Sending it to verifyPin instead would count a failure, and six of those lock
  // the person out of Inventory too.
  async function signIn(id, pin, claim) {
    var r = await inv({ action: claim ? 'claimPin' : 'verifyPin', id: String(id), pin: String(pin) });
    if (!r) return { ok: false, reason: "Couldn't reach the server. Try again." };
    if (r.lockedOut) return { ok: false, reason: 'Too many wrong PINs. Wait ' + r.minutes + ' minutes.' };
    if (!r.valid) return { ok: false, reason: r.attemptsLeft != null ? 'Wrong PIN. ' + r.attemptsLeft + ' tries left.' : (r.error || 'Wrong PIN.') };
    if (!r.token) return { ok: false, reason: r.status === 'pending' ? 'Your access is still waiting for Matt to approve it.' : 'Your access is not approved.' };
    setToken(r.token);
    return { ok: true };
  }

  var ON_THE_LIST = "That name is already on the list. If it's you, go back and pick it. If not, add your second last name or a middle initial.";
  async function requestAccess(name, position, pin) {
    var r = await inv({ action: 'requestProfile', name: name, position: position, pin: pin });
    if (!r) return { ok: false, reason: "Couldn't reach the server. Try again." };
    if (r.error) return { ok: false, reason: r.error };
    // Inventory refuses a name it already has, whatever its status, and says which. Approved or waiting, it is on
    // the sign-in list (it may be this person, or someone else of the same name: the line covers both). Rejected,
    // it is not on the list, and not theirs to take.
    if (r.duplicate) return { ok: false, reason: r.status === 'rejected' ? 'That name was not approved. Talk to Matt.' : ON_THE_LIST };
    return { ok: true };
  }

  // Matt's answer to a request (roster self-service, 10/6/26): Inventory's own admin
  // actions, with his token, as the Inventory app calls them. The snow backend is not
  // involved and still never writes Inventory's Sheet.
  async function decideProfile(what, id) {
    var r = await inv({ action: what === 'approve' ? 'approveProfile' : 'rejectProfile', id: String(id), token: getToken() });
    if (!r) return { ok: false, reason: "Couldn't reach the server. Try again." };
    if (r.error) return { ok: false, reason: r.error };
    return r.success ? { ok: true } : { ok: false, reason: 'That request is gone. Pull the list again.' };
  }

  root.SnowApi = { call: call, read: read, profiles: profiles, signIn: signIn, requestAccess: requestAccess, ON_THE_LIST: ON_THE_LIST,
    approveProfile: function (id) { return decideProfile('approve', id); }, rejectProfile: function (id) { return decideProfile('reject', id); },
    signOut: function () { setToken(''); }, hasToken: function () { return !!getToken(); } };
})(this);
