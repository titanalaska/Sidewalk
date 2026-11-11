// The Spanish engine, pure part (lib/es.js): the dictionary pass and the rules.
// Expected values are the rows the spec fixes (docs/superpowers/specs/2026-10-09-spanish-design.md).
const test = require('node:test');
const assert = require('node:assert');
const Es = require('../lib/es.js');

test('a known phrase translates; an unknown one comes back unchanged', () => {
  assert.equal(Es.translateString('Sign in'), 'Iniciar sesión');
  assert.equal(Es.translateString('Pumpkin spice'), 'Pumpkin spice');
});

test('longest key wins: "Not saved: try again" is one row, not "Not saved" + ": try again"', () => {
  // Both "try again" and the whole line are rows; the whole line must win.
  assert.equal(Es.translateString('Not saved: try again'), 'No se guardó: inténtalo de nuevo');
});

test('a short key never bites into a longer word: Back vs Backend', () => {
  assert.equal(Es.translateString('Back'), 'Atrás');
  assert.equal(Es.translateString('‹ Back'), '‹ Atrás');
  // Bare longer words with a key inside: these are the ones only the \b anchors protect (the full banner
  // below is its own row, so longest-first would save it even without them; the 10/9 mutation check found that).
  assert.equal(Es.translateString('Backend'), 'Backend');
  assert.equal(Es.translateString('Mapbox'), 'Mapbox');
  assert.equal(Es.translateString('Startup'), 'Startup');
  assert.equal(Es.translateString("Backend out of date. Tell Matt: the app and the server don't match."),
    'El servidor está desactualizado. Dile a Matt: la app y el servidor no coinciden.');
});

test('leading and trailing spaces survive ("Tonight: " before a bold name)', () => {
  assert.equal(Es.translateString('Tonight: '), 'Esta noche: ');
  assert.equal(Es.translateString(' · admin'), ' · admin'); // a role tag, not a row: unchanged, space and all
});

test('number rules: the weather hint and the curb items', () => {
  assert.equal(Es.translateString('Snow until 10 AM'), 'Nieve hasta las 10 AM');
  assert.equal(Es.translateString('No snow in the next 12 h'), 'Sin nieve en las próximas 12 h');
  // lib/shiftlog.js curbItems(): 'Curbs' or 'Curbs <g> of <k>', then ' (about <commas(feet)> ft)'
  assert.equal(Es.translateString('Curbs (about 690 ft)'), 'Bordillos (unos 690 ft)');
  assert.equal(Es.translateString('Curbs 1 of 2 (about 470 ft)'), 'Bordillos 1 de 2 (unos 470 ft)');
  assert.equal(Es.translateString('Curbs (about 2,730 ft)'), 'Bordillos (unos 2,730 ft)');
});

test('every row has a Spanish value different from its key and no row is blank', () => {
  const rows = Object.entries(Es.ES);
  assert.ok(rows.length > 0);
  for (const [k, v] of rows) assert.ok(typeof v === 'string' && v.trim() && v !== k, 'row ' + JSON.stringify(k));
});

test('the status words the crew tap all night (spec, Groundwork vocabulary; one crew member checks before ship)', () => {
  const words = {
    'Cleared': 'Despejado', 'Treated': 'Tratado', 'Problem': 'Problema', 'Checked': 'Revisado', 'Touched': 'Tocado',
    'Done': 'Listo', 'Clean again': 'Limpiar de nuevo', 'Whole site': 'Todo el sitio', 'Retry': 'Reintentar', 'Undo': 'Deshacer',
    'Sidewalk': 'Banqueta', 'Hand work': 'Trabajo a mano', 'Heated: check only, no melt': 'Calefaccionado: solo revisar, sin derretidor',
    'Snow storage': 'Depósito de nieve', 'Do not touch': 'No tocar',
    "Couldn't reach the server. Not saved, try again.": 'No se pudo conectar con el servidor. No se guardó, inténtalo de nuevo.',
  };
  for (const [en, es] of Object.entries(words)) assert.equal(Es.translateString(en), es, en);
});

test('final review: the rows and rules the crew screens were still missing', () => {
  const cases = {
    'PIN is 4 digits.': 'El PIN tiene 4 dígitos.',
    'Wrong PIN. 3 tries left.': 'PIN incorrecto. Quedan 3 intentos.',
    'Too many wrong PINs. Wait 5 minutes.': 'Demasiados PIN incorrectos. Espera 5 minutos.',
    ' (waiting for approval)': ' (esperando aprobación)',
    'Type your first and last name and choose a 4-digit PIN. Matt approves it here in Shovel Command. Then sign in with your name and this PIN.':
      'Escribe tu nombre y apellido y elige un PIN de 4 dígitos. Matt lo aprueba aquí en Shovel Command. Después inicia sesión con tu nombre y este PIN.',
    "Can't reach the server. Trying again.": 'No se puede conectar con el servidor. Intentando de nuevo.',
    'Add minutes for Blower, or untick it': 'Agrega minutos para Sopladora, o desmárcala',
    'Night of 10/3, posted 12:12 AM': 'Noche del 10/3, publicado 12:12 AM',
    'Day of 10/3, posted 9:05 AM': 'Día del 10/3, publicado 9:05 AM',
    'Shifts worked': 'Turnos trabajados',
    '— 3 nights · 1 day': '— 3 noches · 1 día',
    '— 1 night · 2 days': '— 1 noche · 2 días',
    'Start': 'Inicio',           // the card's times line is exactly this text node
    '· Finish': '· Fin',
    'Start storm': 'Start storm', // a lead's control: NOT a row, never "Inicio storm" (spec: leads' screens stay)
    'not set': 'sin definir',
    'none': 'ninguno',
    'own': 'propio',
    'needs issued': 'se necesita entregar',
    'I have my own': 'Tengo el mío',
    'I need it issued': 'Necesito que me lo entreguen',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

// The dispatcher mark (Matt, 11/9/26): the crew's own card says who sees their private answers. The rows are Plow
// Command's, word for word (its crew read them 10/21/26); the two "Only Matt sees" rows are gone with their sentences.
test('the privacy promise on Your card names the dispatcher and Matt; the old Matt-only rows are gone', () => {
  assert.equal(Es.translateString('Only the dispatcher and Matt see where you live.'), 'Solo el despachador y Matt ven dónde vives.');
  assert.equal(Es.translateString('Only the dispatcher and Matt see your emergency contact.'), 'Solo el despachador y Matt ven tu contacto de emergencia.');
  for (const old of ['Only Matt sees where you live.', 'Only Matt sees your emergency contact.']) assert.equal(Es.translateString(old), old, old);
});

// Site times (Matt, 11/10/26): Arrived / Left / In / Out sit in exact text nodes, so they are rules, not rows: a bare row
// would turn "Left by night" and "Sign in" into half Spanish. Worked by hand from the vocabulary in the brief (tú).
test("site times: the single words translate only as a whole text node", () => {
  const whole = { Arrived: "Llegué", Left: "Salí", In: "Entrada", Out: "Salida", typed: "escrito", Shift: "Turno", Undo: "Deshacer" };
  for (const [en, es] of Object.entries(whole)) assert.equal(Es.translateString(en), es, en);
  // Not inside longer English: nothing may bite.
  for (const keep of ["Left by night", "Sign in", "Out of date", "Arrived late"]) {
    const out = Es.translateString(keep);
    assert.ok(!/Llegué|Salí|Entrada|Salida|Turno/.test(out), keep + " -> " + out);
  }
});

test("site times: the Set times box and its date line", () => {
  const cases = {
    "Set times": "Poner horas", "Set times: ": "Poner horas: ", "typed by": "escrito por",
    "on 10/3": "el 10/3", "on 11/10": "el 11/10",
    "Night of 10/2": "Noche del 10/2", "Day of 10/2": "Día del 10/2",
    "Type a start, a finish, or both": "Escribe una entrada, una salida, o las dos",
    "Leave a box blank to keep that side as the crew tapped it.": "Deja una casilla en blanco para conservar ese lado como lo tocó la cuadrilla.",
    "Times not saved": "No se guardaron las horas",
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
  // The shift labels that were already in Spanish by the Tonight rule are not disturbed.
  assert.equal(Es.translateString("Night of 10/3, posted 12:12 AM"), "Noche del 10/3, publicado 12:12 AM");
});

test('shift times (11/11/26): the buttons, the card heading, the line words and the counts after a tap', () => {
  const rows = {
    'Start shift': 'Empezar turno', 'End shift': 'Terminar turno', 'Set shift': 'Poner turno', 'Your shift': 'Tu turno',
    'On the clock since': 'En turno desde', 'Undo start': 'Deshacer inicio', 'Undo end': 'Deshacer final', 'Ended': 'Terminó',
    'Set shift: ': 'Poner turno: ', 'Shift not saved: no signal': 'No se guardó el turno: sin señal',
    'Nothing to change: it was already recorded': 'Nada que cambiar: ya estaba registrado',
    'Ask the dispatcher to put you on a route.': 'Pídele al despachador que te ponga en una ruta.',
  };
  for (const [en, es] of Object.entries(rows)) assert.equal(Es.translateString(en), es, en);
  // one person is singular, the rest plural (worked by hand: 1 -> persona, 0 and 3 -> personas)
  assert.equal(Es.translateString('Started for 1 person'), 'Empezó el turno para 1 persona');
  assert.equal(Es.translateString('Started for 3 people'), 'Empezó el turno para 3 personas');
  assert.equal(Es.translateString('Ended for 2 people'), 'Terminó el turno para 2 personas');
  assert.equal(Es.translateString('Start taken back for 3 people'), 'Se deshizo el inicio para 3 personas');
  assert.equal(Es.translateString('End taken back for 1 person'), 'Se deshizo el final para 1 persona');
});
test('shift times: the bare word Ended is only ever an exact text node, so a longer English sentence is left alone', () => {
  assert.equal(Es.translateString('Ended'), 'Terminó');
  assert.equal(Es.translateString('Ended by Matthew'), 'Ended by Matthew');
});
