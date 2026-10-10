# Outlines on Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-in stops carrying every zone outline (225 of its 341 KB): new phones ask for a slim reply with one point per site, fetch a site's outlines when its map opens, and keep a copy per map so the next open draws at once.

**Architecture:** One new shared pure file, `points.js` (byte-identical on both halves), holds the centroid, the site-point rule and the ring stripping. The backend uses it to answer `slim: true` on `bootstrap` and `getZones`; a request without `slim` gets today's reply unchanged. The phone gains `lib/outlines.js` (the kept copies in localStorage under `snow-outlines`) and draws maps from it before the per-site `getZones` reply lands.

**Tech Stack:** Apps Script (clasp, `vm`-tested via `test/fake-apps-script.js`), vanilla ES5 browser modules with the UMD header of `lib/shiftlog.js`, node:test, Playwright over `file://`.

**Spec:** `docs/superpowers/specs/2026-10-09-outlines-on-demand-design.md` (with the amendment committed beside this plan: `points.js`, not `geo.js`).

## Before you start

- Backend: branch `outlines` from `snow-app-script` master **after** the server-cache deploy (master 7d00203 or later). Work in a worktree, never the main checkout.
- Phone: branch `outlines` (this spec + plan) is cut from 139ee5c. **Rebase it onto the branch that holds both Spanish and the map fixes** (main once both have shipped, or their integration branch) before Task 3. Both edit `lib/mapview.js` / `lib/mapedit.js`, and Spanish adds `lib/es.js`, which Task 5 needs.
- The backend identity test compares with `../Snow-App-repo/lib`. From a worktree, point it at the phone worktree for Task 1 (or run the identity check by hand with `sha256sum` on the two copies, CR stripped) and say which you did.

## Global Constraints

- Backend `VERSION = 'outlines-1'`; phone `EXPECTED_BACKEND: 'outlines-1'`. The version-label mutation in `test-tools/mutation-check.js` is re-pointed in the same commit, or it goes SKIPPED.
- Request flag: `slim: true` (strict `=== true`). Absent: **today's reply, unchanged**.
- Reply field: `points: { <site_id>: [lng, lat] }`, unrounded, top level, never a field on a site.
- Point rule, exact: the site's `map.center` when both are finite numbers; else the centroid of the **first** zone (in the order given) with `site_id === site.id`, `archived !== true` and a ring of 3 or more corners; else no point.
- Shared file `points.js` (backend root) and `lib/points.js` (phone) are byte-identical and listed in `test/geo-identity.test.js`. `geo.js` is NOT touched (it is verbatim Bootprint).
- localStorage key `snow-outlines`, value `{ "v": 1, "sites": { <site_id>: { "at": <iso>, "rings": { <zone_id>: [[lng, lat], ...] } } } }`. Never renamed.
- Copy, exact: `Loading map…` and `This map hasn't been opened on this phone yet. It needs signal the first time.` Both get `lib/es.js` dictionary rows.
- Outlines never live in `S.zones` on the phone; only in `SnowOutlines`.
- New Playwright tests go in `test/outlines.spec.js` with their own small fake backend; `ui.spec.js` changes only where an existing fake must now honour `slim`.
- Phone shell: `sw.js` CACHE_VERSION one above what is live when this ships, in the commit of the first app-file change, with `test/manifest.test.js` and `test/sw.spec.js`; `lib/points.js` and `lib/outlines.js` in `SHELL` and `index.html`.
- `.claude/hooks/check-html-js.js` runs on every edit; `test/scripts-parse.test.js` parses every `lib/*.js`.

## Review Focus

1. **Points computed after the rings are stripped** gives an empty `points` and no forecast for 54 sites. Task 2 test: a slim bootstrap has a point for the mapped site; mutation swaps the order.
2. **Matt's replies include archived zones** (`live()` returns everything to admin). An archived first zone must never be a site's point (Task 1 test), and the kept copy must never hold archived rings, or `changed` fires on every open (Task 5 test with an archived zone in the `getZones` reply).
3. **Back, or another site's map, before the background reply lands**: the reply must not redraw onto the other map (the `mapSeq` guard), but it still updates its own site's kept copy (Task 5 test: open S1, hold its reply, open S2, release; S2's map unchanged, S1's copy updated).
4. **Edit map auto-start** (`titan-snow-editing` on) must wait for the reply like the button does, or Matt edits a stale outline (Task 5 test with the preference set and the reply held).
5. **A store that refuses or holds junk**: `setItem` throws (quota, private mode) or `snow-outlines` is not JSON. The map still opens from the reply and nothing throws (Task 3 node tests; Task 5 Playwright with a throwing `setItem`).

---

### Task 1: Shared `points.js`

**Files:**
- Create: `snow-app-script/points.js`, `snow-app-script/test/points.test.js`
- Modify: `snow-app-script/test/fake-apps-script.js:73` (`'points.js'` in `FILES`, before `'Code.js'`), `snow-app-script/test/geo-identity.test.js` (add `'points.js'` to the list)
- Create (copy): `Snow-App-repo/lib/points.js`

**Interfaces:**
- Consumes: nothing (no dependencies). UMD header as `lib/shiftlog.js` with no requires: `module.exports = factory()` / `root.SnowPoints = factory()`.
- Produces (all pure, inputs never mutated):
  - `centroid(ring) -> [lng, lat]`: the area-weighted centroid now in `lib/mapview.js:74-84`, moved verbatim (zero area returns `ring[0]`).
  - `sitePoint(site, zones) -> [lng, lat] | null`, by the Global Constraints rule.
  - `pointsFor(sites, zones) -> { [site_id]: [lng, lat] }`, one entry per site in `sites` with a point.
  - `slim(zones) -> zones`: shallow copies without `ring`; every other field kept.

- [ ] **Step 1: Write the failing tests in `test/points.test.js`.** Fixture: the 30 m x 10 m rectangle `RING` of `test/api.test.js` (copy its `E30`/`N10` arithmetic). Paper values in comments: the rectangle's centroid is its centre, `[-149.9 + E30/2, 61.2 + N10/2]`.
  - `centroid(RING)` equals the centre within `1e-12` on both coordinates; a 3-point collinear ring returns its first corner.
  - `sitePoint({ id: 'S1', map: { center: [-150, 61] } }, zones)` is `[-150, 61]` even when S1 has zones.
  - `sitePoint({ id: 'S1', map: { center: [null, 61] } }, …)` falls through to the zones.
  - zones `[Z0 S1 archived RING2, Z1 S1 RING, Z2 S1 RING2]` gives the centroid of `RING` (archived skipped, first live wins).
  - a zone with a 2-corner ring, or none, is skipped; a site with only such zones gives `null`.
  - a zone of another site is never used.
  - `pointsFor([S1 mapped, S2 unmapped], zones)` deep-equals `{ S1: <centre> }` (no `S2` key).
  - `slim(zones)` has no `ring` on any item, keeps `id, site_id, name, type, area_sqft, archived`, and leaves the input zones' rings in place.
- [ ] **Step 2: Run `npm test` in `snow-app-script`.** Expected: FAIL, `SnowPoints` / `points.js` not found.
- [ ] **Step 3: Implement `points.js`**; add it to `FILES` in the fake and to the identity list; copy it to `Snow-App-repo/lib/points.js`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS, identity test included.
- [ ] **Step 5: Commit** (backend: `points.js` + tests; phone: `lib/points.js` alone, it is not yet loaded by the page).

### Task 2: Backend slim replies, `outlines-1`

**Files:**
- Modify: `snow-app-script/Code.js:9` (VERSION), `:62-64` (`bootstrap`), `:90` (`getZones`)
- Modify: `snow-app-script/test-tools/mutation-check.js:239-244` (version label) plus new mutations
- Create: `snow-app-script/test/outlines-api.test.js` (its own `world()`, built like `test/api.test.js`'s)

**Interfaces:**
- Consumes: `SnowPoints.pointsFor`, `SnowPoints.slim` (Task 1).
- Produces: `bootstrap` + `slim: true` → today's keys plus `points`, zones without `ring`; `getZones` + `slim: true` → zones without `ring`; both without `slim` → unchanged.

- [ ] **Step 1: Write the failing tests.** World: sites S1 (zones Z1 RING, Z2 archived RING) and S2 (no zones); tokens for Matt and a crew member.
  - crew `bootstrap` + `slim: true`: no zone has `ring`; `points` deep-equals `{ S1: <RING centre> }`; every zone still has `area_sqft`.
  - Matt's slim bootstrap (archived Z2 in the reply): `points.S1` is still Z1's centroid.
  - crew `bootstrap` without `slim`: every zone has its `ring`, and `'points' in r` is false (the un-updated-phone guard).
  - `slim: 'yes'` (not `true`) is treated as absent.
  - `getZones { slim: true }`: no `ring`. `getZones { site_id: 'S1' }`: rings present.
  - `doGet()` answers `outlines-1`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL on each new test.
- [ ] **Step 3: Implement.** In `bootstrap`, when `req.slim === true`, set `boot.points = SnowPoints.pointsFor(boot.sites, boot.zones)` **before** `boot.zones = SnowPoints.slim(boot.zones)`. In `getZones`, strip with `SnowPoints.slim` when `req.slim === true`. `VERSION = 'outlines-1'`.
- [ ] **Step 4: Mutations** in `mutation-check.js`, each with its `caughtBy` test name: version label re-pointed to `outlines-1`; `req.slim === true` → `false` in bootstrap; slim before points; `SnowPoints.slim` returns its input; `sitePoint` view check dropped; archived check dropped; last zone instead of first (in `points.js`); getZones slim ignored.
- [ ] **Step 5: Run `npm test`, then `npm run verify-tests` ALONE.** Expected: all pass; every mutation CAUGHT, none SKIPPED.
- [ ] **Step 6: Commit.**

### Task 3: Phone kept copies, `lib/outlines.js`

**Files:**
- Create: `Snow-App-repo/lib/outlines.js`, `Snow-App-repo/test/outlines.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `SnowOutlines.KEY = 'snow-outlines'`; `SnowOutlines.store(storage) -> Store`, where `storage` is localStorage-like (`getItem/setItem/removeItem`) or a function returning one (it may throw); `SnowOutlines.local` = `store(() => window.localStorage)`. `Store`:
  - `keep(siteId, zones)`: that site's entry becomes `{ at: now ISO, rings: { [z.id]: z.ring } }` for the zones with a ring.
  - `keepOne(siteId, zone)`: sets one ring in that site's entry (creating it).
  - `withRings(siteId, zones) -> zones`: copies of the zones that have a kept ring, `ring` attached.
  - `changed(siteId, zones) -> boolean`: true when the zone-id set differs from the kept one, or any ring differs (compare `JSON.stringify` of the two rings).
  - `forget()`: removes the key.
  - Never throws. Unreadable JSON, or `v !== 1`, reads as empty.

- [ ] **Step 1: Write the failing node tests** with an in-memory storage double.
  - `keep` then `withRings` returns the kept rings; a zone never kept is not returned.
  - `keep` replaces the site's entry (a zone dropped from the list is gone); another site's entry is untouched.
  - `keepOne` adds to an existing entry.
  - `changed`: same rings false; one corner moved true; a zone added true; a zone gone true; a site never kept with any zones true.
  - `forget` removes the key.
  - Storage whose `setItem` throws: `keep` returns normally, `withRings` returns `[]`.
  - `getItem` returning `'not json'`, or `{"v":2}`, reads as empty.
  - Storage accessor that throws: every method returns normally.
- [ ] **Step 2: Run `npm run test:unit`.** Expected: FAIL, module missing.
- [ ] **Step 3: Implement `lib/outlines.js`** (UMD header, no requires).
- [ ] **Step 4: Run `npm run test:unit`.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: Phone slim sign-in, points, version

**Files:**
- Modify: `lib/app.js:111` and `:516` (`API.call('bootstrap', { slim: true })`, `S.points = r.points || {}`), `lib/shiftlogui.js:1216` (`ctx.call('getZones', { slim: true })`), `lib/weather.js` (`point`), `lib/snowmap.js:21-30` (`pointsFor`), `lib/shiftlogui.js:690, 743, 774, 1036` (callers), `lib/mapview.js:74-84` (`centroid` delegates to `SnowPoints.centroid`; its UMD header gains `require('./points')` / `root.SnowPoints`, and `lib/points.js` loads before it in `index.html` and `SHELL`), `lib/config.js` (`EXPECTED_BACKEND: 'outlines-1'`), `index.html` + `sw.js` (both new files, shell bump), `test/manifest.test.js`, `test/sw.spec.js`, `test/weather.test.js`, `test/snowmap.test.js`, the fake in `test/ui.spec.js` (answer `points` and drop rings when `slim === true`, exactly like the real one)

**Interfaces:**
- Consumes: `SnowPoints.centroid` (Task 1), `SnowOutlines.local.withRings` (Task 3).
- Produces:
  - `SnowWeather.point(site, zones, serverPoint) -> [lat, lon] | null`. Order: saved view; then `serverPoint` (`[lng, lat]`); then the first zone in `zones` with a ring. Rounded to 2 dp; `[lat, lon]` order as today.
  - `SnowMapOverview.pointsFor(sites, zones, points)`: passes `points[s.id]` through.
  - Callers pass `S.points[site.id]` and `SnowOutlines.local.withRings(site.id, <site's live zones>)`.

- [ ] **Step 1: Write the failing tests.**
  - weather: view beats `serverPoint`; `serverPoint` beats a zone ring; with neither a view nor a `serverPoint`, a kept ring's centroid is used; all rounded to 2 dp (paper: `[-149.8761, 61.2049]` gives `[61.2, -149.88]`).
  - snowmap: a site with only a server point is in `points`, not `missing`.
  - ui.spec: both bootstrap calls carry `slim: true` (assert on the request body); the Storm tab's zone refresh carries `slim: true`.
- [ ] **Step 2: Run the unit tests plus the touched specs.** Expected: FAIL.
- [ ] **Step 3: Implement.** Wire the files, bump the shell and the pins, `EXPECTED_BACKEND: 'outlines-1'`.
- [ ] **Step 4: Run `npm run test:unit` and `npx playwright test test/ui.spec.js test/sw.spec.js --workers=2`.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Maps from kept copies

**Files:**
- Modify: `lib/app.js` `openMap` (:344-372), `startEdit` `onZone` (:336), the sign-out handler (:601); `lib/es.js` (two rows)
- Create: `test/outlines.spec.js` (own fake backend: real-shaped slim replies, a `hold` switch for `getZones { site_id }`, an `abort` switch)

**Interfaces:**
- Consumes: `SnowOutlines.local` (Task 3), `SnowMap.open`, `SnowMap.setZones`, `siteZones(id)`, `mapSeq`.
- Produces: the map-open behaviour in the spec's "Tapping Map".

- [ ] **Step 1: Write the failing Playwright tests.**
  - Kept copy for S1 seeded in `snow-outlines`; `getZones` held: the map opens and draws the kept zones (zones source has the features) **before** the reply is released.
  - Reply with one corner moved: after release the zones source carries the new corner, and `snow-outlines` holds it.
  - No kept copy, reply held: `Loading map…` visible; after release, the map draws and the text is hidden.
  - No kept copy, `getZones` aborted: the no-signal message visible (assert `toBeVisible`, plus a case where it is `toBeHidden`).
  - Kept copy, `getZones` aborted: map drawn, no message.
  - Matt: `#mapedit` disabled while the reply is held, enabled after; with `titan-snow-editing` set, the editor bar does not appear until the reply lands.
  - Matt's reply carries an archived zone: `snow-outlines` holds no ring for it, and a second open with the same reply does not redraw (`changed` false).
  - Open S1 (held), Back, open S2, release S1: S2's zones source unchanged; S1's kept copy updated.
  - Editor save of a zone: `snow-outlines` holds the saved ring.
  - Sign out: `snow-outlines` gone.
  - `localStorage.setItem` throwing for `snow-outlines`: the map still opens from the reply, no page error.
  - Spanish on: both new lines read in Spanish.
- [ ] **Step 2: Run `npx playwright test test/outlines.spec.js`.** Expected: FAIL.
- [ ] **Step 3: Implement** in `openMap`: kept zones via `withRings(id, siteZones(id))`; open now if any is kept or the site has none; otherwise show `Loading map…`. Fetch `getZones({ site_id: id })` in the background; on a reply, drop `archived === true`, `keep`, and when this is still the open map and `changed` was true before keeping, `SnowMap.setZones`; open from the reply if not yet open. Enable `#mapedit` and allow the auto-start only after the reply lands. Show the no-signal message on a failed reply with nothing open. `onZone` adds `keepOne`. Sign-out adds `SnowOutlines.local.forget()`. Two `lib/es.js` rows.
- [ ] **Step 4: Run `npx playwright test test/outlines.spec.js` and `npm run test:unit`.** Expected: PASS.
- [ ] **Step 5: Hand mutations**, each caught and then reverted: open waits for the reply even with a kept copy; `changed` always false; `forget` dropped from sign-out; `#mapedit` enabled at open; archived filter dropped.
- [ ] **Step 6: Commit.**

### Task 6: Full suites and notes

- [ ] **Step 1:** Backend `npm test`, then `npm run verify-tests` ALONE. Expected: all pass, all mutations CAUGHT.
- [ ] **Step 2:** Phone `npm test` (node + full Playwright, `--workers=2`). Expected: all pass ("the forecast shows as a hint" may flake once under load; re-run it alone and report both).
- [ ] **Step 3:** Size check against the fakes: a slim bootstrap from `test/outlines.spec.js`'s fake carries no `ring` substring.
- [ ] **Step 4:** Record in `HANDOFF.md` (top): branches, counts, mutations, no editor step, ships as one `/sidewalk-deploy` (backend first), and the post-deploy re-time of `bootstrap` in the pane (target about 115 KB).
- [ ] **Step 5: Commit.**
