# Multiple cleanings per storm: design (sub-project 6)

**Owner:** Matt Walsh. **Status:** design approved section by section, 10/4/26.
**Repos:** Snow-App-repo (phone, PUBLIC: code only) and snow-app-script (Apps Script backend,
no remote). Builds on the shift log (3), route sheets (5) and Copy for BT.

## Why

Sites have different callout depths: ANTHC calls out at 1", JBER at 5". A site like the ER can
need cleaning several times in one storm. Today a walk marked Cleared stays Cleared until the
next Start storm, so a second pass can't be logged. Matt's answers (10/4) also made "who may
change things" depend on tonight's Board, not a roster badge.

**Success:** a lead or Matt taps "Clean again" on a site and the crew log a new pass while the
first pass stays on the record; Matt's live view nudges him when a site's new snow reaches its
callout; on day shift the crew work sites in Matt's ranking.

## Decisions (Matt, 10/4/26)

| Question | Decision |
|---|---|
| Repeat cleanings | Within a night shift only the ER is revisited; other repeats happen on later shifts |
| Starting a new pass | A **Clean again** button on a site (Matt + leads on the current Board) |
| Callout depth | Per site; **shown + nudge** |
| New snow since last cleaning | **Both**: NWS estimate by default, a lead's measured depth overrides |
| Day ranking | A rank per site orders the **day** list; nights keep route order |
| Who may change things (Q5) | "Active" = on the **current Board**: taps/undo/site cards need a spot on any route; lead powers (storm controls, Snow switch, trucks, Clean again) need a LEAD spot; not on the Board = read-only; Matt never restricted |
| Q6 | Start/Finish times ignore Undo rows |
| Q2 wording | Matt's "end of storm" = snow stopped (melt + rock OK) = the app's Stopped switch; the app's End = close after cleanup. Relabel: **"Snow stopped (melt + rock OK)"** and **"Close storm (cleanup done)"** |

Day ranking Matt gave (app names): 1 ANMC (ER, 4315 Diplomacy) · 2 HCB & COB (3900/4000
Ambassador) · 3 ULMC (3801 University Lake) · 4 Tudor overflow lot for 4000 Ambassador (not yet
a site) · 5 DIP (4500 Diplomacy) · 6 CDC (4055 Tudor Centre) · 7 PG (4043 Tudor Centre, not yet a
site) · 8 IB and ED (4141 / 4115 Ambassador); the rest by choice. Ranks are data Matt types in
the site boxes — never shipped in code (public repo).

## Part A (built first): active = on the current Board, relabels, Undo-free times

- **Server auth** (snow-app-script): for role lead/crew, `tapZone`, `undoTap`, `saveVisit` need
  `a.crew_id` on any route (lead or member) of `CrewBoard.boardFrom(Moves, live routes,
  crewById)`; `stormAction`, `setTruck` (and Part B's `cleanAgain`, `depthNow`) need a LEAD spot.
  Otherwise `forbidden` "You're not on tonight's Board. Ask Matt to add you." Admin unchanged.
  The roster `is_lead` flag no longer grants anything by itself.
- **Phone:** controls shown from the non-stale Post (the server's live Board is the authority;
  a refusal shows its reason). Not on the Post → read-only Storm tab with that message.
- **Relabels:** the switch reads "Snow stopped (melt + rock OK)" / "Snowing"; End storm reads
  "Close storm (cleanup done)" (its confirm says the same).
- **Times:** `siteTimes` (shiftlog.js, byte-identical in both repos) ignores rows with
  `state: 'none'` (undo rows). Route sheets and Copy for BT follow.

## Part B: passes, callout, ranking

### Passes
- `cleanAgain {site_id}` appends a Log row `{zone_id: '*', state: 'again', storm_id, shift_id,
  by_*, at}` (same append-only Log, same lock and seq). Refused with no open storm.
- A walk's status = its newest row **after the site's newest `again` row** (by seq) in the storm.
  Pass number = 1 + count of `again` rows for the site in the storm. `walksFor`, `walkStates`,
  `siteDone`, `routeProgress` work on the current pass.
- `undoTap {seq}` of an `again` row is allowed only while it is the site's newest row (nobody has
  tapped there since); it appends `state: 'again_undone'` pointing at it, and the earlier pass is
  current again.
- Route sheets: each site lists its passes in that shift, each with its own Start/Finish (real taps
  only) and walk states; "Pass 2 · Clean again 10:40 AM by Alex". Copy for BT uses the latest pass.
  The live view shows "pass 2 · 1 of 3 walks".

### Callout and new snow
- Site fields: `callout_in` (number, blank = no nudge), `day_rank` (integer, blank = by choice).
  Blank never invented; a save without them keeps stored values (as units).
- `depthNow {site_id, depth_in}` (Matt + Board leads) appends a Log row `{zone_id: '*', state:
  'depth', depth_in}`; it does not change walk states.
- New snow since the site's last pass end (last real tap of the current pass, or the newest
  `again` row if the pass has no taps yet):
  - **measured**, when a `depth` row exists after that point: the newest one;
  - else **estimate**: the sum of NWS gridpoint `snowfallAmount` (mm → in) overlapping that span,
    for the site's point rounded to 2 decimals. Fetched by Matt's/leads' phones only, one fetch per
    distinct point, cached 30 minutes, never on the 20-second poll. Labelled "~ estimate".
    (For past hours this is the forecast NWS made, not a measurement.)
- **Callouts box** (live view, Matt + Board leads): sites whose new snow ≥ callout, in day-rank
  order (then route order): "ANMC · ~1.3" since 3:10 AM (estimate) · callout 1" · [Clean again]".
  A failed NWS fetch shows nothing for estimates; measured depths still work.

### Ranking
- Day shift (`shiftFor` → `day-…`): the crew's site list, the live view and the Callouts box order
  ranked sites first (rank ascending, ties by route order), then the rest in route order.
  Night shift: route order as now.

## Tests (both repos)
Expected values on paper; every guard a backend mutation or a phone hand mutation.
- Part A: crew not on the Board refused (tap/undo/card); a member can tap but not run the storm;
  a lead on the Board can; a roster lead not on the Board cannot; Matt always can; labels; Undo
  rows don't move Start/Finish.
- Part B: Clean again resets walks for the new pass and keeps pass 1 in the log; Undo of Clean
  again only before any tap since; pass numbers; route sheet lists passes with their own times;
  Copy for BT uses the latest pass; estimate sums only after the last pass end; measured depth
  overrides; blank callout never nudges; NWS down harms nothing; day order ranked-first, night
  unchanged; a save without callout/rank keeps them.

## Not in this sub-project
- Handoff sheets at 8 AM (night record + day working sheet) — next design.
- Adding the PG and Tudor overflow sites (Matt does it in the app).
