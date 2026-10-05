# Multiple cleanings, Part A: on the Board, relabels, Undo-free times — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Who may tap, undo, save site cards and run the storm follows tonight's Board instead of the roster's lead flag; the storm controls get Matt's words; Start/Finish times ignore Undo rows.

**Architecture:** The server's live Board (`CrewBoard.boardFrom(Moves, live routes, crewById)` + `whereIs`) is the authority, checked once in `handle_` for the gated actions. The phone mirrors it from the fresh Post (what crew phones already have) to decide what to show; a server refusal shows its reason. `siteTimes` lives in shiftlog.js, byte-identical in both repos.

**Tech Stack:** Apps Script JS (`node --test`, fake sheet); phone ES5 + Playwright.

**Spec:** `Snow-App-repo/docs/superpowers/specs/2026-10-04-passes-design.md` (Part A section). Part B gets its own plan.

## Global Constraints

- Admin (Matt) is never restricted.
- Gated "any spot" actions: `tapZone`, `undoTap`, `saveVisit`. Gated "lead spot" actions: `stormAction`, `setTruck`. Refusal: `{ok:false, code:'forbidden'}` with reason exactly `You're not on tonight's Board. Ask Matt to add you.` (any spot) / `Only Matt or a route lead on tonight's Board can do that.` (lead spot). setTruck keeps its own same-route check.
- The roster `is_lead` flag grants nothing by itself (role resolution itself is unchanged; it no longer opens LEAD actions).
- Labels: weather switch `Snowing` / `Snow stopped (melt + rock OK)`; storm header `Storm open · Snowing` / `Storm open · Snow stopped`; End button `Close storm (cleanup done)`; its dialog title `Close the storm?`, button `Yes, close storm`.
- `siteTimes` ignores rows with `state === 'none'` (undo rows) for Start and Finish.
- Existing tests whose crew taps legitimately must put that crew member on the Board in the fixture (a Move), never be loosened.

## Review Focus

1. No fresh Post yet (Matt hasn't posted tonight): the phone can't see the live Board, so it does NOT lock anyone out — it shows the walk buttons and lets the server decide (a refusal shows its reason). Read-only only when a fresh Post exists and doesn't list them. Storm controls with no fresh Post: admin only (unchanged for Matt); a Board lead uses Matt's post. Task 3 adds a test for this case.
2. Crew moved OFF the Board mid-storm: their next tap is refused with the reason, and the phone's Retry does not loop.
3. A member undoing a lead's tap: allowed (any spot); a person not on the Board undoing their own earlier tap: refused.
4. setTruck by a Board lead whose roster `is_lead` is false: allowed for their own route.
5. Undo-only site (tap then undo): Start/Finish both blank, site not done.

---

### Task 1: siteTimes ignores Undo rows (shiftlog.js, both repos)

**Files:** `snow-app-script/shiftlog.js` `siteTimes`; copy to `Snow-App-repo/lib/shiftlog.js`. Test `snow-app-script/test/shiftlog.test.js`.

- [ ] Tests first: `Start and Finish ignore undo rows` (cleared seq 2 at 22:10, cleared seq 5 at 22:40, undo of seq 5 as seq 9 at 23:30 → start 22:10, finish 22:10: the undone tap and its undo are both corrections); `a tap and its undo leave no times` (seq 3 cleared 22:00, seq 4 undo → start/finish null). Run → fail.
- [ ] Implement: drop rows with `state === 'none'` and the rows they undo (`undoes` = that row's id). Ruling (spec says undo rows only; Matt's Q6 reason "a new guy mis-taps; an undo is a correction, not work" covers the mis-tap too). Copy file. Backend `npm test`, phone node tests pass (identity test).
- [ ] Mutation: drop the filter → caught by `ignore undo rows`. Commit both repos.

### Task 2: Server Board gate (snow-app-script)

**Files:** `auth.js` (`can`: LEAD actions open to `crew` too — the Board decides), `Code.js` `handle_` (gate after `can`), tests `test/api.test.js` / `test/shiftlog-api.test.js` (whichever holds tap/storm tests; add a Moves fixture).

**Interfaces:** `boardStanding_(a)` → `null | {route, role:'lead'|'member'}` from `CrewBoard.whereIs(CrewBoard.boardFrom(readAll_('Moves'), liveRoutes, crewById), a.crew_id)`.

- [ ] Tests first (each with expected outcome from the Constraints): crew on no route → tapZone/undoTap/saveVisit refused with the any-spot reason; member → tapZone ok, stormAction refused with the lead reason; roster `is_lead:true` but on no route → stormAction refused; Board lead with `is_lead:false` → stormAction ok, setTruck own route ok; admin with no Board → all ok. Update existing fixtures so legitimate tappers are on the Board.
- [ ] Run → new ones fail. Implement. `npm test` all pass.
- [ ] Mutations: skip the any-spot gate; let any spot pass the lead gate; drop the admin bypass. `npm run verify-tests` → all caught, none SKIPPED. Commit.

### Task 3: Phone mirrors the Board; relabels (Snow-App-repo)

**Files:** `lib/app.js` `canRunStorm`; `lib/shiftlogui.js` (tap gating, `canSetTruck` drops the role check, labels, `confirmStorm`, header); tests `test/ui.spec.js`.

**Interfaces:** `standing(S)` in shiftlogui → `'admin' | 'lead' | 'member' | null` from the fresh Post (`CrewTime.isStale`); `ctx.canRun` = admin or `'lead'`.

- [ ] Tests first: crew on no fresh-post route → Storm tab shows `You're not on tonight's Board. Ask Matt to add you.` and no `[data-walk]` buttons, no site-card Save; member → walk buttons, no `#stormctl`; Board lead whose `me.role` is `crew` → `#stormctl` with the new labels; roster lead (`me.role:'lead'`) on no route → no `#stormctl`; header reads `Storm open · Snow stopped`; End dialog title `Close the storm?`. A server `forbidden` on a tap shows its reason (existing error path). Update existing UI fixtures so Jordan stays on the Post where a test taps.
- [ ] Run → fail. Implement. Phone `npm test` all pass. Hand mutations: return true from `standing` for everyone → read-only test fails; old labels → label tests fail.
- [ ] Commit.

### Task 4: Ship

- [ ] Shell bump (sw.js + its two tests). Full suites both repos, `verify-tests`, no-data test. Final whole-branch review (one fresh reviewer). `/sidewalk-deploy` (server first; VERSION unchanged — no new action, reply fields unchanged), with Matt's approval.
- [ ] Update CLAUDE.md counts and memory.
