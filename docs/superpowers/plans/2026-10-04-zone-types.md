# Hand and Snow storage zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new zone types (`hand`, `storage`), Bootprint's colours in Sidewalk, imports that keep hand and storage, and the moa-layer map fix.

**Architecture:** Zone type stays the single switch: colour (mapview), editor buttons (mapedit), server validation (roster.js), and the shift-log rules (shiftlog.js, byte-identical in both repos). Route sheets, Copy for BT and live progress all read `walksFor`, so they follow from Task 1.

**Tech Stack:** plain ES5 browser JS + MapLibre (phone); Apps Script JS tested with `node --test` (backend); Playwright (phone UI).

**Spec:** `Snow-App-repo/docs/superpowers/specs/2026-10-04-zone-types-design.md`

## Global Constraints

- Type ids are stored data: `sidewalk`, `hand`, `heated`, `storage`, `no_touch`. Never rename one.
- Colours: sidewalk `#1c6fb0`, hand `#d98c00`, heated `#d62828`, storage `#7d5ba6`, no_touch `#e0218a`.
- Labels and legend order: Sidewalk · Hand work · Heated: check only, no melt · Snow storage · Do not touch.
- `snow-app-script/shiftlog.js` and `Snow-App-repo/lib/shiftlog.js` stay byte-identical (geo-identity.test.js).
- Public phone repo: no customer data in tests or fixtures (no-data.test.js).
- Expected values worked on paper in test comments; each new guard proven by a mutation.

## Review Focus

1. A site with only storage/no_touch zones: the Storm tab must fall back to "Whole site", not show an empty list → Task 1 test.
2. A storage RUN with a width (a pile drawn as a line) imports as a storage strip, not skipped → Task 2 test.
3. Old zones drawn before today keep their type and just recolour (no migration) → Task 3 colour-expression test covers all five.
4. A map open must never throw on the photo switch (the 10/4 bug) → Task 3 test asserts no console error on open.
5. The import summary must not call piles "walks" (Matt would read 29 walks for ANMC) → Task 2 test.

---

### Task 1: Backend rules + validation (snow-app-script, copied to the phone)

**Files:**
- Modify: `snow-app-script/shiftlog.js` (`walksFor`, `statesFor`), copy to `Snow-App-repo/lib/shiftlog.js`
- Modify: `snow-app-script/roster.js:23` (`ZONE_TYPES`) and the error at ~line 94
- Test: `snow-app-script/test/shiftlog.test.js`, `snow-app-script/test/api.test.js`; mutations in `snow-app-script/test-tools/mutation-check.js`

**Interfaces:** Produces `walksFor(siteId, zones)` including `hand`; `statesFor('hand')` → `['cleared','treated','problem']`.

- [ ] Step 1: tests (fail first):
  - `walksFor lists sidewalk, hand and heated zones, never storage or no_touch` — site with one zone of each of the five types → walk ids are exactly the sidewalk, hand, heated ones.
  - `a site with only storage and no_touch zones is one Whole site walk` → `[{zone_id:'whole', type:'sidewalk', name:'Whole site'}]`.
  - `hand zones take the same three states as sidewalk` → `statesFor('hand')` deepEquals `statesFor('sidewalk')`.
  - api: `hand and storage zones are accepted` (both `ok: true`); rename the old test to `a zone type outside the five is refused` (still `parking_lot` → invalid, reason matches /type/).
- [ ] Step 2: `npm test` in snow-app-script → the new tests fail.
- [ ] Step 3: implement; error text `Zone type must be sidewalk, hand, heated, storage or no_touch`; copy shiftlog.js over the phone's.
- [ ] Step 4: `npm test` (backend, all pass incl. geo-identity) and `npm test` in Snow-App-repo node tests pass.
- [ ] Step 5: add mutations: drop `hand` from walksFor → caught by "never storage"; give storage a walk → same test; drop `storage` from ZONE_TYPES → "accepted". `npm run verify-tests` → all caught.
- [ ] Step 6: commit both repos.

### Task 2: Import keeps hand and storage (Snow-App-repo/lib/bpimport.js)

**Files:** Modify `lib/bpimport.js` (`convertJob`), `lib/mapedit.js` import summary (~lines 290–330). Test `test/bpimport.test.js`.

**Interfaces:** `convertJob(job, existing)` → zones carry `type` from surface: walk→`sidewalk`, hand→`hand`, storage→`storage`; `skipped` loses `storage` (plow, cutouts, noWidth, tooSharp, already, unfinished remain).

- [ ] Step 1: tests (fail first): rewrite `lots, storage and cut-outs are skipped…` → `lots and cut-outs are skipped; storage comes in as snow storage` (storage zone → `type: 'storage'`, skipped `{lots:2, cutouts:1, …}`); `hand areas … come in as hand` (`type: 'hand'`); `a walk area comes across as a sidewalk zone` asserts `type: 'sidewalk'`; `a storage run with a width becomes a storage strip`.
- [ ] Step 2: run `node --test test/bpimport.test.js` → fail.
- [ ] Step 3: implement; job list line and `bp_sum` say "N walks · M snow piles" (piles = storage zones), "1 snow pile" singular.
- [ ] Step 4: ui.spec import test(s) updated to expect the pile wording; Playwright for those tests passes.
- [ ] Step 5: commit.

### Task 3: Colours, editor buttons, map fix (Snow-App-repo)

**Files:** Modify `lib/mapview.js` (TYPES, `showSwitch`), `lib/mapedit.js` (BTN, "Pick a type" message). Test `test/ui.spec.js` (colour expression ~2487, legend), `test/mapview.test.js` if TYPES is unit-tested there.

- [ ] Step 1: tests (fail first): colour expression equals `['match',['get','type'],'sidewalk','#1c6fb0','hand','#d98c00','heated','#d62828','storage','#7d5ba6','no_touch','#e0218a','#888888']`; legend text order as Global Constraints; editor shows five type buttons in that order; `a site map opens with no console error` (collect `pageerror` + console errors while opening a site map 5 times); Storm tab lists a hand zone with Cleared/Treated/Problem and no storage zone.
- [ ] Step 2: run them → fail.
- [ ] Step 3: implement. `showSwitch` must not query the map: keep a local `moaOn = true` that the click handler flips and uses for `setLayoutProperty`. Missing-type message: `Pick a type: Sidewalk, Hand, Heated, Snow storage or Do not touch.`
- [ ] Step 4: phone `npm test` (node + Playwright) all pass. Hand mutations: revert `showSwitch` → the console-error test fails; swap hand/storage colours → colour test fails.
- [ ] Step 5: commit.

### Task 4: Ship

- [ ] Step 1: bump the shell cache version (sw.js) in Snow-App-repo; update CLAUDE.md suite counts if they changed.
- [ ] Step 2: `/sidewalk-deploy dry-run`, then `/sidewalk-deploy` (server first, new version on the same deployment, then phone).
- [ ] Step 3: in Claude's pane: open ANMC map with no console error; legend shows five types in Bootprint colours.
- [ ] Step 4: update memory (snow-app-big, workflow: piles now import; remove "hold the import").
