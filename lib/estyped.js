// The words people type, in the reader's language (Spanish everywhere, Ship 2, Matt 11/25/26): site notes, materials needed,
// zone names and notes, and the crew's Problem notes. Each is drawn in an element marked data-typed (and data-no-es, so the
// app's own Spanish pass, lib/es.js, never touches it). This layer shows the Spanish this phone holds for the element's text;
// a miss is asked for in one `translate` call a moment later (batched, debounced); the answer patches every element with that
// text. The English is kept (as the engine keeps it for the app's own words): a flip to EN, a print scope in English, or a tap
// puts it back. Display only: nothing here is ever saved anywhere but this phone's copy.
//   - On a Spanish phone every data-typed element shows Spanish.
//   - On every phone a crew-typed note (data-typed="crew", a Problem note) shows in the phone's language, both ways.
//   - Inside a print scope (data-es-scope, lib/es.js scope) the scope's language decides.
// The phone's copy is localStorage `snow-es-typed` = { es: { key: text }, en: { key: text } }: named once, never renamed,
// wiped at sign-out (it holds customer notes). Keys are CrewTyped.key (lib/typedwords.js, the server's own file).
// The text is put in with textContent, never as HTML: a translation holding "<b>" shows those characters.
var SnowEsTyped = (function () {
  'use strict';
  var KEY = 'snow-es-typed';
  var DEBOUNCE_MS = 400;    // misses gathered into one call
  var RETRY_MS = 60000;     // a line answered "later" (Google's budget or quota), or a call with no signal, is asked again
  var MAX_RETRIES = 3;      //   ... at most this many more times per line this session; then it stays as typed
  var PEEK_MS = 4000;       // a tap shows the original this long
  var T = typeof CrewTyped !== 'undefined' ? CrewTyped : (typeof require === 'function' ? require('./typedwords.js') : null);

  // ---- pure parts (test/estyped.test.js) --------------------------------------------------------------------------------

  // The language a typed element is shown in, or null for "as typed". scopeLang: the nearest print scope's ('es' | 'en' | null);
  // crew: a crew-typed Problem note; phone: this phone's language.
  function targetFor(scopeLang, crew, phone) {
    if (scopeLang === 'es') return 'es';
    if (scopeLang === 'en') return crew ? 'en' : null;
    if (crew) return phone === 'es' ? 'es' : 'en';
    return phone === 'es' ? 'es' : null;
  }

  // The kept copy, from what localStorage holds: anything unreadable is an empty copy; only text values are kept.
  function readStore(raw) {
    var out = { es: {}, en: {} }, o = null;
    try { o = JSON.parse(raw || 'null'); } catch (e) { o = null; }
    ['es', 'en'].forEach(function (l) {
      var m = o && typeof o === 'object' && o[l];
      if (!m || typeof m !== 'object') return;
      Object.keys(m).forEach(function (k) { if (typeof m[k] === 'string') out[l][k] = m[k]; });
    });
    return out;
  }

  // The lines a Spanish phone asks for right after sign-in: [own route's lines, the rest]. A crew member's own route is the
  // newest Post's route that lists them (their sites in route order); everyone else has none. Per site: notes, materials
  // needed, then each live zone's name and note. Only lines that may ever be sent, each once (the first list wins).
  function prefetchLines(S) {
    var me = S && S.me && S.me.crew_id, post = S && S.post, seen = {};
    var sites = ((S && S.sites) || []).filter(function (s) { return s && s.archived !== true; });
    var zonesBySite = {};
    ((S && S.zones) || []).forEach(function (z) {
      if (!z || z.archived === true) return;
      (zonesBySite[z.site_id] = zonesBySite[z.site_id] || []).push(z);
    });
    var own = [];
    if (me && post) (post.routes || []).forEach(function (r) {
      if (r.lead !== me && (r.members || []).indexOf(me) === -1) return;
      (r.sites || []).forEach(function (s) { var id = s && typeof s === 'object' ? s.id : s; if (own.indexOf(id) === -1) own.push(id); });
    });
    function linesOf(siteIds) {
      var out = [];
      function add(t) { if (!T.sendable(t)) return; var k = T.key(t); if (seen[k]) return; seen[k] = true; out.push(k); }
      siteIds.forEach(function (id) {
        var s = sites.filter(function (x) { return x.id === id; })[0];
        if (!s) return;
        add(s.notes); add(s.materials_needed);
        (zonesBySite[id] || []).forEach(function (z) { add(z.name); add(z.note); });
      });
      return out;
    }
    var mine = linesOf(own);
    var rest = linesOf(sites.map(function (s) { return s.id; }).filter(function (id) { return own.indexOf(id) === -1; }));
    return [mine, rest];
  }

  // ---- the layer on the page ----------------------------------------------------------------------------------------------
  var held = { es: {}, en: {} };
  var call = null, ready = null, started = false, gen = 0, timer = null;
  var queue = { es: [], en: [] }, inflight = { es: {}, en: {} }, refused = { es: {}, en: {} }, retries = { es: {}, en: {} };
  // A line between a "later" and its retry: a redraw must not ask for it again (every reply redraws: that would ask every
  // DEBOUNCE_MS, for ever). A line out of retries goes in `refused` for the rest of the session.
  var waiting = { es: {}, en: {} };
  var orig = typeof WeakMap === 'function' ? new WeakMap() : null;   // element -> { orig: as typed, shown: what it shows }

  function phoneLang() { return typeof window !== 'undefined' && window.SnowEs ? window.SnowEs.lang() : 'en'; }
  function scopeOf(el) { var s = el.closest ? el.closest('[data-es-scope]') : null; return s ? s.getAttribute('data-es-scope') : null; }
  function has(map, k) { return Object.prototype.hasOwnProperty.call(map, k); }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(held)); } catch (e) { /* a full store keeps this session's copy */ } }

  // What the element holds as typed: the original we kept while it still shows our text, else what it shows now (a redraw or
  // an edit put new English in: its old Spanish is never shown for the new text).
  function originalOf(el) {
    var rec = orig && orig.get(el);
    return rec && el.textContent === rec.shown ? rec.orig : el.textContent;
  }

  function show(el) {
    if (!orig || el.hasAttribute('data-typed-peek')) return;
    var o = originalOf(el), rec = orig.get(el);
    var target = targetFor(scopeOf(el), el.getAttribute('data-typed') === 'crew', phoneLang());
    var ok = !!target && T.sendable(o), k = ok ? T.key(o) : '';
    var tr = ok && has(held[target], k) ? held[target][k] : undefined;
    if (tr !== undefined && tr !== o) {
      if (el.textContent !== tr) el.textContent = tr;
      orig.set(el, { orig: o, shown: tr });
      el.setAttribute('data-typed-shown', '');
      return;
    }
    if (rec && el.textContent === rec.shown) el.textContent = rec.orig;
    orig.delete(el);
    el.removeAttribute('data-typed-shown');
    if (ok && tr === undefined) want(target, k);
  }

  function apply(root) {
    root = root || (typeof document !== 'undefined' ? document.body : null);
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('[data-typed]')) show(root);
    Array.prototype.forEach.call(root.querySelectorAll('[data-typed]'), show);
  }

  function want(lang, k) {
    if (has(held[lang], k) || has(refused[lang], k) || has(inflight[lang], k) || has(waiting[lang], k) || queue[lang].indexOf(k) !== -1) return;
    queue[lang].push(k);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush() {
    timer = null;
    if (!call || (ready && !ready())) { queue = { es: [], en: [] }; return; }
    ['es', 'en'].forEach(function (lang) {
      while (queue[lang].length) send(lang, queue[lang].splice(0, T.BATCH));
    });
  }

  function retryLater(lang, k, g) {
    var n = retries[lang][k] || 0;
    if (n >= MAX_RETRIES) { refused[lang][k] = true; return; }   // stays as typed for the rest of this session
    retries[lang][k] = n + 1;
    waiting[lang][k] = true;
    setTimeout(function () { if (g !== gen) return; delete waiting[lang][k]; want(lang, k); }, RETRY_MS);
  }

  // One translate call. Every failure is quiet: no toast, no "Not saved"; the English stays and the line is asked again later.
  function send(lang, texts) {
    var g = gen;
    texts.forEach(function (k) { inflight[lang][k] = true; });
    return Promise.resolve(call('translate', { lang: lang, texts: texts })).then(function (r) {
      if (g !== gen) return;               // signed out (or another person) since: drop it
      texts.forEach(function (k) { delete inflight[lang][k]; });
      if (!r || !r.ok) { texts.forEach(function (k) { retryLater(lang, k, g); }); return; }
      var done = r.done || {}, no = r.refused || [];
      texts.forEach(function (k) {
        if (has(done, k) && typeof done[k] === 'string') held[lang][k] = done[k];
        else if (no.indexOf(k) !== -1) refused[lang][k] = true;
        else retryLater(lang, k, g);       // "later", or not answered at all
      });
      save();
      apply();
    }, function () {
      if (g !== gen) return;
      texts.forEach(function (k) { delete inflight[lang][k]; retryLater(lang, k, g); });
    });
  }

  // A tap on a translated line shows the original for PEEK_MS, or until tapped again.
  function peek(el) {
    if (el.hasAttribute('data-typed-peek')) { unpeek(el); return; }
    var rec = orig && orig.get(el);
    if (!rec) return;
    el.setAttribute('data-typed-peek', '');
    el.textContent = rec.orig;
    el._typedPeek = setTimeout(function () { unpeek(el); }, PEEK_MS);
  }
  function unpeek(el) {
    clearTimeout(el._typedPeek);
    el.removeAttribute('data-typed-peek');
    show(el);
  }

  // Once: the kept copy, the language-flip and print-scope hook, an observer for every typed element drawn later, the tap.
  // Called again (a later sign-in), it only takes the new call and ready functions.
  function start(o) {
    call = (o && o.call) || call;
    ready = (o && o.ready) || ready;
    if (started || typeof document === 'undefined' || !T) return;
    started = true;
    try { held = readStore(localStorage.getItem(KEY)); } catch (e) { held = { es: {}, en: {} }; }
    if (window.SnowEs && window.SnowEs.onChange) window.SnowEs.onChange(function (root) { apply(root); });
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function (list) {
        list.forEach(function (m) {
          if (m.type === 'characterData') {
            var p = m.target.parentNode, t = p && p.closest ? p.closest('[data-typed]') : null;
            if (t) show(t);
            return;
          }
          Array.prototype.forEach.call(m.addedNodes, function (n) {
            if (n.nodeType === 1) apply(n);
            else if (n.nodeType === 3 && n.parentNode && n.parentNode.closest) {
              var e = n.parentNode.closest('[data-typed]');
              if (e) show(e);
            }
          });
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-typed-shown]') : null;
      if (el) peek(el);
    });
    apply(document.body);
  }

  // Right after sign-in, a Spanish phone asks for its own route's lines first, then the rest, in batches, so a crew member
  // has Spanish on the screens they use before they lose signal on the route.
  function prefetch(S) {
    if (!call || phoneLang() !== 'es' || (ready && !ready())) return Promise.resolve();
    var lists = prefetchLines(S), g = gen, batches = [];
    lists.forEach(function (lines) {
      var need = lines.filter(function (k) { return !has(held.es, k) && !has(refused.es, k) && !has(inflight.es, k) && !has(waiting.es, k); });
      for (var i = 0; i < need.length; i += T.BATCH) batches.push(need.slice(i, i + T.BATCH));
    });
    return batches.reduce(function (p, b) {
      return p.then(function () { if (g === gen) return send('es', b); });
    }, Promise.resolve());
  }

  // Sign-out: the copy holds customer notes, so it goes, with everything this session learned.
  function forget() {
    gen++;
    if (timer) { clearTimeout(timer); timer = null; }
    held = { es: {}, en: {} }; queue = { es: [], en: [] }; inflight = { es: {}, en: {} };
    refused = { es: {}, en: {} }; retries = { es: {}, en: {} }; waiting = { es: {}, en: {} };
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }
  }

  // For the tests: how many lines are waiting or out.
  function pending() {
    return { queued: queue.es.length + queue.en.length, inflight: Object.keys(inflight.es).length + Object.keys(inflight.en).length };
  }

  return { KEY: KEY, targetFor: targetFor, readStore: readStore, prefetchLines: prefetchLines,
    start: start, apply: apply, prefetch: prefetch, forget: forget, pending: pending };
})();
if (typeof module !== 'undefined') module.exports = SnowEsTyped;
if (typeof window !== 'undefined') window.SnowEsTyped = SnowEsTyped;
