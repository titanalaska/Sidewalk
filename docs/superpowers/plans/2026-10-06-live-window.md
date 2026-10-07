# Live window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Claude solo, 10/6/26 evening). TDD: test, watch it fail, then code.

**Goal:** on a laptop or TV the Storm tab's live view is a dashboard: a summary strip, Problems and Callouts up top, every route as a tile in a grid, refreshing on its own.

**Spec:** `docs/superpowers/specs/2026-10-06-live-window-design.md`. Phone only. Branch `live-window` cut from origin/main. Shell → 29 here (re-bump at ship time to follow whatever shipped before).

## Task 1: the summary (pure)

- [ ] Test (`test/shiftlog.test.js` or new `test/livesum.test.js`): `CrewShiftLog.liveSummary(o)` on worked examples: 2 routes sharing a site count it once; a route counts as started when any real tap (not `'*'`, not an undo) hit one of its sites this storm; `lastTapAt` is the newest real tap's `at`; no storm → `{sitesDone: 0, sitesTotal: n, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: m}`.
- [ ] Implement in **lib/shiftlogui.js** (not lib/shiftlog.js: that file is byte-identical with the backend's and the backend has no use for it). Export on `SnowShiftUI` for the test? `SnowShiftUI` is DOM-bound; put the pure function in a tiny new `lib/livesum.js` (shell + index.html + scripts-parse) instead.

## Task 2: the strip and the grid

- [ ] Playwright first: `#livesum` text on Matt's Storm tab from a fixture with the worked numbers; updates after a poll; absent for crew; `.live-grid` has more than one column at 1280 px (`page.setViewportSize`, computed style) and one at 390.
- [ ] shiftlogui `draw`: `livesumHtml` after the hint; wrap the route cards in `<div class="live-grid">`.
- [ ] app.js `render`: `document.body.dataset.tab = S.tab`.
- [ ] app.css: `@media (min-width:1000px) { body[data-tab="storm"] main {max-width:none} .live-grid {display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:12px; align-items:start} .live-top {display:grid; grid-template-columns:1fr 1fr; gap:12px} ... }` plus a slightly larger type scale for `.live-route`.
- [ ] Shell 29, manifest pin. Hand mutations: a site on two routes counted twice; the undo row counts as a tap; the grid class dropped.

## Task 3: verify and record

- [ ] `npm run test:unit`, `npx playwright test`; counts into the handoff; commit; nothing deployed.
