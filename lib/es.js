// Sidewalk in Spanish (Matt, 10/9/26: eighteen of the crew stay the winter).
// The SCREEN is translated, never the code: a dictionary of the English the
// app renders, laid over the page's text nodes and a few attributes, and an
// observer that translates every later change as it lands. Lifted from
// Groundwork (9/23/26), which has run this way across every screen since.
// Display only: anything a person typed (site and zone names, notes, people's
// names) sits under data-no-es and is never touched; the server never sees a
// Spanish word. Spec: docs/superpowers/specs/2026-10-09-spanish-design.md
var SnowEs = (function () {
  'use strict';
  var KEY = 'snow-lang';           // this phone's choice. Named once, never renamed.
  var FALLBACK_KEY = 'wolf-lang';  // Groundwork's, same origin, same crew: read once when KEY is unset.
  var lang = 'en';

  // English as the code renders it -> Spanish. tú, never usted. Keys are matched
  // whole (word-bounded), longest first, so a short row can never bite into a
  // longer phrase. A phrase built with a number or a name goes to ES_RULES.
  var ES = {
    // --- the shell and sign-in
    'Sign in': 'Iniciar sesión',
    'Back': 'Atrás',
    "Backend out of date. Tell Matt: the app and the server don't match.":
      'El servidor está desactualizado. Dile a Matt: la app y el servidor no coinciden.',
    // --- Tonight
    'Tonight:': 'Esta noche:',
    // --- the Storm tab
    'Not saved: try again': 'No se guardó: inténtalo de nuevo',
    'try again': 'inténtalo de nuevo',
  };

  // Applied after the dictionary pass, in order. The dictionary must not hold a
  // bare word these patterns begin with ("Snow", "Curbs"), or the pass would
  // eat the front of the phrase before the rule sees it.
  var ES_RULES = [
    [/^Snow until (.+)$/, 'Nieve hasta las $1'],
    [/^No snow in the next (\d+) h$/, 'Sin nieve en las próximas $1 h'],
    // lib/shiftlog.js curbItems(): 'Curbs' or 'Curbs <g> of <k>', then ' (about <feet with commas> ft)'
    [/^Curbs(?: (\d+) of (\d+))? \(about ([\d,]+) ft\)$/, function (m, g, k, ft) {
      return 'Bordillos' + (g ? ' ' + g + ' de ' + k : '') + ' (unos ' + ft + ' ft)';
    }],
  ];

  var ES_KEYS = Object.keys(ES).sort(function (a, b) { return b.length - a.length; });
  function esc_re(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // One alternation for every key: a single pass per text node keeps a phone
  // from stalling when the language flips, and one swap can never feed the next.
  // A key that starts or ends on a word character gets a \b on that side: "Back"
  // must not turn "Backend" into "Atrásend".
  var ES_RE = null;
  function esRules() {
    if (ES_RE) return ES_RE;
    ES_RE = new RegExp(ES_KEYS.map(function (k) {
      var pre = /^[A-Za-z0-9]/.test(k) ? '\\b' : '';
      var post = /[A-Za-z0-9]$/.test(k) ? '\\b' : '';
      return pre + esc_re(k) + post;
    }).join('|'), 'g');
    return ES_RE;
  }

  // A string in, its Spanish out. Inner whitespace is collapsed for the match
  // (markup wraps lines; the screen shows them collapsed); one leading and one
  // trailing space are kept, so "Tonight: " before a bold name stays spaced.
  function translateString(v) {
    var s = String(v).replace(/\s+/g, ' ');
    var lead = /^\s/.test(v) ? ' ' : '', trail = /\s$/.test(v) ? ' ' : '';
    s = s.trim();
    if (!s) return v;
    var out = s.replace(esRules(), function (m) { return ES[m]; });
    ES_RULES.forEach(function (r) { out = out.replace(r[0], r[1]); });
    return out === s ? v : lead + out + trail;
  }

  // What each translated node said in English, so EN comes back without a re-render.
  var ES_ORIG = typeof WeakMap === 'function' ? new WeakMap() : null;
  var ES_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var ES_SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };

  function translateText(node) {
    var v = node.nodeValue;
    if (!v || !v.trim()) return;
    var rec = ES_ORIG && ES_ORIG.get(node);
    if (rec && v === rec.es) return; // already ours
    var es = translateString(v);
    if (es === v) return;
    if (ES_ORIG) ES_ORIG.set(node, { en: v, es: es });
    node.nodeValue = es;
  }

  function attrKey(a) { return 'esOrig' + a.replace(/-./g, function (m) { return m[1].toUpperCase(); }); }

  function translateAttrs(el) {
    if (!el.getAttribute) return;
    ES_ATTRS.forEach(function (a) {
      var v = el.getAttribute(a);
      if (!v) return;
      var key = attrKey(a);
      if (el.dataset[key + 'Es'] === v) return;
      var es = translateString(v);
      if (es === v) return;
      el.dataset[key] = v;
      el.dataset[key + 'Es'] = es;
      el.setAttribute(a, es);
    });
  }

  function translateNode(root) {
    if (lang !== 'es' || !root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1 || ES_SKIP[root.nodeName]) return;
    if (root.closest && root.closest('[data-no-es]')) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (p && ES_SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (p && p.closest && p.closest('[data-no-es]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(translateText);
    translateAttrs(root);
    Array.prototype.forEach.call(root.querySelectorAll('[' + ES_ATTRS.join('],[') + ']'), translateAttrs);
  }

  // Back to English without a reload: every node we changed gets its English back.
  function restoreEnglish() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = walker.nextNode())) {
      var rec = ES_ORIG && ES_ORIG.get(n);
      if (rec && n.nodeValue === rec.es) n.nodeValue = rec.en;
    }
    Array.prototype.forEach.call(document.querySelectorAll('*'), function (el) {
      ES_ATTRS.forEach(function (a) {
        var key = attrKey(a);
        if (el.dataset && el.dataset[key] !== undefined && el.getAttribute(a) === el.dataset[key + 'Es']) {
          el.setAttribute(a, el.dataset[key]);
        }
      });
    });
  }

  // Every change to the screen, translated as it lands: a toast, a rebuilt tab,
  // a walk row. Paused while it writes, so its own changes never call it back.
  var esObserver = null;
  function observeBody() {
    esObserver.observe(document.body, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ES_ATTRS });
  }
  function watchForSpanish() {
    if (esObserver || typeof MutationObserver !== 'function') return;
    esObserver = new MutationObserver(function (list) {
      if (lang !== 'es') return;
      esObserver.disconnect();
      list.forEach(function (m) {
        if (m.type === 'characterData') translateText(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
        else Array.prototype.forEach.call(m.addedNodes, translateNode);
      });
      observeBody();
    });
    observeBody();
  }

  function readKey(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function isLang(v) { return v === 'en' || v === 'es'; }

  // This phone's choice; with none yet, Groundwork's, written here once.
  // Anything else reads as English.
  function readLangKey() {
    var v = readKey(KEY);
    if (isLang(v)) return v;
    var w = readKey(FALLBACK_KEY);
    if (isLang(w)) { writeKey(KEY, w); return w; }
    return 'en';
  }

  function paintLangButtons(wrapId) {
    var wrap = document.getElementById(wrapId || 'langWrap');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.lang-btn'), function (b) {
      var on = b.dataset.lang === lang;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  var wrapIdUsed = 'langWrap';
  // No reload, no re-render: the body is translated in place, or put back.
  function setLang(next) {
    lang = next === 'es' ? 'es' : 'en';
    writeKey(KEY, lang);
    document.documentElement.lang = lang;
    paintLangButtons(wrapIdUsed);
    if (lang === 'es') translateNode(document.body); else restoreEnglish();
  }

  function wireLangButtons(wrapId) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.lang-btn'), function (b) {
      b.addEventListener('click', function () { setLang(b.dataset.lang); });
    });
  }

  // Once, before the first render: read the key, wire and paint the buttons,
  // translate what is on screen if ES, and watch everything that comes after.
  function start(wrapId) {
    wrapIdUsed = wrapId || 'langWrap';
    lang = readLangKey();
    document.documentElement.lang = lang;
    wireLangButtons(wrapIdUsed);
    paintLangButtons(wrapIdUsed);
    if (lang === 'es') translateNode(document.body);
    watchForSpanish();
  }

  return { ES: ES, ES_RULES: ES_RULES, translateString: translateString, translateNode: translateNode,
    restoreEnglish: restoreEnglish, lang: function () { return lang; }, setLang: setLang,
    readLangKey: readLangKey, start: start };
})();
if (typeof module !== 'undefined') module.exports = SnowEs;
if (typeof window !== 'undefined') window.SnowEs = SnowEs;
