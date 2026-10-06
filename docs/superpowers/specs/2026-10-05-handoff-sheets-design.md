# Handoff sheets at the 8 AM night-to-day handoff: design

**Owner:** Matt Walsh. **Status:** design approved section by section, 10/5/26; written spec awaiting Matt's review.
**Repos:** Snow-App-repo (phone, PUBLIC: code only) and snow-app-script (Apps Script backend, no remote).
Builds on the shift log, route sheets, Clean again passes and B2 (callouts, day rank).

## Why

Night crews stop at 8 AM and return the trucks; the day crew starts tapping at 9 (the app's 9 AM
cutover is unchanged). A storm often runs through the morning, so it is still open at the handoff,
and route sheets are made only at Close storm. So at 8 AM the night has no saved record, and the day
crew has nothing that says what night finished and what it left.

**Success:** every storm morning, with nobody remembering, the night's route sheets are in Drive and
each day lead has a working sheet (on the phone, live, and as a PDF) listing their route and every
site night left, so the day crew picks up exactly where night stopped.

## Decisions (Matt, 10/5/26)

| Question | Decision |
|---|---|
| Day sheet form | **Both**: a live card on the phone and a PDF per day route in Drive |
| What starts it | **8:00 AM automatically**, plus **Hand off now** for an early finish |
| Sites on a day sheet | **Their route + night leftovers**: their own day route, and every night site not finished |
| Who takes a leftover | **First to start it**: everyone sees all leftovers; a day tap shows "Started by Alex 9:12" |
| Approach | Server makes the PDFs; the phone card is worked out live from the same rows |

## The handoff moment

- A new Storms row kind **`handoff`**: `{storm_id, shift_id, at, by_*, log_seq, visit_seq, truck_seq}`.
  `shift_id` is the night it closes (`night-YYYY-MM-DD`). The three `*_seq` values are the newest
  seq of the Log, Visits and Trucks tabs at that moment. It never opens, closes or changes the
  Snowing switch (`stormState` already ignores kinds it does not know).
- **New action `handOff {}`**: Matt, or a LEAD on the current Board (the Part A rule, as Clean again).
  Refused, in this order:
  1. `No storm is open`;
  2. `It isn't night shift` (the server's own `shiftFor(now)` does not start `night-`);
  3. `Nothing to hand off yet` (the night has no real tap: never an undo row, never a `'*'` row);
  4. `Already handed off at <h:mm AM>` (a handoff row for this storm and night exists).
  A successful handoff writes the row and queues the handoff's sheets (below).
- **8:00 AM, automatically:** a one-off time trigger, handler `handOffMorning`, set for the next
  8:00 AM America/Anchorage (today's if now is before 8:00, else tomorrow's).
  - Start storm and Reopen book it. Each run books the next one while the storm stays open. Close
    storm deletes it. At most one `handOffMorning` trigger exists: booking deletes any older one first.
  - The run is `handOff` done as `Sidewalk`. Every refusal is a silent no-op (quiet night, already
    handed off, storm closed, no storm). No editor step: the app already holds trigger and Drive access.
- **Hand off now** sits in the live view during night shift, for Matt and posted night leads.
  It confirms first: `Hand off to day now? The night's sheets are saved and the day crew sees what's left.`
- **Late night taps** (before 9 AM) are still night. They show live on the day card and are in Close
  storm's record (see below). The handoff PDFs are a snapshot of the handoff moment.

## The night record in Drive

- At a handoff, the sheet job makes one route sheet per **night route** of that night: exactly
  `CrewRouteSheet.sheetsFor` for that storm, filtered to that shift. Same layout, same storm folder,
  normal file name (`N3 Night of 12-4.pdf`).
- **Close storm** does not make a night sheet that a handoff already saved, unless that night changed
  after the handoff: a Log or Visits row for a site of that route, or a Trucks row for that route, in
  that shift, with seq above the handoff's `log_seq` / `visit_seq` / `truck_seq`. A changed night is
  made again, named `(updated <time>)` as a Reopen's sheets are today. Day sheets are made at Close storm
  as today.
- **Sheets rows** gain `made_for` (`handoff` | `end`) and `for_seq` (the seq of the handoff or End row
  that made them). Existing rows read as `end`, with `for_seq` = their `end_seq`.
- **Failures** never block anything: a file that fails writes `status: failed`. **Retry** also covers a
  storm's newest handoff while the storm is still open (today Retry refuses an open storm).
- Matt's live view sheet status adds: `Night sheets saved at handoff 8:00 AM (6)`, or the failed count
  with Retry.

## The day working sheet

**One shared file**, `handoff.js`, byte-identical in both repos (like `shiftlog.js` and
`routesheet.js`). Pure. The server draws the PDF with it; the phone draws the card with it.

- `handoffData(o)` → `{ night: {shift_id, at, by_name}, dayRoutes: [...], leftovers: [...] }`:
  - **night routes** = the routes `sheetsFor` names for that night shift;
  - **leftovers** = every site on those routes that was not done (`siteDone`, current pass) using only
    rows up to the handoff's `log_seq`. Each: site, `walksDone`/`walksTotal`, its open Problems (with notes,
    `(pass n)` when carried from an earlier pass), and its live status from rows after the handoff:
    `started: {by_name, at}` (the first real day tap there) and `done: {at}` (when `siteDone` became true);
  - **leftover order**: not-done first, by `day_rank` ascending, ties and unranked in night-route order;
    done ones last;
  - **day routes** = the routes of the day Post for the morning after (`day-<night's date + 1>`: the
    handoff of `night-2026-12-04` uses `day-2026-12-05`), else of the Board,
    labelled `from the Board (not posted)`, the same crew rule as route sheets. Each route's sites are
    shown with live states, and `Night: 3 of 5 walks` on any site night touched.
- `handoffHtml(data, routeId, madeAt)` → one day route's PDF: header (route, `Day of 12/5`, crew,
  `Handoff from Night of 12/4 · 8:00 AM`), that route's sites, then the full **Left by night** list and
  Problems. Names only: no phones, PINs or private roster fields.

**Phone card**, on the Storm tab for everyone signed in, from a handoff until Close storm or the next
night's handoff, during day shift:
- heading `Handoff from Night of 12/4 · 8:00 AM` (`· by Alex` when someone tapped Hand off now);
- **Your route** (the viewer's day-Post route; Matt sees every day route);
- **Left by night**: each line `ANMC · 2 of 5 walks · Problem: ice at door` with `Started by Alex 9:12`
  or `Done 9:40`. Tapping a line opens the site with its walk buttons (taps there are flagged
  off-route, as today). A leftover whose new snow has reached its callout shows the B2 callout line.
- It is a replay of rows the phone already polls (Log, Storms, Visits): nothing new is fetched.

**PDF**: one per day route at the handoff, named `D1 Day handoff 12-5.pdf`, in the storm's folder.
With no day route at all (no day Post, nobody on the Board), one `Day handoff 12-5 (left by night).pdf`.
Matt's Print sheets view lists them.

## Versions

- Backend `VERSION` → `handoff-1` (new action, new Storms kind, new Sheets fields), phone
  `EXPECTED_BACKEND` → `handoff-1`, new shell, same deploy.
- No new Sheet tab, no new Google service: no editor step.

## Tests (both repos)

Expected values worked out on paper in comments; every guard gets a mutation (backend `verify-tests`,
phone by hand).
- Backend: one handoff per night; each refusal; the 8 AM run is silent on a quiet night, a closed
  storm and no storm; the trigger is booked at Start and Reopen, re-booked by a run, deleted at Close,
  and never doubled; handoff queues night routes + day routes; Close skips an unchanged night and
  remakes a changed one as `(updated …)` (a late tap, a late site card, a late truck); Retry on an open
  storm's handoff; existing Sheets rows read as `end`; `handoff.js` identical in both repos.
- `handoff.js`: leftovers exclude done sites; partial walks counted; undo rows ignored; a Problem
  carried from an earlier pass; `started`/`done` only from rows after the handoff; day-rank order with
  done last; day routes from the Post, else the Board; a site on two night routes listed once.
- Phone: the card shows only in day shift after a handoff and goes at Close storm; `Started by` appears
  after a day tap lands on a poll; a leftover opens its site; Hand off now shown to Matt and a posted
  night lead, never to a member or by day; its refusal is shown.

## Not in this sub-project

- Changing the 9 AM cutover; assigning leftovers to a crew; texting the sheet.

## Changed during the build (10/5/26, rulings recorded in the build ledger)

- **Night routes are frozen into the handoff row** (`night_routes`): routes with a lead or member on the
  night Post; only with no night Post, `sheetsFor`'s routes. Every phone and the PDF read this one list
  (crew phones hold only the latest Post). A stray night tap on a day route adds no leftovers.
- **Day routes with no day Post** come from the Board only if a Move is newer than the night Post (no
  night Post: a Move in the 12 h before the handoff). Otherwise the handoff makes only the
  `(left by night)` sheet: at 8 AM the Board usually still holds the night's crews.
- **The card shows** from the handoff through the following day shift (the 8–9 AM truck swap included),
  never on a later day after a quiet night. A crew phone with no day Post shows no "Your route", only
  "Left by night". A leftover finished by an undo shows `Done` without a later `Started by`.
- **The 8 AM run is also booked** by Night shift on, Snowing, Stopped and Hand off now whenever none is
  due (a storm open at deploy, or a failed booking), never replacing a booked or late-firing run.
- **Close storm also remakes a held night** when that night was re-posted after the handoff.
- **No two live files in a storm folder share a name**: a clash gets ` (2)`, ` (3)`, …
- **Matt's open-storm line** says `Handoff sheets: <k> of <M> saved` when the night set is short.
