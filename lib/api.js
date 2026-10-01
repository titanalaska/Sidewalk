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

  async function call(action, body) {
    var payload = Object.assign({}, body || {}, { action: action, token: getToken() });
    var res, out;
    try {
      res = await fetch(C.SNOW_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    } catch (e) {
      return { ok: false, code: 'network', reason: "Couldn't reach the server. Not saved, try again." };
    }
    try { out = await res.json(); } catch (e) {
      return { ok: false, code: 'network', reason: 'The server sent something unreadable. Try again.' };
    }
    if (!out || typeof out.ok !== 'boolean') return { ok: false, code: 'error', reason: 'Unexpected reply from the server.' };
    out.versionMismatch = out.version !== C.EXPECTED_BACKEND;
    if (out.code === 'signin') setToken('');
    return out;
  }

  // Inventory's own sign-in endpoints (GET, as the Inventory app calls them).
  async function inv(params) {
    try {
      var r = await fetch(C.INV_URL + '?' + new URLSearchParams(params).toString());
      return await r.json();
    } catch (e) { return null; }
  }

  // Approved names only. Inventory's getProfiles sends names and status, never PINs.
  async function profiles() {
    var r = await inv({ action: 'getProfiles' });
    if (!r || !Array.isArray(r.profiles)) return null;
    return r.profiles.filter(function (p) { return p.status === 'approved'; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  async function signIn(id, pin) {
    var r = await inv({ action: 'verifyPin', id: String(id), pin: String(pin) });
    if (!r) return { ok: false, reason: "Couldn't reach the server. Try again." };
    if (r.lockedOut) return { ok: false, reason: 'Too many wrong PINs. Wait ' + r.minutes + ' minutes.' };
    if (!r.valid) return { ok: false, reason: r.attemptsLeft != null ? 'Wrong PIN. ' + r.attemptsLeft + ' tries left.' : (r.error || 'Wrong PIN.') };
    if (!r.token) return { ok: false, reason: r.status === 'pending' ? 'Your access is still waiting for Matt to approve it.' : 'Your access is not approved.' };
    setToken(r.token);
    return { ok: true };
  }

  async function requestAccess(name, position, pin) {
    var r = await inv({ action: 'requestProfile', name: name, position: position, pin: pin });
    if (!r) return { ok: false, reason: "Couldn't reach the server. Try again." };
    if (r.error) return { ok: false, reason: r.error };
    if (r.duplicate) return { ok: false, reason: r.status === 'approved' ? 'You already have access. Sign in with your name.' : 'You already asked. Matt still has to approve it.' };
    return { ok: true };
  }

  root.SnowApi = { call: call, profiles: profiles, signIn: signIn, requestAccess: requestAccess,
    signOut: function () { setToken(''); }, hasToken: function () { return !!getToken(); } };
})(this);
