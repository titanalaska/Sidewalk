# Multiple cleanings, Part B2: callout depths, new snow, day ranking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each site carries a callout depth and a day rank. Matt's live view lists the sites whose new snow since their last cleaning has reached their callout: an NWS estimate by default, and a lead's measured depth when one has been entered. On day shift, ranked sites come first everywhere the crew read a site list.

**Architecture:** Two new site fields: `callout_in` and `day_rank`. They are blank by default, and a save that leaves them out keeps the stored values, exactly like `customer`.
- **Depth reading:** one new Log row kind, `{zone_id:'*', state:'depth', depth_in}`, written by a new `depthNow` action (Matt + Board leads).
- **Where "since" starts:** this is a replay of Log rows, so it lives in shiftlog.js (byte-identical in both repos; the backend's mutation check guards it).
- **Estimate and list:** the NWS estimate, the Callouts list and the day ordering are phone-only. They sit in a new pure `lib/callout.js` plus a gridpoint fetch in `lib/weather.js`, and are drawn by shiftlogui.js and boardui.js.

**Tech Stack:** Apps Script JS (`node --test`, fake sheet, `verify-tests`); phone ES5, `node --test` + Playwright over `file://`.

**Spec:** `Snow-App-repo/docs/superpowers/specs/2026-10-04-passes-design.md` (Part B › Callout and new snow; Ranking). Part A and B1 are live.

## Global Constraints

- **Site fields:**
  - `callout_in` is null or a number with 0 < x ≤ 24. Error: `Callout depth is inches, more than 0 and at most 24`.
  - `day_rank` is null or an integer from 1 to 99. Error: `Day rank is a whole number from 1 to 99`.
  - Blank is saved as `null`, never 0. A save that leaves a field out (`undefined`) keeps the stored value.
- **Never shipped in code:** no rank or callout values go in the repo, including seed data and tests' real site names (public repo). Matt types them.
- **New action `depthNow {site_id, depth_in}`:**
  - Allowed for Matt and Board leads: LEAD list in auth.js plus `BOARD_LEAD` in Code.js.
  - Refused with no open storm (`No storm is open`), an unknown site (`Unknown site`), or a depth that isn't a number with 0 ≤ x ≤ 60 (`Depth is 0 to 60 inches`).
  - It appends `{zone_id:'*', state:'depth', depth_in:Number, note:''}`. A depth row is never a walk, never a real tap, never a pass, and cannot be undone: the existing `That cannot be undone` reply stands.
  - `depth_in` joins `PUBLIC_LOG_FIELDS`.
- **Undoing a Clean again** is still allowed when depth rows are the only rows after it.
- **Version labels:** `VERSION` → `callouts-1`, and `EXPECTED_BACKEND` → `callouts-1`, in the same deploy (new action = shape change). Shell `titan-snow-shell-23`. New `lib/callout.js` goes in index.html and the sw.js `SHELL` list.
- **Where "new snow since" starts:**
  1. the newest real tap of the site's current pass;
  2. else that pass's `again` row;
  3. else the storm's `start` row.

  The measured depth is the newest depth row at the site after that point.
- **The estimate:**
  - The sum of NWS gridpoint `snowfallAmount` (mm ÷ 25.4) over [from, now]. Each period counts by the fraction of it that overlaps the span.
  - The point is the existing `SnowWeather.point` (2 dp).
  - Only Matt's phone and Board leads' phones fetch it. There is one fetch per distinct point, and a result is kept 30 min. A failure is kept too, so a failing service is not hammered.
  - Shown to one decimal. The **shown** (rounded) value is what's compared with the callout.
  - If the series starts after `from`, the "since" time shown is the series' first covered instant. No overlap at all means no estimate.
- **Labels:**
  - Site form: `Callout depth (inches), blank = no nudge` (`#s_callout`) and `Day rank (1 = first on day shift), blank = by choice` (`#s_rank`).
  - Site card button `New snow` (sites with a callout set; Matt + Board leads; open storm). Its dialog title is `New snow at <site>`, the field `Inches since the last cleaning` (`#dn_in`), the buttons `Save` (`#dn_save`) / Cancel.
  - Box heading `Callouts (<n>)` (`#callouts`). Estimate line: `<site> · ~1.3" since 3:10 AM (estimate) · callout 1"`. Measured line: `<site> · 2" measured 4:05 AM by Alex · callout 1"`. Each line gets a `Clean again` button (the existing `data-again`) only when `CrewShiftLog.checkAgain` is null.
- **Order:** on **day** shift, ranked sites come first (rank ascending, ties by their place in the list), then the unranked in list order. Night shift and the paper route sheets keep route order. "Day" means `shiftFor(now, storms)` starts `day-`; on Tonight it means the post's own `shift`.

## Review Focus

1. **A callout site with no point** (no saved view, no zones): no estimate line and no fetch. A measured depth still lists it.
2. **Storm started yesterday, NWS series begins this morning:** the estimate counts only the covered part, and the line says "since <first covered time>", never the storm start.
3. **Depth measured, then Clean again:** the old reading no longer counts (it's before the new `from`). A new reading after the again does.
4. **A site on two routes:** listed once in the Callouts box, at its first appearance in live-view order.
5. **9 AM cutover:** the next draw after 9 AM re-orders the lists into day-rank order with no reload. At night a ranked site stays in route order.

---

### Task 1: Site fields `callout_in`, `day_rank` (snow-app-script)

**Files:** `roster.js` (`validate`), `Code.js` (save-site keep-on-omit, next to `customer`). Tests `test/roster.test.js`, `test/api.test.js`.

**Interfaces (Produces):** site records always carry `callout_in: Number|null` and `day_rank: Number|null` after a save.

- [ ] **Tests first:**
  - validate accepts null / 1 / 0.5 / 24 for callout_in and refuses 0, -1, 25, `'1'`, NaN with the exact message;
  - day_rank accepts null / 1 / 99 and refuses 0, 100, 1.5, `'2'`;
  - api: a save with `callout_in: 1, day_rank: 3` stores them;
  - a later save leaving both out keeps 1 and 3;
  - a save sending `null` clears them to null;
  - a site never given them reads null, not 0.
- [ ] Run (`npm test`) → the new tests fail. Implement. Then `npm test` passes and `npm run verify-tests` runs ALONE. Add mutations: callout 0 accepted; omit wipes callout; omit wipes rank. Commit.

### Task 2: `snowSince` + depth rows never block an undo (shiftlog.js, both repos)

**Files:** `snow-app-script/shiftlog.js` → copy byte-identical to `Snow-App-repo/lib/shiftlog.js`. Test `snow-app-script/test/shiftlog.test.js`.

**Interfaces (Produces):**
- `snowSince(logRows, stormRows, stormId, siteId)` → `{ from: iso|null, fromSeq: Number, measured: Row|null }`.
  - `from`/`fromSeq` are, in order: the newest real tap (`realTaps`) of the current pass; else the current pass's `again` row; else the storm's `start` row (`from` = its `at`, `fromSeq` 0). `from` is null if there is no start row.
  - `measured` is the newest `state:'depth'` row at the site in the storm with seq > `fromSeq`.
- `undoTarget`: for an `again` row, the "newest row at the site" check skips `state:'depth'` rows.

- [ ] **Tests first** (seqs and times worked out on paper in comments):
  - storm start 01:00, no rows → from 01:00, measured null;
  - a tap seq 3 at 02:10, an undone tap seq 5 → from 02:10 (an undo is not work);
  - again seq 7 at 03:00 with no tap after → from 03:00;
  - a depth seq 8 after it → measured = seq 8;
  - a tap seq 9 after the depth → from = seq 9, measured null (Focus 3);
  - a depth before the again is ignored after it;
  - rows of another site or storm are ignored;
  - undoTarget of an again followed only by a depth row → ok;
  - followed by a depth then a tap → `Someone has tapped this site since`;
  - undo of a depth row → `That cannot be undone`;
  - a depth row is never in walkStates, checkAgain or passSegments.
- [ ] Run → fail. Implement and export. Copy to the phone and confirm the files are identical (the geo-identity test style). Run the backend and phone node suites. Mutations: snowSince counts undo rows as taps; measured ignores seq; the depth row blocks again undo. Commit both repos.

### Task 3: `depthNow` action (snow-app-script)

**Files:** `auth.js` (LEAD), `Code.js` (`BOARD_LEAD`, `handle_` case, `depthNow_` beside `cleanAgain_`, `VERSION = 'callouts-1'`), `roster.js` (`PUBLIC_LOG_FIELDS` + `depth_in`). Test `test/shiftlog-api.test.js`.

**Interfaces:** consumes Task 2's row shape. The reply is `{ok:true, record: <public Log row>}`, as `cleanAgain` returns.

- [ ] **Tests first:**
  - Matt's `depthNow {site_id:'S1', depth_in: 2}` → a Log row with `zone_id '*'`, `state 'depth'`, `depth_in 2`, a seq, and who-from-token;
  - `getShiftLog` returns it with `depth_in`;
  - a Board member is refused with the lead reason; a Board lead is allowed; a roster `is_lead` off the Board is refused;
  - no storm / unknown site / -1 / 61 / `'2'` → the exact refusals;
  - 0 is accepted ("I measured, nothing new");
  - the walk states after a depth row are unchanged;
  - GET answers `callouts-1`.
- [ ] Run → fail. Implement. Run `npm test`, then `verify-tests` alone. Mutations: depthNow open to members; depth 61 accepted; depth_in missing from the public fields. Commit.

### Task 4: Pure phone logic — the estimate, the Callouts list, day order

**Files:**
- Create `Snow-App-repo/lib/callout.js` (UMD like weather.js, global `SnowCallout`).
- Modify `lib/weather.js`.
- Tests: create `test/callout.test.js`; modify `test/weather.test.js`.

**Interfaces (Produces):**
- `SnowWeather.fetchSnowfall(lat, lon)` → `Promise<[{start: ms, end: ms, mm: Number}]|null>`.
  - It calls `points/<lat>,<lon>` and follows `properties.forecastGridData` only if it starts with `HOST`.
  - It reads `properties.snowfallAmount.values`: `validTime` is `"<ISO>/<ISO-8601 duration>"` (PT1H, PT6H, P1DT6H…); `value` is in mm and null counts as 0.
  - Any failure → null. Same `getJson` and timeout.
- `SnowCallout.estimate(series, fromIso, nowIso)` → `{ inches: Number /*1 dp*/, since: iso } | null`. The overlap-fraction sum; `since` = max(from, first covered instant); null when nothing overlaps.
- `SnowCallout.rankOrder(siteIds, siteById, isDay)` → `siteIds` reordered per the Order rule. A new array; the input is untouched.
- `SnowCallout.calloutList({ siteIds, siteById, log, storms, stormId, nowIso, seriesFor(siteId) → series|null|undefined, isDay })` → `[{ site_id, inches, since, measured: Row|null, callout }]`.
  - `siteIds` are in live-view order, so duplicates are kept first-seen (Focus 4).
  - Only sites with `callout_in`. Inches come from `snowSince`'s measured row (the measured `depth_in`, `since` = its `at`), else from `estimate`.
  - Kept when `inches ≥ callout_in`, then ordered by `rankOrder`.

- [ ] **Tests first** (paper values in comments):
  - estimate: a PT6H period of 12 mm, fully inside the span → 0.5 (12/25.4 = 0.47 → 0.5);
  - half of a PT6H 25.4 mm period → 0.5;
  - P1DT6H parsed as 30 h;
  - a null value → 0;
  - the span before the series → since = series start (Focus 2);
  - no overlap → null.
  - rankOrder:
    - day: [A(—), B(2), C(1), D(—), E(2)] → [C, B, E, A, D];
    - night: unchanged;
    - the input array is not mutated.
  - calloutList:
    - a 0.96" estimate lists at callout 1 (shown 1.0);
    - 0.94" does not;
    - measured 2 beats an estimate of 0.2 and lists;
    - measured 0 beats an estimate of 3 and does not list;
    - a blank callout never lists;
    - no series (undefined/null) and no measured → not listed;
    - a duplicate site id is listed once;
    - day order vs night order.
  - fetchSnowfall with stubbed `fetch`:
    - follows only the NWS URL;
    - a non-NWS `forecastGridData` → null;
    - a bad JSON / 500 → null.
- [ ] Run `npm run test:unit` → fail. Implement. Pass. Hand mutations (no verify-tests in this repo): break the overlap fraction, ties by rank only, compare unrounded. Each must turn a test red; restore. Commit.

### Task 5: Phone UI — site form, New snow, Callouts box, day order, Last tap

**Files:**
- `lib/app.js`: the site form's two boxes and save.
- `lib/shiftlogui.js`:
  - the Callouts box after Problems in the live view;
  - the `New snow` button and dialog;
  - `rankOrder` in `routeHtml` and `liveRouteHtml`;
  - "Last tap" counts only `zone_id !== '*'` rows;
  - snowfall fetches cached by point.
- `lib/boardui.js`: Tonight's site list via `rankOrder` with the post's shift.
- `index.html` + `sw.js`: `lib/callout.js` before `lib/shiftlogui.js`; shell 23.
- `lib/config.js`: `EXPECTED_BACKEND: 'callouts-1'`.
- Tests: `test/ui.spec.js` (fake NWS: extend the existing `api.weather.gov` route with a `forecastGridData` URL and a gridpoint body); update the shell number in `test/sw.spec.js` and `test/manifest.test.js`.

**Interfaces:** consumes Tasks 1–4 and the `depthNow` request `{action:'depthNow', payload:{site_id, depth_in}}`, sent through the existing `run(ctx, walkKey(siteId,'*'), …)` path, so busy, failure and Retry behave like Clean again.

- [ ] **Tests first:**
  - **Site form:** Matt sets callout 1 and rank 2 → the saveSite body carries `callout_in: 1, day_rank: 2`; blank boxes send `null`; reopening the form shows the stored values.
  - **Callouts box, estimate:** the storm is open and the fake gridpoint gives 30 mm over the span → `#callouts` toBeVisible with `~1.2" since` … `(estimate) · callout 1"` and a `Clean again` button when the pass has a tap. With the callout at 2 → the box is hidden (toBeHidden).
  - **Callouts box, measured:** a lead taps `New snow` → enters 2 → Save → the body is `depthNow {site_id, depth_in: 2}` → the line reads `2" measured`.
  - **Who sees it:** a crew member never sees the box or the button; the NWS gridpoint is never requested from a crew phone.
  - **NWS down** (route aborts): no box from estimates and no error; a measured depth still lists.
  - **Fetch count:** two polls within 30 min fetch the gridpoint once (count route hits).
  - **Day order:** with the clock at 10:00 (day), ranked sites lead the Storm-tab route list, the live view and Tonight; at 22:00 (night) route order is kept.
  - **Last tap:** after a Clean again or a depth row, "Last tap" still shows the last real tap's time.
- [ ] Run → fail. Implement. Run the whole phone `npm test` and `node --test test/no-data.test.js`. Hand mutations: box shown to crew; Tonight ignores rank; New snow sends the depth as a string. Each must fail a test; restore. Commit.

### Task 6: Ship

- [ ] Matt types `/sidewalk-deploy` (it can't be started for him): server first (@12 `callouts-1 <sha>`), then the phone (shell 23). No new tab and no new Google service, so there are no editor steps.
- [ ] After deploy: Matt sets callout and rank on his sites in the Sites tab. Update the CLAUDE.md test counts and memory `project_snow_app_big.md`.
