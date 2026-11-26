// The Spanish dictionary against the code, both ways (Spanish everywhere, Matt 11/25/26: "Full blown everything when
// you click on it"). Ported from Plow Command's test/es-coverage.test.js (its tokenizer and splitter unchanged).
//
//   1. Every English string the app renders reads Spanish on a phone set to ES: it is a row (a key in ES), matches an
//      ES_RULES pattern, is a piece of a phrase the code builds (BUILT below, with a worked example the engine must
//      translate), or is made only of rows and punctuation. That holds for EVERY screen: the crew's, the leads', the
//      dispatcher's and Matt's (his 10/9/26 "crew screens only" is replaced). The server's refusal words count too: the
//      phone shows them after "Not saved:" (read from SNOW_SERVER_REPO, default ../snow-app-script; a missing Code.js
//      FAILS the file, it never skips).
//   2. Every row is still rendered. A key no lib/*.js string or index.html text holds any more is a dead row.
//
// Two lists leave strings out, each entry with its reason:
//   LEAVES_THE_APP: the words that only reach a Drive PDF or the Copy for BT text (English always, by the spec). Listed BY
//     FUNCTION, because the same files also feed screens (the Storm tab's handoff card shows lib/handoff.js heading,
//     siteParts and leftoverParts).
//   NOT_YET: the screens still owed their rows while the build is under way. Each area task deletes its entries; the last
//     one asserts NOT_YET is empty. An entry that hides nothing fails, so the list can only shrink honestly.
// Spec: claudes room/Snow/Sidewalk specs + ledgers/2026-11-25-spanish-everywhere-design.md
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Es = require('../lib/es.js');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');

// ---------------------------------------------------------------- the tokenizer
// Enough JavaScript for these files: // and /* */ comments, '...' and "..." strings, template literals (their ${}
// parts skipped), regex literals (told from division by the token before the slash), identifiers, numbers, punctuation.
// It also remembers, for each string, the named functions around it and whether it sits inside console.*(...) or
// new Error(...). It reports a bracket imbalance at the end of a file, which is how a wrong regex-or-division call
// would show itself.
function tokenize(src, label) {
  const toks = [];
  let i = 0, line = 1, parenDepth = 0, pending = null, lastIdent = '', lastPunct = '';
  const n = src.length;
  const braces = [];            // one entry per open {: the name of the function it is the body of, or null
  const calls = [];             // open ( that belong to console.x( or new Error(: their paren depth
  let callArm = null;           // set while reading `console . x` or `new Error`, until its ( arrives
  const regexOk = () => {
    const t = toks[toks.length - 1];
    if (!t) return true;
    if (t.type === 'str' || t.type === 'tpl' || t.type === 'num' || t.type === 're') return false;
    if (t.type === 'id') return /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(t.value);
    return !/^[)\]}]$/.test(t.value);
  };
  const fnNames = () => braces.filter(Boolean);
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      line += (src.slice(i, e + 2).match(/\n/g) || []).length; i = e + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const lit = src.slice(i, j + 1);
      let value;
      try { value = (new Function('return ' + lit))(); } catch (e) { throw new Error(label + ':' + line + ' the tokenizer lost its place at ' + lit.slice(0, 50)); }
      toks.push({ type: 'str', value, line, fns: fnNames(), quiet: calls.length > 0 });
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, depth = 0, raw = '';
      while (j < n && !(src[j] === '`' && depth === 0)) {
        if (src[j] === '\\') { raw += src[j] + src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (src[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (depth === 0) raw += src[j];
        j++;
      }
      toks.push({ type: 'tpl', value: raw, line, fns: fnNames(), quiet: calls.length > 0 });
      i = j + 1; continue;
    }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && (src[j] !== '/' || cls)) {
        if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        j++;
      }
      j++; while (/[a-z]/.test(src[j] || '')) j++;
      toks.push({ type: 're', value: src.slice(i, j), line }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const w = src.slice(i, j), prev = toks[toks.length - 1], prev2 = toks[toks.length - 2];
      if (w === 'function') {
        const m = /^\s*([A-Za-z_$][\w$]*)/.exec(src.slice(j, j + 80));
        pending = { name: m ? m[1] : (lastIdent && (lastPunct === ':' || lastPunct === '=') ? lastIdent : '(anon)'), depth: undefined, closed: false };
      }
      if (w === 'Error' && prev && prev.type === 'id' && prev.value === 'new') callArm = true;
      if (prev && prev.type === 'p' && prev.value === '.' && prev2 && prev2.type === 'id' && prev2.value === 'console') callArm = true;
      toks.push({ type: 'id', value: w, line }); lastIdent = w; i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ type: 'num', value: src.slice(i, j), line }); i = j; continue; }
    if (c === '(') {
      if (pending && pending.depth === undefined) pending.depth = parenDepth;
      if (callArm) { calls.push(parenDepth); callArm = null; }
      parenDepth++;
    } else if (c === ')') {
      parenDepth--;
      if (pending && pending.depth === parenDepth) pending.closed = true;
      if (calls.length && calls[calls.length - 1] === parenDepth) calls.pop();
    } else if (c === '{') {
      if (pending && pending.closed) { braces.push(pending.name); pending = null; } else braces.push(null);
    } else if (c === '}') braces.pop();
    if (c !== '.' && c !== '(') callArm = null; // `console.x` / `new Error` must be followed by its ( with nothing between
    lastPunct = c;
    toks.push({ type: 'p', value: c, line }); i++;
  }
  if (parenDepth !== 0 || braces.length !== 0) throw new Error(label + ': brackets do not balance after tokenizing (paren ' + parenDepth + ', brace ' + braces.length + '): a regex literal was read as division, or the other way round');
  return toks;
}

// The strings of a file, 'a' + 'b' joined into one, each with its line, the named functions around it, and
// quiet = inside console.*( or new Error(.
function stringsOf(src, label) {
  const toks = tokenize(src, label), out = [];
  const isStr = (t) => t && (t.type === 'str' || t.type === 'tpl');
  const plus = (t) => t && t.type === 'p' && t.value === '+';
  for (let i = 0; i < toks.length; i++) {
    if (!isStr(toks[i])) continue;
    if (plus(toks[i - 1]) && isStr(toks[i - 2])) continue; // the middle of a chain already taken
    let v = toks[i].value, j = i;
    while (plus(toks[j + 1]) && isStr(toks[j + 2])) { v += toks[j + 2].value; j += 2; }
    out.push({ value: v, line: toks[i].line, fns: toks[i].fns, quiet: toks[i].quiet });
  }
  return out;
}

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
const squash = (s) => decode(s).replace(/\s+/g, ' ').trim();

// The text a string will put on the screen, piece by piece: the text between its tags, and the four translated
// attributes. A piece that opens or closes mid-tag (the string is one slice of a longer concatenation) is trimmed
// to its text. Text right after a tag that carries data-no-es, up to the next tag, is a person's and is dropped.
function textPieces(v) {
  const out = [];
  const attrRe = /\b(?:placeholder|aria-label|title|alt)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(v))) out.push(m[1]);
  // The end of a tag a variable cut off leads the string: `">`, ` disabled>`, `class="x">`, or the bare `>` itself.
  const LEAD = /^(?:(?:"|\s|[\w-]+=)[^<>]*)?>/;
  if (!/<[A-Za-z\/!]/.test(v) && !LEAD.test(v)) {
    // no tag in it: plain text, or the tail of an attribute value that a variable cut off (' minutes" placeholder="min"')
    const tail = /^([^"<>]*)"\s*(?:[\w-]+=|\/?>|$)/.exec(v);
    return out.concat([tail ? tail[1] : v]).map(squash).filter(Boolean);
  }
  // mark every tag, remembering which ones carry data-no-es
  let t = v.replace(LEAD, (s) =>'\u0001' + (/data-no-es/.test(s) ? 'N' : 'Y'));
  t = t.replace(/<[^>]*>?/g, (s) => '\u0001' + (/data-no-es/.test(s) ? 'N' : 'Y'));
  const parts = t.split('\u0001');
  parts.forEach((p, k) => {
    if (k === 0) { if (p) out.push(p); return; }
    const flag = p[0]; p = p.slice(1);
    if (flag === 'N') return;
    if (p) out.push(p);
  });
  return out.map(squash).filter(Boolean);
}

const wordsIn = (p) => p.split(' ').filter((w) => /[A-Za-z]/.test(w));
// Prose, not code: no brackets, equals, angle marks, backslashes, pipes, underscores; no CSS "prop:value".
const isProse = (p) => !/[{}\[\]<>=\\|_$@]/.test(p) && !/\b[a-z-]{3,}:[a-z0-9#(]/.test(p) && !/^[;:.#]/.test(p) && p !== 'use strict';

// ---------------------------------------------------------------- what is read
function libFiles() { return fs.readdirSync(LIB).filter((f) => f.endsWith('.js') && f !== 'es.js').sort(); }
const SOURCES = {};
libFiles().forEach((f) => { SOURCES['lib/' + f] = stringsOf(fs.readFileSync(path.join(LIB, f), 'utf8'), 'lib/' + f); });

// index.html: the markup's own text and its translated attributes (its scripts are external files).
function indexPieces() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<title>[\s\S]*?<\/title>/, '');
  return textPieces(html);
}

// Every candidate: { file, line, fns, text } for the pieces of two or more words that read as prose.
function candidates() {
  const out = [];
  Object.keys(SOURCES).forEach((file) => {
    SOURCES[file].forEach((s) => {
      if (s.quiet) return;
      textPieces(s.value).forEach((p) => { if (wordsIn(p).length >= 2 && isProse(p)) out.push({ file, line: s.line, fns: s.fns.filter((x) => x !== '(anon)'), text: p }); });
    });
  });
  indexPieces().forEach((p) => { if (wordsIn(p).length >= 2 && isProse(p)) out.push({ file: 'index.html', line: 0, fns: [], text: p }); });
  return out;
}

// The one-word text nodes (Save, Cancel, Undo, Plowed...): a capitalised piece of a single word. Two-word candidates are the
// sentences; these are the buttons, labels and states, which the crew read just as much and which a missing row leaves English.
function oneWordNodes() {
  const out = [], take = (file, line, fns, p) => {
    if (wordsIn(p).length === 1 && /^[^A-Za-z]*[A-Z]/.test(p) && isProse(p)) out.push({ file, line, fns: fns.filter((x) => x !== '(anon)'), text: p });
  };
  Object.keys(SOURCES).forEach((file) => SOURCES[file].forEach((s) => { if (!s.quiet) textPieces(s.value).forEach((p) => take(file, s.line, s.fns, p)); }));
  indexPieces().forEach((p) => take('index.html', 0, [], p));
  return out;
}

// ---------------------------------------------------------------- the server's refusal words
// The phone shows a refused save's reason after "Not saved:", so the server's own words are screen words. They are read
// from the snow-app-script checkout: every *.js the phone does not carry itself (the shared files are already read above
// as lib/*.js), seed files aside. A missing Code.js fails the whole file: it never quietly skips.
const SERVER = process.env.SNOW_SERVER_REPO || path.join(ROOT, '..', 'snow-app-script');
if (!fs.existsSync(path.join(SERVER, 'Code.js'))) {
  throw new Error('es-coverage: no Code.js in ' + SERVER + ': set SNOW_SERVER_REPO to the snow-app-script checkout');
}
const SERVER_SKIP = { 'seed-data.js': 'customer seed data, never shown', 'seed.js': 'the one-off seeding job' };
function serverFiles() {
  const phone = new Set(fs.readdirSync(LIB));
  return fs.readdirSync(SERVER).filter((f) => f.endsWith('.js') && !phone.has(f) && !SERVER_SKIP[f]).sort();
}
// The literal pieces of every refusal: invalid_('...'), reason: '...', errs.push('...'). A variable that cuts a message
// leaves its literal pieces standing alone ('Your line is ' + LINE_MAX + ' characters at most' -> 'Your line is',
// 'characters at most'). EVERY prose string of a server-only file counts: refusals come as invalid_('...'), as
// reason: '...', and as validators' returned arrays (roster.js lineErrs), so no call shape is trusted. The few that never
// reach a phone (a Drive folder's name, a log line) are named in NOT_SHOWN with the reason.
const SERVER_SOURCES = {};
serverFiles().forEach((f) => { SERVER_SOURCES['server/' + f] = stringsOf(fs.readFileSync(path.join(SERVER, f), 'utf8'), 'server/' + f); });
const NOT_SHOWN = {
  'px Arial, sans-serif': 'a canvas font (lib/mapprint.js drawNumbers, drawNorth), never shown',
  'Esri, HERE, Garmin': 'the snow map\'s photo credit: company names, shown as they are',
  'snowdot nofc': 'two CSS class names (lib/snowmap.js)',
  'small primary': 'two CSS class names (lib/rosterui.js addCrewButton)',
  'Esri, Maxar, Earthstar Geographics': 'the site map\'s photo credit: company names, shown as they are',
  'Municipality of Anchorage': 'the site map\'s photo credit: a proper noun',
  'Shovel Command': 'the app\'s name (index.html\'s header, lib/share.js\'s share title): a name is never translated',
  'rl-write rl-amount': 'two CSS class names (lib/routelist.js)',
  'px system-ui, -apple-system, sans-serif': 'a canvas font (lib/crewcardsui.js)',
  '700 44px system-ui, sans-serif': 'a canvas font (lib/crewcardsui.js)',
  '400 24px system-ui, sans-serif': 'a canvas font (lib/crewcardsui.js)',
  '400 22px system-ui, sans-serif': 'a canvas font (lib/crewcardsui.js)',
  'Shovel Command ·': 'the app\'s name on the shared crew-card picture (canvas); the winter word after it goes through say()',
  'Snow Route Sheets': 'the Drive folder\'s name (Code.js SHEETS_FOLDER)',
  'Crew times': 'the head of a Crew times PDF\'s file name in Drive',
  'Crew times (worked out).pdf': 'a Drive file name',
  'Crew times (could not be worked out).pdf': 'a Drive file name',
};
function serverCandidates() {
  const out = [];
  Object.keys(SERVER_SOURCES).forEach((file) => SERVER_SOURCES[file].forEach((s) => {
    if (s.quiet) return;
    textPieces(s.value).forEach((p) => { if (wordsIn(p).length >= 2 && isProse(p)) out.push({ file, line: s.line, fns: [], text: p }); });
  }));
  return out;
}
const allCandidates = () => candidates().concat(serverCandidates()).filter((c) => !NOT_SHOWN[c.text]);

// ---------------------------------------------------------------- what is left out, and why
// Words that only ever reach something that LEAVES the app: English always, by the spec ("Print sheets and the Drive PDFs
// stay English"; "Copy for BT stays English"). By function: the same files feed screens too. '*' = the whole file.
const LEAVES_THE_APP = {
  // Every string here is a Drive PDF's, or a Print sheets / Print crew times page's (those pages sit under data-no-es:
  // the English record). The screens call only the data builders and clock(), whose AM / PM are ONE_WORD_ENGLISH.
  // Ship 2 (Task 15) takes clockSheetData / clockSheetBody out of here when Print crew times gets its Espanol button.
  'lib/routesheet.js': '*',
  // The handoff PDF and its Print sheets page. NOT heading, siteParts or leftoverParts: the Storm tab's handoff card shows them.
  'lib/handoff.js': ['handoffBody', 'handoffHtml', 'fileName'],
  'lib/btnote.js': '*',    // the Copy for BT text: English always (BuilderTrend)
  'lib/share.js': ['message'], // the text message the Share button sends; its toast and dialog live in lib/app.js
};

// The screens still owed their rows (the area tasks delete their entries; Task 9 asserts this is empty). '*' = the whole file.
const NOT_YET = {
};

// One-word text nodes that are not translated, each with its reason.
const ONE_WORD_ENGLISH = {
  // initialisms, names and letters that read the same in Spanish
  PIN: 'the sign-in label: PIN is the word in Spanish too',
  EN: 'the language buttons (index.html): the codes name the languages',
  ES: 'the language buttons (index.html)',
  AM: 'the clock\'s own suffix, kept in the Spanish lines ("Nieve hasta las 10 AM")',
  PM: 'the clock\'s own suffix',
  Anchorage: 'a place name (the Home area); Valley has a row (El Valle) because it is also a word',
  Bobcat: 'a machine\'s brand name (spec: proper nouns stay)',
  Snowrator: 'a machine\'s brand name',
  Sweepster: 'a machine\'s brand name',
  N: 'the north arrow on a printed map: Norte is N too',
  English: 'the print screen\'s language pair: each language is named in its own language',
  'Español': 'the print screen\'s language pair (already Spanish)',
  Storage: 'lib/totals.js line(): exported, but no screen draws it (walk totals, 11/23/26, left storage off the line)',
  'No-touch': 'lib/totals.js line(): never drawn, as Storage',
  V: 'the Board chip for a Valley worker: Valle is V too',
  // never on a screen
  POST: 'the HTTP method (lib/api.js)',
  'Content-Type': 'an HTTP header name (lib/api.js)',
  Enter: 'a keyboard key name compared in a keydown handler',
  AbortError: 'a DOMException name compared when Share is cancelled',
  NotAllowedError: 'a DOMException name compared when Share is refused',
  NFD: 'the Unicode form name passed to normalize() (lib/grouplist.js)',
  T: 'the ISO date format\'s separator',
  Z: 'the ISO time zone suffix',
  'B-': 'the batch id prefix (newBatchId), never shown',
  C: 'the worker id prefix (forms.js nextWorkerId), never shown',
  Feature: 'GeoJSON type names the map is fed',
  FeatureCollection: 'GeoJSON type name',
  Polygon: 'GeoJSON type name',
  LineString: 'GeoJSON type name',
};

// A phrase BUILT at run time from pieces that carry no row of their own: [an example of the finished line, its Spanish].
const BUILT = {
  // Task 3 (11/25/26): the half-Spanish lines' pieces, each with the line the code builds and the Spanish the rules make of it.
  "couldn't be made on this phone (no signal?). Their zone lists still print.": ["2 maps couldn't be made on this phone (no signal?). Their zone lists still print.",
    '2 mapas no se pudieron hacer en este teléfono (¿sin señal?). Sus listas de zonas sí se imprimen.'],
  'still on the clock. Tap End shift first, or their End has to be typed with Set shift.': ['3 are still on the clock. Tap End shift first, or their End has to be typed with Set shift.',
    '3 personas siguen en turno. Toca Terminar turno primero, o su salida se tiene que escribir con Poner turno.'],
  'with no End shift)': ['10:30 (2 nights with no End shift)', '10:30 (2 noches sin Terminar turno)'],
  'cleared must be yes or no': ['line 3: cleared must be yes or no', 'línea 3: autorizado debe ser sí o no'],
  'Save or Cancel this zone first. It has': ['Save or Cancel this zone first. It has 5 corners that are not saved.', 'Guarda o cancela esta zona primero. Tiene 5 esquinas sin guardar.'],
  'Storm · became a storm': ['Storm · became a storm 2:14 AM by Ben Test', 'Tormenta · se volvió tormenta 2:14 AM por Ben Test'],
  'goes back to not done for pass': ['Every walk at PAC goes back to not done for pass 2. Pass 1 stays on the record.',
    'Cada recorrido en PAC vuelve a Pendiente para la pasada 2. La pasada 1 se queda en el registro.'],
  'Copy for BT first if pass': ["Copy for BT first if pass 1 isn't posted yet.", 'Usa Copiar para BT primero si la pasada 1 todavía no está publicada.'],
  "isn't posted yet.": ["Copy for BT first if pass 1 isn't posted yet.", 'Usa Copiar para BT primero si la pasada 1 todavía no está publicada.'],
  'No forecast for': ['No forecast for 3 sites.', 'Sin pronóstico para 3 sitios.'],
  'Not saved: the map for': ['Not saved: the map for PAC has changed. Mark the walk again.', 'No se guardó: el mapa de PAC cambió. Marca el recorrido de nuevo.'],
  'clearance not set': ['Alex Test: JBER clearance not set', 'Alex Test: autorización de JBER sin definir'],
  'Emergency contact name is': ['Emergency contact name is 40 characters at most', 'El nombre del contacto de emergencia puede tener 40 caracteres como máximo'],
  'Emergency contact phone is': ['Emergency contact phone is 20 characters at most', 'El teléfono del contacto de emergencia puede tener 20 caracteres como máximo'],
  'must be yes, no or not set': ['Can drive must be yes, no or not set', 'Puede manejar debe ser sí, no o sin definir'],
  // Task 4 (11/25/26): the leads' and dispatcher's Storm tab, and the shared builders it shows (time.js, weather.js, totals.js).
  'Handoff from': ['Handoff from Night of 12/4 · 8:00 AM · by Alex Test', 'Entrega de la noche del 12/4 · 8:00 AM · por Alex Test'],
  'Started by': ['Started by Alex Test 2:14 AM', 'Empezado por Alex Test 2:14 AM'],
  'Started': ['Started 1:05 AM', 'Empezado 1:05 AM'],
  'Handoff sheets:': ['Handoff sheets: 1 not saved', 'Hojas de entrega: 1 sin guardar'],
  'not saved': ['Handoff sheets: 1 not saved', 'Hojas de entrega: 1 sin guardar'],
  'Night sheets saved at handoff': ['Night sheets saved at handoff 8:00 AM (4)', 'Hojas de la noche guardadas en la entrega 8:00 AM (4)'],
  'day handoff sheet': ["1 day handoff sheet couldn't be built on this phone.", 'No se pudo armar 1 hoja de entrega del día en este teléfono.'],
  'day handoff sheets': ["2 day handoff sheets couldn't be built on this phone.", 'No se pudieron armar 2 hojas de entrega del día en este teléfono.'],
  "couldn't be built on this phone.": ["2 day handoff sheets couldn't be built on this phone.", 'No se pudieron armar 2 hojas de entrega del día en este teléfono.'],
  "It's still snowing:": ["It's still snowing: treated anyway", 'Sigue nevando: tratado de todos modos'],
  'Every walk at': ['Every walk at PAC goes back to not done for pass 2. Pass 1 stays on the record.', 'Cada recorrido en PAC vuelve a Pendiente para la pasada 2. La pasada 1 se queda en el registro.'],
  'stays on the record.': ['Every walk at PAC goes back to not done for pass 2. Pass 1 stays on the record.', 'Cada recorrido en PAC vuelve a Pendiente para la pasada 2. La pasada 1 se queda en el registro.'],
  'New snow at': ['New snow at PAC', 'Nieve nueva en PAC'],
  'not saved:': ['Times not saved: no signal', 'No se guardaron las horas: sin señal'],
  'Times': ['Times not saved: no signal', 'No se guardaron las horas: sin señal'],
  'walks done': ['3 of 5 walks done', '3 de 5 recorridos terminados'],
  'Curbs:': ['Curbs: 2 left', 'Bordillos: faltan 2'],
  'Show': ['Show 9 walks', 'Ver 9 recorridos'],
  'Undone:': ['Undone: 16 walks. 2 were tapped since and kept.', 'Deshecho: 16 recorridos. 2 fueron marcados después y se dejaron.'],
  'tapped since and kept.': ['Undone: 16 walks. 2 were tapped since and kept.', 'Deshecho: 16 recorridos. 2 fueron marcados después y se dejaron.'],
  'Callouts (': ['Callouts (2)', 'Llamados (2)'],
  'sites on': ['No storm open · 12 sites on 3 routes', 'No hay tormenta abierta · 12 sitios en 3 rutas'],
  'sites checked': ['4 of 9 sites checked', '4 de 9 sitios revisados'],
  'sites done': ['3 of 12 sites done, 1 touched', '3 de 12 sitios listos, 1 tocado'],
  'last tap': ['last tap 2:14 AM', 'último toque 2:14 AM'],
  'routes started': ['1 of 3 routes started', '1 de 3 rutas empezadas'],
  'not mapped yet': ['3 sites not mapped yet', '3 sitios sin mapa todavía'],
  'Forecast snow at every site from now to': ['Forecast snow at every site from now to 9 AM, against its callout depth.', 'Pronóstico de nieve en cada sitio desde ahora hasta las 9 AM, comparado con su profundidad de llamado.'],
  ', against its callout depth.': ['Forecast snow at every site from now to 9 AM, against its callout depth.', 'Pronóstico de nieve en cada sitio desde ahora hasta las 9 AM, comparado con su profundidad de llamado.'],
  'Up to': ['Up to 3" by 9 AM · snow from 2:14 AM', 'Hasta 3" para las 9 AM · nieve desde las 2:14 AM'],
  'snow from': ['Up to 3" by 9 AM · snow from 2:14 AM', 'Hasta 3" para las 9 AM · nieve desde las 2:14 AM'],
  'snow now': ['Up to 0.5" by 9 AM · snow now', 'Hasta 0.5" para las 9 AM · nieve ahora'],
  'No snow expected by': ['No snow expected by 9 AM.', 'No se espera nieve para las 9 AM.'],
  'as of': ['as of 2:14 AM', 'a las 2:14 AM'],
  'Would reach callout depth (': ['Would reach callout depth (2)', 'Llegarían a su profundidad de llamado (2)'],
  '1 site has': ['1 site has no callout depth set.', '1 sitio no tiene profundidad de llamado.'],
  'sites have': ['5 sites have no callout depth set.', '5 sitios no tienen profundidad de llamado.'],
  'no callout depth set.': ['5 sites have no callout depth set.', '5 sitios no tienen profundidad de llamado.'],
  'Left by night (': ['Left by night (3)', 'Lo que dejó la noche (3)'],
  'this site': ['Not saved: the map for this site has changed. Mark the walk again.', 'No se guardó: el mapa de este sitio cambió. Marca el recorrido de nuevo.'],
  'has changed. Mark the walk again.': ['Not saved: the map for PAC has changed. Mark the walk again.', 'No se guardó: el mapa de PAC cambió. Marca el recorrido de nuevo.'],
  'min, saved before machine lines': ['45 min, saved before machine lines', '45 min, guardado antes de las líneas de máquina'],
  'min). Add it here too if they ran it.': ['(45 min). Add it here too if they ran it.', '(45 min). Agrégala aquí también si la operó.'],
  'Night of': ['Night of 12/4', 'Noche del 12/4'],
  'Day of': ['Day of 12/6', 'Día del 12/6'],
  'sq ft': ['Sidewalk 1,200 sq ft', 'Banqueta 1,200 pies²'],
  'Snow for the next': ['Snow for the next 3 h+', 'Nieve durante las próximas 3 h o más'],
  'Snow until': ['Snow until 10 AM', 'Nieve hasta las 10 AM'],
  'Snow from': ['Snow from 2 AM', 'Nieve desde las 2 AM'],
  'No snow in the next': ['No snow in the next 12 h', 'Sin nieve en las próximas 12 h'],
  'Sheets:': ['Sheets: 6 saved', 'Hojas: 6 guardadas'],
  'Clean': ['Clean PAC again?', '¿Limpiar PAC de nuevo?'],
  // Task 6 (11/25/26): the Roster, the worker card, crew stats and crew cards.
  'no picture': ['3 no picture', '3 sin foto'],
  'Current link (#': ['Current link (#12, not approved right now)', 'Enlace actual (#12, no aprobado ahora)'],
  ', not approved right now)': ['Current link (#12, not approved right now)', 'Enlace actual (#12, no aprobado ahora)'],
  'football field': ['about 1 football field', 'un campo de fútbol americano'],
  'football fields': ['about 3 football fields', 'unos 3 campos de fútbol americano'],
  'Winter': ['Winter 2026-27', 'Invierno 2026-27'],
  '· counted at': ['Winter 2026-27 · counted at 2:14 AM', 'Invierno 2026-27 · contado a las 2:14 AM'],
  '(called out': ['5 (called out 1, no-show 0)', '5 (llamado 1, faltas 0)'],
  'Stats ·': ['Stats · Winter 2026-27', 'Estadísticas · Invierno 2026-27'],
  'Waiting for approval (': ['Waiting for approval (1)', 'Esperando aprobación (1)'],
  'They': ['They can sign in now', 'Ya puede iniciar sesión'],
  'Can operate lists': ['Can operate lists blower, sweepster, bobcat, snowrator or shovel', 'Puede operar solo: soplador, sweepster, bobcat, snowrator o pala'],
  // Task 7 (11/25/26): Sites and Routes.
  'ticked, not added yet': ['3 ticked, not added yet', '3 marcados, sin agregar todavía'],
  'the customer button': ['2 hidden by the customer button', '2 ocultos por el botón del cliente'],
  'hidden by': ['2 hidden by search and the customer button', '2 ocultos por la búsqueda y el botón del cliente'],
  'Archived (': ['Archived (4)', 'Archivados (4)'],
  'site is missing': ['line 2: site is missing', 'línea 2: falta el sitio'],
  'dates must be YYYY-MM-DD': ['line 4: dates must be YYYY-MM-DD', 'línea 4: las fechas deben ser AAAA-MM-DD'],
  '(this site)': ['BC5 (this site)', 'BC5 (este sitio)'],
  // Task 8 (11/25/26): the map editor and the Bootprint import.
  'Getting map': ['Getting map 2 of 7 ready…', 'Preparando el mapa 2 de 7…'],
  'corners that are not saved.': ['Save or Cancel this zone first. It has 5 corners that are not saved.', 'Guarda o cancela esta zona primero. Tiene 5 esquinas sin guardar.'],
  'Archived zones (0)': ['Archived zones (0)', 'Zonas archivadas (0)'],
  'Archived zones (': ['Archived zones (2)', 'Zonas archivadas (2)'],
  'snow pile': ['3 walks · 1 snow pile to add', '3 recorridos · 1 montón de nieve por agregar'],
  'km away': ['1.4 km away · 1 walk', 'a 1.4 km · 1 recorrido'],
  'm away': ['120 m away · 3 walks · 2 snow piles', 'a 120 m · 3 recorridos · 2 montones de nieve'],
  'no corners': ['no corners · 0 walks', 'sin esquinas · 0 recorridos'],
  "(the plow crew's)": ["Left out: 2 lots (the plow crew's)", 'Se dejaron fuera: 2 lotes (de la cuadrilla de arado)'],
  'with no width (set it in Bootprint)': ['Left out: 3 runs with no width (set it in Bootprint)', 'Se dejaron fuera: 3 trazos sin ancho (ponlo en Bootprint)'],
  'that turn too sharply (trace as an area)': ['Left out: 1 run that turn too sharply (trace as an area)', 'Se dejaron fuera: 1 trazo con vueltas muy cerradas (trázalo como área)'],
  'unfinished shape': ['Left out: 2 unfinished shapes', 'Se dejaron fuera: 2 figuras sin terminar'],
  'already imported': ['Left out: 1 already imported', 'Se dejaron fuera: 1 ya importado'],
  'Left out:': ['Left out: 1 cut-out', 'Se dejaron fuera: 1 recorte'],
  'to add': ['1 walk to add', '1 recorrido por agregar'],
  'Add': ['Add 4 zones', 'Agregar 4 zonas'],
  'Adding': ['Adding 2 of 4…', 'Agregando 2 de 4…'],
  'from Bootprint. Tap any heated or do-not-touch one to change it.': ['Added 4 zones from Bootprint. Tap any heated or do-not-touch one to change it.', 'Se agregaron 4 zonas de Bootprint. Toca cualquiera con calefacción o de no tocar para cambiarla.'],
  // Task 9 (11/25/26): the shell, sign-in, Share, the shared refusals and the server's built ones.
  'tries left.': ['Wrong PIN. 3 tries left.', 'PIN incorrecto. Quedan 3 intentos.'],
  'Share Shovel Command': ['Share Shovel Command', 'Compartir Shovel Command'],
  'ft back': ['Curbs: clear 4 ft back', 'Bordillos: despejar 4 pies (1.2 m)'],
  'is on': ['Alex Test is on Bobcat BC5 twice', 'Alex Test está en Bobcat BC5 dos veces'],
  'is on two': ['Alex Test is on two Bobcats with no unit: pick the units', 'Alex Test está en dos Bobcats sin unidad: elige las unidades'],
  's with no unit: pick the units': ['Alex Test is on two Bobcats with no unit: pick the units', 'Alex Test está en dos Bobcats sin unidad: elige las unidades'],
  'Already handed off at': ['Already handed off at 8:00 AM', 'Ya se entregó a las 8:00 AM'],
  'That time is not on the': ['That time is not on the night you picked', 'Esa hora no está en el turno de noche que elegiste'],
  'you picked': ['That time is not on the day you picked', 'Esa hora no está en el turno de día que elegiste'],
  'Phone is': ['Phone is 30 characters at most', 'El teléfono puede tener 30 caracteres como máximo'],
  'That sign-in is already on the roster as': ['That sign-in is already on the roster as Alex Test', 'Ese inicio de sesión ya está en la lista como Alex Test'],
  'must list people on the roster': ['keep apart from must list people on the roster', 'mantener separado de debe listar personas de la lista'],
  'A unit number is text,': ['A unit number is text, 20 characters at most', 'Un número de unidad es texto, 20 caracteres como máximo'],
  'A unit list is': ['A unit list is 60 characters at most', 'Una lista de unidades puede tener 60 caracteres como máximo'],
  'Too many corners (': ['Too many corners (412); the most a zone can hold is 400', 'Demasiadas esquinas (412); una zona puede tener como máximo 400'],
  '); the most a zone can hold is': ['Too many corners (412); the most a zone can hold is 400', 'Demasiadas esquinas (412); una zona puede tener como máximo 400'],
  'Your line is': ['Your line is 40 characters at most', 'Tu frase puede tener 40 caracteres como máximo'],
  'characters at most': ['Phone is 30 characters at most', 'El teléfono puede tener 30 caracteres como máximo'],  // Task 5 (11/25/26): the Board, its toasts (names in spans of their own: lib/app.js holdNames) and its warnings.
  'Trucks for': ['Trucks for Night of 12/4', 'Camionetas de Noche del 12/4'],
  'Take': ['Take 3 people off 2 routes?', '¿Quitar a 3 personas de 2 rutas?'],
  'Took': ['Took 3 people off the Board', 'Se quitó a 3 personas del tablero'],
  'the Board': ['Took 3 people off the Board', 'Se quitó a 3 personas del tablero'],
  '1 was left as it is.': ['Put 3 back. 1 was left as it is.', 'Se regresaron 3. 1 se quedó como estaba.'],
  'Put': ['Put 3 back. 1 was left as it is.', 'Se regresaron 3. 1 se quedó como estaba.'],
  'were left as they are.': ['Put 4 back. 2 were left as they are.', 'Se regresaron 4. 2 se quedaron como estaban.'],
  'Add ticked (': ['Add ticked (3)', 'Agregar marcados (3)'],
  'hidden by search': ['2 hidden by search', '2 ocultos por la búsqueda'],
  'Added': ['Added 3 to', 'Se agregaron 3 a'],
  'already on a route and': ['. 1 was already on a route and was left. ', '. 1 ya estaba en una ruta y se dejó. '],
  'Posted: the crew see': ['Posted: the crew see Day of 12/6', 'Publicado: la cuadrilla ve Día del 12/6'],
  'Callout:': ['Callout: Night of 12/4', 'Llamado: Noche del 12/4'],
  'Callout saved for': ['Callout saved for Night of 12/4', 'Llamado guardado para Noche del 12/4'],
  'End': ['End taken back for 2 people', 'Se deshizo el final para 2 personas'],
  'taken back for': ['End taken back for 2 people', 'Se deshizo el final para 2 personas'],
  'Short night: on (after': ['Short night: on (after 1:00 AM)', 'Noche corta: activada (después de la 1:00 AM)'],
  'Short night: on until': ['Short night: on until 9:00 AM', 'Noche corta: activada hasta las 9:00 AM'],
  'Crew sees': ['Crew sees Night of 12/4, posted 8:05 PM', 'La cuadrilla ve Noche del 12/4, publicado 8:05 PM'],
  'clearance expired': ['Alex Test: JBER clearance expired 2026-10-20', 'Alex Test: autorización de JBER vencida el 2026-10-20'],
  'clearance expires': ['Alex Test: JBER clearance expires 2026-12-01', 'Alex Test: la autorización de JBER vence el 2026-12-01'],
  'rides with': ["Alex Test rides with Sam Sample, who isn't on this route", 'Alex Test viaja con Sam Sample, que no está en esta ruta'],
  ", who isn't on this route": ["Alex Test rides with Sam Sample, who isn't on this route", 'Alex Test viaja con Sam Sample, que no está en esta ruta'],
  "leads but can't drive": ["Alex Test leads but can't drive", 'Alex Test es líder pero no puede manejar'],
  'No confirmed driver (': ['No confirmed driver (2 not set)', 'Sin conductor confirmado (2 sin definir)'],
};

// Rows whose English is never one literal: the code joins two. The dead-row check wants both halves still in that file.
const BUILT_ROWS = {
  // lib/shiftlogui.js warnHtml: "It's still snowing: " + ('sanded' | 'treated') + ' anyway'
  "It's still snowing: treated anyway": { file: 'lib/shiftlogui.js', head: "It's still snowing:", tail: 'treated' },
  "It's still snowing: sanded anyway": { file: 'lib/shiftlogui.js', head: "It's still snowing:", tail: 'sanded' },
  // lib/boardui.js: 'Undo ' + o.undo, the kind 'start' | 'end' (clockTap's own literals)
  'Undo start': { file: 'lib/boardui.js', head: 'Undo', tail: 'start' },
  'Undo end': { file: 'lib/boardui.js', head: 'Undo', tail: 'end' },
  // lib/shiftlogui.js: o.failWord + ' not saved: ' + reason, failWord 'Times' (Set times) | 'Shift' (Set shift)
  'Times not saved': { file: 'lib/shiftlogui.js', head: 'Times', tail: 'not saved:' },
  'Shift not saved': { file: 'lib/shiftlogui.js', head: 'Shift', tail: 'not saved:' },
  // snow-app-script roster.js lineErrs: 'Your line is ' + LINE_MAX + ' characters at most' (LINE_MAX = 40)
  'Your line is 40 characters at most': { file: 'server/roster.js', head: 'Your line is', tail: 'characters at most' },
  // lib/rosterui.js decide: (p ? p.name : 'They') + ' can sign in now'
  'They can sign in now': { file: 'lib/rosterui.js', head: 'They', tail: 'can sign in now' },
};

// Rows for words a vendor file puts on the screen (MapLibre's controls set them as title / aria-label): alive while that file holds them.
const VENDOR_ROWS = {
  'Zoom in': 'vendor/maplibre-gl.js', 'Zoom out': 'vendor/maplibre-gl.js', 'Reset bearing to north': 'vendor/maplibre-gl.js',
  'Map marker': 'vendor/maplibre-gl.js', 'Toggle attribution': 'vendor/maplibre-gl.js', 'Close popup': 'vendor/maplibre-gl.js',
};

// ---------------------------------------------------------------- the checks
// An entry is '*' (the whole file) or a list of function names; '(top)' names the strings that sit in no named function.
function listed(map, c) {
  const e = map[c.file];
  if (!e) return false;
  return e === '*' || c.fns.some((f) => e.indexOf(f) !== -1) || (c.fns.length === 0 && e.indexOf('(top)') !== -1);
}
const leaves = (c) => listed(LEAVES_THE_APP, c);
const notYet = (c) => listed(NOT_YET, c);
function isOut(c) { return leaves(c) || notYet(c); }

// The engine's own matching: every row, longest first, whole words. A piece whose letters all sit inside matched rows
// reads fully Spanish ("Site card:" is the row "Site card" and a colon).
const ROW_RE = new RegExp(Object.keys(Es.ES).sort((a, b) => b.length - a.length).map((k) =>
  (/^[A-Za-z0-9]/.test(k) ? '\\b' : '') + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/[A-Za-z0-9]$/.test(k) ? '\\b' : '')).join('|'), 'g');
function fullyKeyed(text) { return !/[A-Za-z]/.test(text.replace(ROW_RE, ' ')); }
function covered(text) {
  if (Object.prototype.hasOwnProperty.call(Es.ES, text)) return true;
  // a rule with the g flag keeps lastIndex between test() calls: reset it, or the next piece is judged from the middle
  if (Es.ES_RULES.some((r) => { r[0].lastIndex = 0; return r[0].test(text); })) return true;
  if (fullyKeyed(text)) return true;
  const b = BUILT[text];
  return !!b && Es.translateString(b[0]) === b[1];
}
const where = (c) => c.file + ':' + c.line + (c.fns.length ? ' [' + c.fns[c.fns.length - 1] + ']' : '') + ' ' + JSON.stringify(c.text);

test('every English string a screen renders (or the server refuses with) has a row or a rule', () => {
  const missing = [], seen = new Set();
  allCandidates().filter((c) => !isOut(c)).forEach((c) => {
    if (covered(c.text)) return;
    const k = c.file + '|' + c.text;
    if (seen.has(k)) return;
    seen.add(k); missing.push(c);
  });
  assert.deepEqual(missing.map(where), [], missing.length + ' English string(s) a phone set to ES would show in English.\n'
    + 'Add a row or a rule to lib/es.js (tú, the live vocabulary; a name is never translated).\n  '
    + missing.map(where).join('\n  '));
});

const trimEnds = (x) => x.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
// The rows no code renders any more (es.js itself holds every key, so it is not read). The server's refusal words count as
// rendered. A one-word row has to be a whole text node by itself.
function deadRows() {
  const pieces = [];
  Object.keys(SOURCES).forEach((file) => SOURCES[file].forEach((s) => { if (!s.quiet) textPieces(s.value).forEach((p) => pieces.push(p)); }));
  Object.keys(SERVER_SOURCES).forEach((file) => SERVER_SOURCES[file].forEach((s) => textPieces(s.value).forEach((p) => pieces.push(p))));
  indexPieces().forEach((p) => pieces.push(p));
  const heard = pieces.join('\n');
  return Object.keys(Es.ES).filter((k) => {
    if (VENDOR_ROWS[k]) return !fs.readFileSync(path.join(ROOT, VENDOR_ROWS[k]), 'utf8').includes('"' + k + '"');
    if (BUILT_ROWS[k]) {
      const b = BUILT_ROWS[k], file = SOURCES[b.file] || SERVER_SOURCES[b.file] || [];
      const has = (w) => file.some((s) => !s.quiet && textPieces(s.value).some((q) => trimEnds(q) === trimEnds(w)));
      return !(has(b.head) && has(b.tail));
    }
    if (wordsIn(k).length >= 2) {
      const re = new RegExp((/^[A-Za-z0-9]/.test(k) ? '\\b' : '') + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/[A-Za-z0-9]$/.test(k) ? '\\b' : ''));
      return !re.test(heard);
    }
    return !pieces.some((q) => trimEnds(q) === trimEnds(k));
  });
}

test('every row is still rendered: no dead row', () => {
  const dead = deadRows();
  assert.deepEqual(dead, [], dead.length + ' row(s) in lib/es.js translate English that nothing renders any more. Delete them.\n  '
    + dead.map((k) => JSON.stringify(k)).join('\n  '));
});

test('every capitalised one-word text node is a row, a rule or named; every one-word row is rendered', () => {
  const missing = [], seen = new Set();
  oneWordNodes().filter((c) => !isOut(c)).forEach((c) => {
    if (covered(c.text) || ONE_WORD_ENGLISH[c.text]) return;
    const k = c.file + '|' + c.text;
    if (seen.has(k)) return;
    seen.add(k); missing.push(c);
  });
  assert.deepEqual(missing.map(where), [], missing.length + ' one-word text node(s) have no row and no rule.\n'
    + 'Add an exact-text rule (/^Word$/) or a row to lib/es.js, or name the word in ONE_WORD_ENGLISH with the reason.\n  ' + missing.map(where).join('\n  '));
  const deadOne = deadRows().filter((k) => wordsIn(k).length < 2);
  assert.deepEqual(deadOne, [], deadOne.length + ' one-word row(s) are no whole text node anywhere:\n  ' + deadOne.map((k) => JSON.stringify(k)).join('\n  '));
  const stale = Object.keys(ONE_WORD_ENGLISH).filter((t) => !oneWordNodes().some((c) => c.text === t && !leaves(c) && !covered(c.text)));
  assert.deepEqual(stale, [], 'ONE_WORD_ENGLISH names words that are not (or no longer) an untranslated node: ' + stale.join(', '));
});

test('every left-out entry is real, and every NOT_YET entry still hides a string with no row', () => {
  const all = allCandidates(), ones = oneWordNodes(), problems = [];
  const open = all.concat(ones).filter((c) => !covered(c.text) && !ONE_WORD_ENGLISH[c.text]);
  const need = (ok, msg) => { if (!ok) problems.push(msg); };
  const fileOf = (f) => (f.indexOf('server/') === 0 ? path.join(SERVER, f.slice(7)) : path.join(ROOT, f));
  Object.keys(LEAVES_THE_APP).forEach((f) => {
    need(fs.existsSync(fileOf(f)), 'LEAVES_THE_APP names a file that is gone: ' + f);
    const e = LEAVES_THE_APP[f];
    if (e !== '*' && fs.existsSync(fileOf(f))) {
      const src = fs.readFileSync(fileOf(f), 'utf8');
      e.forEach((fn) => need(new RegExp('function ' + fn + '\\s*\\(').test(src), 'LEAVES_THE_APP names a function ' + f + ' does not have: ' + fn));
    }
  });
  Object.keys(NOT_YET).forEach((f) => {
    need(fs.existsSync(fileOf(f)), 'NOT_YET names a file that is gone: ' + f);
    const e = NOT_YET[f];
    if (e === '*') need(open.some((c) => c.file === f && !leaves(c)), 'NOT_YET hides nothing in ' + f + ': delete the entry');
    else e.forEach((fn) => need(open.some((c) => c.file === f && !leaves(c) && (fn === '(top)' ? c.fns.length === 0 : c.fns.indexOf(fn) !== -1)),
      'NOT_YET hides nothing in ' + f + ' ' + fn + ': delete it'));
  });
  assert.deepEqual(problems, [], problems.length + ' left-out entr' + (problems.length === 1 ? 'y is' : 'ies are') + ' wrong:\n  ' + problems.join('\n  '));
  Object.keys(BUILT).forEach((t) => {
    assert.ok(all.some((c) => c.text === t) || ones.some((c) => c.text === t), 'BUILT names a piece no source holds: ' + t);
    assert.equal(Es.translateString(BUILT[t][0]), BUILT[t][1], 'BUILT example for ' + t);
    assert.notEqual(BUILT[t][1], BUILT[t][0]);
  });
});

// Half Spanish reads worse than English ("Guardar zone", "Vive en the El Valle": the spec's first anti-goal). A piece the
// engine changes at all must come out with no English word of 3+ letters left in it, except the proper nouns the spec keeps
// (Shovel Command, Titan, Bobcat...). This runs over EVERY piece but the ones that leave the app, NOT_YET or not (Task 3's
// ruling): a half piece is fixed by a row for the whole phrase or a rule, never by deleting the short row other screens need.
const KEEP_EN = new Set(['Shovel', 'Command', 'Titan', 'Inventory', 'Bobcat', 'Snowrator', 'Sweepster', 'BuilderTrend', 'ANTHC', 'MOA', 'JBER',
  'PIN', 'Esri', 'Google', 'Maxar', 'Earthstar', 'Geographics', 'HERE', 'Garmin', 'Matt', 'JPEG', 'PNG', 'NWS', 'GPS', 'min', 'max',
  'app', 'Anchorage', 'YYYY',
  'Time', 'Out', 'Daily', 'Log', 'Blower', 'IceMelt', 'Bootprint', 'bootprint', 'export', 'html',
  'night', 'day', 'MM', 'DD', 'DDTHH',
  'bobcat', 'snowrator', 'sweepster']);   // the brand names as the server's checks write them, lower case   // the server's shift-id and time formats, quoted as they are typed (night-AAAA-MM-DD)   // Bootprint and its address   // BuilderTrend's own field names, kept beside the Spanish ("Entrada (Time In)", "Daily Log")   // app: "la app" is Spanish too; Anchorage a place; YYYY a date pattern
function halfSpanish(text) {
  const out = Es.translateString(text);
  if (out === text) return null;
  const inWords = new Set(text.match(/[A-Za-z]{3,}/g) || []);
  const left = (out.match(/[A-Za-z]{3,}/g) || []).filter((w) => inWords.has(w) && !KEEP_EN.has(w));
  return left.length ? { out, left } : null;
}
test('no piece comes out half Spanish', () => {
  const half = [], seen = new Set();
  allCandidates().filter((c) => !leaves(c)).forEach((c) => {
    if (BUILT[c.text]) return;   // judged by its worked example
    const h = halfSpanish(c.text);
    if (!h || seen.has(c.text)) return;
    seen.add(c.text);
    half.push(where(c) + ' -> ' + JSON.stringify(h.out) + ' (English left: ' + h.left.join(', ') + ')');
  });
  assert.deepEqual(half, [], half.length + ' piece(s) come out half Spanish. Give the whole phrase its own row or rule.\n  ' + half.join('\n  '));
});
test('halfSpanish(): the judge says no to a half line and yes to a whole one', () => {
  // Worked by hand against the rows: "Save" is a row, "the dock now" is not; "Compartir Shovel Command" keeps a proper noun.
  assert.deepEqual(halfSpanish('Save the dock now'), { out: 'Guardar the dock now', left: ['the', 'dock', 'now'] });
  assert.equal(halfSpanish('Sign in'), null);                 // whole: Iniciar sesión
  assert.equal(halfSpanish('Pumpkin spice'), null);           // untouched English: the missing-row check's job, not this one's
  assert.equal(halfSpanish('Share Shovel Command'), null);    // Compartir Shovel Command: proper nouns stay
});

// Spanish everywhere's end state (Task 9): no screen is owed its rows any more. A new screen written in English fails the
// missing-row check above; it may not be parked here again.
test('NOT_YET is empty: every screen has its rows', () => {
  assert.deepEqual(NOT_YET, {});
});

test('the server scan fails the file, never skips, when SNOW_SERVER_REPO holds no Code.js', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'es-cov-'));
  // NODE_TEST_CONTEXT is the runner's own mark for its child processes: left in, the nested run reports to this one and exits 0.
  const env = Object.assign({}, process.env, { SNOW_SERVER_REPO: empty });
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', __filename], { env, encoding: 'utf8' });
  fs.rmdirSync(empty);
  assert.notEqual(r.status, 0, 'the run passed with no server checkout');
  assert.match(r.stdout + r.stderr, /no Code\.js in/);
});

test('the server scan reads every refusal shape: invalid_, reason:, a validator\'s returned array', () => {
  assert.ok(Object.keys(SERVER_SOURCES).indexOf('server/Code.js') !== -1, 'Code.js is read');
  assert.ok(Object.keys(SERVER_SOURCES).indexOf('server/routesheet.js') === -1, 'a shared file is read once, as lib/routesheet.js');
  const texts = serverCandidates().map((c) => c.text);
  assert.ok(texts.indexOf('Only Matt can do that.') !== -1, 'reason: in auth (Code.js)');
  assert.ok(texts.indexOf('Busy, try again.') !== -1, 'reason: in locked_ (Code.js)');
  // roster.js lineErrs: ['Your line is ' + LINE_MAX + ' characters at most'], a returned array: both pieces are found
  assert.ok(texts.indexOf('Your line is') !== -1 && texts.indexOf('characters at most') !== -1, 'a validator\'s returned array (roster.js)');
  Object.keys(NOT_SHOWN).forEach((t) => assert.ok(candidates().concat(serverCandidates()).some((c) => c.text === t), 'NOT_SHOWN names a string no file holds: ' + t));
});

// The tokenizer and the splitter, on made-up source: they are the instrument, so they get their own proof (Plow's, unchanged).
test('the extractor: joins chains, splits tags, keeps attributes, skips code and a person\'s words', () => {
  const src = [
    "var a = 'Hello there ' + 'friend';",
    "// 'not in a comment here'",
    "/* 'nor here' */",
    "var re = /it's \"quoted\" here/g, d = 10 / 2;",
    "console.log('console words are not shown');",
    "throw new Error('error words are not shown');",
    "x.innerHTML = '<p class=\"muted\">Shoveled today</p><input placeholder=\"Your name here\"><span data-no-es>Jordan Test</span> and more';",
    "function outer() { return function inner() { return 'Inside two functions'; }; }",
    "y.innerHTML = '<button id=\"h\"' + (busy ? ' disabled aria-busy=\"true\"' : '') + '>Hand off now</button></div>';",
    "z.innerHTML = '<button id=\"k\" class=\"x' + '\" disabled' + '>Keep going</button>';",
  ].join('\n');
  const s = stringsOf(src, 'fixture');
  const texts = s.filter((x) => !x.quiet).map((x) => x.value);
  assert.ok(texts.indexOf('Hello there friend') !== -1, 'a + b is one string');
  assert.equal(texts.some((t) => /comment|nor here/.test(t)), false, 'comments are not strings');
  assert.equal(texts.some((t) => /quoted/.test(t)), false, 'a regex literal is not a string');
  assert.equal(s.filter((x) => x.quiet).length, 2, 'console.* and new Error( arguments are quiet');
  const html = s.filter((x) => /Shoveled today/.test(x.value))[0].value;
  assert.deepEqual(textPieces(html), ['Your name here', 'Shoveled today', 'and more'], 'text between tags, the placeholder, and nothing from data-no-es');
  const inner = s.filter((x) => x.value === 'Inside two functions')[0];
  assert.deepEqual(inner.fns, ['outer', 'inner'], 'named functions around a string');
  assert.deepEqual(textPieces('">Save the day</b> now'), ['Save the day', 'now']);
  const bare = s.filter((x) => /^>Hand off now/.test(x.value))[0];
  assert.ok(bare, 'the fixture string that begins with > is there');
  assert.deepEqual(textPieces(bare.value), ['Hand off now'], 'a leading > closes a tag; the text after it is the text');
  assert.deepEqual(textPieces(s.filter((x) => /Keep going/.test(x.value))[0].value), ['Keep going'], 'a chain that spans a whole tag is one string');
  assert.deepEqual(textPieces('5 > 3 and more'), ['5 > 3 and more'], 'a > inside running text is left alone');
  assert.throws(() => tokenize("var x = (1;", 'broken'), /balance/);
});

test('the extractor reads every lib file and finds the words the crew read', () => {
  assert.ok(Object.keys(SOURCES).length >= 30, 'lib/*.js are read');
  const all = candidates().map((c) => c.text);
  for (const sample of ["Pick your name, then your PIN. If you use Titan Inventory, it's the same PIN.", 'No sites on this route.', 'Aerial photo unavailable. The zones below are still right.']) {
    assert.ok(all.indexOf(sample) !== -1, 'the extractor found: ' + sample);
  }
});

// The judge has to be able to say no. Worked by hand against the rows: "Site card:" is the row "Site card" and a colon;
// "Save the day now" holds the row "Save" and the English words "the day now".
test('covered(): a whole row, a rule, a string made only of rows and punctuation pass; a half-covered or unknown one fails', () => {
  assert.equal(covered('Sign in'), true);                            // a row
  assert.equal(covered('Snow until 10 AM'), true);                   // a rule
  assert.equal(covered('Site card:'), true);                         // "Site card" + a colon
  assert.equal(covered('Save the day now'), false);                  // "Save" is a row; the rest is English
  assert.equal(covered('Some invented sentence here'), false);
  assert.equal(leaves({ file: 'lib/btnote.js', fns: ['btNote'], text: 'Treated while still snowing.' }), true);   // Copy for BT
  assert.equal(leaves({ file: 'lib/handoff.js', fns: ['handoffBody'], text: 'Left by night' }), true);           // the PDF
  assert.equal(leaves({ file: 'lib/handoff.js', fns: ['siteParts'], text: 'Left by night' }), false);            // the card
});
