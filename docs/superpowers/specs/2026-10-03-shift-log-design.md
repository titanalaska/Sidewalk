# Shift log in Snow Crew: design (sub-project 3)

**Owner:** Matt Walsh. **Status:** design approved section by section, 10/3/26.
**Repos:** Snow-App-repo (phone app, PUBLIC: code only) and snow-app-script
(Apps Script backend, no remote). Builds on Foundation (1), Site maps (2) and
Pairings (4).

## Why

The paper route sheet is filled in after the fact, by memory, and nobody can
see a route's progress until the crew is back. The shift log puts every walk
on the phone: the crew tap each zone as they finish it, Matt and the leads
watch every route live, and the next shift picks up from what is already
marked.

**Success:** during a storm, Matt and the leads open one screen and see which
routes are behind and every Problem, without a phone call; the crew mark each
walk as they go; the paper sheet's fields (depth, materials, equipment time,
start/finish) come out of the app.

## Decisions (Matt, 10/1 and 10/3/26)

| Question | Decision |
|---|---|
| Unit of work | The **storm**. Start storm puts every walk back to not done; night and day work the same storm until End storm |
| Who runs the storm | **Matt and leads**: Start, End, Reopen storm, the Snowing/Stopped switch, and Night shift on. Every one is logged with who |
| Who marks walks | Anyone. A tap off the person's Board route **saves with an off-route flag** (not refused) |
| Zone states | sidewalk: Cleared / Treated / Problem. heated: Checked / Problem (**never** Treated). no_touch: nothing. Problem needs a note |
| Mistakes | **Undo** adds a row restoring the walk's previous state. Mistake and fix both stay in the log |
| Weather | NWS hourly forecast shown as a hint. **The switch is what counts.** Treated while Snowing = yellow warning, **allowed**, and the row records the warning |
| Shifts | Day starts 9 AM by itself (time.js). Night starts when Matt or a lead taps **Night shift on**. No tap = the day shift carries on |
| Site card | Per site, **per person**, per shift: snow depth (in), materials used (beside the printed "needed"), equipment ticks (blower / Snowrator / Bobcat / Sweepster) with minutes each. Start and finish are not typed: first and last zone tap at that site that shift |
| Live view | Matt + leads: Problems in red on top, then each route: "4 of 6 sites done", progress bar, who's on it, last tap time. Crew: their own route |
| Handoff | Nothing extra. The shared walk state and the Problem notes are the handoff |

## Data (Snow App Sheet)

All three tabs are **append-only**: a row is never edited or deleted. State
is always "the newest row that applies", the same pattern as Moves.
Rejected: one status cell per walk, updated in place. Two taps a second apart
would lose one with no trace.

**Order.** "Newest" means the order rows were written on the server (the row
id it assigns), never the phone's clock. The phone has no offline queue, so a
tap that reached the server reached it in the order it was made.

### `Log`: one row per tap

`id, storm_id, shift_id, site_id, zone_id, state, note, by_profile, by_name,
at (server, time.localIso), off_route (bool), snowing_warned (bool),
undoes (id of the row it reverses, or empty)`

- `state`: `cleared | treated | problem | checked`.
- A walk's status = its newest Log row whose `storm_id` is the current storm.
  No row in this storm = **not done**.
- **Undo** writes a row whose `state` is the walk's state **before** the row
  being undone (or `none` for not done), with `undoes` set. Undo of an Undo
  is the same rule applied again, so it restores the undone tap.

### `Storms`: the storm's own history

`id, kind, storm_id, by_profile, by_name, at`, where `kind` is
`start | end | reopen | snowing | stopped | night_on`.

- The current storm = the newest `start`; it is **open** if its newest
  `start|end|reopen` row is not `end`.
- The switch = newest `snowing|stopped` in the current storm (starts Stopped).
- Start storm while one is open: refused ("End the storm first"), so two
  storms never overlap.

### `Visits`: site cards

`id, storm_id, shift_id, site_id, by_profile, by_name, at, depth_in,
materials_used, equipment (JSON: {blower: min, snowrator: min, bobcat: min,
sweepster: min})`

- One card per **site + shift + person**; a newer save by the same person
  replaces their own card. Matt's view **sums** the cards (minutes, materials)
  and shows depth per person.
- Start / finish for a site on a shift = first / last Log `at` for that site
  and `shift_id`. Computed, never stored.

### Which shift a row belongs to

Computed on the server at write time from `at` and the Storms tab:
- before 9 AM → `night-<previous date>` (time.shiftDate);
- otherwise → `night-<today>` if a `night_on` row exists at or after 9 AM
  today, else `day-<today>`.

## Backend actions (snow-app-script)

| Action | Who | Notes |
|---|---|---|
| `getShiftLog(after)` | anyone signed in | Rows after the cursor only (`getRange` from the cursor row). Admin/lead get every route; crew get every route's walk states but the payload is built from an **allow-list**: no personnel fields |
| `tapZone` | anyone | Refused with no open storm. Refused: Problem with no note; Treated on heated; any tap on no_touch. Sets `off_route` from `boardFrom(Moves)`; sets `snowing_warned` from the switch |
| `undoTap` | anyone | Only the walk's newest row in this storm can be undone |
| `saveVisit` | anyone | Refused with no open storm |
| `stormAction` | admin, lead | `start | end | reopen | snowing | stopped | night_on` |

Every row's `by_*` comes from the token, never from the request body. A new
backend VERSION string (`shiftlog-1`) and EXPECTED_BACKEND bump, then a new
version on the **same deployment id** (pushing is not deploying).

## Phone (Snow-App-repo)

- A **Storm** tab. Crew: their own Board route only, each site with its zones
  as tap buttons and its site card. Other routes stay behind an **Other
  routes** button (needed to help out, which saves as off-route). Matt and
  leads: the live view, plus the storm controls.
- Polls `getShiftLog` about every **20 s** while the tab is on screen; stops
  when hidden or locked, catches up on return (same as Tonight). Apps Script
  cannot push. Quota checked 10/1: 30 simultaneous executions per user, no
  daily web-app cap; ~20 phones at 20 s is about 2 at once.
- The site map (sub-project 2) colours each zone by its state.
- Forecast: the phone fetches `api.weather.gov` hourly for the site's point.
  Hint only. If it fails, the hint is absent and nothing else changes.
- A failed tap stays on screen as **not saved**, with a retry. Double tap
  saves one row (the existing save pattern).
- Shell: new files in `sw.js` SHELL, cache version bumped.

## Tests (both repos)

Expected values worked out on paper in the comments; each guard broken on
purpose (mutation) to see it fail.

- Newest row wins: rows arriving out of order, two in the same millisecond,
  ids with a gap.
- Undo restores the previous state; Undo of Undo restores the tap; only the
  newest row can be undone.
- Two people's site cards at one site: both sets of minutes and materials in
  the total; one person re-saving replaces only their own card.
- Start storm: every walk is not done and **no row is deleted**. Start while
  open is refused. End then Reopen keeps every walk's state.
- Treated while Snowing saves with `snowing_warned`; while Stopped, without.
- heated never Treated; no_touch never tapped; Problem without a note refused.
- A tap off the Board route saves with `off_route`; on-route without.
- Storm controls: admin and lead yes, crew no.
- Shift filing: 8:59 AM → previous night; 9:00 AM → day; after `night_on` →
  night; a `night_on` from yesterday does not carry into today.
- `getShiftLog(after)` returns only newer rows; the crew payload carries no
  personnel field.
- Forecast failure: hint absent, taps still work.
- Never writes Inventory's Sheet (the existing guard covers the new actions).

## Not in this sub-project

- Truck and equipment unit numbers from the paper sheet's header (leader and
  members come from the Board). Add later if Matt wants them.
- An offline queue for taps.
- Parking lots (plow crew, never drawn).
