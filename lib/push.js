// What this phone can do about snow alerts (crew notifications, 11/10/26): whether it can get them at all,
// turning them on and off, and remembering the language for the service worker. The screens that draw
// cardHtml / rowHtml are the Tonight tab and the Your card (Task 8); nothing here draws by itself.
//
// "On" needs all three: permission granted, a subscription in this browser, and that subscription's
// fingerprint in the list the server sent (S.push.ids). A subscription the server does not list (dropped
// as gone, or made with an older key) reads `off`, and Turn on repairs it.
//
// An iPhone refuses a permission request that does not start inside the tap, so turnOn asks
// Notification.requestPermission() as its very first synchronous step: no await, no .then, no timer before it.
//
// Old-style JavaScript on purpose (var, promise chains): installed phones include old WebViews.
// `env` is injectable so the node tests never touch a real browser.
var SnowPush = (function () {
  'use strict';
  var PREFS_CACHE = 'titan-snow-prefs';   // the service worker reads this name; it never begins titan-snow-shell-
  var PREFS_LANG = './prefs/lang';
  var NOT_SAVED = 'Not saved: try again';
  var NOT_SET_UP = 'Snow alerts are not set up yet.';

  // f = { sw, push, notif, ios, standalone, permission, subscribed, known }
  function stateOf(f) {
    if (!f.sw || !f.push || !f.notif) return f.ios && !f.standalone ? 'install' : 'unsupported';
    if (f.permission === 'denied') return 'blocked';
    if (f.permission === 'granted' && f.subscribed && f.known) return 'on';
    return 'off';
  }

  function defaultEnv() {
    var w = typeof window !== 'undefined' ? window : {};
    return {
      navigator: typeof navigator !== 'undefined' ? navigator : {},
      PushManager: w.PushManager,
      Notification: w.Notification,
      matchMedia: w.matchMedia ? function (q) { return w.matchMedia(q); } : undefined,
      caches: typeof caches !== 'undefined' ? caches : undefined,
      Response: typeof Response !== 'undefined' ? Response : undefined,
      lang: function () { return w.SnowEs && w.SnowEs.lang ? w.SnowEs.lang() : 'en'; }
    };
  }

  // The same id the backend makes: SHA-256 of the endpoint's UTF-8 bytes, the first 8 bytes as lowercase hex.
  function fingerprint(endpoint) {
    return Promise.resolve().then(function () {
      var bytes = new TextEncoder().encode(String(endpoint));
      return crypto.subtle.digest('SHA-256', bytes);
    }).then(function (buf) {
      var u = new Uint8Array(buf), out = '', i, h;
      for (i = 0; i < 8; i++) { h = u[i].toString(16); out += h.length < 2 ? '0' + h : h; }
      return out;
    });
  }

  function isIos(e) {
    var nav = e.navigator || {};
    if (/iPhone|iPad|iPod/.test(nav.userAgent || '')) return true;
    return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;   // iPadOS says it is a Mac
  }
  function isStandalone(e) {
    var nav = e.navigator || {};
    if (nav.standalone === true) return true;
    try { return !!(e.matchMedia && e.matchMedia('(display-mode: standalone)').matches); } catch (err) { return false; }
  }

  // The worker's registration, or null. Never waits on serviceWorker.ready: with no worker (file://, the
  // first load before registration) that promise never resolves and a tap would hang.
  function getReg(e) {
    var sw = (e.navigator || {}).serviceWorker;
    if (!sw) return Promise.resolve(null);
    return Promise.resolve(sw.getRegistration());
  }
  function getSub(e) {
    return getReg(e).then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; });
  }

  function readFlags(e, ids) {
    var f = { sw: !!(e.navigator && e.navigator.serviceWorker), push: !!e.PushManager, notif: !!e.Notification,
      ios: isIos(e), standalone: isStandalone(e), permission: 'default', subscribed: false, known: false };
    try { if (e.Notification) f.permission = e.Notification.permission; } catch (err) { /* stays default */ }
    if (!f.sw || !f.push || !f.notif) return Promise.resolve(f);
    return getSub(e).then(function (sub) {
      if (!sub) return f;
      f.subscribed = true;
      return fingerprint(sub.endpoint).then(function (h) { f.known = (ids || []).indexOf(h) >= 0; return f; });
    }).catch(function () { f.subscribed = false; f.known = false; return f; });
  }

  // Reads the browser, compares with what the server listed, sets S.push.state.
  function refresh(S, env) {
    var e = env || defaultEnv();
    if (!S.push) S.push = { key: null, ids: [], state: 'unsupported' };
    // The answer goes to the object this refresh started with, and only if no newer refresh of it began since:
    // an older reply that lands late must not overwrite a newer one.
    var p = S.push, n = (p.seq = (p.seq || 0) + 1);
    return readFlags(e, p.ids).then(function (f) {
      if (p.seq === n) p.state = stateOf(f);
      return p.state;
    });
  }

  function keyBytes(key) {
    var s = String(key).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = atob(s), u = new Uint8Array(raw.length), i;
    for (i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    return u;
  }
  function sameKey(sub, bytes) {
    var k = sub && sub.options && sub.options.applicationServerKey;
    if (!k) return false;
    var u = new Uint8Array(k), i;
    if (u.length !== bytes.length) return false;
    for (i = 0; i < u.length; i++) if (u[i] !== bytes[i]) return false;
    return true;
  }

  // A subscription for this key: the existing one when its key still matches, else a fresh one. If the
  // browser refuses (a subscription made with an old key), drop the old one and ask once more.
  function subscribeNow(e, key) {
    var bytes = keyBytes(key), opts = { userVisibleOnly: true, applicationServerKey: bytes };
    return getReg(e).then(function (reg) {
      if (!reg) throw new Error('no service worker registration');
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing && sameKey(existing, bytes)) return existing;
        return reg.pushManager.subscribe(opts).catch(function () {
          return reg.pushManager.getSubscription().then(function (old) {
            return old ? old.unsubscribe() : null;
          }).catch(function () { return null; }).then(function () {
            return reg.pushManager.subscribe(opts);
          });
        });
      });
    });
  }

  function langOf(e) {
    var l;
    try { l = e.lang ? e.lang() : 'en'; } catch (err) { l = 'en'; }
    return l === 'es' ? 'es' : 'en';
  }

  // The tap. Notification.requestPermission() is the first thing that runs, inside this very call.
  function turnOn(ctx, env) {
    var e = env || defaultEnv(), p = ctx.S.push;
    if (!p || !p.key) return Promise.resolve({ ok: false, state: p ? p.state : 'unsupported', reason: NOT_SET_UP });
    if (!e.Notification) return Promise.resolve({ ok: false, state: p.state });
    // Called exactly once, here, inside the tap. Old Safari takes a callback and returns undefined; newer
    // browsers return a promise: whichever answers first wins.
    var ask = new Promise(function (resolve, reject) {
      try {
        var ret = e.Notification.requestPermission(function (perm) { resolve(perm); });
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
      } catch (err) { reject(err); }
    });
    var sub = null;
    return Promise.resolve(ask).then(function (perm) {
      if (perm === 'denied') { ctx.S.push.state = 'blocked'; return { ok: false, state: 'blocked' }; }
      if (perm !== 'granted') { ctx.S.push.state = 'off'; return { ok: false, state: 'off' }; }
      return subscribeNow(e, p.key).then(function (s) {
        sub = s;
        return ctx.call('savePush', { endpoint: s.endpoint, lang: langOf(e) });
      }).then(function (r) {
        if (!r || !r.ok) throw new Error('save refused');
        // whatever S.push is NOW: a bootstrap may have replaced it while the tap was in flight
        if (Array.isArray(r.push_ids)) ctx.S.push.ids = r.push_ids;
        return refresh(ctx.S, e).then(function (state) { return { ok: true, state: state }; });
      });
    }).catch(function () {
      // Not saved: never leave a subscription the server does not know about.
      var done = sub ? Promise.resolve().then(function () { return sub.unsubscribe(); }).catch(function () { return null; }) : Promise.resolve();
      // The state is read again from the browser, never remembered: the unsubscribe above may have changed it
      // (or failed), and the permission may have changed since the card was drawn.
      return done.then(function () {
        return refresh(ctx.S, e).catch(function () { return ctx.S.push.state; });
      }).then(function (state) {
        return { ok: false, state: state, reason: NOT_SAVED };
      });
    });
  }

  // Unsubscribes this phone first, then tells the server. A server that cannot be reached does not undo it.
  function turnOff(ctx, env) {
    var e = env || defaultEnv();
    return getSub(e).catch(function () { return null; }).then(function (sub) {
      var endpoint = sub && sub.endpoint;
      return Promise.resolve().then(function () { return sub ? sub.unsubscribe() : null; }).catch(function () { return null; }).then(function () {
        if (!endpoint) return null;
        return Promise.resolve().then(function () { return ctx.call('dropPush', { endpoint: endpoint }); }).then(function (r) {
          if (r && r.ok && Array.isArray(r.push_ids)) ctx.S.push.ids = r.push_ids;
        }).catch(function () { return null; });
      });
    }).then(function () { return refresh(ctx.S, e); }).then(function (state) {
      return { ok: true, state: state };
    });
  }

  // The service worker cannot read localStorage: it reads the language from this small cache entry.
  // Never throws or rejects into the app (no Cache API, private mode, a full disk).
  function rememberLang(lang, env) {
    return Promise.resolve().then(function () {
      var e = env || defaultEnv();
      if (!e.caches || !e.Response) return null;
      var text = lang === 'es' ? 'es' : 'en';
      return e.caches.open(PREFS_CACHE).then(function (c) { return c.put(PREFS_LANG, new e.Response(text)); });
    }).then(function () { return undefined; }, function () { return undefined; });
  }

  function stateIn(ctx) { return ctx && ctx.S && ctx.S.push && ctx.S.push.state; }
  var INSTALL_TEXT = 'To get snow alerts on an iPhone, add Shovel Command to your home screen first: Share, then Add to Home Screen.';
  var BLOCKED_TEXT = "Notifications are blocked for Shovel Command in this phone's settings.";
  var ON_TOAST = 'Snow alerts are on.';
  var OFF_TOAST = 'Snow alerts are off.';

  // The last refusal ("Not saved: try again", "Snow alerts are not set up yet."), kept on S.push by onClick and drawn as the
  // last line of the card and the row (the spec: on the card, not a toast that is gone in five seconds). A new bootstrap
  // makes a new S.push, so a note never outlives the sign-in it was said in.
  function noteHtml(ctx) {
    var n = ctx && ctx.S && ctx.S.push && ctx.S.push.note;
    if (!n) return '';
    var esc = ctx.esc || function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    return '<p class="err pushnote">' + esc(n) + '</p>';
  }

  // The buttons carry data-push, never an id: the Tonight card and the Your card row (a dialog over Tonight) can be on
  // screen at the same time, and an id must be one element's.
  // The Tonight card: drawn only while this phone is not getting alerts and something can be said about it.
  function cardHtml(ctx) {
    var st = stateIn(ctx);
    if (st === 'off') {
      return '<section class="card" id="pushcard"><h2>Get snow alerts on this phone</h2>' +
        '<button class="primary" data-push="on" type="button">Turn on notifications</button>' + noteHtml(ctx) + '</section>';
    }
    if (st === 'install') return '<section class="card" id="pushcard"><p>' + INSTALL_TEXT + '</p>' + noteHtml(ctx) + '</section>';
    if (st === 'blocked') return '<section class="card" id="pushcard"><p>' + BLOCKED_TEXT + '</p>' + noteHtml(ctx) + '</section>';
    return '';
  }

  // The Your card row: the same four states.
  function rowHtml(ctx) {
    var st = stateIn(ctx);
    if (st === 'on') {
      return '<div class="row" id="pushrow"><span>Snow alerts on this phone: on</span> ' +
        '<button class="small" data-push="off" type="button">Turn off</button>' + noteHtml(ctx) + '</div>';
    }
    if (st === 'off') {
      return '<div class="row" id="pushrow"><span>Snow alerts on this phone: off</span> ' +
        '<button class="small" data-push="on" type="button">Turn on</button>' + noteHtml(ctx) + '</div>';
    }
    if (st === 'install') return '<div class="row" id="pushrow"><span>' + INSTALL_TEXT + '</span>' + noteHtml(ctx) + '</div>';
    if (st === 'blocked') return '<div class="row" id="pushrow"><span>' + BLOCKED_TEXT + '</span>' + noteHtml(ctx) + '</div>';
    return '';
  }

  // One tap at a time: while a turn-on or turn-off is out (a permission prompt, a slow save), another tap on a push button
  // asks nothing and sends nothing. It is still the push buttons' click, so it is handled (true).
  var running = false;

  // true when the click was on a push button and was handled (the router stops there).
  function onClick(ev, ctx, env) {
    var t = ev && ev.target;
    if (!t || !t.closest) return false;
    var b = t.closest('[data-push]'), which = b && b.dataset && b.dataset.push;
    if (which !== 'on' && which !== 'off') return false;
    if (running) return true;
    running = true;
    if (ctx.S && ctx.S.push) ctx.S.push.note = null;           // the last refusal goes the moment a new tap starts
    var run;
    try { run = which === 'on' ? turnOn(ctx, env) : turnOff(ctx, env); }   // turnOn asks for permission before it returns
    catch (err) { run = Promise.resolve({ ok: false, state: stateIn(ctx) }); }
    run.then(function (r) {
      var p = ctx.S && ctx.S.push;                              // whatever S.push is NOW (a bootstrap may have replaced it)
      if (r && !r.ok && r.reason && p) p.note = r.reason;
      else if (r && r.ok && ctx.toast) {
        if (which === 'on' && r.state === 'on') ctx.toast(ON_TOAST);
        if (which === 'off' && r.state !== 'on') ctx.toast(OFF_TOAST);
      }
      if (ctx.render) ctx.render();
    }).catch(function () { /* never surfaces */ }).then(function () { running = false; });
    return true;
  }

  return { stateOf: stateOf, fingerprint: fingerprint, refresh: refresh, turnOn: turnOn, turnOff: turnOff,
    rememberLang: rememberLang, cardHtml: cardHtml, rowHtml: rowHtml, onClick: onClick };
})();
if (typeof module !== 'undefined') module.exports = SnowPush;
if (typeof window !== 'undefined') window.SnowPush = SnowPush;
