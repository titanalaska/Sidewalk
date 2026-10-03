# Printable route sheets: design (sub-project 5)

**Owner:** Matt Walsh. **Status:** design approved section by section, 10/3/26.
**Repos:** Snow-App-repo (phone app, PUBLIC: code only) and snow-app-script
(Apps Script backend, no remote). Builds on the shift log (sub-project 3).

## Why

Matt is killing the paper route sheet for the crew, but the office still wants
a paper trail. The sheet is built from what the app already records (taps, site
cards, the Post), so it costs the crew nothing. It is the office's record for
slip-and-fall claims: who did each site, when, and with what.

**Success:** after every storm, one PDF per route per shift is sitting in Drive
without anyone remembering to print. It matches what happened, including sites
that were NOT done. Matt can also print the sheets from his phone.

## Decisions (Matt, 10/3/26)

| Question | Decision |
|---|---|
| Who it's for | The office file / claims |
| One sheet | One **route + shift** (as today's paper) |
| How it's made | **Both**: auto PDF to Drive when the storm ends, and a Print button in Matt's live view |
| Truck | Changes nightly. **Either**: Matt sets it per route on the Board, or the lead changes it on their phone. The last one set wins, recorded with who set it |
| Bobcat / Snowrator | Stationed at the site, so the **unit number is a site field** Matt sets once ("Bobcat BCT7"). "Who used what" = each person's site-card minutes on that site's unit |

## What's on a sheet

**Header:** route, shift label ("Night of 12/4"), storm start time; lead and
members; truck (+ who set it).

**Crew source, in order:**
1. the Post whose shift is this sheet's shift;
2. otherwise the Board, replayed from Moves made at or before the last tap of
   that shift on that route, labelled "from the Board (not posted)".

**Per site, in route order:**
- start / finish (first and last Log tap at that site that shift);
- each walk's final state that shift (Cleared / Treated / Checked / **Problem: note**),
  who and when; off-route and treated-while-snowing flags;
- snow depth per person; materials needed (site) next to used (per person);
- equipment: units from the site (Bobcat, Snowrator) with each person's
  minutes; blower / Sweepster minutes per person (no unit number);
- a site with no taps that shift prints **"Not done this shift"**. A site is
  never left off the sheet.

**Footer:** "Made by Sidewalk from crew taps", the time it was made, and
"(updated)" when a later End storm made it again.

Names only: no phones, PINs or private roster fields.

## Data

- **Sites** gain `units: {bobcat: '', snowrator: ''}` (blank by default, never
  invented). Matt's site edit box gets the two fields.
- **`Trucks` tab** (append-only, seq like Log): `{route_id, shift_id, truck,
  by_*, at}`. The truck for a route + shift = the newest row. Admin: any route.
  Lead: only the route the live Board has them leading. Crew: never. The Post
  carries each route's current truck so the crew see it.
- **`Sheets` tab** (append-only): `{storm_id, route_id, shift_id, file_id,
  url, made_at, status: saved|failed, error}`.

## Making the PDFs

- **One layout, two places.** New `routesheet.js` (pure, byte-identical in both
  repos, like `shiftlog.js`) turns the data into one sheet's HTML. The Print
  button and the PDF can never differ.
- **End storm** returns at once and schedules a one-off time trigger about one
  minute later (`ScriptApp.newTrigger`). That job makes every route + shift
  sheet with taps or a crew that storm, turns each into a PDF
  (`HtmlService` → `getAs('application/pdf')`), saves it in **Snow Route
  Sheets / <storm start date> storm /** as `N3 Night of 12-4.pdf`, and writes
  one `Sheets` row per file. The trigger deletes itself.
- A later End (after Reopen) makes **new** files named `... (updated 9-12 AM).pdf`.
  Old files are never deleted.
- **Failures never block End storm.** A failed file writes `status: failed`.
  Matt's live view shows "Sheets: 22 saved" or "Sheets: 3 not saved, Retry".
  Retry schedules the job again for the failed ones only.
- Drive and trigger access is new: Matt authorizes once in the editor
  (as for `setup`). The PDFs land in the Drive of the account that owns the
  script.

## Phone

- **Matt's live view:** a **Print sheets** button (current or last storm) opens
  every sheet, one per page, in a print view (`window.print()`), plus the
  Sheets status line with Retry.
- **Board:** a truck field per route. **Lead's Storm tab:** their route's truck,
  tappable to change. Crew see the truck read-only.
- **Site edit box:** Bobcat and Snowrator unit numbers.
- Shell bumped.

## Tests (both repos)

Expected sheets worked out on paper in comments; every guard gets a mutation
(backend) or a hand mutation (phone).

- A site with no taps prints "Not done this shift". It's never missing.
- Two people's minutes on one site's Bobcat both print, under the unit number.
- Crew source: the shift's Post wins; with no Post, the Board as of that shift's
  last tap, labelled not posted.
- Truck: newest row wins; a lead can set only their own route; crew refused;
  the Post carries it.
- End storm returns before any PDF is made; the job saves one file per route +
  shift; a Drive failure writes `failed` and the storm stays ended; Retry
  redoes only the failed ones; a second End adds "(updated)" files and deletes
  nothing.
- The phone's Print view and the server's HTML come from the same
  `routesheet.js` (identity test).
- No private roster field ever appears on a sheet.

## Not in this sub-project

- BuilderTrend posts (sub-project 6, designed next).
- Emailing sheets to anyone.
