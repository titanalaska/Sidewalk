# Handoff sheets (8 AM night-to-day) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At 8:00 AM (or on Hand off now) the server marks the night handed off, saves that night's route sheets and one day-handoff PDF per day route to Drive, and day phones show a live handoff card: their route plus every site night left.

**Architecture:**
- **The handoff mark:** a new Storms row kind `handoff`, written by a new `handOff` action and by a one-off 8 AM trigger (`handOffMorning`).
- **The sheets:** the existing sheet job learns to make a handoff's sheets, and Close storm learns to skip night sheets nothing changed since.
- **The shared file:** a new pure `handoff.js`, byte-identical in both repos like `routesheet.js`. It turns the rows into the day sheet's data and HTML. The server makes the PDF with it and the phone draws the card with it.

**Tech Stack:** Apps Script JS (`node --test`, fake sheet + fake Apps Script, `verify-tests`); phone ES5, `node --test` + Playwright over `file://`.

**Spec:** `Snow-App-repo/docs/superpowers/specs/2026-10-05-handoff-sheets-design.md`

## Global Constraints

- **The mark:** a Storms row `{kind:'handoff', storm_id, shift_id:'night-YYYY-MM-DD', at, by_name, by_profile, log_seq, visit_seq, truck_seq}`. The three `*_seq` are the highest seq in Log, Visits and Trucks at that moment (0 if a tab is empty). `stormState` is unchanged (it ignores the kind).
- **The action:** `handOff {}`. It goes in LEAD (auth.js) and `BOARD_LEAD` (Code.js). Refusals, in this order, exact:
  1. `No storm is open`
  2. `It isn't night shift`
  3. `Nothing to hand off yet`
  4. `Already handed off at <h:mm AM>` (`CrewTime` 12-hour clock of the existing row's `at`)
  "Night shift" = the server's `shiftFor(now, storms)` starts `night-`. "Something to hand off" = at least one real tap (realTaps rules: not `'*'`, not an undo row, not undone) with that `shift_id` in the current storm.
- **The 8 AM trigger:** handler `handOffMorning`, a one-off `.timeBased().at(<Date>)` for the next 08:00 America/Anchorage local (today's if now is before 08:00, else tomorrow's; computed in local time, so it holds across a DST change).
  - At most one exists: booking deletes every `handOffMorning` trigger first.
  - Booked by Start storm and Reopen, and by each run while the storm is open after it. Deleted by Close storm (`kind:'end'`).
  - A run is `handOff` as `{role:'admin', name:'Sidewalk'}`. Its refusals are silent.
- **Day post for a handoff of `night-D`:** `day-(D+1)`. For example, the handoff of `night-2026-12-04` uses `day-2026-12-05`.
- **Sheets rows** gain `made_for: 'handoff'|'end'` and `for_seq`. A row with no `made_for` reads as `'end'` with `for_seq = end_seq`.
- **File names:**
  - night sheets: as today (`CrewRouteSheet.fileName`);
  - day sheets: `<route name> Day handoff <M-D>.pdf`, or `Day handoff <M-D> (left by night).pdf` when there is no day route;
  - `<M-D>` is the day post's date (`12-5`).
- **Labels:**
  - Confirm: `Hand off to day now? The night's sheets are saved and the day crew sees what's left.` with buttons `Yes, hand off` / Cancel. The button reads `Hand off now`.
  - Card heading: `Handoff from Night of 12/4 · 8:00 AM` (plus ` · by <name>` unless by `Sidewalk`). Sections `Your route` and `Left by night`.
  - Leftover line parts: `<site> · <walksDone> of <walksTotal> walks` (or `Not started`), `Problem: <note>`, `Started by <name> <h:mm>`, `Done <h:mm>`. On a day-route site night touched: `Night: <d> of <t> walks`.
  - Matt's status line: `Night sheets saved at handoff <h:mm AM> (<n>)`, or `Handoff sheets: <k> not saved` with Retry.
- **Versions:** `VERSION` → `handoff-1`; phone `EXPECTED_BACKEND` → `handoff-1`; shell `titan-snow-shell-25`. `lib/handoff.js` goes in index.html (after routesheet.js and shiftlog.js, before shiftlogui.js) and in the sw.js SHELL.
- **Privacy:** names only in the card and the PDF, never phones, PINs or private roster fields. The repo is public: test fixtures use made-up site names on anything carrying day_rank or callout_in.

## Review Focus

1. **DST:** a storm open across the 11/1/26 change (AKDT→AKST). From local 2026-10-31T22:00, the next booking is 2026-11-01T08:00 local (`-09:00`), not 07:00 or 09:00. → Task 2 test.
2. **A late night tap after the handoff** (08:20, before 9 AM) counts as "after the handoff": the leftover shows `Started by <that person> 8:20`. A Close storm after it remakes that night's sheet as `(updated …)`. → Task 1 + Task 3 tests.
3. **Clean again on a leftover after the handoff:** it stays a leftover, but its live walks/done follow the current pass. → Task 1 test.
4. **Two nights in one storm:** the card follows the newest handoff, and each handoff gets its own PDFs. → Task 1 + Task 3 tests.
5. **Two phones tap Hand off now:** the second is refused `Already handed off at …`, and the 8 AM run after it does nothing. → Task 2 test.

---

### Task 1: `handoff.js` + day order in `shiftlog.js` (both repos)

**Files:**
- Create `snow-app-script/handoff.js` (UMD like routesheet.js; global `CrewHandoff`; node requires `./time`, `./shiftlog`, `./routesheet`).
- Modify `snow-app-script/shiftlog.js`.
- Copy both to `Snow-App-repo/lib/`.
- Modify `Snow-App-repo/lib/callout.js` (rankOrder delegates).
- Tests: create `snow-app-script/test/handoff.test.js`; add `'handoff.js'` to the identity list in `test/geo-identity.test.js`.

**Interfaces (Produces):**
- `CrewShiftLog.realTaps(rows)` exported (today it is internal; same rules), for Task 2's "something to hand off" check.
- `CrewShiftLog.dayOrder(siteIds, siteById)` → a new array: ranked first (day_rank ascending, ties by list position), then unranked in list order. `SnowCallout.rankOrder(ids, byId, isDay)` returns `isDay ? CrewShiftLog.dayOrder(ids, byId) : ids.slice()`, so existing callout tests stay green unchanged.
- `CrewHandoff.newestHandoff(stormRows, stormId)` → the handoff row with the highest seq for that storm, or null.
- `CrewHandoff.dayShiftOf(nightShiftId)` → `'day-YYYY-MM-DD'` (date + 1).
- `CrewHandoff.handoffData(o, handoff)` → `{ night: {shift_id, at, by_name}, dayShift, dayRoutes: [{route_id, name, crew, sites:[{site_id, name, address, walksDone, walksTotal, done, night: {done,total}|null}]}], leftovers: [{site_id, name, address, walksDone, walksTotal, problems:[{zone_name, note, pass}], started:{by_name, at}|null, done:{at}|null}] }`.
  - `o` has the routesheet `sheetData` shape: `{storm_id, routes, sites, zones, crew, log, visits, posts, moves, trucks, storms}`.
  - Night routes = `CrewRouteSheet.sheetsFor(o)` filtered to `handoff.shift_id`.
  - A leftover's "done at handoff" = `siteDone` over `walkStates` of Log rows with seq ≤ `handoff.log_seq`. Live `walksDone`/`done` use all rows (current pass).
  - `started` = the first real tap at the site with seq > `log_seq`. `done.at` = the at of the real tap after which `siteDone` first holds.
  - Order: not-done by `dayOrder` (list = night-route order, first appearance), done last.
  - Day routes: the Post of `dayShift`, else the Board (crew `source:'board'`, per `crewFor`'s rule). A route with no crew is left out.
- `CrewHandoff.handoffHtml(data, routeId|null, madeAt)` → one day PDF's HTML (null = the left-by-night-only sheet). Reuse `CrewRouteSheet.css`.
- `CrewHandoff.fileName(data, routeId|null)` → per the Global Constraints.

- [ ] **Tests first** (paper values in comments; made-up site names):
  - dayOrder: [A(—), B(2), C(1), D(—), E(2)] → [C, B, E, A, D]; the input is not mutated.
  - Leftovers:
    - a site done before the handoff is not a leftover;
    - a partly done one gives `2 of 5`;
    - a tap undone before the handoff doesn't count;
    - an open Problem, and one carried `(pass 1)`;
    - `started` from the first real tap after `log_seq`, including a late night tap at 08:20 (Focus 2);
    - an undo row after the handoff doesn't count as started;
    - `done.at`;
    - Clean again after the handoff: still a leftover, live counts from the new pass (Focus 3);
    - a site on two night routes is listed once;
    - two handoffs: `newestHandoff` picks the later one, and data follows it (Focus 4).
  - Day routes: from the day Post; with no Post, from the Board with `source:'board'`; a route with no crew is left out.
  - dayShiftOf: `night-2026-12-31` → `day-2027-01-01`.
  - fileName: both forms.
  - HTML:
    - has the heading and `Left by night`;
    - escapes a note holding `<b>`;
    - holds no phone number from a crew fixture that has one.
- [ ] Run (`npm test`) → fail. Implement. Copy both files to the phone. Run the backend `npm test` (identity included) and the phone's `npm run test:unit`. Add verify-tests mutations: leftovers ignore `log_seq`; `started` counts undo rows; done sites not sunk last; dayOrder ties by rank only. Run `npm run verify-tests` ALONE. Commit both repos.

### Task 2: the `handOff` action and the 8 AM trigger (snow-app-script)

**Files:** `Code.js` (`handle_` case; `BOARD_LEAD`; `handOff_`; `handOffMorning()`; `bookHandoff_()`; Start/Reopen book it, End drops it; `VERSION = 'handoff-1'`), `auth.js` (LEAD), `roster.js` (`PUBLIC_STORM_FIELDS` += `shift_id`, `log_seq`), `test/fake-apps-script.js` (`timeBased().at(date)` records the Date on the trigger; `getProjectTriggers()` returns it). Tests: create `test/handoff-api.test.js`.

**Interfaces:**
- Consumes `CrewShiftLog.realTaps(rows)` (Task 1) for "something to hand off": never re-derive the rules.
- Produces the handoff row (Global Constraints) and `queueSheets_(stormId)` + `ensureSheetsTrigger_()` called after it, so Task 4's job picks it up.
- `nextEightAm_(nowDate)` → a Date for the next local 08:00, built from the local `CrewTime.localIso` parts (pure enough to test).

- [ ] **Tests first:**
  - Matt hands off at 07:10 with night taps → the row has `shift_id night-…`, the `*_seq` high-water marks, and who; the sheets queue holds the storm.
  - Each refusal, with its exact text:
    - no storm;
    - 10:00 (day);
    - a night with only an undone tap;
    - a second handoff (two phones, Focus 5).
  - A posted night member → the lead refusal; a Board lead → allowed.
  - `handOffMorning`:
    - silent on a quiet night, a closed storm and no storm;
    - after a button handoff it does nothing;
    - it re-books while the storm is open;
    - each case leaves exactly one `handOffMorning` trigger, or none after Close.
  - Booking: Start books, Reopen books, End deletes. `nextEightAm_` from 07:59 → today 08:00; from 08:00 → tomorrow 08:00; DST from 2026-10-31T22:00 → 2026-11-01T08:00 local (Focus 1).
  - getShiftLog sends crew `shift_id` and `log_seq` on a handoff row.
  - GET answers `handoff-1`.
- [ ] Run → fail. Implement. Run `npm test`, then `verify-tests` alone. Mutations:
  - handOff open to members;
  - the already-handed-off check removed;
  - booking without deleting the old trigger;
  - End not deleting the trigger;
  - `nextEightAm_` off by an hour across DST.
  Commit.

### Task 3: the sheet job makes handoff sheets; Close skips unchanged nights (snow-app-script)

**Files:** `Code.js` (`owedSheets_`, `makeStormSheets_`, `sheetsOfEnd_`, `retrySheets_`). Tests: `test/routesheet-drive.test.js` (extend), `test/routesheet-api.test.js` (Retry).

**Interfaces:**
- Consumes `CrewHandoff.newestHandoff`, `handoffData`, `handoffHtml`, `fileName` (Task 1) and the handoff row (Task 2).
- Produces Sheets rows with `made_for`/`for_seq`, read by Task 4.

- [ ] **Tests first:**
  - **A handoff on an open storm** makes:
    - one night route sheet per `sheetsFor` night route, `made_for:'handoff'`, `for_seq` = the handoff seq, normal names;
    - one day PDF per crewed day route, `<route> Day handoff 12-5.pdf`;
    - with no day route: `Day handoff 12-5 (left by night).pdf`.
  - A second run makes nothing more.
  - **Close storm after a handoff:**
    - no changes: the night's sheets are not made again, and the day sheets are made as today;
    - a late tap (Focus 2) / a late Visits row / a late Trucks row for that night after the handoff's marks: that route's night sheet is remade with `(updated …)`, and only that route's.
  - **Two nights in one storm:** each handoff's sheets, each with its own `for_seq` (Focus 4).
  - **Old Sheets rows** with no `made_for` still count for their End: an existing ended storm owes nothing new.
  - **Retry** on an open storm with a failed handoff sheet schedules the job, and only that sheet is remade. Retry on an open storm with no handoff is still refused as today.
  - A failed Drive write writes `status:'failed'` and never throws out of the run.
- [ ] Run → fail. Implement. Run `npm test`, then `verify-tests` alone. Mutations:
  - Close always remakes night sheets;
  - the change check ignores Visits;
  - the change check ignores Trucks;
  - handoff rows counted for the End's set;
  - Retry still refuses an open storm.
  Commit.

### Task 4: the phone — card, Hand off now, status, Print (Snow-App-repo)

**Files:**
- `lib/shiftlogui.js`:
  - the handoff card at the top of the Storm tab (crew and live view) during day shift, while the storm is open and `newestHandoff` exists;
  - the `Hand off now` button + confirm in the live view during night shift (Matt / posted lead, `canRunNow`), through `run()` like Clean again;
  - the handoff status in `sheetsStatus` (reading `made_for`/`for_seq`);
  - Print lists the day handoff sheets.
- `lib/config.js` (`EXPECTED_BACKEND: 'handoff-1'`).
- `index.html` + `sw.js` (`lib/handoff.js`, shell 25).
- Tests: `test/ui.spec.js`; update the shell number in `test/sw.spec.js` and `test/manifest.test.js`.

**Interfaces:** consumes `CrewHandoff.*` (Task 1), the `handOff` request `{action:'handOff', payload:{}}` (Task 2), and Sheets rows (Task 3). The fake backend (`fakeSnow`) learns `handOff` (writes the row the same way the server does) and returns handoff rows on a poll.

- The card's `o` is built like `sheetOpts(S, st)`. On a crew phone `posts` is `[S.post]` and `moves` is `[]` (no Board), so day routes come from the fresh day Post. Matt's phone has both.

- [ ] **Tests first** (clock pinned with `clockAt`; made-up names on ranked sites):
  - **Card at 09:30** after a 08:00 handoff:
    - toBeVisible with the heading text;
    - `Your route` lists the viewer's day-Post route;
    - `Left by night` lists the not-done night sites in day-rank order, with `2 of 5 walks` and the Problem note.
  - **Card hidden** (toBeHidden):
    - at 22:00 (night);
    - with no handoff;
    - after Close storm.
  - **Live status:** a day tap on a leftover lands on a poll → `Started by Jordan 9:41` appears, with no reload. A finished leftover moves last with `Done`.
  - **Opening a leftover:** tapping its line opens that site's walks.
  - **Callout line:** a leftover whose measured new snow is at its callout shows the B2 callout line; one under it shows none.
  - **Hand off now:**
    - shown to Matt and to a posted night lead at 06:30, never to a member, never at 10:00;
    - the confirm text is exact;
    - Yes sends `handOff`;
    - a refusal shows its reason.
  - **Matt's status line:** after the handoff's Sheets rows arrive, `Night sheets saved at handoff 8:00 AM (2)`; a failed one shows Retry.
  - **Print** lists `Day handoff` sheets.
  - **Missing file:** lib/handoff.js blocked by `page.route` abort → the Storm tab still renders, with no card and no throw (guard as for SnowCallout).
- [ ] Run → fail. Implement. Run the full `npm test` and `node --test test/no-data.test.js`. Hand mutations (each must turn a test red, then restore):
  - the card shown at night;
  - the button shown to a member;
  - leftovers ignoring the handoff cut-off.
  Commit.

### Task 5: ship

- [ ] Matt types `/sidewalk-deploy`: server first (@13 `handoff-1 <sha>`), then the phone (shell 25). No new tab and no new Google service, so no editor steps. The first Start storm after the deploy books the 8 AM run.
- [ ] After the first real storm morning: check the Drive folder holds the night sheets from 8:00 and the day handoff PDFs, and compare one PDF with the phone card. Update the CLAUDE.md test counts and memory.
