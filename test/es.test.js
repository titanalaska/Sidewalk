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
    'Start storm': 'Empezar tormenta', // a whole row since Matt's 'everything' (11/25/26); never "Inicio storm" (no bare Start row)
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
  // ('Clear ticks' left this list: since Spanish everywhere, 11/25/26, it is the Add sites… button with a whole row of its own.)
  for (const keep of ['Clear all snow', 'All sites', 'Clear the ticks', 'All clear', 'Not all done', 'Clear the dock', 'All day']) {
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
  // ('Pick a worker' / 'Pick a shift' left this list: they are whole rows since Spanish everywhere, 11/25/26.)
  for (const en of ['Remove the photo', 'Not sure yet', 'Unit: BC5', 'Minutes: 5']) {
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
  // lib/shiftlogui.js onBoard: 'Board, not posted yet: ' + [Alex Test] ' (lead), ' + [Sam Sample], each name its own span (whoHtml)
  assert.equal(Es.translateString('Board, not posted yet: '), 'Tablero, todavía no publicado: ');
  assert.equal(Es.translateString(' (lead), '), ' (líder), ');
  assert.equal(Es.translateString(' (lead)'), ' (líder)');
  // the server's messages, joined by "; " after "Not saved:" (the numbers are its constants)
  assert.equal(Es.translateString('Not saved: Emergency contact name is 40 characters at most; Can drive must be yes, no or not set'),
    'No se guardó: El nombre del contacto de emergencia puede tener 40 caracteres como máximo; Puede manejar debe ser sí, no o sin definir');
});

// Spanish everywhere, Task 4: the leads' and the dispatcher's Storm tab. "Start storm" was English on purpose (the 10/9/26
// "crew screens only" ruling; the pin at the top of this file); Matt's "everything" (11/25/26) turns it Spanish. Never a bare
// "Start" row: the controls are whole rows. Worked by hand, tú, Mexican Spanish (camioneta, banqueta).
test('storm controls and their confirms read Spanish (Matt 11/25/26: everything)', () => {
  const cases = {
    'Start storm': 'Empezar tormenta',
    'Start check night': 'Empezar noche de revisión',
    'Reopen storm': 'Reabrir tormenta',
    'Make it a storm': 'Convertir en tormenta',
    'Night shift on': 'Turno de noche activado',
    'Start a new storm?': '¿Empezar una tormenta nueva?',
    'Every walk goes back to not done. Nothing already logged is deleted.': 'Cada recorrido vuelve a Pendiente. No se borra nada de lo ya registrado.',
    'Yes, start storm': 'Sí, empezar tormenta',
    'Are you sure?': '¿Estás seguro?',
    'Hand off now': 'Entregar ahora',
    'Hand off to day now?': '¿Entregar al turno de día ahora?',
    'Truck saved': 'Camioneta guardada',
    'Truck:': 'Camioneta:',
    'Truck': 'Camioneta',
    '‹ Live view': '‹ Vista en vivo',
    'Check outlook': 'Revisar pronóstico',
    'New snow': 'Nieve nueva',
    'Heated': 'Con calefacción',   // whole text nodes only (exact rules)
    'Hand': 'A mano',
    'Curbs': 'Bordillos',
    'Heated walk': 'Heated walk',  // a longer line is left alone
    'Hand 300': 'A mano 300',      // the walk-totals rule, unchanged
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('the leads\' and dispatcher\'s built lines keep their numbers, names and times', () => {
  // the live summary: one node, parts joined by " · " (lib/shiftlogui.js livesumHtml)
  assert.equal(Es.translateString('No storm open · 12 sites on 3 routes'), 'No hay tormenta abierta · 12 sitios en 3 rutas');
  assert.equal(Es.translateString('3 of 12 sites done, 1 touched · 2 problems · 1 callout · last tap 2:14 AM · 1 of 3 routes started'),
    '3 de 12 sitios listos, 1 tocado · 2 problemas · 1 llamado · último toque 2:14 AM · 1 de 3 rutas empezadas');
  assert.equal(Es.translateString('4 of 9 sites checked · 0 problems · no taps yet · 0 of 3 routes started'),
    '4 de 9 sitios revisados · 0 problemas · sin toques todavía · 0 de 3 rutas empezadas');
  // the outlook (by = hourLabel(9) = "9 AM")
  assert.equal(Es.translateString('Forecast snow at every site from now to 9 AM, against its callout depth.'),
    'Pronóstico de nieve en cada sitio desde ahora hasta las 9 AM, comparado con su profundidad de llamado.');
  assert.equal(Es.translateString('Up to 3" by 9 AM · snow from 2:14 AM'), 'Hasta 3" para las 9 AM · nieve desde las 2:14 AM');
  assert.equal(Es.translateString('Up to 0.5" by 9 AM · snow now'), 'Hasta 0.5" para las 9 AM · nieve ahora');
  assert.equal(Es.translateString('No snow expected by 9 AM.'), 'No se espera nieve para las 9 AM.');
  assert.equal(Es.translateString('as of 2:14 AM'), 'a las 2:14 AM');
  assert.equal(Es.translateString('Would reach callout depth (2)'), 'Llegarían a su profundidad de llamado (2)');
  assert.equal(Es.translateString('· ~3" · callout 2"'), '· ~3" · llamado 2"');
  assert.equal(Es.translateString('1 site has no callout depth set.'), '1 sitio no tiene profundidad de llamado.');
  assert.equal(Es.translateString('5 sites have no callout depth set.'), '5 sitios no tienen profundidad de llamado.');
  // the handoff card: the heading, and a site's parts after its name (one node, " · " joined)
  assert.equal(Es.translateString('Handoff from Night of 12/4 · 8:00 AM · by Alex Test'), 'Entrega de la noche del 12/4 · 8:00 AM · por Alex Test');
  assert.equal(Es.translateString('Handoff from Day of 12/6 · 6:00 PM'), 'Entrega del día del 12/6 · 6:00 PM');
  assert.equal(Es.translateString(' · Sidewalks done, 3 of 5 walks · Started by Alex Test 2:14 AM · Done 3:00 AM'),
    ' · Banquetas listas, 3 de 5 recorridos · Empezado por Alex Test 2:14 AM · Listo 3:00 AM');
  assert.equal(Es.translateString(' · 2 of 4 walks · Night: 1 of 4 walks'), ' · 2 de 4 recorridos · Noche: 1 de 4 recorridos');
  assert.equal(Es.translateString(' · Not started · Started 1:05 AM'), ' · Sin empezar · Empezado 1:05 AM');
  assert.equal(Es.translateString('Left by night (3)'), 'Lo que dejó la noche (3)');
  // the sheets' status lines
  assert.equal(Es.translateString('Sheets: 2 not saved'), 'Hojas: 2 sin guardar');
  assert.equal(Es.translateString('Sheets: 3 of 5 saved · making…'), 'Hojas: 3 de 5 guardadas · haciéndose…');
  assert.equal(Es.translateString('Sheets: 6 saved'), 'Hojas: 6 guardadas');
  assert.equal(Es.translateString('Handoff sheets: 1 not saved'), 'Hojas de entrega: 1 sin guardar');
  assert.equal(Es.translateString('Night sheets saved at handoff 8:00 AM (4)'), 'Hojas de la noche guardadas en la entrega 8:00 AM (4)');
  assert.equal(Es.translateString("2 day handoff sheets couldn't be built on this phone."), 'No se pudieron armar 2 hojas de entrega del día en este teléfono.');
  // dialogs with a site's name inside one node
  assert.equal(Es.translateString('New snow at PAC'), 'Nieve nueva en PAC');
  assert.equal(Es.translateString('Clean PAC again?'), '¿Limpiar PAC de nuevo?');
  // the snow map
  assert.equal(Es.translateString('3 sites not mapped yet'), '3 sitios sin mapa todavía');
  assert.equal(Es.translateString('1 site not mapped yet'), '1 sitio sin mapa todavía');
  assert.equal(Es.translateString('Callouts (2)'), 'Llamados (2)');
});

// Spanish everywhere, Task 5: Matt's and the dispatcher's Board, Add people…, Clear, Callout and the gear Log. The tab names
// and one-word buttons are exact-text rules (a bare "Board" row would bite "Board, not posted yet:"). Names stay as typed.
test('the Board reads Spanish: tabs, buttons, prompts', () => {
  const cases = {
    'Board': 'Tablero', 'Log': 'Registro', 'Roster': 'Personal', 'Post': 'Publicar', 'Callout': 'Llamado', 'Change': 'Cambiar',
    'Card': 'Tarjeta', 'Unassign': 'Quitar de la ruta', 'Unassigned': 'Sin asignar', 'Unplaced': 'Sin asignar',
    'Clear Board': 'Vaciar tablero', 'Clear route': 'Vaciar ruta', 'Add people…': 'Agregar personas…',
    'Place here': 'Poner aquí', 'Place as lead': 'Poner como líder', 'Make lead': 'Hacer líder',
    'Everyone is placed': 'Todos están asignados', 'Changed since post': 'Cambió desde la publicación',
    'Short night: off': 'Noche corta: desactivada',
    'Post to the crew for which shift?': '¿Publicar a la cuadrilla para qué turno?',
    'Callout: who is going out, for which shift?': 'Llamado: ¿quién sale y para qué turno?',
    'Nobody is placed on the board.': 'Nadie está asignado en el tablero.',
    'Log entry': 'Anotación', '+ Entry': '+ Anotación', 'Worker': 'Trabajador', 'Type': 'Tipo', 'Item': 'Artículo', 'Route': 'Ruta', 'Site': 'Sitio',
    'broken': 'roto', 'left on site': 'dejado en el sitio', 'issued': 'entregado', 'returned': 'devuelto', 'choose…': 'elige…',
    'Placed': 'Asignado', 'Worked': 'Trabajó', 'Search name': 'Buscar nombre', 'No people match': 'Ninguna persona coincide',
    'Nobody on this route can drive': 'Nadie en esta ruta puede manejar', 'No lead on this route': 'No hay líder en esta ruta',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('the Board\'s built lines keep their names, numbers and shifts', () => {
  assert.equal(Es.translateString('Crew sees Night of 12/4, posted 8:05 PM'), 'La cuadrilla ve Noche del 12/4, publicado 8:05 PM');
  assert.equal(Es.translateString('Trucks for Night of 12/4'), 'Camionetas de Noche del 12/4');
  assert.equal(Es.translateString('Cleared 3 people'), 'Se quitaron 3 personas');
  assert.equal(Es.translateString('Cleared 1 person'), 'Se quitó 1 persona');
  assert.equal(Es.translateString('Take 3 people off 2 routes?'), '¿Quitar a 3 personas de 2 rutas?');
  assert.equal(Es.translateString('Take 1 person off'), '¿Quitar a 1 persona de');      // then the route's name (data-no-es) and "?"
  assert.equal(Es.translateString('Took 3 people off the Board'), 'Se quitó a 3 personas del tablero');
  assert.equal(Es.translateString('Took 1 person off'), 'Se quitó a 1 persona de');   // then the route's name in its own span (holdNames)
  assert.equal(Es.translateString('Put 3 back. 1 was left as it is.'), 'Se regresaron 3. 1 se quedó como estaba.');
  assert.equal(Es.translateString('Put 1 back.'), 'Se regresó 1.');
  assert.equal(Es.translateString('Put 4 back. 2 were left as they are.'), 'Se regresaron 4. 2 se quedaron como estaban.');
  assert.equal(Es.translateString('Add ticked (3)'), 'Agregar marcados (3)');
  assert.equal(Es.translateString('2 hidden by search'), '2 ocultos por la búsqueda');
  // the Add people toast, cut around its names (route, lead): 'Added 3 to' [Night 2] '. 1 was already on a route and was left. '
  // [Night 2] ' already had a lead: ' [Sam Sample] ' was added as a member'
  assert.equal(Es.translateString('Added 3 to'), 'Se agregaron 3 a');
  assert.equal(Es.translateString('. 1 was already on a route and was left. '), '. 1 ya estaba en una ruta y se dejó. ');
  assert.equal(Es.translateString(' already had a lead: '), ' ya tenía líder: ');
  assert.equal(Es.translateString(' was added as a member'), ' se agregó como miembro');
  // placeFromRoster: [Alex Test] ' taken off the Board' | [Alex Test] ': lead on ' [Night 2] | [Alex Test] ' placed on ' [Night 2]
  assert.equal(Es.translateString(' taken off the Board'), ' quitado del tablero');
  assert.equal(Es.translateString(': lead on '), ': líder en ');
  assert.equal(Es.translateString(' placed on '), ' asignado a ');
  assert.equal(Es.translateString('Posted: the crew see Day of 12/6'), 'Publicado: la cuadrilla ve Día del 12/6');
  assert.equal(Es.translateString('Callout: Night of 12/4'), 'Llamado: Noche del 12/4');
  assert.equal(Es.translateString('Callout saved for Night of 12/4'), 'Llamado guardado para Noche del 12/4');
  assert.equal(Es.translateString('Short night: on (after 1:00 AM)'), 'Noche corta: activada (después de la 1:00 AM)');
  assert.equal(Es.translateString('Short night: on until 9:00 AM'), 'Noche corta: activada hasta las 9:00 AM');
  assert.equal(Es.translateString('3 nights · 1 day'), '3 noches · 1 día');
  assert.equal(Es.translateString('Night 2 · lead'), 'Night 2 · líder');
  assert.equal(Es.translateString('Not saved: Unknown worker C05'), 'No se guardó: Trabajador desconocido C05');
  // the warnings: one node each, a person's name inside
  assert.equal(Es.translateString('Alex Test: JBER clearance expired 2026-10-20'), 'Alex Test: autorización de JBER vencida el 2026-10-20');
  assert.equal(Es.translateString('Alex Test: no JBER clearance'), 'Alex Test: sin autorización de JBER');
  assert.equal(Es.translateString('Alex Test: JBER clearance expires 2026-12-01'), 'Alex Test: la autorización de JBER vence el 2026-12-01');
  assert.equal(Es.translateString("Alex Test rides with Sam Sample, who isn't on this route"), 'Alex Test viaja con Sam Sample, que no está en esta ruta');
  assert.equal(Es.translateString('Alex Test: not cold-rated'), 'Alex Test: no apto para frío');
  assert.equal(Es.translateString('Alex Test: gear needs issuing'), 'Alex Test: hay que entregarle equipo');
  assert.equal(Es.translateString('Alex Test: no valid ID for a cleared site'), 'Alex Test: sin ID vigente para un sitio con autorización');
  assert.equal(Es.translateString('Alex Test: placed but not on call'), 'Alex Test: asignado pero no disponible');
  assert.equal(Es.translateString('Alex Test: Valley, short night (under 8 hours)'), 'Alex Test: El Valle, noche corta (menos de 8 horas)');
  assert.equal(Es.translateString('Alex Test and Sam Sample: keep apart'), 'Alex Test y Sam Sample: mantener separados');
  assert.equal(Es.translateString("Alex Test leads but can't drive"), 'Alex Test es líder pero no puede manejar');
  assert.equal(Es.translateString('No confirmed driver (2 not set)'), 'Sin conductor confirmado (2 sin definir)');
});

// Spanish everywhere, Task 6: Matt's Roster, the worker card and editor, the waiting lists, crew stats. Draft, tú.
test('the Roster, the worker card and crew stats read Spanish', () => {
  const cases = {
    'Add worker': 'Agregar trabajador', 'Search crew': 'Buscar en la cuadrilla', 'No crew yet.': 'Todavía no hay cuadrilla.',
    'No picture': 'Sin foto', 'No one matches': 'Nadie coincide', 'Good lead': 'Buen líder', 'Smokes': 'Fuma',
    'Dispatcher': 'Despachador', 'Operates': 'Opera', 'Traits': 'Cualidades', 'Weaknesses': 'Debilidades', 'Clearances': 'Autorizaciones',
    'Rides with': 'Viaja con', 'Works well with': 'Trabaja bien con', 'Keep apart from': 'Mantener separado de',
    'Waiting to be added': 'Esperando que lo agreguen', 'Place': 'Asignar', 'Stats': 'Estadísticas', 'Edit': 'Editar',
    'nobody': 'nadie', 'Name': 'Nombre', 'Photo': 'Foto', 'Archive': 'Archivar', 'Where they live': 'Dónde vive',
    'Can operate': 'Puede operar', 'Pick a route…': 'Elige una ruta…', 'Hours': 'Horas', 'Machines': 'Máquinas',
    'Sq ft cleared': 'Pies² despejados', 'Help visits': 'Visitas de ayuda', 'Night by night': 'Noche por noche',
    'no End': 'sin salida', 'no-show': 'falta', 'called out': 'llamado', 'Approve': 'Aprobar', 'Reject': 'Rechazar',
    'Add to crew': 'Agregar a la cuadrilla', 'Add a picture first': 'Primero agrega una foto', 'My crew card': 'Mi tarjeta de la cuadrilla',
    'blower': 'soplador', 'shovel': 'pala', 'bobcat': 'bobcat',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('the Roster\'s built lines keep their numbers and names', () => {
  assert.equal(Es.translateString('3 no picture'), '3 sin foto');
  assert.equal(Es.translateString('Current link (#12, not approved right now)'), 'Enlace actual (#12, no aprobado ahora)');
  assert.equal(Es.translateString('Stats · Winter 2026-27'), 'Estadísticas · Invierno 2026-27');
  assert.equal(Es.translateString('5 (called out 1, no-show 0)'), '5 (llamado 1, faltas 0)');
  assert.equal(Es.translateString('12,400 sq ft'), '12,400 pies²');
  assert.equal(Es.translateString('Waiting to be added (2)'), 'Esperando que los agreguen (2)');
  assert.equal(Es.translateString('Waiting for approval (1)'), 'Esperando aprobación (1)');
  assert.equal(Es.translateString(' can sign in now'), ' ya puede iniciar sesión');     // after the person's name, in its own span
  assert.equal(Es.translateString('They can sign in now'), 'Ya puede iniciar sesión');   // no name known
  assert.equal(Es.translateString(' is on the crew'), ' ya está en la cuadrilla');
  assert.equal(Es.translateString(' · lead'), ' · líder');                               // a route's name before it, in its own span
  assert.equal(Es.translateString('blower, bobcat, shovel'), 'soplador, bobcat, pala');
});

// Spanish everywhere, Task 7: Matt's Sites and Routes tabs, the site and route editors, Add sites…, Archived / Restore. Draft, tú.
test('Sites, Routes and their editors read Spanish', () => {
  const cases = {
    'Add site': 'Agregar sitio', 'Add route': 'Agregar ruta', 'Add sites…': 'Agregar sitios…', 'Add sites': 'Agregar sitios',
    'Address': 'Dirección', 'Archived': 'Archivado', 'Restored': 'Restaurado', 'Restore': 'Restaurar',
    'Materials needed (shown to the crew on the map)': 'Materiales que se necesitan (la cuadrilla los ve en el mapa)',
    'e.g. 2-4 bags IceMelt': 'p. ej. 2-4 bolsas de IceMelt',
    'Curbs for the crew': 'Bordillos para la cuadrilla',
    "Off: the curbs stay on your map, the crew doesn't see them": 'No: los bordillos siguen en tu mapa, la cuadrilla no los ve',
    'Callout depth (inches), blank = no nudge': 'Profundidad de llamado (pulgadas), en blanco = sin aviso',
    'Day rank (1 = first on day shift), blank = by choice': 'Orden de día (1 = primero en el turno de día), en blanco = a elección',
    'Move up': 'Subir', 'Move down': 'Bajar', 'Tick all': 'Marcar todos', 'Untick all': 'Desmarcar todos', 'Clear ticks': 'Borrar marcas',
    'Every site is already on this route.': 'Todos los sitios ya están en esta ruta.',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('Sites and Routes: the built lines keep their numbers', () => {
  assert.equal(Es.translateString('3 ticked, not added yet'), '3 marcados, sin agregar todavía');
  assert.equal(Es.translateString('5 added'), '5 agregados');
  assert.equal(Es.translateString('2 hidden by the customer button'), '2 ocultos por el botón del cliente');
  assert.equal(Es.translateString('2 hidden by search and the customer button'), '2 ocultos por la búsqueda y el botón del cliente');
  assert.equal(Es.translateString('Archived (4)'), 'Archivados (4)');
  assert.equal(Es.translateString('1 site'), '1 sitio');
  assert.equal(Es.translateString('7 sites'), '7 sitios');
  assert.equal(Es.translateString('line 2: site is missing · line 4: dates must be YYYY-MM-DD'), 'línea 2: falta el sitio · línea 4: las fechas deben ser AAAA-MM-DD');
});

// Spanish everywhere, Task 8: Matt's map editor, the Bootprint import, the map print page. Draft, tú.
test('the map editor and the Bootprint import read Spanish', () => {
  const cases = {
    'Edit map': 'Editar mapa', 'New zone': 'Zona nueva', 'Edit zone': 'Editar zona', 'Show old map': 'Mostrar mapa viejo',
    'Import from Bootprint': 'Importar de Bootprint', 'Lock corners': 'Bloquear esquinas', 'Unlock corners': 'Desbloquear esquinas',
    'Delete corner': 'Borrar esquina', 'Turn the map left': 'Girar el mapa a la izquierda', 'Turn the map right': 'Girar el mapa a la derecha',
    'Moving map: tap to add corners': 'Moviendo el mapa: toca para agregar esquinas',
    'Adding corners: tap to move map': 'Agregando esquinas: toca para mover el mapa',
    'Tap the map to add corners. Drag a corner to move it.': 'Toca el mapa para agregar esquinas. Arrastra una esquina para moverla.',
    'At least 3 corners. Tap the map to add them.': 'Al menos 3 esquinas. Toca el mapa para agregarlas.',
    'View saved. The crew open here.': 'Vista guardada. La cuadrilla abre aquí.',
    'Pick a job': 'Elige un trabajo', 'Unnamed job': 'Trabajo sin nombre', 'Nothing to add': 'Nada que agregar', 'Hide': 'Ocultar',
    'Site map': 'Mapa del sitio', 'Main entry': 'Entrada principal',
    'That file is not a Bootprint export. Make one at bootprint.app/export.html.': 'Ese archivo no es una exportación de Bootprint. Haz una en bootprint.app/export.html.',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

test('the map editor\'s built lines keep their numbers', () => {
  assert.equal(Es.translateString('Archived zones (2)'), 'Zonas archivadas (2)');
  assert.equal(Es.translateString('Add 1 zone'), 'Agregar 1 zona');
  assert.equal(Es.translateString('Add 4 zones'), 'Agregar 4 zonas');
  assert.equal(Es.translateString('Adding 2 of 4…'), 'Agregando 2 de 4…');
  assert.equal(Es.translateString('3 walks · 1 snow pile to add'), '3 recorridos · 1 montón de nieve por agregar');
  assert.equal(Es.translateString('1 walk to add'), '1 recorrido por agregar');
  assert.equal(Es.translateString('120 m away · 3 walks · 2 snow piles'), 'a 120 m · 3 recorridos · 2 montones de nieve');
  assert.equal(Es.translateString('1.4 km away · 1 walk'), 'a 1.4 km · 1 recorrido');
  assert.equal(Es.translateString('no corners · 0 walks'), 'sin esquinas · 0 recorridos');
  assert.equal(Es.translateString("Left out: 2 lots (the plow crew's), 1 cut-out, 3 runs with no width (set it in Bootprint), 1 already imported"),
    'Se dejaron fuera: 2 lotes (de la cuadrilla de arado), 1 recorte, 3 trazos sin ancho (ponlo en Bootprint), 1 ya importado');
  assert.equal(Es.translateString('Added 4 zones from Bootprint. Tap any heated or do-not-touch one to change it.'),
    'Se agregaron 4 zonas de Bootprint. Toca cualquiera con calefacción o de no tocar para cambiarla.');
  assert.equal(Es.translateString('Added 2 of 5. Stopped: not saved. Import again for the rest.'), 'Se agregaron 2 de 5. Se detuvo: no se guardó. Importa otra vez para el resto.');
  assert.equal(Es.translateString('Getting map 2 of 7 ready…'), 'Preparando el mapa 2 de 7…');   // then the site's name, in its own span
});

// Spanish everywhere, Task 9: the server's refusal words (snow-app-script Code.js, auth.js, roster.js) and the shared files'
// (shiftlog.js), shown after "Not saved:". A validator joins its messages with "; " (Code.js errs.join('; ')): every one reads Spanish.
test('the server\'s refusals read Spanish, one by one and joined', () => {
  assert.equal(Es.translateString('Not saved: Name is required; Customer must be short text, like ANTHC'),
    'No se guardó: El nombre es obligatorio; Cliente debe ser texto corto, como ANTHC');
  assert.equal(Es.translateString('Not saved: Phone is 30 characters at most; That picture is too big'),
    'No se guardó: El teléfono puede tener 30 caracteres como máximo; Esa foto es demasiado grande');
  assert.equal(Es.translateString('Not saved: Only Matt can do that.'), 'No se guardó: Solo Matt puede hacer eso.');
  assert.equal(Es.translateString("Not saved: You're not on tonight's Board. Ask Matt to add you."),
    'No se guardó: No estás en el tablero de esta noche. Pídele a Matt que te agregue.');
  assert.equal(Es.translateString('Not saved: That time is not on the night you picked'), 'No se guardó: Esa hora no está en el turno de noche que elegiste');
  assert.equal(Es.translateString('Not saved: Already handed off at 8:00 AM'), 'No se guardó: Ya se entregó a las 8:00 AM');
  assert.equal(Es.translateString('Not saved: Too many corners (412); the most a zone can hold is 400'),
    'No se guardó: Demasiadas esquinas (412); una zona puede tener como máximo 400');
  assert.equal(Es.translateString('Not saved: works well with must list people on the roster'), 'No se guardó: trabaja bien con debe listar personas de la lista');
  assert.equal(Es.translateString('Not saved: A unit list is 60 characters at most'), 'No se guardó: Una lista de unidades puede tener 60 caracteres como máximo');
  assert.equal(Es.translateString('Not saved: Someone has tapped this walk since'), 'No se guardó: Alguien marcó este recorrido desde entonces');
  assert.equal(Es.translateString('Not saved: A Snowrator has no attachment'), 'No se guardó: Un Snowrator no lleva aditamento');
  assert.equal(Es.translateString('Link copied. Paste it in a text.'), 'Enlace copiado. Pégalo en un mensaje.');
});

// Final review I3 (11/25/26): the rule pass got shortcuts (an exact-text rule is an equality test; the others are skipped when one
// combined test finds nothing). The output must be byte for byte what running every rule in turn gives. The oracle below IS the old
// pass (the dictionary alternation, then each rule in order), copied here so the test does not trust the code it checks.
test('the fast rule pass gives exactly what running every rule in turn gives', () => {
  const keys = Object.keys(Es.ES).sort((a, b) => b.length - a.length);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dict = new RegExp(keys.map((k) => (/^[A-Za-z0-9]/.test(k) ? '\\b' : '') + esc(k) + (/[A-Za-z0-9]$/.test(k) ? '\\b' : '')).join('|'), 'g');
  function slow(v) {
    let s = String(v).replace(/\s+/g, ' ');
    const lead = /^\s/.test(v) ? ' ' : '', trail = /\s$/.test(v) ? ' ' : '';
    s = s.trim();
    if (!s) return v;
    let out = s.replace(dict, (m) => Es.ES[m]);
    Es.ES_RULES.forEach((r) => { out = out.replace(r[0], r[1]); });
    return out === s ? v : lead + out + trail;
  }
  const corpus = [];
  keys.forEach((k) => corpus.push(k, ' ' + k + ' ', k + ':', 'Not saved: ' + k, k + '; ' + k));
  ['Board', 'Hand', 'Hand 300', 'Heated walk', 'Sidewalk 1,200 sq ft', 'Curbs', 'Curbs: clear 4 ft back (about 1,200 ft)', 'Show 9 walks · 3 done',
    '3 of 12 sites done, 1 touched · 2 problems · last tap 2:14 AM · 1 of 3 routes started', 'Up to 3" by 9 AM · snow from 2:14 AM',
    'Handoff from Night of 12/4 · 8:00 AM · by Alex Test', 'Wrong PIN. 3 tries left.', 'Night of 12/4', 'Took 3 people off', 'Left out: 2 lots (the plow crew\'s), 1 cut-out',
    'Not saved: Name is required; Customer must be short text, like ANTHC', 'Pumpkin spice', 'Alex Test', 'PAC', '—', '12:05 AM', 'blower, bobcat, shovel']
    .forEach((x) => corpus.push(x));
  const diff = corpus.filter((s) => Es.translateString(s) !== slow(s)).map((s) => JSON.stringify(s) + ' -> ' + JSON.stringify(Es.translateString(s)) + ' vs ' + JSON.stringify(slow(s)));
  assert.deepEqual(diff, [], diff.length + ' line(s) differ from the rule-by-rule pass');
  assert.ok(corpus.length > 3000, 'a corpus that covers every row');
});
