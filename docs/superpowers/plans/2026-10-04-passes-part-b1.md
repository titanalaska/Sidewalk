# Multiple cleanings, Part B1: Clean again (passes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matt or a Board lead taps **Clean again** on a site and the crew log a fresh pass; the earlier pass stays on the record, the route sheet lists every pass with its own times, Copy for BT uses the latest pass.

**Architecture:** One new Log row kind, `{zone_id:'*', state:'again'}` (append-only, same lock/seq). Every "what state is this walk in" answer in shiftlog.js (byte-identical both repos) counts only rows after the site's newest *standing* again row. Undoing an again appends `{zone_id:'*', state:'again_undone', undoes:<again row id>}` and is allowed only while the again row is the site's newest row. routesheet.js (byte-identical both repos) splits a site's shift rows at again rows.

**Tech Stack:** Apps Script JS (`node --test`, fake sheet, verify-tests); phone ES5 + Playwright.

**Spec:** `Snow-App-repo/docs/superpowers/specs/2026-10-04-passes-design.md` (Part B › Passes). B2 (callout depth, new snow, Callouts box, day ranking) is a separate plan.

## Global Constraints

- New server action `cleanAgain {site_id}`: LEAD list in auth.js and `BOARD_LEAD` in Code.js (Matt + a Board lead). Refused with no open storm (`No storm is open`), unknown site (`Unknown site`), or when the site's current pass has no real tap yet (`Nothing to clean again yet`).
- Backend `VERSION` changes to `passes-1` (new action = shape change) and the phone's `EXPECTED_BACKEND` to `passes-1`, same deploy.
- Rows with `zone_id === '*'` are never walks: `walkStates`, marks, progress, route sheets, BT never treat them as a zone.
- Pass number = 1 + standing again rows for the site in the storm (an again undone by a standing `again_undone` doesn't count).
- `undoTap` of an again row: allowed only while it is the site's newest row in the storm; needs a LEAD spot (or Matt); else `Someone has tapped this site since`. `undoTap` of a tap from an earlier pass: refused `That tap is from an earlier pass`.
- Labels: button `Clean again`; confirm title `Clean <site> again?`, body `Every walk at <site> goes back to not done for pass <n+1>. Pass <n> stays on the record.`, buttons `Yes, clean again` / Cancel; site line `Pass <n> · Clean again <h:mm AM> by <name>`; route sheet pass heading `Pass <n>` plus ` · Clean again <stamp> by <name>` for n > 1.
- Copy for BT: walk states and Time In/Out from the latest pass only.

## Review Focus

1. A Clean again tapped twice fast (two phones): the second is refused (`Nothing to clean again yet`), never pass 3 with nothing in pass 2.
2. Night pass 1, day pass 2: the day route sheet starts at pass 2 with the right number, the night sheet shows pass 1 only.
3. An undo of a tap made before Clean again (stale walk on a phone that hasn't polled): refused, not silently rewriting pass 1.
4. A site with no zones drawn (Whole site walk): Clean again works the same.
5. Off-route flag and snowing flag still work on pass-2 taps; site cards (Visits) are unaffected by passes.

---

### Task 1: Pass rules in shiftlog.js (both repos)

**Files:** `snow-app-script/shiftlog.js` → copy to `Snow-App-repo/lib/shiftlog.js`. Test `snow-app-script/test/shiftlog.test.js`.

**Interfaces (Produces):**
- `passInfo(logRows, stormId, siteId)` → `{ n: Number, again: Row|null, sinceSeq: Number }` — current pass number, its standing again row, and the seq it starts after (0 for pass 1).
- `walkStates(logRows, stormId)` — unchanged signature; per site counts only rows with seq > that site's `sinceSeq`; ignores `zone_id '*'`.
- `undoTarget(...)` — for an again row returns `{ok:true, row, state:'again_undone', note:''}` only if it is the site's newest row; refuses a tap older than the site's `sinceSeq` with `That tap is from an earlier pass`.
- `checkAgain(logRows, stormId, siteId)` → `null | 'Nothing to clean again yet'`.
- `siteTimes(logRows, siteId, shiftId, sinceSeq)` — optional 4th arg: count only rows with seq > sinceSeq.
- `passSegments(logRows, stormId, siteId, shiftId)` → `[{ n, again: Row|null, rows: [...] }]` — this shift's rows split at standing again rows, numbered by storm pass.

- [ ] Tests first (values on paper in comments): again resets every walk (cleared Z1 seq 2, again seq 4 → Z1 'none' in walkStates; seq 6 cleared → cleared); pass n counts standing agains only; again_undone restores pass 1 states and n; undo of again refused once a tap follows it; undo of a pass-1 tap after again refused with the earlier-pass reason; checkAgain refuses with no real tap in the current pass; `'*'` rows never appear as walks; siteTimes sinceSeq; passSegments for a night/day split (pass 1 at night, again + pass 2 by day → night [n1], day [n2 with again]).
- [ ] Run → fail. Implement. Copy. Backend + phone node tests pass. Mutations (verify-tests): ignore again rows in walkStates; count undone agains in n; let a stale-pass tap be undone; checkAgain always null. Commit both repos.

### Task 2: Server action (snow-app-script)

**Files:** `auth.js` (LEAD list + `cleanAgain`), `Code.js` (`BOARD_LEAD`, `handle_` case, `cleanAgain_`, undoTap_ lead check for again rows, `VERSION = 'passes-1'`). Test `test/shiftlog-api.test.js`.

- [ ] Tests first: Matt cleans again → Log row `{zone_id:'*', state:'again', site_id:'S1'}` with seq and who-from-token; a member refused (lead reason); a Board lead allowed; no storm / unknown site / nothing tapped yet refused; a tap after again is pass 2 (getShiftLog states); member's undo of an again refused, lead's allowed while newest, refused after a tap. VERSION answers `passes-1`.
- [ ] Run → fail. Implement. `npm test`, `verify-tests` (add: cleanAgain open to members; undo of again by a member). Commit.

### Task 3: Route sheets show passes; BT uses the latest pass (routesheet.js both repos, btnote.js)

**Files:** `snow-app-script/routesheet.js` → copy to phone; `Snow-App-repo/lib/btnote.js`. Tests `snow-app-script/test/routesheet.test.js`, `Snow-App-repo/test/btnote.test.js`.

- [ ] Tests first: a site with 2 passes in one shift prints `Pass 1` and `Pass 2 · Clean again <stamp> by <name>` each with its own In/Out and walk lines; top-level `start/finish/walks/done` = the latest pass; a single-pass site prints exactly as today (no "Pass" text); night/day split (Focus 2); BT note lists the latest pass's states and Time In/Out only.
- [ ] Run → fail. Implement (`siteData` builds `passes` from `passSegments`). Copy routesheet.js. Both suites. Mutations: print only the latest pass; BT uses all passes. Commit both repos.

### Task 4: Phone — Clean again button, pass line, Undo (Snow-App-repo)

**Files:** `lib/shiftlogui.js` (siteHtml, a confirm dialog, onClick `data-again`, the pass line + Undo of the again), `lib/config.js` (`EXPECTED_BACKEND: 'passes-1'`). Test `test/ui.spec.js` (fake backend: `cleanAgain` appends the row like the server; undo of an again).

- [ ] Tests first: Matt and a posted lead see `Clean again` on each site while a storm is open, a member doesn't; confirm text per Constraints; after it, walks show not done and the site line reads `Pass 2 · Clean again …`; Undo on that line restores pass 1 for a lead; the live view counts the site as not done again; a server refusal shows its reason.
- [ ] Run → fail. Implement. Phone `npm test`. Hand mutations: button shown to members; pass line missing. Commit.

### Task 5: Ship

- [ ] Shell bump; full suites both repos, verify-tests, no-data; one fresh whole-branch review; `/sidewalk-deploy` with Matt's approval (server first, VERSION `passes-1`, phone `EXPECTED_BACKEND` `passes-1`). Update CLAUDE.md and memory.
