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
    'Type your first and last name and choose a 4-digit PIN. Matt approves it here in Sidewalk. Then sign in with your name and this PIN.':
      'Escribe tu nombre y apellido y elige un PIN de 4 dígitos. Matt lo aprueba aquí en Sidewalk. Después inicia sesión con tu nombre y este PIN.',
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
