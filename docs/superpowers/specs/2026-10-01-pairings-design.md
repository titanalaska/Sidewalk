# Pairings in Snow Crew: design (sub-project 4, built before 3)

**Owner:** Matt Walsh. **Status:** design approved section by section, 10/1/26.
**Repos:** Snow-App-repo (phone app, PUBLIC: code only) and snow-app-script
(Apps Script backend, no remote).

## Why, in Matt's words

Matt is designing the shift log (sub-project 3): anyone on a route marks its
walks done, so the app must know who is on which route. That lives on the
Crew Board today, a separate private page the snow app cannot read. Matt:
route assignment "should be in the snow app". So pairings come in first, and
the shift log builds on them.

**Success:** Matt builds and posts the crew board inside Snow Crew; each crew
member signs in and sees their own route, partners and sites first; the Crew
Board page is retired.

## Decisions (Matt, 10/1/26)

| Question | Decision |
|---|---|
| Order | Pairings (sub-project 4) before the shift log (3) |
| What moves | All of the Crew Board: board with warnings, callouts, gear log. The Crew Board page then retires |
| When crew see changes | When Matt **posts**, as today. No half-finished boards |
| Crew view | Their own route first (lead, partners, tap-to-call, sites that open their maps), then every other route |
| Callouts | Per **shift**: *Night of 10/1*, *Day of 10/2*. Not per night |
| Shift times | Day shift starts **9 AM**. Night starts when the weather says, 6 PM to 3 AM, often 8 or 9 PM |
| Approach | Move the Crew Board's tested logic over (approach A); store in the Snow App Sheet |

Shift-log decisions already made (kept for sub-project 3): a storm is started
and ended by Matt and spans shifts; anyone on a route marks its walks.

## Approach

The Crew Board's pure modules move into Snow-App-repo **with their tests**:
`board.js` (the board replayed from moves), `warnings.js`, `history.js`,
`gear.js`, `time.js`. Their storage changes from the artifact database to the
Snow App Sheet through the existing backend. Rejected: rebuilding (same
result, tests start over) and linking out to the Crew Board (two apps, a
public link, breaks "one app, all reads signed in").

Not moved: `store.js` (artifact database), `crew.js` (the page-baked crew
copy, replaced by a server-built post), the Crew Board's `app.js` screens
(rebuilt in Snow Crew's style), and `test/fixture.json` (the public repo
tracks no data JSON; fixtures become inline test code with obviously fake
names).

## 1. Where things are kept

Four new tabs in the Snow App Sheet, the same record shape as every other tab
(`ID | Name | Rev | Archived | UpdatedAt | Json`), created by `setup`:

| Tab | One row per | Changes |
|---|---|---|
| **Moves** | place / move / make lead / unassign: `{at, worker, to_route, role}` | **Append-only.** Never edited or archived. The board is `boardFrom(moves, routes, crew)` |
| **Callouts** | shift, id `night-YYYY-MM-DD` or `day-YYYY-MM-DD`: `{shift, date, started_at, note, roster, no_shows}` | Upsert with the existing rev/conflict rule. `roster` is a **copy** of the board at that moment |
| **Gear** | event: `{date, shift, at, worker, type, item, route, site, note}` (`date` is the calendar date, kept for ordering), type in broken / left_on_site / issued / returned | **Append-only** |
| **Posts** | post: `{posted_at, shift, routes: [{id, name, sites: [{id, name}], lead, members}], people: {id: {name, phone, photo_thumb, shifts: {night, day}}}}`. `people` is every active crew member, placed or not, so shifts worked shows for everyone | **Append-only.** The newest row is what crew see |

- **Crew (roster) gains** `rides_with`, `gear` (own / needs_issued / null),
  `works_well_with`, `keep_apart_from`, `seasons`. All private: none join
  `PUBLIC_CREW_FIELDS`.
- **Sites gain** `needs_clearance` (text, e.g. `JBER`). Ships empty; Matt sets
  it. It drives the clearance warning, matched against each person's
  `clearances[].site`.
- **Backend actions:**

  | Action | Who | Does |
  |---|---|---|
  | `getBoard` | admin | moves, callouts, gear, latest post |
  | `addMove` | admin | appends one move. The phone's `at` is kept because the replay orders by it (then by id); the row's UpdatedAt is the server's, as everywhere |
  | `saveCallout` | admin | upserts the shift's callout |
  | `addGear` | admin | appends one gear event |
  | `post` | admin | **the server builds the crew copy** from the board it replays itself, keeping only allowed fields, then appends it |
  | `getPost` | any signed-in role | the newest post, exactly as stored |

  `post` never takes a crew copy from the phone, so a phone-side mistake
  cannot leak a private field. `bootstrap` adds `post` (everyone) and, for
  admin only, `moves`, `callouts`, `gear`.
- **Nothing migrates.** The Crew Board's real board is empty.

## 2. Matt's board screen (admin)

A **Board** tab:

- **One card per live route** (the snow app's 11 routes), sites listed as
  pills; lead and members as chips (photo or initials, **Lead** tag,
  tap-to-call). **Unassigned** at the bottom: on call first, off call greyed.
- **Placing:** tap a person, then a route's box. The bar offers Make lead /
  Unassign / Card / Cancel. One tap writes one `addMove`; one write at a time;
  a failed write says so and the board does not change.
- **Heads-up warnings** per route, the Crew Board's rules unchanged:
  clearance, rides-with, keep-apart, cold-rated and gear, ID on a clearance
  route, no lead / no driver, not on call. **Warn, never block. `null` never
  fires or clears a warning** (a grey "?" on the chip).
- **Top bar:** **Post** with what crew currently see ("Crew sees Night of
  10/1, posted 4:12 PM"), a **"Changed since post"** mark when the board
  differs from the newest post, and **Callout**.
- **Shift choice** (Post and Callout): the shifts around now, **none
  pre-picked**, nights named by their evening's date. Before 9 AM: *Night of
  [yesterday]*, *Day of [today]*, *Night of [today]*. From 9 AM: *Day of
  [today]*, *Night of [today]*. The 9 AM day start is Matt's; there is no
  night start, because the weather sets it.
- **Tap a person** (not placing): their full card, with private fields, routes
  placed on (from moves), shifts worked (from callouts) and gear on hand.
- Routes and their sites are edited on the Routes tab, as now.

## 3. What the crew see (crew and leads)

A **Tonight** tab rendered only from `getPost`:

- Header: *"Night of 10/1, posted 4:12 PM"*.
- **Their route first:** route name, lead, partners with tap-to-call, their
  sites in order, **each opening its map**.
- Then every other route.
- Not on the post: *"You're not on a route this shift"*, then the whole
  board.
- **Stale post** (its shift is earlier than the earliest shift on offer now):
  *"Not posted yet for this shift"*, and **no old routes shown**.
- Shifts worked for everyone, split night/day.
- Fetched on open and on pull-down. No polling, no push.

## 4. Gear log, retirement, testing

**Gear log** (admin), a **Log** tab: + Entry (worker, type, item, shift,
route, site, note). The route is guessed from that shift's callout, then the
board at that time; Matt can change it. Filters by worker and type. Gear on
hand = issued minus returned, which feeds the cold-gear warning.

**Retiring the Crew Board:** once the snow board is live and used, Matt turns
off the Crew Board's public link (and the TEST board's). The pages stay in his
gallery; nothing is deleted without his say. Crew-Board-repo stays as the
record (no remote, ever).

**Testing:**
- The moved modules keep their tests, adapted only where the shift model
  replaces the noon cutover.
- Backend:
  - admin-only writes;
  - Moves, Gear and Posts are append-only (no edit or archive path);
  - one callout per shift;
  - **a post cannot carry a private field even when one is planted in the
    roster** (asserted on the stored row).
- Phone:
  - placing;
  - Post and the "Changed since post" mark;
  - the crew's own-route-first view;
  - not-on-the-post;
  - a stale post hides old routes;
  - the shift choices at **pinned clock times** (8:59 AM, 9:00 AM, 2 AM,
    11 PM).
- `verify-tests` mutations for each guard: the allow-list, append-only, the
  stale rule, shift naming, warnings.
- No tracked data JSON (the public-repo guard stays green).

## Out of scope

The shift log itself (next), per-person stats (5), push notifications, crew
self check-in, and leads editing the board.

## Open items

None blocking. `needs_clearance` and the new roster fields ship empty for Matt
to fill in.
