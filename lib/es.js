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
    // --- the shell (index.html) and lib/api.js
    'Loading…': 'Cargando…',
    'Share': 'Compartir',
    'Sign out': 'Cerrar sesión',
    "Backend out of date. Tell Matt: the app and the server don't match.":
      'El servidor está desactualizado. Dile a Matt: la app y el servidor no coinciden.',
    "Couldn't reach the server. Not saved, try again.": 'No se pudo conectar con el servidor. No se guardó, inténtalo de nuevo.',
    "Couldn't reach the server. Try again.": 'No se pudo conectar con el servidor. Intenta de nuevo.',
    "Couldn't reach the server": 'No se pudo conectar con el servidor',
    'The server sent something unreadable. Try again.': 'El servidor envió algo ilegible. Intenta de nuevo.',
    'Unexpected reply from the server.': 'Respuesta inesperada del servidor.',
    'Too many wrong PINs. Wait': 'Demasiados PIN incorrectos. Espera',
    'Wrong PIN.': 'PIN incorrecto.',
    'PIN is 4 digits.': 'El PIN tiene 4 dígitos.',
    '(waiting for approval)': '(esperando aprobación)',
    'This goes to Matt in Titan Inventory. Once he approves it, sign in with your name and this PIN.': 'Esto le llega a Matt en Titan Inventory. Cuando lo apruebe, inicia sesión con tu nombre y este PIN.',
    'Your access is still waiting for Matt to approve it.': 'Tu acceso todavía está esperando que Matt lo apruebe.',
    'Your access is not approved.': 'Tu acceso no está aprobado.',
    'You already have access. Sign in with your name.': 'Ya tienes acceso. Inicia sesión con tu nombre.',
    'You already asked. Matt still has to approve it.': 'Ya lo pediste. Matt todavía tiene que aprobarlo.',
    'That request is gone. Pull the list again.': 'Esa solicitud ya no existe. Vuelve a cargar la lista.',
    'Try again': 'Intentar de nuevo',
    'try again': 'inténtalo de nuevo',
    'no signal': 'sin señal',
    // --- sign in and access (lib/app.js showSignIn, showNotOnRoster, showPending, request access)
    'Sign in': 'Iniciar sesión',
    'Same name and PIN as Titan Inventory.': 'El mismo nombre y PIN que en Titan Inventory.',
    'Your name': 'Tu nombre',
    'Loading names…': 'Cargando nombres…',
    'Choose your name.': 'Elige tu nombre.',
    'Choose your name': 'Elige tu nombre',
    "Couldn't load names": 'No se pudieron cargar los nombres',
    'First time: Choose a 4-digit PIN': 'Primera vez: elige un PIN de 4 dígitos',
    'Choose a 4-digit PIN': 'Elige un PIN de 4 dígitos',
    'Request access': 'Solicitar acceso',
    'Position': 'Puesto',
    'Sidewalk crew': 'Cuadrilla de banquetas',
    'Send request': 'Enviar solicitud',
    'Name is required.': 'El nombre es obligatorio.',
    'Request sent': 'Solicitud enviada',
    'Matt will approve it in Titan Inventory. Then sign in here.': 'Matt la aprobará en Titan Inventory. Después inicia sesión aquí.',
    'Back to sign in': 'Volver a iniciar sesión',
    'Back': 'Atrás',
    'Could not check for a new post:': 'No se pudo buscar un aviso nuevo:',
    // --- the tabs the crew see (Board, Log and Roster are Matt's and stay English)
    'Storm': 'Tormenta',
    'Tonight': 'Esta noche',
    'Routes': 'Rutas',
    'Sites': 'Sitios',
    // --- Routes and Sites lists, the site map page (lib/app.js, lib/mapview.js)
    'Map': 'Mapa',
    'No routes yet.': 'Todavía no hay rutas.',
    'No sites yet.': 'Todavía no hay sitios.',
    'No customer yet': 'Sin cliente todavía',
    'Materials:': 'Materiales:',
    'Aerial photo unavailable. The zones below are still right.': 'Foto aérea no disponible. Las zonas de abajo siguen siendo correctas.',
    "The map couldn't load on this phone. Use the site notes.": 'El mapa no se pudo cargar en este teléfono. Usa las notas del sitio.',
    'Map not drawn yet': 'Mapa aún no dibujado',
    // map taps (10/19/26): a tap that reaches two zones asks which (lib/mapview.js showPick)
    'Which zone?': '¿Qué zona?',
    // outlines on demand (10/9/26): a site map whose outlines this phone has not kept yet
    'Loading map…': 'Cargando mapa…',
    "This map hasn't been opened on this phone yet. It needs signal the first time.": 'Este mapa todavía no se ha abierto en este teléfono. La primera vez necesita señal.',
    "Matt hasn't drawn this site's zones. Use the site notes for now.": 'Matt todavía no ha dibujado las zonas de este sitio. Usa las notas del sitio por ahora.',
    'Sidewalk': 'Banqueta',
    'Hand work': 'Trabajo a mano',
    'Heated: check only, no melt': 'Calefaccionado: solo revisar, sin derretidor',
    'Snow storage': 'Depósito de nieve',
    'Do not touch': 'No tocar',
    'Priority: do first': 'Prioridad: hacer primero',
    'Priority:': 'Prioridad:',
    'Photo: City 2024': 'Foto: Ciudad 2024',
    'Photo: Esri': 'Foto: Esri',
    // --- Tonight for the crew (lib/boardui.js renderTonight)
    'Tonight:': 'Esta noche:',
    "You're not on a route this shift": 'No estás en una ruta este turno',
    "Here is everyone's.": 'Aquí está la de todos.',
    'Your route': 'Tu ruta',
    'Not posted yet for this shift': 'Todavía no publicado para este turno',
    "Matt hasn't posted the crews yet. Check back, or call your lead.": 'Matt todavía no ha publicado las cuadrillas. Vuelve a revisar o llama a tu líder.',
    'Nobody yet': 'Nadie todavía',
    'Refresh': 'Actualizar',
    'Your card': 'Tu tarjeta',
    'LEAD': 'LÍDER',
    'Lead': 'Líder',
    'posted': 'publicado',
    // --- the Storm tab (lib/shiftlogui.js): states, the head, walks, problems, the site card
    'Cleared': 'Despejado',
    'Treated': 'Tratado',
    'Problem': 'Problema',
    'Problem:': 'Problema:',
    'Problems': 'Problemas',
    'Checked': 'Revisado',
    'Not done': 'Pendiente',
    'Done': 'Listo',
    'Touched': 'Tocado',
    'Whole site': 'Todo el sitio',
    'Checking for a storm…': 'Buscando una tormenta…',
    "Can't reach the server. Trying again.": 'No se puede conectar con el servidor. Intentando de nuevo.',
    'Shifts worked': 'Turnos trabajados',
    'Storm open': 'Tormenta abierta',
    'Snowing': 'Nevando',
    'Snow stopped': 'Nieve detenida',
    'No storm open': 'No hay tormenta abierta',
    'Not saved: try again': 'No se guardó: inténtalo de nuevo',
    'Not saved: no signal': 'No se guardó: sin señal',
    'Not saved:': 'No se guardó:',
    'Not saved.': 'No se guardó.',
    'Retry': 'Reintentar',
    'Undo': 'Deshacer',
    "It's still snowing: treated anyway": 'Sigue nevando: tratado de todos modos',
    'What is the problem?': '¿Cuál es el problema?',
    'Save': 'Guardar',
    'Saved': 'Guardado',
    'Cancel': 'Cancelar',
    'Close': 'Cerrar',
    'Pass': 'Pasada',
    'pass': 'pasada',
    'Clean again': 'Limpiar de nuevo',
    'Yes, clean again': 'Sí, limpiar de nuevo',
    'Site card': 'Tarjeta del sitio',
    'Site card saved': 'Tarjeta del sitio guardada',
    'Site card for': 'Tarjeta del sitio para',
    'No sites on this route.': 'No hay sitios en esta ruta.',
    'Snow map': 'Mapa de nieve',
    'Hide map': 'Ocultar mapa',
    'Tap a dot.': 'Toca un punto.',
    'No forecast': 'Sin pronóstico',
    'Forecast ~': 'Pronóstico ~',
    'Measured': 'Medido',
    'No reading yet': 'Sin lectura todavía',
    'Depth:': 'Profundidad:',
    'Not posted': 'No publicado',
    'Last tap': 'Último toque',
    'No taps yet': 'Sin toques todavía',
    'Night shift': 'Turno de noche',
    'Day shift': 'Turno de día',
    "You're not on tonight's posted Board.": 'No estás en el tablero publicado de esta noche.',
    'You can see the routes, but not mark walks. If Matt just added you, ask him to Post again.': 'Puedes ver las rutas, pero no marcar recorridos. Si Matt te acaba de agregar, pídele que vuelva a publicar.',
    'Ask your lead. To help out on another route, open the other routes below.': 'Pregunta a tu líder. Para ayudar en otra ruta, abre las otras rutas abajo.',
    'Hide other routes': 'Ocultar otras rutas',
    'Other routes': 'Otras rutas',
    'Still saving the last card… try again in a moment': 'Todavía se está guardando la última tarjeta… inténtalo en un momento',
    'Snow depth (in)': 'Profundidad de nieve (pulg)',
    'Materials used': 'Materiales usados',
    'Needed:': 'Se necesita:',
    'Equipment (minutes)': 'Equipo (minutos)',
    'Blower': 'Sopladora',
    'minutes': 'minutos',
    'Notes': 'Notas',
    'Depth must be a number, zero or more': 'La profundidad debe ser un número, cero o más',
    'Add minutes for': 'Agrega minutos para',
    'Minutes must be a whole number, zero or more': 'Los minutos deben ser un número entero, cero o más',
    // --- the crew's own roster card (lib/rosterui.js) and the trait words it shows (lib/app.js)
    'Hi': 'Hola',
    "You're signed in, but not on the snow crew yet. Fill out your card and Matt will add you.": 'Ya iniciaste sesión, pero todavía no estás en la cuadrilla de nieve. Llena tu tarjeta y Matt te agregará.',
    'Fill out your card': 'Llenar tu tarjeta',
    'Your card is in. Matt will add you to the crew.': 'Tu tarjeta está lista. Matt te agregará a la cuadrilla.',
    'Edit your card': 'Editar tu tarjeta',
    'Check again': 'Revisar de nuevo',
    'Your name comes from your Titan Inventory sign-in. The rest is yours to fill in.': 'Tu nombre viene de tu inicio de sesión en Titan Inventory. El resto lo llenas tú.',
    'Picture on file': 'Foto registrada',
    'No picture yet': 'Sin foto todavía',
    'Take a picture': 'Tomar una foto',
    'Choose a photo': 'Elegir una foto',
    'Picture ready. Save to keep it.': 'Foto lista. Guarda para conservarla.',
    "That file isn't a picture this phone can read.": 'Ese archivo no es una foto que este teléfono pueda leer.',
    'Phone': 'Teléfono',
    'What can you run?': '¿Qué máquinas puedes operar?',
    'Can run': 'Puede operar',
    'Seasons with Titan': 'Temporadas con Titan',
    'Seasons': 'Temporadas',
    'Cold-weather gear': 'Equipo para el frío',
    'Gear': 'Equipo',
    'I have my own': 'Tengo el mío',
    'I need it issued': 'Necesito que me lo entreguen',
    'needs issued': 'se necesita entregar',
    'not set': 'sin definir',
    'none': 'ninguno',
    'own': 'propio',
    'yes': 'sí',
    'Where do you live?': '¿Dónde vives?',
    'Only Matt sees where you live.': 'Solo Matt ve dónde vives.',
    'Lives in': 'Vive en',
    'Valley': 'El Valle',
    'Emergency contact: name': 'Contacto de emergencia: nombre',
    'Emergency contact: phone': 'Contacto de emergencia: teléfono',
    'Only Matt sees your emergency contact.': 'Solo Matt ve tu contacto de emergencia.',
    'Emergency contact': 'Contacto de emergencia',
    'Can you drive a truck?': '¿Puedes manejar una camioneta?',
    'Do you have valid ID?': '¿Tienes identificación vigente?',
    'Can we call you out at 3 AM?': '¿Te podemos llamar a las 3 AM?',
    'Can you work a full shift out in deep cold?': '¿Puedes trabajar un turno completo con frío intenso?',
    'Can drive': 'Puede manejar',
    'Valid ID': 'ID vigente',
    'Cold-rated': 'Apto para frío',
    'On call': 'Disponible',
    'Reliable at 3 AM': 'Confiable a las 3 AM',
  };

  // Applied after the dictionary pass, in order, for the phrases whose word order
  // changes around a number or a name. The dictionary must not hold a bare word
  // these patterns begin with ("Snow", "Curbs"), or the pass would eat the front
  // of the phrase before the rule sees it; "Pass" and "Clean again" ARE rows, so
  // the clean-again line is matched in its half-translated form.
  var ES_RULES = [
    [/^Snow until (.+)$/, 'Nieve hasta las $1'],
    // the site card's times line: exactly "Start" then "· Finish" as text nodes (never a bare 'Start' row:
    // it would turn a lead's "Start storm" into "Inicio storm")
    [/^Start$/, 'Inicio'],
    [/^· Finish$/, '· Fin'],
    // after the 'Wrong PIN.' row
    [/^PIN incorrecto\. (\d+) tries left\.$/, 'PIN incorrecto. Quedan $1 intentos.'],
    // after the 'Add minutes for' row
    [/, or untick it$/, ', o desmárcala'],
    // Tonight's head, after the 'posted' row; the shift label comes from lib/time.js shiftLabel
    [/^Night of (\d+\/\d+), publicado (.+)$/, 'Noche del $1, publicado $2'],
    [/^Day of (\d+\/\d+), publicado (.+)$/, 'Día del $1, publicado $2'],
    // Shifts worked: the text node after the name's own span
    [/^— (\d+) nights? · (\d+) days?$/, function (m, n, d) {
      return '— ' + n + (Number(n) === 1 ? ' noche' : ' noches') + ' · ' + d + (Number(d) === 1 ? ' día' : ' días');
    }],
    [/^Snow from (.+)$/, 'Nieve desde las $1'],
    [/^Snow for the next (\d+) h\+$/, 'Nieve durante las próximas $1 h o más'],
    [/^No snow in the next (\d+) h$/, 'Sin nieve en las próximas $1 h'],
    // lib/shiftlog.js curbItems(): 'Curbs' or 'Curbs <g> of <k>', then ' (about <feet with commas> ft)'
    [/^Curbs(?: (\d+) of (\d+))? \(about ([\d,]+) ft\)$/, function (m, g, k, ft) {
      return 'Bordillos' + (g ? ' ' + g + ' de ' + k : '') + ' (unos ' + ft + ' ft)';
    }],
    // lib/shiftlogui.js: 'Pass <n> · Clean again <time> by <name>' (the name is a person's: kept)
    [/^Pasada (\d+) · Limpiar de nuevo (.+?) by (.+)$/, 'Pasada $1 · Limpiar de nuevo $2 por $3'],
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
    var p = node.parentNode;
    if (p && p.closest && p.closest('[data-no-es]')) return; // set later or edited in place: still a person's words
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
    if (el.closest && el.closest('[data-no-es]')) return;
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
