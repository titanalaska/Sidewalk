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
  // lib/shiftlog.js curbItems(): 'Curbs' or 'Curbs <g> of <k>', then ': clear <width> ft back', then ' (about <commas(feet)> ft)'
  // Wording changed on Matt's word 11/12/26. Metres are feet x 0.3048 to one decimal:
  //   4 ft = 1.2192 -> 1.2 m;  3 ft = 0.9144 -> 0.9 m;  5 ft = 1.524 -> 1.5 m.
  assert.equal(Es.translateString('Curbs: clear 4 ft back (about 1,200 ft)'), 'Bordillos: despejar 4 pies (1.2 m) (unos 1,200 pies)');
  assert.equal(Es.translateString('Curbs 2 of 3: clear 4 ft back (about 2,000 ft)'), 'Bordillos 2 de 3: despejar 4 pies (1.2 m) (unos 2,000 pies)');
  assert.equal(Es.translateString('Curbs: clear 4 ft back'), 'Bordillos: despejar 4 pies (1.2 m)');
  assert.equal(Es.translateString('Curbs: clear 4 ft back (about 12,340 ft)'), 'Bordillos: despejar 4 pies (1.2 m) (unos 12,340 pies)');
  // the width is read from the name, so a changed setting stays right
  assert.equal(Es.translateString('Curbs: clear 3 ft back (about 800 ft)'), 'Bordillos: despejar 3 pies (0.9 m) (unos 800 pies)');
  assert.equal(Es.translateString('Curbs 1 of 2: clear 5 ft back'), 'Bordillos 1 de 2: despejar 5 pies (1.5 m)');
  // a walk a person named "Curbs ..." is theirs: not translated
  assert.equal(Es.translateString('Curbs at dock'), 'Curbs at dock');
  assert.equal(Es.translateString('Curbs: clear the dock'), 'Curbs: clear the dock');
});

test('the orange type reads "Clear 4 ft back" / "Despejar 4 pies (1.2 m)" (Matt, 11/12/26)', () => {
  assert.equal(Es.translateString('Clear 4 ft back'), 'Despejar 4 pies (1.2 m)');
  assert.equal(Es.ES['Hand work'], undefined); // nothing renders the old label any more
});

// New concrete (Matt, 11/12/26): the four strings the flag adds, with Matt's copy exactly, plus the warning's sanded twin and the
// map legend row (review note N5). "Sanded" is a row like "Treated", so it also reads inside the walk's "Sanded · Name · time" line;
// the English "Treated" on a plain walk still reads Tratado.
test('new concrete: the walk line, the button, the route-list tag, the legend row and the sanded warning', () => {
  const cases = {
    'Sand only, no salt': 'Solo arena, sin sal',
    'Sanded': 'Con arena',
    'New concrete: sand only, no salt': 'Concreto nuevo: solo arena, sin sal',
    "It's still snowing: sanded anyway": 'Sigue nevando: con arena de todos modos',
    "It's still snowing: treated anyway": 'Sigue nevando: tratado de todos modos',
    'Sanded · Jordan Demo · 7:50 AM': 'Con arena · Jordan Demo · 7:50 AM',
    'Treated': 'Tratado',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
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
    'Sidewalk': 'Banqueta', 'Heated: check only, no melt': 'Calefaccionado: solo revisar, sin derretidor',
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
    'Add minutes for Walk-behind blower, or untick it': 'Agrega minutos para Soplador de empuje, o desmárcala',
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

// The Sites tab's search and customer buttons (Matt, 11/15/26). "Search sites" and "No sites match" are whole phrases, so they are rows.
// "All" and "Clear" are bare words: as rows they would turn "Clear all snow" or "All sites" half Spanish, so each is a rule on an exact
// text node (the customer button reads "All " beside its count, in its own element). Tú, plain words.
test('the Sites tab: the search box, the All button, the Clear button and the empty line', () => {
  const cases = { 'Search sites': 'Buscar sitios', 'All': 'Todos', 'Clear': 'Borrar', 'No sites match': 'Ningún sitio coincide' };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
  assert.equal(Es.translateString('All '), 'Todos ', 'the button text node keeps its space before the count');
});
test('the Sites tab: All and Clear change only as a whole text node, never inside longer English', () => {
  assert.equal(Es.ES['All'], undefined);
  assert.equal(Es.ES['Clear'], undefined);
  for (const keep of ['Clear all snow', 'All sites', 'Clear ticks', 'All clear', 'Not all done', 'Clear the dock', 'All day']) {
    assert.equal(Es.translateString(keep), keep, keep);
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

// M4 (final review): the refusal sentences the start/stop-times actions send a CREW phone (Code.js siteGate_, siteMark_, undoSiteMark_,
// clockCrew_, clockTap_, clockUndo_, and shiftlog.js markUndoTarget's reasons) arrive in English and are shown inside a frame: "Not saved: ",
// "Shift not saved: ", "Times not saved: ". Each used to leave the sentence in English behind a Spanish frame ("No se guardó: That site is not
// on your route"). Tú, plain words; the button words are the ones on the buttons (Llegué, Salí, Deshacer).
const REFUSALS = [
  ['No storm is open', 'No hay una tormenta abierta'],
  ['Arrived or Left', 'Llegué o Salí'],
  ['Unknown site', 'Sitio desconocido'],
  ['That site is not on your route', 'Ese sitio no está en tu ruta'],
  ["That site's own crew is still there", 'La cuadrilla de ese sitio todavía está ahí'],
  ['No Arrived to take back', 'No hay ningún "Llegué" que deshacer'],
  ['No Left to take back', 'No hay ningún "Salí" que deshacer'],
  ['That cannot be undone', 'Eso no se puede deshacer'],
  ['The dispatcher has not placed you on a route', 'El despachador todavía no te ha puesto en una ruta'],
  ['That is not your route', 'Esa no es tu ruta'],
  ['Start or End', 'Inicio o Final'],
  ['Nothing to take back', 'No hay nada que deshacer'],
  ['Pick a route', 'Elige una ruta'],
  ['Pick Site done or Site treated', 'Elige Sitio terminado o Sitio tratado'],
  ['Bad batch id', 'Identificador de lote no válido'],
  ['That tap is not in this storm', 'Esa marca no está en esta tormenta'],
];
const FRAMES = [['Not saved: ', 'No se guardó: '], ['Shift not saved: ', 'No se guardó el turno: '], ['Times not saved: ', 'No se guardaron las horas: ']];
test('M4 every refusal a crew phone can be shown reads Spanish inside each of its frames, nothing left in English', () => {
  for (const [en, es] of REFUSALS) {
    assert.equal(Es.translateString(en), es, en);
    for (const [fen, fes] of FRAMES) assert.equal(Es.translateString(fen + en), fes + es, fen + en);
  }
});

// Print crew times (R47, 11/11/26): the button, the dialog's empty line, and the night buttons' count, one person singular, the rest plural.
test('print crew times: the button title, the empty line, and the night buttons with their counts', () => {
  assert.equal(Es.translateString('Print crew times'), 'Imprimir horas del equipo');
  assert.equal(Es.translateString('No shift times recorded yet.'), 'Todav\u00eda no hay horas de turno registradas.');
  // worked by hand: 1 -> persona; 3 and 12 -> personas; the shift label becomes Noche del / D\u00eda del, the date is kept
  assert.equal(Es.translateString('Night of 12/4 \u00b7 3 people'), 'Noche del 12/4 \u00b7 3 personas');
  assert.equal(Es.translateString('Day of 12/6 \u00b7 1 person'), 'D\u00eda del 12/6 \u00b7 1 persona');
  assert.equal(Es.translateString('Night of 11/30 \u00b7 12 people'), 'Noche del 11/30 \u00b7 12 personas');
});

// Site done / Site treated (11/13/26): the buttons, the toggle, the second phone's toast, the folded line's parts (each its own text node) and the Undo toast.
// Worked by hand against the spec's copy: 1 -> singular, anything else -> plural; "Los <n> ... terminados" only when all are done and n > 1.
test('site done: the buttons, the toggle and the Already done toast', () => {
  assert.equal(Es.translateString('Site done'), 'Sitio terminado');
  assert.equal(Es.translateString('Site treated'), 'Sitio tratado');
  assert.equal(Es.translateString('Show walks'), 'Ver recorridos');
  assert.equal(Es.translateString('Hide walks'), 'Ocultar recorridos');
  assert.equal(Es.translateString('Already done'), 'Ya est\u00e1 hecho');
});
test('big site toggle: Show <n> walks, with and without the done count, k = 1 and k > 1', () => {
  assert.equal(Es.translateString('Show 9 walks'), 'Ver 9 recorridos');
  assert.equal(Es.translateString('Show 23 walks \u00b7 1 done'), 'Ver 23 recorridos \u00b7 1 terminado');
  assert.equal(Es.translateString('Show 23 walks \u00b7 12 done'), 'Ver 23 recorridos \u00b7 12 terminados');
});
test('site done: the folded line, n = 1 and n > 1', () => {
  assert.equal(Es.translateString('All 1 walk done'), '1 recorrido terminado');
  assert.equal(Es.translateString('All 4 walks done'), 'Los 4 recorridos terminados');
  assert.equal(Es.translateString('0 of 1 walks done'), '0 de 1 recorridos terminados');
  assert.equal(Es.translateString('4 of 5 walks done'), '4 de 5 recorridos terminados');
  assert.equal(Es.translateString('1 problem'), '1 problema');
  assert.equal(Es.translateString('3 problems'), '3 problemas');
  assert.equal(Es.translateString('Curbs: 1 left'), 'Bordillos: faltan 1');
  assert.equal(Es.translateString('Curbs: 4 left'), 'Bordillos: faltan 4');
});
test('site done: the Undo toast, walks and the kept count, n = 1 and n > 1', () => {
  assert.equal(Es.translateString('Undone: 1 walk.'), 'Deshecho: 1 recorrido.');
  assert.equal(Es.translateString('Undone: 3 walks.'), 'Deshecho: 3 recorridos.');
  assert.equal(Es.translateString('Undone: 2 walks. 1 was tapped since and kept.'), 'Deshecho: 2 recorridos. 1 fue marcado despu\u00e9s y se dej\u00f3.');
  assert.equal(Es.translateString('Undone: 1 walk. 2 were tapped since and kept.'), 'Deshecho: 1 recorrido. 2 fueron marcados despu\u00e9s y se dejaron.');
});
test('site done: no bare word was added that could bite longer English', () => {
  // the rules above own "Curbs: <c> left" and "<p> problem(s)"; a bare row would eat the front of a curb item's own line
  assert.equal(Es.translateString('Curbs: clear 4 ft back'), 'Bordillos: despejar 4 pies (1.2 m)');
  assert.equal(Es.translateString('Problems (2)'), 'Problemas (2)');
});

test('walk totals (Matt, 11/23/26): each part of the Sites / Routes line reads whole in Spanish, the number untouched', () => {
  // lib/totals.js walkParts(): 'Sidewalk <n> sq ft', 'Heated <n>', 'Hand <n>'; "sq ft" on the first part only, whichever it is.
  // The dictionary turns the bare word Sidewalk into Banqueta first; the rule reads the half-translated part.
  assert.equal(Es.translateString('Sidewalk 2,050 sq ft'), 'Banqueta 2,050 pies²');
  assert.equal(Es.translateString('Heated 640'), 'Con calefacción 640');
  assert.equal(Es.translateString('Hand 300'), 'A mano 300');
  assert.equal(Es.translateString('Heated 640 sq ft'), 'Con calefacción 640 pies²');
  assert.equal(Es.translateString('Hand 1,234,567 sq ft'), 'A mano 1,234,567 pies²');
  // Only the whole part: other English that starts with these words is left to its own rows.
  assert.equal(Es.translateString('Hand 300 bags'), 'Hand 300 bags');
  assert.equal(Es.translateString('Heated 640 ft'), 'Heated 640 ft');
  assert.equal(Es.translateString('Zebra Hand 300'), 'Zebra Hand 300'); // only a whole part, never the tail of other text
  assert.equal(Es.translateString('Sidewalk'), 'Banqueta');
});

test("directions: the bare word translates only as a whole text node", () => {
  assert.equal(Es.translateString("Directions"), "Cómo llegar");
  for (const keep of ["Directions to the site", "No Directions"])
    assert.ok(!/Cómo llegar/.test(Es.translateString(keep)), keep);
});

test('next site bar: "Next:" translates only as a whole text node', () => {
  assert.equal(Es.translateString('Next:'), 'Siguiente:');
  for (const keep of ['Next: check the ramp', 'Next'])
    assert.ok(!/Siguiente/.test(Es.translateString(keep)), keep);
});

test('crew cards (Matt, 11/24/26): every word of the Crew tab reads in Spanish; names and lines are not rows', () => {
  const rows = {
    'Crew': 'Cuadrilla',
    'Nights worked': 'Noches trabajadas',
    'Team sq ft': 'Pies² del equipo',
    'Rookie': 'Novato',
    '2 seasons': '2 temporadas',
    '12 seasons': '12 temporadas',
    'about 21 football fields': 'unos 21 campos de fútbol americano',
    'about 1 football field': 'un campo de fútbol americano',
    'Winter 2026–27 · counted at 6:14 AM': 'Invierno 2026–27 · contado a las 6:14 AM',
    'Winter 2026–27': 'Invierno 2026–27',
    'Share my card': 'Compartir mi tarjeta',
    'Edit your card': 'Editar tu tarjeta',
    'Refresh': 'Actualizar',
    "No signal. Your crew's cards come back when you do.": 'Sin señal. Las tarjetas de tu cuadrilla vuelven cuando vuelvas.',
    'No signal. Showing the last copy.': 'Sin señal. Se muestra la última copia.',
    'Could not share the card. Try again.': 'No se pudo compartir la tarjeta. Inténtalo de nuevo.',
    'No phone on file.': 'No hay teléfono registrado.',
    'A line for your card': 'Una frase para tu tarjeta',
    'Their line': 'Su frase',
    'Your line is 40 characters at most': 'Tu frase puede tener 40 caracteres como máximo',
  };
  for (const [en, es] of Object.entries(rows)) assert.equal(Es.translateString(en), es, en);
});

test('crew cards: the bare Crew row and the number rules take whole text nodes only; names and lines pass through', () => {
  for (const keep of ['Crew bar', 'My Crew', 'about 21 football fields away', '1 seasons here', 'Abel Stone'])
    assert.equal(Es.translateString(keep), keep, keep);
  assert.equal(Es.translateString('Crew:'), 'Cuadrilla:');
  assert.equal(Es.translateString('Seasons'), 'Temporadas');
});

test('check night (11/24/26): the header reads Noche de revisión abierta, whole, and Storm open is untouched', () => {
  assert.equal(Es.translateString('Check night open'), 'Noche de revisión abierta');
  assert.equal(Es.translateString('Storm open'), 'Tormenta abierta');
});

test('check night (final review I3): the pass line "Storm · became a storm" reads in Spanish, the name and time kept', () => {
  // Dictionary first: Storm -> Tormenta; then the rule on the half-translated line. The time and the name are kept.
  assert.equal(Es.translateString('Storm · became a storm 1:00 AM by Matt Walsh'), 'Tormenta · se volvió tormenta 1:00 AM por Matt Walsh');
  // No name on the row: the time ends the line.
  assert.equal(Es.translateString('Storm · became a storm 1:00 AM'), 'Tormenta · se volvió tormenta 1:00 AM');
});

// Site card machine lines (Matt, 11/24/26). Crew read owed. Brand names (Bobcat, Snowrator, Sweepster), people and units
// stay English: the card puts them under data-no-es, or they sit inside a sentence as plain text and are kept by the rule.
test('machine lines: the line-numbered refusals keep the brand name and N', () => {
  const cases = {
    'Pick the unit for Bobcat 2, or remove it': 'Elige la unidad de Bobcat 2, o quítala',
    'Pick an attachment for Bobcat 2, or remove it': 'Elige el aditamento de Bobcat 2, o quítala',
    'Pick who ran Bobcat 1, or remove it': 'Elige quién operó Bobcat 1, o quítala',
    'Add minutes for Bobcat 3, or remove it': 'Agrega minutos para Bobcat 3, o quítala',
    'Pick the unit for Snowrator 1, or remove it': 'Elige la unidad de Snowrator 1, o quítala',
    'Pick who ran Snowrator 2, or remove it': 'Elige quién operó Snowrator 2, o quítala',
    'Add minutes for Snowrator 1, or remove it': 'Agrega minutos para Snowrator 1, o quítala',
    'Add minutes for Walk-behind blower, or untick it': 'Agrega minutos para Soplador de empuje, o desmárcala',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('machine lines: the duplicate refusals keep the name, the unit and the brand name', () => {
  const cases = {
    'Loki Haskins is on BC5 twice': 'Loki Haskins está en BC5 dos veces',
    'Loki Haskins is on two Bobcats with no unit: pick the units': 'Loki Haskins está en dos Bobcats sin unidad: elige las unidades',
    'Jordan Demo is on two Snowrators with no unit: pick the units': 'Jordan Demo está en dos Snowrators sin unidad: elige las unidades',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('machine lines: the server refusals a card can show are not half translated by the shorter rows', () => {
  const cases = {
    'Pick an attachment for each Bobcat': 'Elige un aditamento para cada Bobcat',
    'Pick who ran each machine': 'Elige quién operó cada máquina',
    'Add minutes for each machine': 'Agrega minutos para cada máquina',
    'A unit number is text, 20 characters at most': 'Un número de unidad es texto, 20 caracteres como máximo',
    'Too many machines on one card': 'Demasiadas máquinas en una tarjeta',
    "That person isn't on the roster": 'Esa persona no está en la lista',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('machine lines: the labels, one text node each', () => {
  const cases = {
    'Pick': 'Elegir', 'Unit:': 'Unidad:', 'Minutes:': 'Minutos:', 'Operator:': 'Operador:', 'Not sure': 'No sé', 'Remove': 'Quitar',
    'Snowblower': 'Soplador de nieve', 'Bucket': 'Cucharón', 'Equipment': 'Equipo', 'Walk-behind blower': 'Soplador de empuje',
    '+ Add a ': '+ Agregar un ',
    'Already logged here this shift:': 'Ya registrado aquí en este turno:',
    'Walk-behind blower minutes': 'Minutos del soplador de empuje',
    'Attachment for Bobcat 2': 'Aditamento para Bobcat 2',
    ' 106 min': ' 106 min',   // "min" is the same word in Spanish: no row
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, JSON.stringify(en));
});

test('machine lines: the old-minutes row and the replaced note, split around their brand names and people', () => {
  const cases = {
    ' 106 min, saved before machine lines': ' 106 min, guardado antes de las líneas de máquina',
    'Remove it if you add this': 'Quítalo si agregas este',
    ' as a line': ' como una línea',
    ' logged ': ' registró a ',
    ' later; that line counts.': ' después; esa línea cuenta.',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, JSON.stringify(en));
});

// Final fix wave (11/25/26): the card's bare words are exact text nodes (rules), not rows. As rows they were matched inside
// other screens' English: "Pick a worker" read "Elegir a worker", "Remove the photo" read "Quitar the photo".
test('machine lines: Pick, Remove, Not sure, Unit:, Minutes: translate only as a whole text node', () => {
  const whole = { 'Pick': 'Elegir', 'Remove': 'Quitar', 'Not sure': 'No sé', 'Unit:': 'Unidad:', 'Minutes:': 'Minutos:', ' Remove ': ' Quitar ' };
  for (const [en, es] of Object.entries(whole)) assert.equal(Es.translateString(en), es, JSON.stringify(en));
  for (const k of ['Pick', 'Remove', 'Not sure', 'Unit:', 'Minutes:']) assert.equal(Es.ES[k], undefined, k + ' is a rule, not a row');
  // Inside longer English that has no row of its own, the word is left alone (the sentence stays English, never half Spanish).
  for (const en of ['Pick a worker', 'Pick a shift', 'Remove the photo', 'Not sure yet', 'Unit: BC5', 'Minutes: 5']) {
    assert.equal(Es.translateString(en), en, en);
  }
  // mapedit's type refusal: "Pick" is no longer a row. Spanish everywhere (11/25/26) gave the whole sentence its own row (it read
  // half Spanish, "Pick a type: Banqueta, Hand, Heated, ..."): the row wins, and the bare-word rule never bites it.
  const type = Es.translateString('Pick a type: Sidewalk, Hand, Heated, Snow storage or Do not touch.');
  assert.equal(type, 'Elige un tipo: Banqueta, A mano, Con calefacción, Depósito de nieve o No tocar.');
  assert.ok(!/Elegir/.test(type), type);
  // The longer rows that begin with these words still win.
  assert.equal(Es.translateString('Pick a route'), 'Elige una ruta');
  assert.equal(Es.translateString('Remove it if you add this'), 'Quítalo si agregas este');
  assert.equal(Es.translateString('Pick the unit for Bobcat 2, or remove it'), 'Elige la unidad de Bobcat 2, o quítala');
});

test('machine lines: the Unit pick marks this site\'s units "(este sitio)", the unit kept', () => {
  // The option's text is one text node: "<unit> (this site)" (lib/machinepick.js). Worked on paper: the unit before the marker
  // is copied as it is, the marker becomes "(este sitio)".
  const cases = { 'BC5 (this site)': 'BC5 (este sitio)', 'Snowrator 1 (this site)': 'Snowrator 1 (este sitio)',
    'BC5-ABCDEFGHIJKLMNOP (this site)': 'BC5-ABCDEFGHIJKLMNOP (este sitio)' };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
  assert.equal(Es.translateString('BC7'), 'BC7');   // another site's unit: no marker, nothing to translate
});

test('machine lines: the Save guard notice, Save anyway, and the self-replaced note', () => {
  // The notice's text nodes, split around the saver's name, the machine (brand + unit) and the operator, all data-no-es:
  //   "Saving replaces " [Ben Bravo] "'s " [Bobcat BC5] " Snowblower line for " [Loki Haskins] " (40 min). Add it here too if they ran it."
  // Spanish, same order: "Al guardar se reemplaza la línea de Ben Bravo: Bobcat BC5 Soplador de nieve para Loki Haskins (40 min).
  // Agrégala aquí también si la operó." A Snowrator has no attachment: " line for " -> " para ".
  const cases = {
    'Saving replaces ': 'Al guardar se reemplaza la línea de ',
    "'s ": ': ',
    ' Snowblower line for ': ' Soplador de nieve para ',
    ' Bucket line for ': ' Cucharón para ',
    ' line for ': ' para ',
    ' (40 min). Add it here too if they ran it.': ' (40 min). Agrégala aquí también si la operó.',
    'Save anyway': 'Guardar de todos modos',
    ' logged this line again later; that line counts.': ' registró esta línea de nuevo después; esa línea cuenta.',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, JSON.stringify(en));
  assert.equal(Es.translateString('Save'), 'Guardar');   // the plain button is unchanged
});

test('machine lines: the new bare words never bite longer English or the old card words', () => {
  assert.equal(Es.translateString('Pick a route'), 'Elige una ruta');
  assert.equal(Es.translateString('Minutes must be a whole number, zero or more'), 'Los minutos deben ser un número entero, cero o más');
  assert.equal(Es.translateString('Blower'), 'Blower', 'no bare Blower row');
  assert.ok(!('Equipment (minutes)' in Es.ES) && !('Blower' in Es.ES));
});

// Spanish everywhere (Matt 11/25/26), Task 3: the lines that came out HALF Spanish ("Guardar zone", "Vive en the El Valle").
// Each gets its whole phrase as a row, or a rule that keeps the name or number it carries. Worked by hand, tú:
//   "Save zone"           -> "Guardar zona"   (the row "Save" alone gave "Guardar zone")
//   "Lives in the Valley" -> "Vive en el Valle" (the rows "Lives in" + "Valley" gave "Vive en the El Valle")
//   built lines: the dictionary runs first, so a rule matches what it leaves ("pass" is already "pasada").
test('half Spanish: the whole phrase wins over its short rows', () => {
  const cases = {
    'Print map': 'Imprimir mapa',
    'Save zone': 'Guardar zona',
    'Save view': 'Guardar vista',
    'Lives in the Valley': 'Vive en el Valle',
    'Some fields not set': 'Algunos datos sin definir',
    'Gear on hand': 'Equipo a la mano',
    'Photo ready. Save to keep it.': 'Foto lista. Guarda para conservarla.',
    'Seasons must be a whole number': 'Las temporadas deben ser un número entero',
    'Zone saved': 'Zona guardada',
    'Print sheets': 'Imprimir hojas',
    "Tonight's outlook": 'Pronóstico de esta noche',
    'Close the storm?': '¿Cerrar la tormenta?',
    'Busy, try again.': 'Ocupado, inténtalo de nuevo.',
    'Session expired. Sign in again.': 'La sesión expiró. Inicia sesión de nuevo.',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('half Spanish: the built lines keep their names and numbers', () => {
  // lib/app.js printRouteMaps: plural(missing, 'map') + " couldn't be made..." ; 1 is singular, 2 plural
  assert.equal(Es.translateString("1 map couldn't be made on this phone (no signal?). Their zone lists still print."),
    '1 mapa no se pudo hacer en este teléfono (¿sin señal?). Su lista de zonas sí se imprime.');
  assert.equal(Es.translateString("2 maps couldn't be made on this phone (no signal?). Their zone lists still print."),
    '2 mapas no se pudieron hacer en este teléfono (¿sin señal?). Sus listas de zonas sí se imprimen.');
  // lib/boardui.js clearAsk: p.onClock + ' is' | ' are' + ' still on the clock. ...'
  assert.equal(Es.translateString('1 is still on the clock. Tap End shift first, or their End has to be typed with Set shift.'),
    '1 persona sigue en turno. Toca Terminar turno primero, o su salida se tiene que escribir con Poner turno.');
  assert.equal(Es.translateString('3 are still on the clock. Tap End shift first, or their End has to be typed with Set shift.'),
    '3 personas siguen en turno. Toca Terminar turno primero, o su salida se tiene que escribir con Poner turno.');
  // lib/shiftlogui.js confirmAgain: the walk count and the pass numbers; a site's name is kept as typed
  assert.equal(Es.translateString('Every walk at PAC goes back to not done for pass 2. Pass 1 stays on the record.'),
    'Cada recorrido en PAC vuelve a Pendiente para la pasada 2. La pasada 1 se queda en el registro.');
  assert.equal(Es.translateString("Copy for BT first if pass 1 isn't posted yet."), 'Usa Copiar para BT primero si la pasada 1 todavía no está publicada.');
  // lib/mapedit.js unsavedWork: corners counted
  assert.equal(Es.translateString('Save or Cancel this zone first. It has 1 corners that are not saved.'), 'Guarda o cancela esta zona primero. Tiene 1 esquina sin guardar.');
  assert.equal(Es.translateString('Save or Cancel this zone first. It has 5 corners that are not saved.'), 'Guarda o cancela esta zona primero. Tiene 5 esquinas sin guardar.');
  // lib/shiftlogui.js run: a site's name, or "this site" when the phone has none
  assert.equal(Es.translateString('Not saved: the map for PAC has changed. Mark the walk again.'), 'No se guardó: el mapa de PAC cambió. Marca el recorrido de nuevo.');
  assert.equal(Es.translateString('Not saved: the map for this site has changed. Mark the walk again.'), 'No se guardó: el mapa de este sitio cambió. Marca el recorrido de nuevo.');
  // lib/shiftlogui.js onBoard: names as typed, "(lead)" in Spanish
  assert.equal(Es.translateString('Board, not posted yet: Alex Test (lead), Sam Sample'), 'Tablero, todavía no publicado: Alex Test (líder), Sam Sample');
  // the server's messages, joined by "; " after "Not saved:" (the numbers are its constants)
  assert.equal(Es.translateString('Not saved: Emergency contact name is 40 characters at most; Can drive must be yes, no or not set'),
    'No se guardó: El nombre del contacto de emergencia puede tener 40 caracteres como máximo; Puede manejar debe ser sí, no o sin definir');
});
