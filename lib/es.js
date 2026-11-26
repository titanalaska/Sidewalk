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
    'Type your first and last name and choose a 4-digit PIN. Matt approves it here in Shovel Command. Then sign in with your name and this PIN.':
      'Escribe tu nombre y apellido y elige un PIN de 4 dígitos. Matt lo aprueba aquí en Shovel Command. Después inicia sesión con tu nombre y este PIN.',
    'Your access is still waiting for Matt to approve it.': 'Tu acceso todavía está esperando que Matt lo apruebe.',
    'Your access is not approved.': 'Tu acceso no está aprobado.',
    "That name is already on the list. If it's you, go back and pick it. If not, add your second last name or a middle initial.":
      'Ese nombre ya está en la lista. Si eres tú, regresa y elígelo. Si no, agrega tu segundo apellido o una inicial.',
    'That name was not approved. Talk to Matt.': 'Ese nombre no fue aprobado. Habla con Matt.',
    'That request is gone. Pull the list again.': 'Esa solicitud ya no existe. Vuelve a cargar la lista.',
    'Try again': 'Intentar de nuevo',
    'try again': 'inténtalo de nuevo',
    'no signal': 'sin señal',
    // --- sign in and access (lib/app.js showSignIn, showNotOnRoster, showPending, request access)
    'Sign in': 'Iniciar sesión',
    "Pick your name, then your PIN. If you use Titan Inventory, it's the same PIN.": 'Elige tu nombre y luego tu PIN. Si usas Titan Inventory, es el mismo PIN.',
    // a new person types their name (Matt, 10/20/26)
    'Not on the list?': '¿No estás en la lista?',
    'Type your name': 'Escribe tu nombre',
    'Your first and last name': 'Tu nombre y apellido',
    'Type your first and last name.': 'Escribe tu nombre y apellido.',
    'Your name': 'Tu nombre',
    'Loading names…': 'Cargando nombres…',
    'Choose your name.': 'Elige tu nombre.',
    'Choose your name': 'Elige tu nombre',
    "Couldn't load names": 'No se pudieron cargar los nombres',
    'First time: Choose a 4-digit PIN': 'Primera vez: elige un PIN de 4 dígitos',
    'Choose a 4-digit PIN': 'Elige un PIN de 4 dígitos',
    'Position': 'Puesto',
    'Sidewalk crew': 'Cuadrilla de banquetas',
    'Send request': 'Enviar solicitud',
    'Name is required.': 'El nombre es obligatorio.',
    'Request sent': 'Solicitud enviada',
    'Matt approves it in Shovel Command. Then come back, pick your name and sign in with your PIN.': 'Matt la aprueba en Shovel Command. Después regresa, elige tu nombre e inicia sesión con tu PIN.',
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
    // the Sites tab's search box (placeholder + aria-label) and its empty line (Matt, 11/15/26); the bare words All and Clear are rules below
    'Search sites': 'Buscar sitios',
    'No sites match': 'Ningún sitio coincide',
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
    'Clear 4 ft back': 'Despejar 4 pies (1.2 m)', // the orange type's label (lib/mapview.js TYPES.hand), Matt 11/12/26
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
    'Check night open': 'Noche de revisión abierta',   // draft, crew read owed
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
    "It's still snowing: sanded anyway": 'Sigue nevando: con arena de todos modos',
    'Sand only, no salt': 'Solo arena, sin sal',
    'Sanded': 'Con arena',
    'New concrete: sand only, no salt': 'Concreto nuevo: solo arena, sin sal',
    'What is the problem?': '¿Cuál es el problema?',
    'Save': 'Guardar',
    'Saved': 'Guardado',
    'Cancel': 'Cancelar',
    'Close': 'Cerrar',
    'Open photo': 'Abrir foto',
    'Pass': 'Pasada',
    'pass': 'pasada',
    'Clean again': 'Limpiar de nuevo',
    // Site done / Site treated (Matt, 11/13/26): the two buttons, the walk list's toggle, the toast of a second phone's tap. The lines with a number are rules below.
    'Site done': 'Sitio terminado',
    'Site treated': 'Sitio tratado',
    'Show walks': 'Ver recorridos',
    'Hide walks': 'Ocultar recorridos',
    'Already done': 'Ya est\u00e1 hecho',
    // the server's three refusals of the two actions (the phone sends a good kind and batch, so the first two are a safety net)
    'Pick Site done or Site treated': 'Elige Sitio terminado o Sitio tratado',
    'Bad batch id': 'Identificador de lote no v\u00e1lido',
    'That tap is not in this storm': 'Esa marca no est\u00e1 en esta tormenta',
    'Yes, clean again': 'Sí, limpiar de nuevo',
    'Site card': 'Tarjeta del sitio',
    // site times (Matt, 11/10/26): the single words Arrived / Left / In / Out / Shift are rules below (exact text nodes), never rows
    'Set times': 'Poner horas',
    'typed by': 'escrito por',
    'Type a start, a finish, or both': 'Escribe una entrada, una salida, o las dos',
    'Leave a box blank to keep that side as the crew tapped it.': 'Deja una casilla en blanco para conservar ese lado como lo tocó la cuadrilla.',
    'Times not saved': 'No se guardaron las horas',
    // shift times (Matt, 11/11/26): the single word Ended is a rule below (an exact text node), never a row
    'Your shift': 'Tu turno',
    'Start shift': 'Empezar turno',
    'End shift': 'Terminar turno',
    'Set shift': 'Poner turno',
    'On the clock since': 'En turno desde',
    'Undo start': 'Deshacer inicio',
    'Undo end': 'Deshacer final',
    'Ask the dispatcher to put you on a route.': 'Pídele al despachador que te ponga en una ruta.',
    'Nothing to change: it was already recorded': 'Nada que cambiar: ya estaba registrado',
    'Shift not saved': 'No se guardó el turno',
    'Held: not shown for a shift this old': 'Registrado: no se muestra para un turno tan antiguo',
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
    'minutes': 'minutos',
    'Notes': 'Notas',
    // Print sheets ends with the night's Crew times (11/11/26)
    'Crew times here cover the last three shifts only. Earlier nights, if any were recorded, are in the saved sheets.': 'Aqu\u00ed las horas del equipo cubren solo los tres \u00faltimos turnos. Las noches anteriores, si se registraron, est\u00e1n en las hojas guardadas.',
    'Crew times here cover the last three shifts only. Earlier nights are saved when the storm ends.': 'Aqu\u00ed las horas del equipo cubren solo los tres \u00faltimos turnos. Las noches anteriores se guardan cuando termina la tormenta.',
    'Not started': 'Sin empezar',
    // M4 (final review): the refusals the start/stop-times actions send a crew phone, shown after "Not saved: " (tu register).
    'No storm is open': 'No hay una tormenta abierta',
    'Arrived or Left': 'Llegu\u00e9 o Sal\u00ed',
    'Unknown site': 'Sitio desconocido',
    'That site is not on your route': 'Ese sitio no est\u00e1 en tu ruta',
    // Help visits (11/15/26): a helper's Left while the site's own crew is still there (snow-app-script siteMark_). Crew read owed.
    "That site's own crew is still there": 'La cuadrilla de ese sitio todav\u00eda est\u00e1 ah\u00ed',
    'No Arrived to take back': 'No hay ning\u00fan "Llegu\u00e9" que deshacer',
    'No Left to take back': 'No hay ning\u00fan "Sal\u00ed" que deshacer',
    'That cannot be undone': 'Eso no se puede deshacer',
    'The dispatcher has not placed you on a route': 'El despachador todav\u00eda no te ha puesto en una ruta',
    'That is not your route': 'Esa no es tu ruta',
    'Start or End': 'Inicio o Final',
    'Nothing to take back': 'No hay nada que deshacer',
    'Pick a route': 'Elige una ruta',
    "The Crew times sheet couldn't be built on this phone.": 'No se pudo armar la hoja de horas del equipo en este tel\u00e9fono.',
    // Print crew times (R47, 11/11/26): the Storm tab's button and its dialog; the night buttons' count is a rule below
    'Print crew times': 'Imprimir horas del equipo',
    'No shift times recorded yet.': 'Todav\u00eda no hay horas de turno registradas.',
    // The print screen's English | Español pair (11/25/26): its aria-label. The two names are each in their own language.
    'Language': 'Idioma',
    // Print map (11/18/26, lib/mapprint.js): the map screen's button, its page and its words
    'Print': 'Imprimir',
    'Getting the map ready to print\u2026': 'Preparando el mapa para imprimir\u2026',
    'Map of': 'Mapa de',
    'Needs clearance:': 'Necesita autorizaci\u00f3n:',
    'Zone': 'Zona',
    'What': 'Qu\u00e9 es',
    'Note': 'Nota',
    'Printed': 'Impreso',
    'The map picture could not be made on this phone. The zone list below is still right.': 'No se pudo hacer la imagen del mapa en este tel\u00e9fono. La lista de zonas de abajo sigue siendo correcta.',
    'Print maps': 'Imprimir mapas',
    "This site's map couldn't be loaded on this phone. Open it in the app with signal, then print it from there.": 'No se pudo cargar el mapa de este sitio en este tel\u00e9fono. \u00c1brelo en la app con se\u00f1al y despu\u00e9s impr\u00edmelo desde ah\u00ed.',
    'No zones drawn on this site yet.': 'Todav\u00eda no hay zonas dibujadas en este sitio.',
    "The map picture couldn't be made. The zone list still prints.": 'No se pudo hacer la imagen del mapa. La lista de zonas s\u00ed se imprime.',
    // Print route lists (11/10/26, lib/routelist.js): the plan on paper, one page per live route
    'Print route lists': 'Imprimir listas de rutas',
    'route lists': 'listas de rutas',
    'route list': 'lista de ruta',
    'Date:': 'Fecha:',
    'Crew:': 'Cuadrilla:',
    'No walks drawn yet.': 'Todavía no hay recorridos dibujados.',
    'In:': 'Entrada:',
    'Out:': 'Salida:',
    // One line per site (11/14/26): the walks that need a word, and the curbs column. No bare 'Curbs' row (see the curb rules).
    'Heated, check only:': 'Con calefacción, solo revisar:',
    'Sand only, no salt:': 'Solo arena, sin sal:',
    'Curbs done': 'Bordillos listos',
    'Notes:': 'Notas:',
    // Route sheet columns (Matt, 11/19/26): the paper route list's new columns and the Equipment cell's words to circle.
    // Bobcat, Snowrator and Sweepster are brand names and have no row. Crew read owed.
    'Shoveled': 'Paleado',
    'Ice melt (bags)': 'Derretidor de hielo (bolsas)',
    'Sand (buckets)': 'Arena (cubetas)',
    'Equipment': 'Equipo',
    // The end-of-night sheet's table headings (Matt, 11/25/26). '#', 'Done' (Listo), 'In' / 'Out' (rules), 'Shoveled' and the two materials
    // headings already read. Crew read owed.
    'Site and notes': 'Sitio y notas',
    'Snow (in)': 'Nieve (pulg)',
    'Equipment (min)': 'Equipo (min)',
    'Bucket': 'Cucharón',
    'Snowblower': 'Soplador de nieve',
    'Operator:': 'Operador:',
    'Walk-behind blower': 'Soplador de empuje',
    'Depth must be a number, zero or more': 'La profundidad debe ser un número, cero o más',
    'Add minutes for': 'Agrega minutos para',
    'Minutes must be a whole number, zero or more': 'Los minutos deben ser un número entero, cero o más',
    // Site card machine lines (Matt, 11/24/26). Crew read owed. The line messages end ', or remove it' (a rule below); the longer
    // server refusals are rows of their own so the shorter 'Pick an attachment for' / 'Add minutes for' never half-translate them.
    'Pick the unit for': 'Elige la unidad de',
    'Pick an attachment for': 'Elige el aditamento de',
    'Pick who ran': 'Elige quién operó',
    'Pick an attachment for each Bobcat': 'Elige un aditamento para cada Bobcat',
    'Pick who ran each machine': 'Elige quién operó cada máquina',
    'Add minutes for each machine': 'Agrega minutos para cada máquina',
    'A unit number is text, 20 characters at most': 'Un número de unidad es texto, 20 caracteres como máximo',
    'Too many machines on one card': 'Demasiadas máquinas en una tarjeta',
    "That person isn't on the roster": 'Esa persona no está en la lista',
    // 'Pick', 'Unit:', 'Minutes:', 'Not sure', 'Remove' are exact text-node RULES below: as rows they bit other screens'
    // sentences ("Pick a worker" read "Elegir a worker").
    'Remove it if you add this': 'Quítalo si agregas este',
    // The Save guard (final fix wave, 11/25/26): the button's second word. Crew read owed.
    'Save anyway': 'Guardar de todos modos',
    'Already logged here this shift:': 'Ya registrado aquí en este turno:',
    'Walk-behind blower minutes': 'Minutos del soplador de empuje',
    // --- the crew's own roster card (lib/rosterui.js) and the trait words it shows (lib/app.js)
    'Hi': 'Hola',
    "You're signed in, but not on the snow crew yet. Fill out your card and Matt will add you.": 'Ya iniciaste sesión, pero todavía no estás en la cuadrilla de nieve. Llena tu tarjeta y Matt te agregará.',
    'Fill out your card': 'Llenar tu tarjeta',
    'Your card is in. Matt will add you to the crew.': 'Tu tarjeta está lista. Matt te agregará a la cuadrilla.',
    'Edit your card': 'Editar tu tarjeta',
    'Check again': 'Revisar de nuevo',
    'Your name is the one you signed in with. The rest is yours to fill in.': 'Tu nombre es con el que iniciaste sesión. El resto lo llenas tú.',
    'Picture on file': 'Foto registrada',
    'No picture yet': 'Sin foto todavía',
    // crew pictures (11/24/26): the bar under the header and the waiting screen's line. Crew read owed.
    'No picture on your card yet. Add one so the dispatcher knows who you are.': 'Tu tarjeta todavía no tiene foto. Agrega una para que el despachador sepa quién eres.',
    'Add picture': 'Agregar foto',
    'Matt needs your picture before he can add you.': 'Matt necesita tu foto antes de poder agregarte.',
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
    'Only the dispatcher and Matt see where you live.': 'Solo el despachador y Matt ven dónde vives.',
    'Lives in': 'Vive en',
    'Valley': 'El Valle',
    'Emergency contact: name': 'Contacto de emergencia: nombre',
    'Emergency contact: phone': 'Contacto de emergencia: teléfono',
    'Only the dispatcher and Matt see your emergency contact.': 'Solo el despachador y Matt ven tu contacto de emergencia.',
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
    // --- crew cards (Matt, 11/24/26): the Crew tab, lib/crewcardsui.js + lib/crewcards.js. Names and a person's own line sit under data-no-es.
    // The tab's name is the rule /^Crew$/ below, never a bare row (it would bite 'Crew bar'). 'Refresh' and 'Edit your card' are rows above.
    // The admins' Crew tab's switch (bottom tabs, 11/25/26): the crew cards are "Cards" there; its Board, Roster and Log are the exact-text
    // rules of Spanish everywhere (Tablero, Personal, Registro). "Cards" is a rule too (the tabs session's note): never a bare row.
    'Nights worked': 'Noches trabajadas',
    'Team sq ft': 'Pies² del equipo',
    'Rookie': 'Novato',
    'Share my card': 'Compartir mi tarjeta',
    "No signal. Your crew's cards come back when you do.": 'Sin señal. Las tarjetas de tu cuadrilla vuelven cuando vuelvas.',
    'No signal. Showing the last copy.': 'Sin señal. Se muestra la última copia.',
    'Could not share the card. Try again.': 'No se pudo compartir la tarjeta. Inténtalo de nuevo.',
    'No phone on file.': 'No hay teléfono registrado.',
    'A line for your card': 'Una frase para tu tarjeta',
    'Their line': 'Su frase',
    'Your line is 40 characters at most': 'Tu frase puede tener 40 caracteres como máximo',
    // --- Spanish everywhere (Matt, 11/25/26: "Full blown everything when you click on it"). Task 3: the lines that came out
    // HALF Spanish because a short row bit into a sentence that had none of its own ("Guardar zone"). The whole phrase wins
    // (longest first). Draft wording, tú; one either/or question through Ben when a word matters (Matt, 11/12/26).
    'Logs own work': 'Registra su propio trabajo',
    'Print map': 'Imprimir mapa',
    '(your own card)': '(tu propia tarjeta)',
    'Photo ready. Save to keep it.': 'Foto lista. Guarda para conservarla.',
    'Seasons must be a whole number': 'Las temporadas deben ser un número entero',
    'Customer (groups the Sites tab, e.g. ANTHC), blank if not set': 'Cliente (agrupa la pestaña Sitios, p. ej. ANTHC), en blanco si no se define',
    'Needs clearance (e.g. JBER), blank if none': 'Necesita autorización (p. ej. JBER), en blanco si no',
    'Bobcat unit # (blank if none; more than one: BC5, BT13)': 'Unidad de Bobcat # (en blanco si no hay; más de una: BC5, BT13)',
    'Snowrator unit # (blank if none; more than one: SR1, SR2)': 'Unidad de Snowrator # (en blanco si no hay; más de una: SR1, SR2)',
    'Sites, in driving order': 'Sitios, en orden de manejo',
    'To rename a site, use its Edit on the Sites tab.': 'Para cambiarle el nombre a un sitio, usa su Editar en la pestaña Sitios.',
    'No sites yet. Add them on the Sites tab.': 'Todavía no hay sitios. Agrégalos en la pestaña Sitios.',
    'Lives in the Valley': 'Vive en el Valle',
    'Some fields not set': 'Algunos datos sin definir',
    'Trucks: Save asks which shift': 'Camionetas: Guardar pregunta qué turno',
    'Trucks: nothing is posted, so Save asks which shift': 'Camionetas: no hay nada publicado, así que Guardar pregunta qué turno',
    'No routes yet. Add them on the Routes tab.': 'Todavía no hay rutas. Agrégalas en la pestaña Rutas.',
    'is no longer on the crew list. Untick them and try again.': 'ya no está en la lista de la cuadrilla. Desmárcalo e inténtalo de nuevo.',
    'Gear on hand': 'Equipo a la mano',
    'none logged': 'ninguno registrado',
    'Save callout': 'Guardar llamado',
    'Save view': 'Guardar vista',
    'Note for the crew (optional)': 'Nota para la cuadrilla (opcional)',
    'Save zone': 'Guardar zona',
    'Pick a type: Sidewalk, Hand, Heated, Snow storage or Do not touch.': 'Elige un tipo: Banqueta, A mano, Con calefacción, Depósito de nieve o No tocar.',
    'The outline crosses itself. Move a corner or Undo.': 'El contorno se cruza consigo mismo. Mueve una esquina o toca Deshacer.',
    'Zone saved': 'Zona guardada',
    'Zone archived': 'Zona archivada',
    'Zone restored': 'Zona restaurada',
    'Still saving. Try Save view again in a moment.': 'Todavía se está guardando. Intenta Guardar vista de nuevo en un momento.',
    'They filled out their own card. Add to crew puts them on the roster; tap the name to see the card.':
      'Llenaron su propia tarjeta. Agregar a la cuadrilla los pone en la lista; toca el nombre para ver la tarjeta.',
    'That tap is from an earlier pass': 'Esa marca es de una pasada anterior',
    'Sheets: none (nothing logged)': 'Hojas: ninguna (nada registrado)',
    'Sheets are being made now; your Retry is queued': 'Las hojas se están haciendo ahora; tu Reintentar quedó en espera',
    'Retry not sent:': 'No se envió Reintentar:',
    "The sheets couldn't be built on this phone. Try again.": 'No se pudieron armar las hojas en este teléfono. Inténtalo de nuevo.',
    'Print sheets': 'Imprimir hojas',
    'No sheets yet: no route has a tap, a site card or a posted crew this storm.':
      'Todavía no hay hojas: ninguna ruta tiene una marca, una tarjeta del sitio ni una cuadrilla publicada en esta tormenta.',
    "The route lists couldn't be built on this phone. Try again.": 'No se pudieron armar las listas de rutas en este teléfono. Inténtalo de nuevo.',
    "Tonight's outlook": 'Pronóstico de esta noche',
    'The forecast could not be fetched. Try again.': 'No se pudo obtener el pronóstico. Inténtalo de nuevo.',
    'from the Board (not posted)': 'del tablero (no publicado)',
    'Close check night': 'Cerrar noche de revisión',
    'Close storm (cleanup done)': 'Cerrar tormenta (limpieza terminada)',
    'Snow stopped (melt + rock OK)': 'Nieve detenida (derretidor + grava OK)',
    'Copied. Paste it into the BT Notes': 'Copiado. Pégalo en las Notas de BT',
    'Close the check night?': '¿Cerrar la noche de revisión?',
    'Close the storm?': '¿Cerrar la tormenta?',
    'Copy for BT': 'Copiar para BT',   // the button; the TEXT it copies stays English (BuilderTrend)
    // the server's own refusals (snow-app-script Code.js, auth.js, roster.js), shown after "Not saved:", joined by "; "
    'Busy, try again.': 'Ocupado, inténtalo de nuevo.',
    'You cannot change your own dispatcher mark': 'No puedes cambiar tu propia marca de despachador',
    'Equipment must list minutes by machine': 'El equipo debe listar los minutos por máquina',
    'Session expired. Sign in again.': 'La sesión expiró. Inicia sesión de nuevo.',
    'Home area must be Valley, Anchorage or not set': 'La zona donde vives debe ser El Valle, Anchorage o sin definir',
    'Gear must be own or needs issued': 'El equipo debe ser propio o se necesita entregar',
    'Someone changed this since you opened it. Reload and try again.': 'Alguien cambió esto desde que lo abriste. Vuelve a cargar e inténtalo de nuevo.',
    'Dispatcher must be yes, no or not set': 'Despachador debe ser sí, no o sin definir',
    'Curbs for the crew must be yes or no': 'Bordillos para la cuadrilla debe ser sí o no',
    'Gear needs a calendar date (YYYY-MM-DD)': 'El equipo necesita una fecha (AAAA-MM-DD)',
    'New concrete must be yes or no': 'Concreto nuevo debe ser sí o no',
    // --- Spanish everywhere, Task 4: the leads' and the dispatcher's Storm tab (storm controls and confirms, the live view,
    // Tonight's outlook, the handoff card, the sheets' status, Set truck, New snow, Copy for BT's panel). Draft, tú.
    'Start storm': 'Empezar tormenta',
    'Start check night': 'Empezar noche de revisión',
    'Reopen storm': 'Reabrir tormenta',
    'Make it a storm': 'Convertir en tormenta',
    'Night shift on': 'Turno de noche activado',
    'Start a new storm?': '¿Empezar una tormenta nueva?',
    'Every walk goes back to not done. Nothing already logged is deleted.': 'Cada recorrido vuelve a Pendiente. No se borra nada de lo ya registrado.',
    'Yes, start storm': 'Sí, empezar tormenta',
    'Start a check night?': '¿Empezar una noche de revisión?',
    'Crews mark Arrived and Left at each site. Nothing already logged is deleted.': 'Las cuadrillas marcan Llegué y Salí en cada sitio. No se borra nada de lo ya registrado.',
    'Yes, start check night': 'Sí, empezar noche de revisión',
    'Make this check night a storm?': '¿Convertir esta noche de revisión en tormenta?',
    "Every walk goes back to not done for the storm. It can't go back to a check night.": 'Cada recorrido vuelve a Pendiente para la tormenta. Ya no puede volver a ser noche de revisión.',
    'Yes, make it a storm': 'Sí, convertir en tormenta',
    'The crew can no longer mark walks until it is reopened.': 'La cuadrilla ya no puede marcar recorridos hasta que se reabra.',
    'Yes, close check night': 'Sí, cerrar noche de revisión',
    'Yes, close storm': 'Sí, cerrar tormenta',
    'Are you sure?': '¿Estás seguro?',
    'Hand off now': 'Entregar ahora',
    'Hand off to day now?': '¿Entregar al turno de día ahora?',
    "The night's sheets are saved and the day crew sees what's left.": 'Las hojas de la noche se guardan y la cuadrilla de día ve lo que queda.',
    'Yes, hand off': 'Sí, entregar',
    'Day routes': 'Rutas de día',
    'Night left nothing.': 'La noche no dejó nada.',
    'Sidewalks done,': 'Banquetas listas,',
    'Night:': 'Noche:',
    'Live view': 'Vista en vivo',
    'Type the truck first': 'Escribe la camioneta primero',
    'Trucks for which shift?': '¿Camionetas para qué turno?',
    'Truck saved': 'Camioneta guardada',
    'Truck:': 'Camioneta:',
    'Handoff sheets: making…': 'Hojas de entrega: haciéndose…',
    'Sheets: making…': 'Hojas: haciéndose…',
    'Retrying the sheets that were not saved. They are made in about a minute.': 'Reintentando las hojas que no se guardaron. Se hacen en más o menos un minuto.',
    'Nothing to retry.': 'Nada que reintentar.',
    "The day handoff sheets couldn't be built on this phone.": 'No se pudieron armar las hojas de entrega del día en este teléfono.',
    'Inches since the last cleaning': 'Pulgadas desde la última limpieza',
    'Type the inches first': 'Escribe las pulgadas primero',
    'New snow': 'Nieve nueva',
    'no taps yet': 'sin toques todavía',
    'no forecast': 'sin pronóstico',
    'Check outlook': 'Revisar pronóstico',
    'No site reaches its callout depth.': 'Ningún sitio llega a su profundidad de llamado.',
    'BT post:': 'Nota de BT:',
    'Time In': 'Entrada (Time In)',          // BuilderTrend's own field names stay beside the Spanish: the lead types into them
    'Time Out': 'Salida (Time Out)',
    "Paste into the site's Daily Log in BuilderTrend, pick crew and equipment there, add your photos.":
      'Pégalo en el Daily Log del sitio en BuilderTrend, elige ahí la cuadrilla y el equipo, y agrega tus fotos.',
    'Copy notes': 'Copiar notas',
    'Press and hold the text to copy it': 'Mantén presionado el texto para copiarlo',
    'That zone is not walked at this site': 'Esa zona no se recorre en este sitio',
    'No zones yet': 'Todavía no hay zonas',
    'Checking…': 'Revisando…',
    'Make it a storm first': 'Primero toca Convertir en tormenta',   // the server, refusing Snowing on a check night
    // --- Spanish everywhere, Task 5: Matt's and the dispatcher's Board, Add people…, Clear, Callout and the gear Log. Draft, tú.
    'Unassigned': 'Sin asignar',
    'Clear Board': 'Vaciar tablero',
    'Clear route': 'Vaciar ruta',
    'Add people…': 'Agregar personas…',
    'Place here': 'Poner aquí',
    'Place as lead': 'Poner como líder',
    'Make lead': 'Hacer líder',
    'Everyone is placed': 'Todos están asignados',
    'Changed since post': 'Cambió desde la publicación',
    'Tap a route for': 'Toca una ruta para',
    'Short night: off': 'Noche corta: desactivada',
    'the server is not updated yet': 'el servidor todavía no está actualizado',
    "Couldn't check who is on the clock.": 'No se pudo revisar quién está en turno.',
    'A storm is open: people off the Board cannot tap until they are placed again.': 'Hay una tormenta abierta: quien quede fuera del tablero no puede marcar hasta que lo vuelvan a asignar.',
    'The crew still sees the last Post until you tap Post.': 'La cuadrilla sigue viendo la última publicación hasta que toques Publicar.',
    'Already saved': 'Ya estaba guardado',
    'Nobody to take off': 'No hay nadie que quitar',
    'Nothing to put back': 'Nada que regresar',
    'No people match': 'Ninguna persona coincide',
    'Add people to': 'Agregar personas a',
    'Search name': 'Buscar nombre',
    'Nobody added': 'No se agregó a nadie',
    'Still saving the last move…': 'Todavía se está guardando el último movimiento…',
    'Nothing to change': 'Nada que cambiar',
    'never placed': 'nunca asignado',
    'Nobody is placed on the board.': 'Nadie está asignado en el tablero.',
    "Tap anyone who didn't show. They won't get this shift.": 'Toca a quien no se presentó. Se queda fuera de este turno.',
    'Post to the crew for which shift?': '¿Publicar a la cuadrilla para qué turno?',
    'Callout: who is going out, for which shift?': 'Llamado: ¿quién sale y para qué turno?',
    'All workers': 'Todos los trabajadores',
    'All types': 'Todos los tipos',
    '+ Entry': '+ Anotación',
    'Nothing logged yet.': 'Todavía no hay nada registrado.',
    'Log entry': 'Anotación',
    'e.g. Blower #3 shear pin, Parka': 'p. ej. perno del Blower #3, parka',
    'choose…': 'elige…',
    'Pick a worker': 'Elige un trabajador',
    'Item is required': 'El artículo es obligatorio',
    'Pick a shift': 'Elige un turno',
    'Pick somebody': 'Elige a alguien',
    'The lead must be one of the people added': 'El líder debe ser una de las personas agregadas',
    'New: never on a route': 'Nuevos: nunca en una ruta',
    'Everyone else': 'Todos los demás',
    'already had a lead:': 'ya tenía líder:',
    'was added as a member': 'se agregó como miembro',
    'No lead on this route': 'No hay líder en esta ruta',
    'Nobody on this route can drive': 'Nadie en esta ruta puede manejar',
    // --- Spanish everywhere, Task 6: Matt's Roster, the worker card and editor, the waiting lists, crew stats. Draft, tú.
    'Good lead': 'Buen líder',
    'No picture': 'Sin foto',
    'No one matches': 'Nadie coincide',
    'Add worker': 'Agregar trabajador',
    'Search crew': 'Buscar en la cuadrilla',
    'No crew yet.': 'Todavía no hay cuadrilla.',
    'Rides with': 'Viaja con',
    'Works well with': 'Trabaja bien con',
    'Keep apart from': 'Mantener separado de',
    'Waiting to be added': 'Esperando que lo agreguen',
    'nobody else yet': 'nadie más todavía',
    'Where they live': 'Dónde vive',
    'Sign-in (Titan Inventory name)': 'Inicio de sesión (nombre en Titan Inventory)',
    'No sign-in yet': 'Sin inicio de sesión todavía',
    "Names couldn't load, so the sign-in link stays as it is.": 'No se pudieron cargar los nombres, así que el enlace de inicio de sesión se queda como está.',
    'Has a photo': 'Tiene foto',
    'No photo': 'Sin foto',
    'Can operate': 'Puede operar',
    "That file isn't a photo this phone can read.": 'Ese archivo no es una foto que este teléfono pueda leer.',
    'Clearances, one per line: SITE | yes/no | cleared date | expires (YYYY-MM-DD)': 'Autorizaciones, una por línea: SITIO | sí/no | fecha de autorización | vence (AAAA-MM-DD)',
    'Pick a route…': 'Elige una ruta…',
    'My crew card': 'Mi tarjeta de la cuadrilla',
    'Sq ft cleared': 'Pies² despejados',
    'Help visits': 'Visitas de ayuda',
    'No nights yet this winter.': 'Todavía no hay noches este invierno.',
    'Night by night': 'Noche por noche',
    'Loading stats…': 'Cargando estadísticas…',
    'Could not load the stats.': 'No se pudieron cargar las estadísticas.',
    'Requests from the sign-in screen. Approve lets them sign in and fill out their card.': 'Solicitudes desde la pantalla de inicio de sesión. Aprobar les deja iniciar sesión y llenar su tarjeta.',
    'Really reject?': '¿Seguro que lo rechazas?',
    'Not approved:': 'No se aprobó:',
    'Not rejected:': 'No se rechazó:',
    'They can sign in now': 'Ya puede iniciar sesión',
    'Request rejected': 'Solicitud rechazada',
    'Add to crew': 'Agregar a la cuadrilla',
    'Add a picture first': 'Primero agrega una foto',
    // --- Spanish everywhere, Task 7: Matt's Sites and Routes tabs, the editors, Add sites…, Archived / Restore. Draft, tú.
    'Add site': 'Agregar sitio',
    'Add route': 'Agregar ruta',
    'Add sites…': 'Agregar sitios…',
    'Add sites': 'Agregar sitios',
    'Materials needed (shown to the crew on the map)': 'Materiales que se necesitan (la cuadrilla los ve en el mapa)',
    'e.g. 2-4 bags IceMelt': 'p. ej. 2-4 bolsas de IceMelt',
    'Curbs for the crew': 'Bordillos para la cuadrilla',
    "Off: the curbs stay on your map, the crew doesn't see them": 'No: los bordillos siguen en tu mapa, la cuadrilla no los ve',
    'Callout depth (inches), blank = no nudge': 'Profundidad de llamado (pulgadas), en blanco = sin aviso',
    'Day rank (1 = first on day shift), blank = by choice': 'Orden de día (1 = primero en el turno de día), en blanco = a elección',
    'Move up': 'Subir',
    'Move down': 'Bajar',
    'Tick all': 'Marcar todos',
    'Untick all': 'Desmarcar todos',
    'Clear ticks': 'Borrar marcas',
    'Every site is already on this route.': 'Todos los sitios ya están en esta ruta.',
    'Board, not posted yet:': 'Tablero, todavía no publicado:',   // the live view; the names follow, each in its own span
    // MapLibre's own controls (vendor/maplibre-gl.js sets these as title / aria-label; the engine translates attributes)
    'Zoom in': 'Acercar',
    'Zoom out': 'Alejar',
    'Reset bearing to north': 'Orientar al norte',
    'Map marker': 'Marcador del mapa',
    'Toggle attribution': 'Mostrar u ocultar créditos',
    'Close popup': 'Cerrar ventana',
    'Every walk at': 'Cada recorrido en',   // the Clean again confirm: [site] and the rest follow (final review I1)
    // --- Spanish everywhere, Task 8: Matt's map editor, the Bootprint import, the map print page. Draft, tú.
    'Edit map': 'Editar mapa',
    'New zone': 'Zona nueva',
    'Edit zone': 'Editar zona',
    'Show old map': 'Mostrar mapa viejo',
    'Import from Bootprint': 'Importar de Bootprint',
    'Tap a zone to change it, or New zone to draw one.': 'Toca una zona para cambiarla, o Zona nueva para dibujar una.',
    'Lock corners': 'Bloquear esquinas',
    'Unlock corners': 'Desbloquear esquinas',
    'Delete corner': 'Borrar esquina',
    'Turn the map left': 'Girar el mapa a la izquierda',
    'Turn the map right': 'Girar el mapa a la derecha',
    'Moving map: tap to add corners': 'Moviendo el mapa: toca para agregar esquinas',
    'Adding corners: tap to move map': 'Agregando esquinas: toca para mover el mapa',
    'Tap the map to add corners. Drag a corner to move it.': 'Toca el mapa para agregar esquinas. Arrastra una esquina para moverla.',
    'Main entry': 'Entrada principal',   // the zone name box's example (placeholder); a zone a person named "Main entry" sits under data-no-es
    'At least 3 corners. Tap the map to add them.': 'Al menos 3 esquinas. Toca el mapa para agregarlas.',
    'Still adding zones. Wait for it to finish.': 'Todavía se están agregando zonas. Espera a que termine.',
    'Still saving. Try Restore again in a moment.': 'Todavía se está guardando. Intenta Restaurar de nuevo en un momento.',
    'View saved. The crew open here.': 'Vista guardada. La cuadrilla abre aquí.',
    'Nearest this site first. Pick the job that measured it.': 'Primero el más cercano a este sitio. Elige el trabajo que lo midió.',
    'Unnamed job': 'Trabajo sin nombre',
    'Open in Bootprint (not filed yet)': 'Abierto en Bootprint (todavía sin archivar)',
    'Pick a job': 'Elige un trabajo',
    'Nothing to add': 'Nada que agregar',
    'Old map: on this screen only, never saved': 'Mapa viejo: solo en esta pantalla, nunca se guarda',
    'Old route-sheet map': 'Mapa viejo de la hoja de ruta',
    'Site map': 'Mapa del sitio',
    'That file is not a Bootprint export. Make one at bootprint.app/export.html.': 'Ese archivo no es una exportación de Bootprint. Haz una en bootprint.app/export.html.',
    // --- Spanish everywhere, Task 9: the server's refusal words (snow-app-script Code.js, auth.js, roster.js) and the shared
    // files' (lib/shiftlog.js), shown after "Not saved:"; a validator joins its messages with "; ". Draft, tú.
    'Link copied. Paste it in a text.': 'Enlace copiado. Pégalo en un mensaje.',
    'Copy this and text it:': 'Copia esto y mándalo por mensaje:',
    'This zone is not walked': 'Esta zona no se recorre',
    'That is not a state for this zone': 'Ese no es un estado para esta zona',
    'Say what the problem is': 'Di cuál es el problema',
    'Nothing to clean again yet': 'Todavía no hay nada que limpiar de nuevo',
    'Machines must be a list': 'Las máquinas deben ser una lista',
    'Someone has tapped this site since': 'Alguien marcó este sitio desde entonces',
    'Someone has tapped this walk since': 'Alguien marcó este recorrido desde entonces',
    'Unknown machine': 'Máquina desconocida',
    'A Snowrator has no attachment': 'Un Snowrator no lleva aditamento',
    'A truck is 1 to 20 characters': 'Una camioneta tiene de 1 a 20 caracteres',
    'Unknown route': 'Ruta desconocida',
    "Only Matt or that route's lead can set its truck.": 'Solo Matt o el líder de esa ruta puede poner su camioneta.',
    'Materials must be text': 'Los materiales deben ser texto',
    'Unknown equipment': 'Equipo desconocido',
    'Nothing to archive.': 'Nada que archivar.',
    'Unknown storm': 'Tormenta desconocida',
    'That storm is open: its sheets are made when it is ended': 'Esa tormenta está abierta: sus hojas se hacen cuando termina',
    'Nothing to restore.': 'Nada que restaurar.',
    'That one is not archived.': 'Eso no está archivado.',
    "It isn't night shift": 'No es el turno de noche',
    'Nothing to hand off yet': 'Todavía no hay nada que entregar',
    'An admin sign-in has no crew card': 'Un inicio de sesión de administrador no tiene tarjeta de la cuadrilla',
    'Pick add, clear or undo': 'Elige agregar, vaciar o deshacer',
    'That clear is not on the Board': 'Ese vaciado no está en el tablero',
    'Unknown storm control': 'Control de tormenta desconocido',
    'Check must be true or left out': 'La revisión debe ser verdadera o quedar fuera',
    'End the storm first': 'Primero termina la tormenta',
    'The storm is already open': 'La tormenta ya está abierta',
    'There is no storm to reopen': 'No hay tormenta que reabrir',
    'No check night is open': 'No hay una noche de revisión abierta',
    'Depth is 0 to 60 inches': 'La profundidad es de 0 a 60 pulgadas',
    "You're not on tonight's Board. Ask Matt to add you.": 'No estás en el tablero de esta noche. Pídele a Matt que te agregue.',
    "Only Matt or a route lead on tonight's Board can do that.": 'Solo Matt o un líder de ruta en el tablero de esta noche puede hacer eso.',
    'The finish is before the start': 'La salida es antes de la entrada',
    'That shift is not part of this storm': 'Ese turno no es parte de esta tormenta',
    'A time is YYYY-MM-DDTHH:MM, a real date and minute': 'Una hora es AAAA-MM-DDTHH:MM, una fecha y un minuto reales',
    'A time cannot be in the future': 'Una hora no puede estar en el futuro',
    'Only Matt can do that.': 'Solo Matt puede hacer eso.',
    'Pick a person': 'Elige una persona',
    'Unknown person': 'Persona desconocida',
    'Profile no longer exists': 'El perfil ya no existe',
    'Profile is not approved': 'El perfil no está aprobado',
    "You're signed in, but not on the snow crew yet. Ask Matt to add you.": 'Ya iniciaste sesión, pero todavía no estás en la cuadrilla de nieve. Pídele a Matt que te agregue.',
    'That picture is not a JPEG': 'Esa foto no es JPEG',
    'That picture is too big': 'Esa foto es demasiado grande',
    'That record no longer exists. Reload.': 'Ese registro ya no existe. Vuelve a cargar.',
    'Name is required': 'El nombre es obligatorio',
    'Needs clearance must be short text, like JBER': 'Necesita autorización debe ser texto corto, como JBER',
    'Customer must be short text, like ANTHC': 'Cliente debe ser texto corto, como ANTHC',
    'Callout depth is inches, more than 0 and at most 24': 'La profundidad de llamado es en pulgadas, más de 0 y como máximo 24',
    'Day rank is a whole number from 1 to 99': 'El orden de día es un número entero de 1 a 99',
    'Units are bobcat and snowrator only': 'Las unidades son solo bobcat y snowrator',
    'A move needs a time': 'Un movimiento necesita una hora',
    'Role must be lead or member on a route, and empty off one': 'El papel debe ser líder o miembro en una ruta, y vacío fuera de una ruta',
    'Shift must be night-YYYY-MM-DD or day-YYYY-MM-DD': 'El turno debe ser night-AAAA-MM-DD o day-AAAA-MM-DD',
    'A zone needs at least 3 corners': 'Una zona necesita al menos 3 esquinas',
    'A corner is not a map position': 'Una esquina no es una posición en el mapa',
    'That outline crosses itself': 'Ese contorno se cruza consigo mismo',
    'Rides with must be someone else on the roster': 'Viaja con debe ser otra persona de la lista',   // the server's roster check
  };

  // Applied after the dictionary pass, in order, for the phrases whose word order
  // changes around a number or a name. The dictionary must not hold a bare word
  // these patterns begin with ("Snow", "Curbs"), or the pass would eat the front
  // of the phrase before the rule sees it; "Pass" and "Clean again" ARE rows, so
  // the clean-again line is matched in its half-translated form.
  var ES_RULES = [
    [/^Snow until (.+)$/, 'Nieve hasta las $1'],
    // crew cards (11/24/26): the tab name and the card's number words, whole text nodes only
    [/^Crew$/, 'Cuadrilla'],
    [/^(\d+) seasons$/, '$1 temporadas'],
    [/^about (\d+) football fields?$/, function (m, n) { return Number(n) === 1 ? 'un campo de fútbol americano' : 'unos ' + n + ' campos de fútbol americano'; }],
    [/^Winter (\S+) · counted at (.+)$/, 'Invierno $1 · contado a las $2'],
    [/^Winter (\S+)$/, 'Invierno $1'],   // the shared picture's footer words
    // the site card's times line: exactly "Start" then "· Finish" as text nodes (never a bare 'Start' row:
    // it would turn a lead's "Start storm" into "Inicio storm")
    [/^Start$/, 'Inicio'],
    // the Sites tab's customer button "All <count>" and its Clear (Matt, 11/15/26): exact text nodes, because a bare row would turn
    // "Clear all snow" or "All sites" half Spanish; the button's count sits in its own element
    [/^All$/, 'Todos'],
    // the Directions link (Matt, 11/20/26): the bare word only as a whole text node
    [/^Directions$/, 'Cómo llegar'],
    // the Next site bar's label (Matt, 11/20/26): only the bare label
    [/^Next:$/, 'Siguiente:'],
    [/^Clear$/, 'Borrar'],
    // site times (11/11/26): exact text nodes, because a bare row would bite longer English ("Left by night", "Sign in")
    [/^Arrived$/, 'Llegué'],
    [/^Left$/, 'Salí'],
    [/^In$/, 'Entrada'],
    [/^Out$/, 'Salida'],
    [/^typed$/, 'escrito'],
    [/^Shift$/, 'Turno'],
    // shift times (11/11/26): the line on the card and the Board; the counts after a tap (from the server's `written`)
    [/^Ended$/, 'Terminó'],
    [/^Started for (\d+) (?:person|people)$/, function (m, n) { return 'Empezó el turno para ' + n + (Number(n) === 1 ? ' persona' : ' personas'); }],
    [/^Ended for (\d+) (?:person|people)$/, function (m, n) { return 'Terminó el turno para ' + n + (Number(n) === 1 ? ' persona' : ' personas'); }],
    [/^Start taken back for (\d+) (?:person|people)$/, function (m, n) { return 'Se deshizo el inicio para ' + n + (Number(n) === 1 ? ' persona' : ' personas'); }],
    [/^End taken back for (\d+) (?:person|people)$/, function (m, n) { return 'Se deshizo el final para ' + n + (Number(n) === 1 ? ' persona' : ' personas'); }],
    [/^Held$/, 'Registrado'],
    [/^nothing yet$/, 'nada todavía'],
    [/^Saved$/, 'Guardado'],
    [/^on (\d+\/\d+)$/, 'el $1'],
    [/^Night of (\d+\/\d+)$/, 'Noche del $1'],
    // Print crew times: one button per night, 'Night of 12/4 \u00b7 3 people' / 'Day of 12/6 \u00b7 1 person' (CrewTime.shiftLabel, then the count)
    [/^(Night|Day) of (\d+\/\d+) \u00b7 (\d+) (?:person|people)$/, function (m, k, d, n) { return (k === 'Night' ? 'Noche del ' : 'D\u00eda del ') + d + ' \u00b7 ' + n + (Number(n) === 1 ? ' persona' : ' personas'); }],
    [/^Day of (\d+\/\d+)$/, 'Día del $1'],
    [/^· Finish$/, '· Fin'],
    // after the 'Wrong PIN.' row
    [/^PIN incorrecto\. (\d+) tries left\.$/, 'PIN incorrecto. Quedan $1 intentos.'],
    // after the 'Add minutes for' row
    [/, or untick it$/, ', o desmárcala'],
    [/, or remove it$/, ', o quítala'],
    // Site card machine lines (11/24/26). Bobcat / Snowrator, the unit and the names are kept; each text node is matched whole.
    [/^(.+?) is on (.+?) twice$/, '$1 está en $2 dos veces'],
    [/^(.+?) is on two (Bobcat|Snowrator)s with no unit: pick the units$/, '$1 está en dos $2s sin unidad: elige las unidades'],
    [/^\+ Add a$/, '+ Agregar un'],
    [/^Attachment for (.+)$/, 'Aditamento para $1'],
    [/^(.+?) min, saved before machine lines$/, '$1 min, guardado antes de las líneas de máquina'],
    [/^as a line$/, 'como una línea'],
    [/^logged$/, 'registró a'],
    [/^later; that line counts\.$/, 'después; esa línea cuenta.'],
    // the card's bare words, whole text nodes only (final fix wave, 11/25/26)
    [/^Pick$/, 'Elegir'],
    [/^Remove$/, 'Quitar'],
    [/^Not sure$/, 'No sé'],
    [/^Unit:$/, 'Unidad:'],
    [/^Minutes:$/, 'Minutos:'],
    // the Unit pick's own units: one option text "<unit> (this site)"; the unit is copied as it is
    [/^(.+) \(this site\)$/, '$1 (este sitio)'],
    // a line the operator logged again on their own card (the replacing card's saver IS the operator)
    [/^logged this line again later; that line counts\.$/, 'registró esta línea de nuevo después; esa línea cuenta.'],
    // the Save guard's notice, split around the saver, the machine and the operator (each data-no-es). Crew read owed.
    // "Snowblower" / "Bucket" are rows, so the attachment's piece is matched in its half-translated form.
    [/^Saving replaces$/, 'Al guardar se reemplaza la línea de'],
    [/^'s$/, ':'],
    [/^(Soplador de nieve|Cucharón) line for$/, '$1 para'],
    [/^line for$/, 'para'],
    [/^\((\d+) min\)\. Add it here too if they ran it\.$/, '($1 min). Agrégala aquí también si la operó.'],
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
    // lib/shiftlog.js curbItems(): 'Curbs' or 'Curbs <g> of <k>', then ': clear <width> ft back', then ' (about <feet with commas> ft)' (Matt, 11/12/26).
    // The metres are the feet x 0.3048 to one decimal (4 ft = 1.2 m). A walk a person named 'Curbs at dock' matches nothing here.
    [/^Curbs(?: (\d+) of (\d+))?: clear (\d+) ft back(?: \(about ([\d,]+) ft\))?$/, function (m, g, k, w, ft) {
      return 'Bordillos' + (g ? ' ' + g + ' de ' + k : '') + ': despejar ' + w + ' pies (' + (Number(w) * 0.3048).toFixed(1) + ' m)' + (ft ? ' (unos ' + ft + ' pies)' : '');
    }],
    // Site done / Site treated, the folded line's parts (each its own text node) and the Undo toast (lib/shiftlogui.js siteLineHtml, afterSiteReply).
    // 'All 1 walk done' / 'All <n> walks done'; '<k> of <n> walks done'; '<p> problem(s)'; 'Curbs: <c> left'. No bare row 'Curbs' or 'problem' may exist.
    [/^All (\d+) walks? done$/, function (m, n) { return Number(n) === 1 ? '1 recorrido terminado' : 'Los ' + n + ' recorridos terminados'; }],
    // A big site's toggle (lib/shiftlogui.js bigToggleHtml, 11/19/26): 'Show <n> walks' with ' \u00b7 <k> done' when any is done. The name bar needs no row (a site's name is data-no-es).
    [/^Show (\d+) walks(?: \u00b7 (\d+) done)?$/, function (m, n, k) { return 'Ver ' + n + ' recorridos' + (k === undefined ? '' : ' \u00b7 ' + k + (Number(k) === 1 ? ' terminado' : ' terminados')); }],
    [/^(\d+) of (\d+) walks done$/, '$1 de $2 recorridos terminados'],
    [/^(\d+) problems?$/, function (m, n) { return n + (Number(n) === 1 ? ' problema' : ' problemas'); }],
    [/^Curbs: (\d+) left$/, 'Bordillos: faltan $1'],
    // walk totals (Matt, 11/23/26), lib/totals.js walkParts(): each part is its own text node, 'Sidewalk <n> sq ft' / 'Heated <n>' / 'Hand <n>',
    // "sq ft" on the first part only. The dictionary has already made the bare word Sidewalk Banqueta; no bare 'Heated' or 'Hand' row may exist.
    [/^(Banqueta|Heated|Hand) ([\d,]+)( sq ft)?$/, function (m, k, n, u) {
      return { Banqueta: 'Banqueta', Heated: 'Con calefacción', Hand: 'A mano' }[k] + ' ' + n + (u ? ' pies²' : '');
    }],
    [/^Undone: (\d+) walks?\.(?: (\d+) (?:was|were) tapped since and kept\.)?$/, function (m, n, k) {
      return 'Deshecho: ' + n + (Number(n) === 1 ? ' recorrido.' : ' recorridos.') +
        (k === undefined ? '' : Number(k) === 1 ? ' 1 fue marcado despu\u00e9s y se dej\u00f3.' : ' ' + k + ' fueron marcados despu\u00e9s y se dejaron.');
    }],
    // lib/shiftlogui.js: 'Pass <n> · Clean again <time> by <name>' (the name is a person's: kept)
    [/^Pasada (\d+) · Limpiar de nuevo (.+?) by (.+)$/, 'Pasada $1 · Limpiar de nuevo $2 por $3'],
    // lib/shiftlogui.js passHtml, the check night's own pass break (final review 11/24/26; draft, crew read owed): 'Storm · became a storm <time> by <name>'
    [/^Tormenta · became a storm (.+?)(?: by (.+))?$/, function (m, t, by) { return 'Tormenta · se volvió tormenta ' + t + (by ? ' por ' + by : ''); }],
    // --- Spanish everywhere (11/25/26), Task 3: the built lines that came out half Spanish. Each matches what the dictionary
    // pass leaves ("no signal" is already "sin señal", "pass" "pasada", "posted" "publicado"); a name or number is kept as is.
    [/^(\d+) maps? couldn't be made on this phone \(sin señal\?\)\. Their zone lists still print\.$/, function (m, n) {
      return Number(n) === 1 ? '1 mapa no se pudo hacer en este teléfono (¿sin señal?). Su lista de zonas sí se imprime.'
        : n + ' mapas no se pudieron hacer en este teléfono (¿sin señal?). Sus listas de zonas sí se imprimen.';
    }],
    [/^(\d+) (?:is|are) still on the clock\. Tap Terminar turno first, or their End has to be typed with Poner turno\.$/, function (m, n) {
      return n + (Number(n) === 1 ? ' persona sigue' : ' personas siguen') + ' en turno. Toca Terminar turno primero, o su salida se tiene que escribir con Poner turno.';
    }],
    [/^(\d+:\d\d) \((\d+) nights? with no Terminar turno\)$/, function (m, h, n) { return h + ' (' + n + (Number(n) === 1 ? ' noche' : ' noches') + ' sin Terminar turno)'; }],
    [/line (\d+): cleared must be sí or no/g, 'línea $1: autorizado debe ser sí o no'],
    [/^Guardar or Cancelar this zone first\. It has (\d+) corners that are not saved\.$/, function (m, n) {
      return 'Guarda o cancela esta zona primero. Tiene ' + n + (Number(n) === 1 ? ' esquina' : ' esquinas') + ' sin guardar.';
    }],
    [/^Copiar para BT first if pasada (\d+) isn't publicado yet\.$/, 'Usa Copiar para BT primero si la pasada $1 todavía no está publicada.'],
    [/^Sin pronóstico for (\d+) sites?\.$/, function (m, n) { return 'Sin pronóstico para ' + n + (Number(n) === 1 ? ' sitio.' : ' sitios.'); }],
    [/^No se guardó: the map for (.+) has changed\. Mark the walk again\.$/, function (m, s) {
      return 'No se guardó: el mapa de ' + (s === 'this site' ? 'este sitio' : s) + ' cambió. Marca el recorrido de nuevo.';
    }],
    [/^(.+): (.+) clearance sin definir$/, '$1: autorización de $2 sin definir'],
    // the server's roster checks (roster.js), the numbers its constants; "Emergency contact" is already a row
    [/Contacto de emergencia name is (\d+) characters at most/g, 'El nombre del contacto de emergencia puede tener $1 caracteres como máximo'],
    [/Contacto de emergencia phone is (\d+) characters at most/g, 'El teléfono del contacto de emergencia puede tener $1 caracteres como máximo'],
    [/ must be sí, no or sin definir/g, ' debe ser sí, no o sin definir'],
    // --- Spanish everywhere, Task 4: the leads' and the dispatcher's Storm tab, built lines. The live summary and a handoff
    // site's parts are ONE node joined by " · ", so those rules match inside a line (after the anchored rules above, so the
    // "N of M walks done" rule has already had its turn: the walks rule here leaves a "done" alone).
    [/^Truck$/, 'Camioneta'],
    // the bare type words as whole text nodes (the map editor's type buttons, an old phone's curb walk named "Curbs"); never
    // rows: "Heated walk" and "Hand 300" are other lines (a name; the walk-totals rule)
    [/^Heated$/, 'Con calefacción'],
    [/^Hand$/, 'A mano'],
    [/^Curbs$/, 'Bordillos'],
    [/^Weather$/, 'Clima'],                 // the Snowing / Snow stopped pair's aria-label
    [/(\d+) sites? on (\d+) routes?/g, function (m, s, r) { return s + (Number(s) === 1 ? ' sitio' : ' sitios') + ' en ' + r + (Number(r) === 1 ? ' ruta' : ' rutas'); }],
    [/(\d+) of (\d+) sites checked/g, '$1 de $2 sitios revisados'],
    [/(\d+) of (\d+) sites done(?:, (\d+) touched)?/g, function (m, d, t, k) { return d + ' de ' + t + ' sitios listos' + (k === undefined ? '' : ', ' + k + (Number(k) === 1 ? ' tocado' : ' tocados')); }],
    [/(^|· )(\d+) problems?(?= ·|$)/g, function (m, pre, n) { return pre + n + (Number(n) === 1 ? ' problema' : ' problemas'); }],
    [/(^|· )(\d+) callouts?(?= ·|$)/g, function (m, pre, n) { return pre + n + (Number(n) === 1 ? ' llamado' : ' llamados'); }],
    [/last tap (\d{1,2}:\d\d(?: [AP]M)?)/g, 'último toque $1'],
    [/(\d+) of (\d+) routes started/g, '$1 de $2 rutas empezadas'],
    [/^Forecast snow at every site from now to (.+), against its callout depth\.$/, 'Pronóstico de nieve en cada sitio desde ahora hasta las $1, comparado con su profundidad de llamado.'],
    [/^Up to ([\d.]+)" by (.+?)(?: · (snow now|snow from (.+)))?$/, function (m, n, by, x, t) {
      return 'Hasta ' + n + '" para las ' + by + (x === undefined ? '' : ' · ' + (x === 'snow now' ? 'nieve ahora' : 'nieve desde las ' + t));
    }],
    [/^No snow expected by (.+)\.$/, 'No se espera nieve para las $1.'],
    [/^as of (.+)$/, 'a las $1'],
    [/^Would reach callout depth \((\d+)\)$/, 'Llegarían a su profundidad de llamado ($1)'],
    [/^· ~([\d.]+)" · callout ([\d.]+)"$/, '· ~$1" · llamado $2"'],
    [/^(?:1 site has|(\d+) sites have) no callout depth set\.$/, function (m, n) { return n === undefined ? '1 sitio no tiene profundidad de llamado.' : n + ' sitios no tienen profundidad de llamado.'; }],
    [/^Handoff from (Night|Day) of (\d+\/\d+) · ([^·]+?)(?: · by (.+))?$/, function (m, k, d, t, by) {
      return 'Entrega ' + (k === 'Night' ? 'de la noche' : 'del día') + ' del ' + d + ' · ' + t + (by === undefined ? '' : ' · por ' + by);
    }],
    [/(\d+) of (\d+) walks(?! done)/g, '$1 de $2 recorridos'],
    [/Started by (.+?) (\d{1,2}:\d\d(?: ?[AP]M)?)/g, 'Empezado por $1 $2'],
    [/Started (\d{1,2}:\d\d(?: ?[AP]M)?)/g, 'Empezado $1'],
    [/^Left by night \((\d+)\)$/, 'Lo que dejó la noche ($1)'],
    [/^(Handoff sheets|Sheets): (\d+) not saved$/, function (m, k, n) { return (k === 'Sheets' ? 'Hojas' : 'Hojas de entrega') + ': ' + n + ' sin guardar'; }],
    [/^(Handoff sheets|Sheets): (\d+) of (\d+) saved( · making…)?$/, function (m, k, a, b, mk) {
      return (k === 'Sheets' ? 'Hojas' : 'Hojas de entrega') + ': ' + a + ' de ' + b + ' guardadas' + (mk ? ' · haciéndose…' : '');
    }],
    [/^Sheets: (\d+) saved$/, 'Hojas: $1 guardadas'],
    [/^Night sheets saved at handoff (.+) \((\d+)\)$/, 'Hojas de la noche guardadas en la entrega $1 ($2)'],
    [/^(\d+) day handoff sheets? couldn't be built on this phone\.$/, function (m, n) {
      return Number(n) === 1 ? 'No se pudo armar 1 hoja de entrega del día en este teléfono.' : 'No se pudieron armar ' + n + ' hojas de entrega del día en este teléfono.';
    }],
    [/^Nieve nueva at (.+)$/, 'Nieve nueva en $1'],   // 'New snow' is a row: the rule sees its Spanish
    [/^Clean (.+) again\?$/, '¿Limpiar $1 de nuevo?'],
    [/^(\d+) sites? not mapped yet$/, function (m, n) { return n + (Number(n) === 1 ? ' sitio' : ' sitios') + ' sin mapa todavía'; }],
    [/^Callouts \((\d+)\)$/, 'Llamados ($1)'],
    // --- Spanish everywhere, Task 5: the Board. The tab names and one-word buttons are whole text nodes only (a bare "Board"
    // row would bite "Board, not posted yet:", a bare "Post" "Post to the crew…"). Names inside a line are kept as they are.
    [/^Board$/, 'Tablero'],
    [/^Cards$/, 'Tarjetas'],             // the Crew tab's switch (bottom tabs, 11/25/26)
    [/^Log$/, 'Registro'],
    [/^Roster$/, 'Personal'],
    [/^Post$/, 'Publicar'],
    [/^Callout$/, 'Llamado'],
    [/^Change$/, 'Cambiar'],
    [/^Card$/, 'Tarjeta'],
    [/^Unassign$/, 'Quitar de la ruta'],
    [/^Unplaced$/, 'Sin asignar'],
    [/^Placed$/, 'Asignado'],
    [/^Worked$/, 'Trabajó'],
    [/^Worker$/, 'Trabajador'],
    [/^Type$/, 'Tipo'],
    [/^Item$/, 'Artículo'],
    [/^Route$/, 'Ruta'],
    [/^Site$/, 'Sitio'],
    [/^broken$/, 'roto'],
    [/^left on site$/, 'dejado en el sitio'],
    [/^issued$/, 'entregado'],
    [/^returned$/, 'devuelto'],
    [/^Crew sees (Night|Day) of (\d+\/\d+), publicado (.+)$/, function (m, k, d, t) { return 'La cuadrilla ve ' + (k === 'Night' ? 'Noche del ' : 'Día del ') + d + ', publicado ' + t; }],
    [/^Trucks for (Night|Day) of (\d+\/\d+)$/, function (m, k, d) { return 'Camionetas de ' + (k === 'Night' ? 'Noche del ' : 'Día del ') + d; }],
    [/^Despejado (\d+) (?:person|people)$/, function (m, n) { return Number(n) === 1 ? 'Se quitó 1 persona' : 'Se quitaron ' + n + ' personas'; }],   // "Cleared" is a row
    [/^Take (\d+) (?:person|people) off(?: (\d+) routes?\?)?$/, function (m, n, r) {
      var who = Number(n) === 1 ? '1 persona' : n + ' personas';
      return r === undefined ? '¿Quitar a ' + who + ' de' : '¿Quitar a ' + who + ' de ' + r + (Number(r) === 1 ? ' ruta?' : ' rutas?');
    }],
    // the route's name follows in a span of its own (the toast's names, lib/app.js holdNames): "Took 3 people off" + name
    [/^Took (\d+) (?:person|people) off(?: (the Board))?$/, function (m, n, x) { return 'Se quitó a ' + (Number(n) === 1 ? '1 persona' : n + ' personas') + (x ? ' del tablero' : ' de'); }],
    [/^Put (\d+) back\.(?: (?:1 was left as it is|(\d+) were left as they are)\.)?$/, function (m, n, k) {
      var left = /1 was left/.test(m) ? ' 1 se quedó como estaba.' : k !== undefined ? ' ' + k + ' se quedaron como estaban.' : '';
      return (Number(n) === 1 ? 'Se regresó 1.' : 'Se regresaron ' + n + '.') + left;
    }],
    [/^Add ticked \((\d+)\)$/, 'Agregar marcados ($1)'],
    [/^(\d+) hidden by search$/, function (m, n) { return n + (Number(n) === 1 ? ' oculto' : ' ocultos') + ' por la búsqueda'; }],
    [/^Added (\d+) to$/, function (m, n) { return 'Se ' + (Number(n) === 1 ? 'agregó 1' : 'agregaron ' + n) + ' a'; }],
    [/(\d+) (?:was|were) already on a route and (?:was|were) left/g, function (m, n) { return n + (Number(n) === 1 ? ' ya estaba en una ruta y se dejó' : ' ya estaban en una ruta y se dejaron'); }],
    // placeFromRoster's toasts: the person's and the route's names are spans of their own around these pieces
    [/^taken off the Board$/, 'quitado del tablero'],
    [/^: lead on$/, ': líder en'],
    [/^placed on$/, 'asignado a'],
    [/^Posted: the crew see (Night|Day) of (\d+\/\d+)$/, function (m, k, d) { return 'Publicado: la cuadrilla ve ' + (k === 'Night' ? 'Noche del ' : 'Día del ') + d; }],
    [/^Callout: (Night|Day) of (\d+\/\d+)$/, function (m, k, d) { return 'Llamado: ' + (k === 'Night' ? 'Noche del ' : 'Día del ') + d; }],
    [/^Callout saved for (Night|Day) of (\d+\/\d+)$/, function (m, k, d) { return 'Llamado guardado para ' + (k === 'Night' ? 'Noche del ' : 'Día del ') + d; }],
    [/^Short night: on \(after (.+)\)$/, 'Noche corta: activada (después de la $1)'],
    [/^Short night: on until (.+)$/, 'Noche corta: activada hasta las $1'],
    [/^(\d+) nights? · (\d+) days?$/, function (m, n, d) { return n + (Number(n) === 1 ? ' noche' : ' noches') + ' · ' + d + (Number(d) === 1 ? ' día' : ' días'); }],
    [/^(.+) · lead$/, '$1 · líder'],
    [/Unknown worker( \S+)?/g, 'Trabajador desconocido$1'],
    [/ from (\d+\/\d+)/g, ' desde $1'],   // a worker card's Placed list: "<route> from 12/1"
    // the Board's warnings (lib/warnings.js): one line each, a person's name inside; "Valley" and "not set" are already rows
    [/^(.+): (.+) clearance expired (\S+)$/, '$1: autorización de $2 vencida el $3'],
    [/^(.+): no (.+) clearance$/, '$1: sin autorización de $2'],
    [/^(.+): (.+) clearance expires (\S+)$/, '$1: la autorización de $2 vence el $3'],
    [/^(.+) rides with (.+), who isn't on this route$/, '$1 viaja con $2, que no está en esta ruta'],
    [/^(.+): not cold-rated$/, '$1: no apto para frío'],
    [/^(.+): gear needs issuing$/, '$1: hay que entregarle equipo'],
    [/^(.+): no valid ID for a cleared site$/, '$1: sin ID vigente para un sitio con autorización'],
    [/^(.+): placed but not on call$/, '$1: asignado pero no disponible'],
    [/^(.+): El Valle, short night \(under 8 hours\)$/, '$1: El Valle, noche corta (menos de 8 horas)'],
    [/^(.+) and (.+): keep apart$/, '$1 y $2: mantener separados'],
    [/^(.+) leads but can't drive$/, '$1 es líder pero no puede manejar'],
    [/^No confirmed driver \((\d+) sin definir\)$/, 'Sin conductor confirmado ($1 sin definir)'],
    // --- Spanish everywhere, Task 6: the Roster and crew stats. One-word labels as whole text nodes only.
    [/^Smokes$/, 'Fuma'],
    [/^Dispatcher$/, 'Despachador'],
    [/^Operates$/, 'Opera'],
    [/^Traits$/, 'Cualidades'],
    [/^Weaknesses$/, 'Debilidades'],
    [/^Clearances$/, 'Autorizaciones'],
    [/^Place$/, 'Asignar'],
    [/^Stats$/, 'Estadísticas'],
    [/^Edit$/, 'Editar'],
    [/^nobody$/, 'nadie'],
    [/^Name$/, 'Nombre'],
    [/^Photo$/, 'Foto'],
    [/^Archive$/, 'Archivar'],
    [/^Hours$/, 'Horas'],
    [/^Machines$/, 'Máquinas'],
    [/^Approve$/, 'Aprobar'],
    [/^Reject$/, 'Rechazar'],
    [/^no End$/, 'sin salida'],
    [/^no-show$/, 'falta'],
    [/^called out$/, 'llamado'],
    // what a person can run: Matt's checkboxes one word each, the card's list joined by ", "; the brand names stay
    [/^(?:blower|sweepster|bobcat|snowrator|shovel)(?:, (?:blower|sweepster|bobcat|snowrator|shovel))*$/, function (m) { return m.replace(/\bblower\b/g, 'soplador').replace(/\bshovel\b/g, 'pala'); }],
    [/^(\d+) no picture$/, '$1 sin foto'],
    [/^Current link \(#(.+), not approved right now\)$/, 'Enlace actual (#$1, no aprobado ahora)'],
    [/^Stats · Winter (\S+)$/, 'Estadísticas · Invierno $1'],
    [/^(\d+) \(called out (\d+), no-show (\d+)\)$/, '$1 (llamado $2, faltas $3)'],
    [/^([\d,]+) sq ft$/, '$1 pies²'],
    [/^Esperando que lo agreguen \((\d+)\)$/, 'Esperando que los agreguen ($1)'],   // "Waiting to be added" is a row
    [/^Waiting for approval \((\d+)\)$/, 'Esperando aprobación ($1)'],
    // a toast's pieces around a person's name (its own span: lib/app.js holdNames)
    [/^can sign in now$/, 'ya puede iniciar sesión'],
    [/^is on the crew$/, 'ya está en la cuadrilla'],
    [/^· lead$/, '· líder'],
    // the server's roster check, joined by "; " after "Not saved:": "Can operate" is a row, the machine words map as on the card
    [/Puede operar lists ([a-z, ]+?) or ([a-z]+)/g, function (m, list, last) {
      var w = function (s) { return s.replace(/\bblower\b/g, 'soplador').replace(/\bshovel\b/g, 'pala'); };
      return 'Puede operar solo: ' + w(list) + ' o ' + w(last);
    }],
    // --- Spanish everywhere, Task 7: Sites and Routes.
    [/^Address$/, 'Dirección'],
    [/^Archived$/, 'Archivado'],
    [/^Restored$/, 'Restaurado'],
    [/^Restore$/, 'Restaurar'],
    [/^(\d+) ticked, not added yet$/, function (m, n) { return n + (Number(n) === 1 ? ' marcado' : ' marcados') + ', sin agregar todavía'; }],
    [/^(\d+) added$/, function (m, n) { return n + (Number(n) === 1 ? ' agregado' : ' agregados'); }],
    [/^(\d+) hidden by (search and the customer button|the customer button)$/, function (m, n, why) {
      return n + (Number(n) === 1 ? ' oculto' : ' ocultos') + ' por ' + (why === 'the customer button' ? 'el botón del cliente' : 'la búsqueda y el botón del cliente');
    }],
    [/^Archived \((\d+)\)$/, 'Archivados ($1)'],
    [/^(\d+) sites?$/, function (m, n) { return n + (Number(n) === 1 ? ' sitio' : ' sitios'); }],
    [/line (\d+): site is missing/g, 'línea $1: falta el sitio'],
    [/line (\d+): dates must be YYYY-MM-DD/g, 'línea $1: las fechas deben ser AAAA-MM-DD'],
    // --- Spanish everywhere, Task 8: the map editor and the Bootprint import.
    [/^Hide$/, 'Ocultar'],
    [/^Show$/, 'Mostrar'],                         // the map editor's old-map panel toggle (Show / Hide)
    [/^≈ ([\d,]+) sq ft$/, '≈ $1 pies²'],          // a zone card's area (lib/mapview.js sheetHtml)
    [/^not saved:(.*)$/, 'no se guardó:$1'],      // after a site's name in its own span: "Site card for" [name] " not saved: …"
    [/^heated$/, 'con calefacción'],             // a walk's type tag on the Storm tab (lib/shiftlogui.js)
    [/^\(lead\)(,?)$/, '(líder)$1'],            // the live view's crew: "(lead)" after the lead's name (its own span)
    [/^Call (.+)$/, 'Llamar a $1'],              // a chip's ☎ link (aria-label; the name cannot be marked inside an attribute)
    [/^Archived zones \((\d+)\)$/, 'Zonas archivadas ($1)'],
    [/^Add (\d+) zones?$/, function (m, n) { return 'Agregar ' + n + (Number(n) === 1 ? ' zona' : ' zonas'); }],
    [/^Adding (\d+) of (\d+)…$/, 'Agregando $1 de $2…'],
    [/^(\d+) walks?(?: · (\d+) snow piles?)? to add$/, function (m, w, p) {
      return w + (Number(w) === 1 ? ' recorrido' : ' recorridos') + (p === undefined ? '' : ' · ' + p + (Number(p) === 1 ? ' montón de nieve' : ' montones de nieve')) + ' por agregar';
    }],
    [/^(?:(\d+) m away|([\d.]+) km away|(no corners)) · (\d+) walks?(?: · (\d+) snow piles?)?$/, function (m, mt, km, none, w, p) {
      var where = none ? 'sin esquinas' : mt !== undefined ? 'a ' + mt + ' m' : 'a ' + km + ' km';
      return where + ' · ' + w + (Number(w) === 1 ? ' recorrido' : ' recorridos') + (p === undefined ? '' : ' · ' + p + (Number(p) === 1 ? ' montón de nieve' : ' montones de nieve'));
    }],
    [/^Left out: (.+)$/, function (m, list) {
      var one = function (part) {
        var x = /^(\d+) (.+)$/.exec(part); if (!x) return part;
        var n = x[1], k = x[2], s = Number(n) === 1;
        if (/^lots? \(the plow crew's\)$/.test(k)) return n + (s ? ' lote' : ' lotes') + ' (de la cuadrilla de arado)';
        if (/^cut-outs?$/.test(k)) return n + (s ? ' recorte' : ' recortes');
        if (/^runs? with no width \(set it in Bootprint\)$/.test(k)) return n + (s ? ' trazo' : ' trazos') + ' sin ancho (ponlo en Bootprint)';
        if (/^runs? that turn too sharply \(trace as an area\)$/.test(k)) return n + (s ? ' trazo' : ' trazos') + ' con vueltas muy cerradas (trázalo como área)';
        if (/^unfinished shapes?$/.test(k)) return n + (s ? ' figura' : ' figuras') + ' sin terminar';
        if (k === 'already imported') return n + (s ? ' ya importado' : ' ya importados');
        return part;
      };
      return 'Se dejaron fuera: ' + list.split(', ').map(one).join(', ');
    }],
    [/^Added (\d+) zones? from Bootprint\. Tap any heated or do-not-touch one to change it\.$/, function (m, n) {
      return 'Se ' + (Number(n) === 1 ? 'agregó 1 zona' : 'agregaron ' + n + ' zonas') + ' de Bootprint. Toca cualquiera con calefacción o de no tocar para cambiarla.';
    }],
    [/^Added (\d+) of (\d+)\. Stopped: (.+)\. Import again for the rest\.$/, function (m, a, b, why) {
      return 'Se agregaron ' + a + ' de ' + b + '. Se detuvo: ' + (why === 'not saved' ? 'no se guardó' : why) + '. Importa otra vez para el resto.';
    }],
    [/^Getting map (\d+) of (\d+) ready…$/, 'Preparando el mapa $1 de $2…'],   // the site's name follows in its own span (holdNames)
    // --- Spanish everywhere, Task 9: the server's built refusals. Unanchored: a validator's messages are joined by "; ".
    [/That time is not on the (night|day) you picked/g, function (m, k) { return 'Esa hora no está en el turno de ' + (k === 'night' ? 'noche' : 'día') + ' que elegiste'; }],
    [/Already handed off at (\d{1,2}:\d\d(?: [AP]M)?)/g, 'Ya se entregó a las $1'],
    [/Teléfono is (\d+) characters at most/g, 'El teléfono puede tener $1 caracteres como máximo'],   // "Phone" is a row
    [/That sign-in is already on the roster as (.+?)(?=; |$)/g, 'Ese inicio de sesión ya está en la lista como $1'],
    [/(works well with|keep apart from) must list people on the roster/g, function (m, k) { return (k === 'works well with' ? 'trabaja bien con' : 'mantener separado de') + ' debe listar personas de la lista'; }],
    [/A unit list is (\d+) characters at most/g, 'Una lista de unidades puede tener $1 caracteres como máximo'],
    [/A unit number is text, (\d+) characters at most/g, 'Un número de unidad es texto, $1 caracteres como máximo'],
    [/Too many corners \((\d+)\); the most a zone can hold is (\d+)/g, 'Demasiadas esquinas ($1); una zona puede tener como máximo $2'],
    // --- Final review I1 (11/25/26): lines that now carry a name in a span of its own; these are the words around it.
    // the handoff heading with its hander's name in its own span after " · by" (lib/shiftlogui.js headingHtml)
    [/^Handoff from (Night|Day) of (\d+\/\d+) · (.+?) · by$/, function (m, k, d, t) { return 'Entrega ' + (k === 'Night' ? 'de la noche' : 'del día') + ' del ' + d + ' · ' + t + ' · por'; }],
    [/^Clean$/, '¿Limpiar'],                                    // "Clean" [site] "again?" (the Clean again confirm)
    [/^again\?$/, 'de nuevo?'],
    [/^goes back to not done for pasada (\d+)\. Pasada (\d+) stays on the record\.$/, 'vuelve a Pendiente para la pasada $1. La pasada $2 se queda en el registro.'],
    [/^No se guardó: the map for$/, 'No se guardó: el mapa de'],   // "Not saved:" is a row; [site] follows
    [/^has changed\. Mark the walk again\.$/, 'cambió. Marca el recorrido de nuevo.'],
    [/(^|· )Started by$/, '$1Empezado por'],                     // a handoff part: [name] and the time follow
    // the Callouts line and the handoff card's callout: [site] " · ~3" since 2:14 AM (estimate) · callout 2"" / " · 3" measured 2:14 AM by " [name] " · callout 2""
    [/~([\d.]+)" since (.+?) \(estimate\)/g, '~$1" desde las $2 (estimado)'],
    [/([\d.]+)" measured (\d{1,2}:\d\d(?: [AP]M)?)( by)?/g, function (m, n, t, by) { return n + '" medido a las ' + t + (by ? ' por' : ''); }],
    [/(^|\s)· callout ([\d.]+)"/g, '$1· llamado $2"'],
    // the snow map's info line (lib/snowmap.js): "Forecast ~" and "Measured" are rows
    [/Pronóstico ~([\d.]+)" next (\d+) h/g, 'Pronóstico ~$1" en las próximas $2 h'],
    [/Medido ([\d.]+)" at (\d{1,2}:\d\d(?: [AP]M)?)( by)?/g, function (m, n, t, by) { return 'Medido ' + n + '" a las ' + t + (by ? ' por' : ''); }],
    // the live view's totals: [name] " 2 in, " … (a depth in inches after a person's name)
    [/^([\d.]+) in(,?)$/, '$1 pulg$2'],
    [/^off-route$/, 'fuera de ruta'],
    [/^· admin$/, '· administrador'],                          // the header's role tag after the signed-in name
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

  // Speed (final review I3, 11/25/26): with every screen in Spanish there are about 230 rules, and each ran on every text node in
  // turn (~4x slower than before on a Spanish phone). Two shortcuts, the same output:
  //   - an exact-text rule (/^literal$/ with a plain replacement) is an equality test, never a regex;
  //   - every other rule is tried first as ONE combined test on the line the dictionary left: if none of them finds anything there,
  //     none can change it (a rule only sees what the rules before it made, and none has made anything), so they are skipped,
  //     unless an exact rule fires, after which the rest run as before.
  var RULES = null;
  var EXACT_SRC = /^\^((?:[^\\^$.*+?()[\]{}|]|\\.)*)\$$/;
  function compiledRules() {
    if (RULES) return RULES;
    var parts = [];
    RULES = ES_RULES.map(function (r) {
      var m = EXACT_SRC.exec(r[0].source);
      if (m && typeof r[1] === 'string' && r[1].indexOf('$') === -1) return { exact: m[1].replace(/\\(.)/g, '$1'), rep: r[1] };
      parts.push('(?:' + r[0].source + ')');
      return { re: r[0], rep: r[1] };
    });
    RULES.any = parts.length ? new RegExp(parts.join('|')) : null;
    return RULES;
  }
  function applyRules(out) {
    var R = compiledRules(), skip = !R.any || !R.any.test(out);
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      if (r.exact !== undefined) { if (out === r.exact) { out = r.rep; skip = false; } continue; }
      if (!skip) out = out.replace(r.re, r.rep);
    }
    return out;
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
    out = applyRules(out);
    return out === s ? v : lead + out + trail;
  }

  // What each translated node said in English, so EN comes back without a re-render.
  var ES_ORIG = typeof WeakMap === 'function' ? new WeakMap() : null;
  var ES_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var ES_SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };
  // Never translated: a person's words (data-no-es), and a subtree its own print screen has put in English (scope below).
  var HELD = '[data-no-es], [data-es-scope="en"]';

  function translateText(node) {
    var v = node.nodeValue;
    if (!v || !v.trim()) return;
    var p = node.parentNode;
    if (p && p.closest && p.closest(HELD)) return; // set later or edited in place: still a person's words
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
    if (el.closest && el.closest(HELD)) return;
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

  // force: translate even on an English phone (the print screen's Español, scope below).
  function translateNode(root, force) {
    if ((lang !== 'es' && !force) || !root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1 || ES_SKIP[root.nodeName]) return;
    if (root.closest && root.closest(HELD)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (p && ES_SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (p && p.closest && p.closest(HELD)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(translateText);
    translateAttrs(root);
    Array.prototype.forEach.call(root.querySelectorAll('[' + ES_ATTRS.join('],[') + ']'), translateAttrs);
  }

  // Back to English without a reload: every node under root we changed gets its English back.
  function restoreNode(root) {
    if (!root || root.nodeType !== 1) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = walker.nextNode())) {
      var rec = ES_ORIG && ES_ORIG.get(n);
      if (rec && n.nodeValue === rec.es) n.nodeValue = rec.en;
    }
    [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))).forEach(function (el) {
      ES_ATTRS.forEach(function (a) {
        var key = attrKey(a);
        if (el.dataset && el.dataset[key] !== undefined && el.getAttribute(a) === el.dataset[key + 'Es']) {
          el.setAttribute(a, el.dataset[key]);
        }
      });
    });
  }
  function restoreEnglish() { restoreNode(document.body); }

  // The print screen's own language (Matt, 11/25/26: "it had no option to print it in Spanish"): one subtree in one
  // language, whatever the phone's. 'es' translates it now, even on an English phone; 'en' puts back what the engine
  // changed there, and while the mark says English the engine leaves that subtree alone (on a Spanish phone the observer
  // would otherwise translate it straight back). A person's words stay under data-no-es either way.
  function scope(root, next) {
    if (!root || !root.setAttribute) return;
    next = next === 'es' ? 'es' : 'en';
    root.setAttribute('data-es-scope', next);
    if (next === 'es') translateNode(root, true); else restoreNode(root);
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
    restoreEnglish: restoreEnglish, restoreNode: restoreNode, scope: scope, lang: function () { return lang; }, setLang: setLang,
    readLangKey: readLangKey, start: start };
})();
if (typeof module !== 'undefined') module.exports = SnowEs;
if (typeof window !== 'undefined') window.SnowEs = SnowEs;
