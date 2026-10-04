# Hand and Snow storage zones, Bootprint colours: design (sub-project 7)

**Owner:** Matt Walsh. **Status:** design approved in conversation 10/4/26; this file awaits his read.
**Repos:** Snow-App-repo (phone, PUBLIC: code only) and snow-app-script (backend, no remote).

## Why

Matt traces sites in Bootprint and imports them (ANMC, DIP on 10/4). Two things were lost on the way in:

- **Hand work** (lot cleanouts between cars, 4-ft curbs, 4-ft building pullouts) arrived as plain
  Sidewalk, so on the crew's map a lot row looks exactly like a front walk.
- **Snow storage** was dropped. Matt (10/4): "It tells them where to put it if the Bobcat operator is
  ever wondering."

And the two apps disagree on colour: Sidewalk paints walks orange and Do not touch blue, while
Bootprint paints walks blue. Matt's call (10/4): **match Bootprint.**

**Success:** one import of ANMC brings 26 walks/hand zones + 3 piles and DIP 16 + 6, each in its
Bootprint colour; a pile is never tapped or counted; a hand zone is tapped and counted exactly like a
sidewalk.

## Decisions (Matt, 10/4/26)

| Question | Decision |
|---|---|
| Colours | Match Bootprint |
| Hand vs walk on the crew map | Different: amber vs blue |
| Do not touch | Pink/magenta (blue now means walk) |
| Storage | Imported and shown; tells the Bobcat operator where snow goes |

## Zone types

| Type | Colour | Label (legend) | Shift log, route sheet, BT copy, live progress |
|---|---|---|---|
| `sidewalk` | `#1c6fb0` | Sidewalk | Cleared / Treated / Problem (unchanged) |
| `hand` **new** | `#d98c00` | Hand work | **same as sidewalk** |
| `heated` | `#d62828` | Heated: check only, no melt | Checked / Problem (unchanged) |
| `storage` **new** | `#7d5ba6` | Snow storage | never walked, never counted |
| `no_touch` | `#e0218a` (was `#1f6fd1`) | Do not touch | never walked (unchanged) |

Colours are Bootprint's `SURFACE_COLOR` walk / hand / storage. Type ids are stored data and never
renamed; only colours and labels change.

## Changes

**Shared rules** (`lib/shiftlog.js` phone = `shiftlog.js` backend, byte-identical, test-enforced):
`walksFor` takes `sidewalk`, `hand`, `heated`; `statesFor('hand')` = sidewalk's three states.
`storage` and `no_touch` fall through untouched: never a walk. Route sheets, Copy for BT and live
progress read `walksFor`, so they follow with no change of their own (tests prove it).

**Backend** (`roster.js`): `ZONE_TYPES` gains `hand`, `storage`; the error names all five.

**Phone:**
- `lib/mapview.js` TYPES: new colours, the two new types, legend in the order of the table.
  (A map tap already shows only name, note and area for every type; log buttons live on the Storm
  tab and come from `walksFor`, so a storage zone never gets them.)
- `lib/mapedit.js` BTN: Sidewalk, Hand, Heated, Snow storage, Do not touch.
- `lib/bpimport.js`: Bootprint `walk` → `sidewalk`, `hand` → `hand`, `storage` → `storage` (no longer
  skipped). `plow` and cut-outs stay out. A storage run with a width becomes a strip like any run.
  The summary counts storage as its own line ("3 snow piles"), not as walks.
- **Fix found 10/4:** `mapview.js` reads the `moa` layer right after `new Map()`, before the style is
  parsed, so on some opens the map throws "non-existing layer moa" and fails to load (six times in one
  session in Claude's pane). Set the switch label from the known starting state instead of asking
  the map.
- Shell cache bump.

**Existing data:** no imported zones exist yet (the 10/4 import never saved), so nothing to migrate.
Zones drawn earlier in Sidewalk keep their type; only their colour changes.

## Tests (both repos)

Expected values on paper; each guard proven by a mutation (backend `verify-tests`; phone by hand).
- Backend: `hand`/`storage` accepted, a sixth type refused; `walksFor` includes hand, excludes
  storage; hand states = sidewalk's; shiftlog.js still byte-identical to the phone's.
- Phone: import maps walk/hand/storage to the three types and keeps plow + cut-outs out; summary
  counts piles separately; legend order and colours; the map's colour expression; the Storm tab
  lists no storage zone; a hand zone gets Cleared/Treated/Problem; route sheet and BT copy list a hand
  zone and never a storage zone; the map opens with no console error.

## Not in this sub-project
- Re-colouring Bootprint (it is the reference).
- The multiple-cleanings work (sub-project 6, branch `passes`) — unaffected; it builds on `walksFor`.
