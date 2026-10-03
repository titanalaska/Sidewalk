# Route Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One PDF per route + shift saved to Drive after every storm, plus a Print button, built from what the shift log already records; trucks and site units added with almost no typing.

**Architecture:** A pure `routesheet.js` (byte-identical in both repos) turns storm data into one sheet's HTML. The backend schedules a one-off trigger at End storm that renders every sheet to PDF in Drive and records each in a `Sheets` tab. The phone prints the same HTML. Trucks are an append-only `Trucks` tab; site units are a site field.

**Tech Stack:** Apps Script (clasp; HtmlService, DriveApp, ScriptApp), node `--test` + the vm fake Sheet, browser JS, Playwright over `file://`.

**Spec:** `docs/superpowers/specs/2026-10-03-route-sheets-design.md`

## Global Constraints

- Phone repo `Snow-App-repo` branch `route-sheets` (PUBLIC, code only, no data files). Backend `snow-app-script` on `master`.
- `routesheet.js` byte-identical in both repos (identity test strips `\r`); pushed after `time.js`, `board.js`, `shiftlog.js` in `.clasp.json` `filePushOrder`.
- Append-only tabs (`Trucks`, `Sheets`): rows are never edited or deleted; seq/ids via `appendSeq_` under `locked_`.
- `by_*` always from the token. Names only on a sheet: never phone, PIN, profile id or private roster fields.
- Blank, never invented: site units default `''`; a missing truck prints "—".
- A site on the route is never left off a sheet: no taps that shift → "Not done this shift".
- End storm never waits for PDFs and never fails because of them.
- Backend `VERSION = 'sheets-1'`; phone `EXPECTED_BACKEND: 'sheets-1'`; shell `titan-snow-shell-15`.
- Edit/Write tools only for source edits. Every backend guard gets a mutation; phone guards a hand mutation noted in the commit.

## Review Focus

1. **A storm that spans midnight and the 9 AM cutover** → each route gets one night sheet and one day sheet; no tap lands on both or neither (Task 1 test).
2. **A route with crew but zero taps in a shift** → its sheet exists and every site says "Not done this shift" (Task 1 test).
3. **Two Ends after a Reopen** → the first files stay; the second set is named "(updated …)"; the Sheets tab holds both sets (Task 3 test).
4. **A site whose units were never set** → equipment prints minutes with no unit number, never "undefined" (Task 1 test).
5. **A note containing `<script>` or `&`** → printed as text in both the PDF HTML and the Print view (Task 1 test).

---

### Task 1: `routesheet.js`, the shared layout

**Files:**
- Create: `snow-app-script/routesheet.js`, the identical `Snow-App-repo/lib/routesheet.js`, `snow-app-script/test/routesheet.test.js`
- Modify: `.clasp.json` filePushOrder (after `shiftlog.js`), `test/fake-apps-script.js` FILES (after `shiftlog.js`), `test/geo-identity.test.js` list, `test-tools/mutation-check.js` FILES

**Interfaces:**
- Consumes: `CrewShiftLog.walksFor/walkStates`-style rules (use `walksFor`, `siteTimes`, `visitTotals`), `CrewBoard.boardFrom`, `CrewTime.shiftLabel`.
- Produces `CrewRouteSheet` (UMD like `history.js`, deps time, board, shiftlog):
  - `sheetsFor(o) -> [{route_id, shift_id}]` — o = `{storm_id, routes, log, visits, posts, moves, trucks}`; one entry per live route + shift where the route has a tap, a visit, a truck row or a posted/board crew in that shift of that storm; shifts from the storm's Log/Visits/Trucks rows; ordered by shift (`CrewTime` order) then numeric route name.
  - `sheetData(o, routeId, shiftId) -> {route, shift_label, storm_started, crew:{lead, members, source:'post'|'board'}, truck:{truck, by_name}|null, sites:[{id, name, start, finish, done, walks:[{name, state, note, by_name, at, off_route, snowing_warned}], depth:[{by_name, depth_in}], materials:{needed, used:[{by_name, materials_used}]}, equipment:[{machine, unit, minutes:[{by_name, min}]}]}]}`; o adds `sites, zones, crew, storms`.
    - crew: the post whose `shift` === shiftId (newest such), else `boardFrom(moves with at <= that route's last tap that shift, or all moves before the shift's end if no taps)`.
    - truck: newest Trucks row for route + shift.
    - walk state per shift: newest Log row for that walk with that shift_id in that storm; none → walk listed as "Not done".
    - equipment: bobcat/snowrator carry `site.units[k]` (may be ''); blower/sweepster unit ''. Only machines with any minutes listed.
  - `sheetHtml(data, madeAt, updated) -> string` — one self-contained page (inline CSS, print-friendly, `@page` letter), every string escaped; footer "Made by Sidewalk from crew taps · <madeAt>" + " (updated)" when `updated`.
  - `fileName(data, madeAt, updated) -> 'N3 Night of 12-4.pdf' | 'N3 Night of 12-4 (updated 9-12 AM).pdf'`.

- [ ] **Step 1: Failing tests** (`test/routesheet.test.js`, values worked on paper in comments): `a site with no taps prints Not done this shift`; `a route with crew but no taps still gets its sheet`; `night and day sheets split at 9 AM and night_on` (Review Focus 1); `the shift's post names the crew; with no post the board as of the last tap, labelled board`; `the newest truck row wins and prints who set it`; `two people's minutes print under the site's Bobcat unit`; `a unit never set prints minutes with no unit, never undefined` (RF4); `notes and names are escaped` (RF5: `<script>` and `&`); `no private roster field reaches the html` (plant `weaknesses: 'SECRET'`, phone `555-…` on crew; assert absent); `file names: plain, and updated with the time`.
- [ ] **Step 2: Run** `node --test test/routesheet.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** to the interfaces. Copy byte-identical to `Snow-App-repo/lib/routesheet.js`.
- [ ] **Step 4: Run** `npm test` → green (identity test included).
- [ ] **Step 5: Mutations**: drop not-done sites; ignore shift_id when picking walk state; take the board even when a post exists; oldest truck wins; skip escaping; include `phone`. `npm run verify-tests` → all CAUGHT.
- [ ] **Step 6: Commit** both repos.

---

### Task 2: Backend data — trucks, site units, the post carries the truck

**Files:** Modify `snow-app-script/sheet.js` (TABS `Trucks`, `Sheets`), `roster.js` (site `units` validation; `PUBLIC_TRUCK_FIELDS`), `auth.js`, `Code.js`, `pairing.js`; Create `test/routesheet-api.test.js`

**Interfaces:**
- `setTruck {route_id, truck}` → `Trucks` (`T-`), server sets `shift_id = shiftFor(now, storms)` (open storm not required), `by_*`, `at`. Admin: any live route. Lead: only the route the live board has them **leading**; else `forbidden` "Only Matt or that route's lead can set its truck." Crew: forbidden. `truck` trimmed, 1–20 chars.
- `getShiftLog` reply gains `trucks` (cursor/last like the other tabs) and `sheets` (admin only; `[]` for others).
- Site `units`: object with only `bobcat`, `snowrator`, each string ≤ 20 chars or ''; anything else refused.
- `buildPost` route entries gain `truck` (newest Trucks row for that route + the post's shift, else null) — allow-listed.
- `auth.js`: `setTruck` in a new `LEAD` entry (admin+lead; route check in Code.js).
- `VERSION = 'sheets-1'`.

- [ ] **Step 1: Failing tests:** `Matt can set any route's truck; a lead only the route they lead; crew never`; `the newest truck wins and the post carries it`; `a truck is filed under the server's shift`; `site units accept only bobcat and snowrator, blank by default`; `the crew's poll carries trucks but no profile ids and no sheets`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → green.
- [ ] **Step 5: Mutations:** lead may set any route; post drops the truck; units accept any key; crew poll gets sheets. `verify-tests` → CAUGHT.
- [ ] **Step 6: Commit.**

---

### Task 3: Backend — PDFs to Drive after End storm

**Files:** Modify `Code.js`, `sheet.js`, `test/fake-apps-script.js` (fakes: `ScriptApp.newTrigger(fn).timeBased().after(ms).create()` recording triggers, `ScriptApp.getProjectTriggers/deleteTrigger`; `HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf')` returning a blob that records its html; `DriveApp.getFoldersByName/createFolder/folder.createFile(blob).setName/getId/getUrl`, with an option to make createFile throw); Create `test/routesheet-drive.test.js`

**Interfaces:**
- `stormAction end` → after the Storms row is written (inside its lock), schedules `makeSheets` via a one-off trigger (60 000 ms) and returns at once. No Drive call in the request.
- `makeSheets()` (trigger entry point, top-level function): finds every storm with an `end` row newer than its newest `Sheets` rows (or with failed rows marked for retry), builds `CrewRouteSheet.sheetsFor/sheetData/sheetHtml` per sheet, saves PDF to `Snow Route Sheets/<storm start YYYY-MM-DD> storm/`, appends a `Sheets` row per file (`saved` + file id/url, or `failed` + error); `updated` = this storm already has saved Sheets rows from an earlier End. Deletes its own trigger. Never touches Log/Storms/Visits/Trucks.
- `retrySheets {storm_id}` (admin): schedules the job for that storm's failed (route, shift) pairs only.
- Drive and trigger scopes appear in the manifest automatically from use; Matt authorizes once.

- [ ] **Step 1: Failing tests:** `ending a storm schedules the sheets and returns without touching Drive`; `the job saves one pdf per route and shift and records each`; `a Drive failure records failed and the storm stays ended`; `retry redoes only the failed sheets`; `a second end after reopen adds updated files and deletes nothing` (RF3); `the job deletes its own trigger`; `the job never writes Log, Storms, Visits or Trucks`; `retry is Matt only`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → green.
- [ ] **Step 5: Mutations:** make PDFs inside the End request; delete old files on update; retry redoes all; no trigger cleanup. `verify-tests` → CAUGHT.
- [ ] **Step 6: Commit.**

---

### Task 4: Phone — truck, site units, Print sheets, Sheets status

**Files:** Modify `lib/boardui.js` (truck field per route on the Board), `lib/shiftlogui.js` (lead's truck on their route; crew read-only truck; live view: Print sheets button, Sheets status + Retry), `lib/app.js` (site edit box units; `S.trucks`, `S.sheets` from the poll), `index.html` (script `lib/routesheet.js` after `shiftlog.js`), `lib/config.js` (`EXPECTED_BACKEND: 'sheets-1'`), `sw.js` (SHELL + `titan-snow-shell-15`), `app.css`, `test/ui.spec.js` (fake: setTruck, trucks/sheets in poll, units on sites, retrySheets), `test/sw.spec.js`, `test/manifest.test.js`

**Interfaces:**
- Consumes `setTruck`, `retrySheets`, poll `trucks`/`sheets`, `CrewRouteSheet.sheetsFor/sheetData/sheetHtml`.
- Print sheets: opens a print view (an in-app overlay, not a new window) holding every `sheetHtml` for the current or last storm, one per page (`page-break-after`), then `window.print()`; Back closes it (a Back-stack step 'print').
- Status line: "Sheets: N saved" / "Sheets: N not saved · Retry" / "Sheets: making…" (end row newer than the last Sheets row).

- [ ] **Step 1: Failing tests:** `Matt sets a route's truck on the Board and it is sent`; `a lead changes their own route's truck from the Storm tab`; `crew see the truck but cannot change it`; `site units are typed in the site box and sent, blank by default`; `Print sheets shows one page per route and shift, with not-done sites`; `Back closes the print view`; `the sheets status shows saved, failed with Retry, and making`; `a note with <b> prints as text`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full `npm test` → green. Hand-mutate: lead truck control shown to crew; Print view drops not-done sites. Note results.
- [ ] **Step 5: Commit.**

---

### Task 5: Review and deploy

- [ ] **Step 1:** Whole-branch review across both repos; one fix wave; scoped re-review.
- [ ] **Step 2: Deploy — Matt approves first.** `clasp push` → Matt runs `setup` (adds Trucks, Sheets) **and** runs `makeSheets` once in the editor to grant Drive + trigger access → `clasp create-version "sheets-1"` → `update-deployment AKfycbwc7dcf… -V <n> -d "sheets-1"` → GET says `sheets-1` → `git push origin route-sheets:main` → Pages green → live `sw.js` says shell 15.
- [ ] **Step 3:** Update CLAUDE.md counts, memory, HANDOFF.
