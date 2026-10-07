# Live window: design

**Owner:** Matt Walsh. **Status:** designed by Claude alone on 10/6/26 (evening) on Matt's instruction
("Try to get all of that done"). **Not yet reviewed by Matt.** Phone only, no backend change.
Builds on the shift log's live view (Storm tab, Matt and the Board leads).

## Why

Matt (10/6): "a live window where I can monitor how all the routes are doing." The live view exists on the
Storm tab, but it is a phone column: eleven routes stacked, one at a time, scrolled. On a laptop or the office
TV it should read at a glance: every route at once, the problems in front, one line that says how the night
is going.

**Success:** Matt opens the app on a laptop or TV, signs in, taps Storm, and leaves it up: every route is a
tile in a grid with its progress, crew, truck and sites; Problems and Callouts sit at the top; a summary line
says how many sites are done, how many problems are open and when the last tap landed; it all refreshes on
its own (the Storm tab already polls every 20 s while on screen).

## What changes

- **A summary strip** (`#livesum`) at the top of the live view, under the storm head and hint, on every
  screen size: `12 of 54 sites done · 2 problems · 3 callouts · last tap 7:42 PM · 4 of 11 routes started`.
  Counts come from the same replay the route cards use (`CrewShiftLog.routeProgress`, `openProblems`, the
  callout rows, the newest real tap). No storm open: `No storm open`. Nothing stored.
- **A wide layout** at 1000 px and up, only on the Storm tab (`body[data-tab="storm"]`, set by the shell on
  every render): the page's 720 px column opens to the window; the route cards sit in a grid (`.live-grid`,
  auto-fill, 340 px minimum per tile); Problems and Callouts share a row above the grid; the storm controls
  keep the top. Type is a step larger. Phones (under 1000 px) are untouched: one column, as today.
- **A route tile** is the live route card as it is (progress bar, who, truck, last tap, sites with status).
  Opening a route from a tile still works (the route's own walks, `‹ Live view` to come back).
- Crew phones never get the live view, so the wide layout changes nothing for them.

## Tests

- Node: `liveSummary({routes, zones, states, log, storms, stormId, callouts})` → `{sitesDone, sitesTotal, problems,
  callouts, lastTapAt, routesStarted, routesTotal}` on worked examples (a site on two routes counts once; an undo row and
  a `'*'` row are not taps; no storm → nulls).
- Playwright: Matt's Storm tab shows `#livesum` with the worked numbers; a tap arriving in a poll updates it; at
  1280 px wide the route cards sit in `.live-grid` with more than one column (computed `grid-template-columns`), at
  390 px in one; crew phones have no `#livesum`.

## Assumptions for Matt

| # | Call made | If wrong |
|---|---|---|
| C1 | The live window is the Storm tab itself on a wide screen, not a separate page or link | a separate page would need its own sign-in and polling: say so and it can be split |
| C2 | 1000 px is the line between phone and window | one number in app.css |
| C3 | The summary line is on phones too | hide it under 1000 px |
