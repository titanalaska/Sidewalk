# Sidewalk in Spanish: the crew screens, switched on the phone

Matt Walsh, Titan Alaska. Designed 10/9/26 in conversation; Matt answered every question below himself.
Status: spec for review. Nothing built. Supersedes the draft in `claudes room/Sidewalk Spanish spec 2026-10-09 (draft for Matt, open questions).md`.

## Why

Eighteen Spanish-speaking crew stay for the winter (Matt, 10/9/26). They read walk states and tap
Cleared, Treated and Problem at night, on a phone, in a second language. Sidewalk has no language
layer at all today: `<html lang="en">` is the only line that knows a language exists. Groundwork,
Inventory and Bootprint got full Spanish on 9/23/26; this brings Sidewalk level, for the screens the
crew use, before the first storm.

## Decisions Matt made (10/9/26)

| Question | Matt's answer |
|---|---|
| Who gets it first | **Crew screens only**: sign-in, Storm tab, Tonight, Routes, Sites, the map legend, their own roster card, every toast and error. The Board, the map editor, route sheets, handoff and the Sites/Routes forms get no rows of their own |
| Leads' live view and storm controls | Not in this pass (offered, declined with "crew screens only") |
| Where the choice lives | **On the phone**: a localStorage key, works before sign-in; a phone that already chose Spanish in Groundwork opens Sidewalk in Spanish |
| The words | **Groundwork's vocabulary** (tú, Mexican Spanish) and the draft list; **one crew member reads the Storm tab on a test phone and corrects it before ship**. Corrections are dictionary rows |
| Copy for BT and the crew post | **English always.** What goes to BuilderTrend never changes language; the buttons and labels around it do |
| When | **Build now on branch `spanish`, ship with the next deploy.** Before the first storm either way |

Carried over from 9/23/26 (all three apps): tú, never usted; translate display, never data.
Carried over from 10/5/26: a test that checks a translated banner asserts `toBeVisible` on the Spanish and
`toBeHidden` on the English, never `toContainText` alone.

## What the crew see

EN and ES buttons in the header beside their name, like Groundwork's. Tapping ES turns every crew screen
Spanish at once, without a reload: the sign-in form, the tabs, the Storm tab with its walks and states, Tonight,
Routes, Sites, the map legend and the photo switch, their own roster card and its form, every toast and every
error. Tapping EN brings the English back, also without a reload. The choice is remembered on that phone.

What stays as typed, in either language, because it is a person's words or it leaves the app:
site names, addresses, site notes and materials lines, zone names ("Curb - lot island (U) - N"), people's names,
the Copy for BT text and the crew post. Matt's own screens are not translated on purpose; shared words such as
Save and Cancel will still read Spanish there on a phone set to ES (his is set to EN, so he sees no change).

## Approach: translate the screen, not the code

Groundwork's engine (9/23/26) is lifted into one new file, `lib/es.js`. It translates the DOM: a dictionary of
English → Spanish phrases, one regex alternation built longest-key-first with a word boundary on any key that
starts or ends on a word character, a tree walk over text nodes plus four attributes (placeholder, aria-label,
title, alt), a `WeakMap` of each node's English so EN comes back without a re-render, and a `MutationObserver`
that translates every later change as it lands (a toast, a rebuilt tab, a walk row). No render code changes in
any of the 25 files. A feature added later costs dictionary rows and nothing else.

Two alternatives were considered and set aside: wrapping every rendered string in an `L(en, es)` call (about
300 places, and every future string needs the wrapper), and a hybrid, which is this design with a worse name.

### Components

**`lib/es.js`** (new, loaded in index.html before `lib/app.js`, so the engine exists when the first render
happens). Exposes `window.SnowEs = { lang, setLang, translateNode, start }` in the page and, like `lib/geo.js`,
the pure parts (`translateString`, `ES`, `ES_RULES`) through `module.exports` when run under node.
Lifted from Groundwork's index.html, lines 3397-4180, and trimmed:
- kept: `ES` (the dictionary), `ES_RULES` (the rule list for phrases built with numbers), `esRules`,
  `translateString`, `translateText`, `translateAttrs`, `translateNode`, `restoreEnglish`, `watchForSpanish`,
  `setLang`, `paintLangButtons`, `wireLangButtons`;
- dropped: the plant and bed rules, `LOG_ES` and `logToSpanish`, `translateBlock` / `data-es-html` (Sidewalk's
  static markup has no paragraphs to carry an HTML variant; if one appears, the Groundwork mechanism comes with it);
- `ES_SKIP` stays `{SCRIPT, STYLE, TEXTAREA}`; `data-no-es` on an element keeps the engine out of it and its
  children.

**The switch**: `<span class="lang-wrap" id="langWrap"><button class="lang-btn" data-lang="en">EN</button>
<button class="lang-btn" data-lang="es">ES</button></span>` in the header of index.html, before the Share
button, styled in app.css like Groundwork's. `setLang` writes `document.documentElement.lang`.

**Memory**: localStorage key **`snow-lang`** (`"en"` or `"es"`; anything else is English). Read once at start-up:
if `snow-lang` is unset, `wolf-lang` is read instead (same origin, `titanalaska.github.io`, same crew; its values
are the same two strings) and then written to `snow-lang`, after which the two keys are independent. The key,
once named, is never renamed (the 9/22/26 rule that keeps `wolf-*` alive).

**Start-up order** in app.js: read the key → paint the buttons → first render → `translateNode(document.body)`
→ `watchForSpanish()`. The sign-in form is in the first render, so it is Spanish before anyone signs in.

### The dictionary

Only crew-screen phrases, about 250, seeded from `claudes room/Sidewalk English phrases 2026-10-09 (seed list
for the Spanish dictionary).md` (438 found mechanically across all files; the crew-facing files are
`lib/shiftlogui.js`, `lib/app.js`, `lib/rosterui.js`, `lib/mapview.js`, `lib/weather.js`, `index.html`). Keys are
the exact English the code renders, whitespace collapsed. Phrases that carry a number or a name go to
`ES_RULES` as a regex and a replacement: "Adding 7 of 18…", "Curbs (about 500 ft)", "3 walks · 1 snow pile",
"Snow until 10 AM", "No snow in the next 12 h", "Added 9 of 20. Stopped: …". The NWS hint is built by the app
from NWS numbers, so it translates by rule; the hour keeps the phone's 12-hour clock.

Status words, the ones tapped all night, start as: Cleared → Despejado · Treated → Tratado · Problem → Problema ·
Checked → Revisado · Touched → Tocado · Done → Listo · Clean again → Limpiar de nuevo · Whole site → Todo el sitio ·
Not saved, try again → No se guardó, inténtalo de nuevo · Retry → Reintentar · Undo → Deshacer ·
Sidewalk → Banqueta · Hand work → Trabajo a mano · Heated: check only, no melt → Calefaccionado: solo revisar, sin
derretidor · Snow storage → Depósito de nieve · Do not touch → No tocar. The crew check decides banqueta/acera,
despejado/limpio and derretidor/sal; whatever they say becomes the row.

The dictionary lives inside `lib/es.js` (one file in the shell, no fetch, works with no signal).

### Data never translates

`data-no-es` goes on every element that prints a person's words, at the place it renders:
- `lib/app.js`: site name, address, materials and notes on the site map page, the Routes and Sites lists, the
  `#who` badge, the crew name on Tonight (19 render sites found by `esc(x.name|address|note|notes|materials_needed|customer|needs_clearance)`);
- `lib/shiftlogui.js`: site and zone names on walk rows, the Problems box notes, the site cards, `#bt_text`
  (the Copy for BT text) and the crew post (12 sites);
- `lib/rosterui.js`: names and the card's free-text line (3 sites);
- `lib/mapview.js`: the site name and address over the map (2 sites).
The API never sees Spanish: a tap still sends `state: 'cleared'`; the dictionary maps labels, never values.
Copy for BT copies `#bt_text` as built by `lib/btnote.js`, which has no translated string in it, so the clipboard
text is byte-identical in EN and ES.

### Error handling

A phrase with no row shows in English: the engine replaces only what it matches. A corrupt or missing
`snow-lang` reads as English. If `lib/es.js` fails to load (a bad shell cache), `app.js` guards every call with
`window.SnowEs &&`, so the app runs in English rather than not at all, the same way it survives a missing
`lib/handoff.js` (10/5/26 test).

### Tests

Playwright, `test/ui.spec.js`, a new "Spanish" section, each with the hidden-banner rule:
1. Tapping ES turns the Storm tab Spanish: "Despejado" visible, "Cleared" hidden; tapping EN reverses it with no
   reload (the `calls` array shows no new bootstrap).
2. A zone named "Curb - lot island" and a site note "clean between every car" stay English in ES.
3. The Copy for BT text is byte-identical in EN and ES (clipboard stub captures both).
4. A tap in ES sends `{ action: 'tapZone', state: 'cleared' }`, never a Spanish word.
5. `wolf-lang=es` with no `snow-lang` opens the sign-in form in Spanish and writes `snow-lang=es`;
   `snow-lang=en` with `wolf-lang=es` opens in English.
6. A toast that arrives after the switch ("Not saved, try again") is Spanish (the observer path).
7. With `lib/es.js` blocked (`page.route` abort), the app still signs in and shows the Storm tab in English.
Node, `test/es.test.js`, on the exported pure engine: longest key wins; a key inside a longer word is left alone
("Go" never touches "Gold"); each number rule with one case worked on paper; an unknown phrase comes back
unchanged; every `ES` value differs from its key (no row forgotten half-filled).
Hand mutations before ship (the repo has no `verify-tests`): drop the word boundary, drop longest-first, drop
`data-no-es` on the zone name; each must turn a test red.
Existing tests: `test/sw.spec.js` and `test/manifest.test.js` follow the SHELL list and version; the full suite
stays at its count plus the new tests (229 node + 301 Playwright on main today).

### Ship

`lib/es.js` joins SHELL in `sw.js`; `CACHE_VERSION` moves to `titan-snow-shell-37` (or the next number when it
ships); no backend change, VERSION stays `curbs-1`. One `/sidewalk-deploy` with Matt. Before that deploy: one of
the 18 reads the Storm tab on a test phone in ES; what sounds wrong becomes a corrected row in the same branch.

## Out of scope, on purpose

Matt's screens (Board, map editor, route sheets, handoff, the Sites and Routes forms); the leads' live view and
storm controls; a per-person language on the roster; translating anything that leaves the app. Each is a later
decision, and the engine makes any of them a dictionary change.

## Assumptions Matt did not rule on

- Spanish on a phone set to ES also reaches the shared words on his screens (Save, Cancel, Back). Accepted as
  harmless; a `data-no-es` on the admin sections would reverse it in one line.
- The language buttons sit before Share in the header; if the header gets tight on a small phone, Share keeps
  its place and the buttons shrink to a single toggle.
