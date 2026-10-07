# Place from the roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Claude solo, 10/6/26 evening). TDD: test, watch it fail, then code.

**Goal:** Matt sees where each roster person is tonight and places, promotes or pulls them from the worker card; the Board tab shows the same board afterwards.

**Spec:** `docs/superpowers/specs/2026-10-06-place-from-roster-design.md`. Phone only. Branch `place-from-roster` cut from origin/main (independent of `roster-self`; the two touch different lines of app.js and boardui.js). Shell → 28 here; whichever of the 10/6 branches ships second re-bumps.

## Task 1: pure placement helper (lib/boardui.js or lib/pairing.js)

- [ ] Test (`test/pairing.test.js`): `SnowPairing.placementLabel(board, routesById, id)` → `'Unplaced'`, `'N1'`, `'N1 · lead'`; unknown route id → the id itself.
- [ ] Implement in lib/pairing.js (pure, shared shape with the backend's pairing.js? No: phone-only; keep it in lib/pairing.js, which is NOT byte-compared).

## Task 2: the card and the tiles (lib/app.js, lib/boardui.js)

- [ ] Playwright first: the spec's list. The fake already handles `addMove`.
- [ ] `SnowBoardUI.placeFromRoster(ctx, workerId, routeId, role)`: `planMove` + the Board's `writeMove` (busy guard), then `ctx.toast` with the spec's words. Export `isBusy` is already there.
- [ ] app.js `renderRoster`: tile line with the label (board from `SnowBoardUI.board(S)`). `openWorker`: the Place row (route `<select id="w_route">`, buttons `data-place`, `data-lead`, `data-unassign`); none on a pending card; clicks delegated to `SnowBoardUI` via a new `onRosterClick`.
- [ ] Shell 28 (`sw.js`), manifest test pin.
- [ ] Hand mutations: label shows the last Post instead of the Board; Place sends `role: 'lead'`; pending card shows the row.

## Task 3: verify and record

- [ ] `npm run test:unit`, `npx playwright test`; counts into the handoff; commit; nothing deployed.
