# Sidewalk Snow App: Foundation (sub-project 1 of 5)

**Owner:** Matt Walsh, Nursery & Field Operations Manager, Titan Alaska
**Date:** 2026-09-30
**Status:** design approved in conversation; this written spec awaits Matt's review
**Working name:** "snow app". The real name is open and parked by Matt; see the
`winter-site-cards` memory for the rejected rounds. Nothing in this spec depends
on the name.

## The whole app (context, not this spec's scope)

One app for Titan's **sidewalk** crews: shovels, blowers, Snowrators and
Sweepsters on walks, not plows. Matt's goals:

- Everyone logs what they finish, **zone by zone on the site map**, as
  Cleared / Treated / Problem.
- Matt watches it **live**, with no notebook at the end of the night and about
  an hour of travel a night saved.
- **Day shift continues from where night shift ended.**
- Pairings ("who I'm with, which route") are inside the same app.

It is built as five sub-projects, each with its own spec, plan and build:

1. **Foundation** (this spec): sign-in, roles, sites, routes, crew catalog.
2. **Site maps:** Bootprint's aerial map engine moves in; draw zones; tag
   treatments.
3. **Shift log:** zone taps, live watch, shift handoff.
4. **Pairings:** the Crew Board moves in; each crew member sees their own route
   and partners.
5. **Stats per guy.**

Until 4 ships, this winter's pairings run on the existing Crew Board artifact.

## Decisions (Matt, 9/30/26)

| Question | Decision |
|---|---|
| Where private crew notes live | In this app, **behind Matt's PIN**. The backend refuses them to anyone else. |
| Sign-in | **Reuse Titan Inventory PINs and session tokens.** One PIN per person. |
| Reads | **All reads require sign-in.** (Inventory is open-read by Matt's August choice. This app is not.) |
| Roles | **Admin** (Matt): everything, including private notes, and the only one who edits the roster, sites and routes. **Lead**: sees every route live. **Crew**: sees their own route. |
| Signal | Lost **rarely**. No offline queue. A failed write says "Not saved, try again". |
| Maps | Drawn **in this app** (sub-project 2). |
| Zone states | Cleared / Treated / Problem (sub-project 3). |

## Architecture

### Backend: a new Apps Script project with its own Google Sheet

- New local repo `snow-app-script` (clasp), and a new Sheet. **Not** part of
  the Inventory script. A snow deploy slip, like Count mode sitting dead for a
  day on a pinned deployment, cannot take Inventory down, and the reverse holds
  too.
- Deployment: `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`, the same
  as Inventory. A Google-account-restricted web app answers a cross-origin
  `fetch` with a login redirect. The memory `project_titan_inventory_auth`
  explains why that kills the app.
- **Trusts Inventory sign-in by reading Inventory's Sheet**
  (`SpreadsheetApp.openById(INVENTORY_SHEET_ID)`):
  - `Sessions`: `Token | ProfileID | Name | IssuedAt | ExpiresAt | LastSeen`.
    The token must exist and must not be expired.
  - `Profiles`: `ID | Name | Position | Status | RequestedAt | ApprovedAt | PIN`.
    `Status` must be `approved`. It is re-read on every request, so pulling
    approval in Inventory locks the person out of both apps at once.
  - **The snow backend never writes Inventory's Sheet.** That means no
    `LastSeen` update either, so Inventory's data is never touched by this app.
    It reads only.
- **Role resolution** (pure function, tested):
  - name in `ADMIN_NAMES` → `admin`
  - otherwise, a snow `Crew` row with `profile_id` = ProfileID and
    `archived` ≠ true: `is_lead` true → `lead`, else → `crew`
  - otherwise → refused: **"You're signed in, but not on the snow crew yet. Ask
    Matt to add you."** This is a distinct state with its own screen and test.
    (Inventory's rollout bug was exactly an in-between sign-in state that
    nobody had designed.)
- **Tabs in the snow Sheet:**
  - `Crew`: the catalog. Same fields as the Crew Board worker record, plus
    `profile_id`.
  - `Sites`: `id | name | address | notes | archived`. A site is the unit a map
    hangs off in sub-project 2.
  - `Routes`: `id | name | site_ids (ordered) | archived`.
  - `Audit`: `at | who (from token) | action | target | before | after`. Every
    write is recorded, and the server takes `who` from the token, never from
    the request.
- **Field allow-list for non-admins** (`PUBLIC_CREW_FIELDS = ['id', 'name',
  'phone', 'photo_thumb', 'is_lead']`). The server builds every non-admin
  crew list from this list. Weaknesses, traits, smokes, keep-apart, clearances,
  valid_id, gear and the rest exist **only** in admin responses.
- **Actions** (every one requires a valid token; there are no open reads):

| Action | Who | Returns / does |
|---|---|---|
| `me` | any signed-in | `{name, role, crew_id}` or the not-on-roster refusal |
| `getSites`, `getRoutes` | any role | Non-archived sites and routes |
| `getCrew` | any role | Crew list. Admin gets all fields; others get the allow-list only |
| `saveCrew`, `archiveCrew` | admin | Write plus an Audit row |
| `saveSite`, `saveRoute`, `archiveSite`, `archiveRoute` | admin | Write plus an Audit row |

- **No kill switch that opens reads.** If sign-in breaks, crew are blocked and
  private data stays locked. A kill switch would turn a sign-in outage into a
  privacy outage.
- **Every response is `{ok: true, ...}` or `{ok: false, reason}`.** The client
  always parses the body, because Apps Script answers HTTP 200 even when it
  refuses.

### Phone app: a new public GitHub Pages repo, with no data in the code

- New repo (`Snow-App-repo` locally, under the working name). It is a
  multi-file vanilla JS app, like the Crew Board after the crew-link refactor:
  a shell `index.html`, `app.css` and `lib/*.js`. There is no build step.
- **Sign-in:**
  - The PIN goes to **Inventory's** `verifyPin`/`claimPin`, which returns the
    token.
  - The token is stored under `titan-snow-token`.
  - "Request access" calls Inventory's open `requestProfile`, which adds a
    pending person to Inventory's existing approval queue.
- **Screens in this sub-project:**
  - **Sign in.**
  - **Not on the snow crew yet.**
  - **Home:** sites and routes for everyone.
  - **Roster:** admin only. The Crew Board's Crew tab moves over: photos as
    thumbnails, traits, weaknesses, clearances, links, archive, and a
    `profile_id` picker listing approved Inventory profiles by name.
  - **Sites and Routes editor:** admin only.
- **Storage keys are brand-neutral from day one**, all prefixed `titan-snow-`.
  A later rename can't wipe phones, unlike the `wolf-*` keys Groundwork had to
  keep.
- **Service worker:** a cache-versioned shell, the same pattern as the other
  three apps. `CACHE_VERSION` gets bumped in the same commit as any shell
  change. Apps Script responses are **never cached**.

## Reuse from the Crew Board (moves over with its tests)

`lib/forms.js` (`nextWorkerId`, clearances, sites, tri-state), the worker
form, the thumbnail code, and `esc()`. The board, warnings, history and crew
modules wait for sub-project 4.

## Error handling

- **Not signed in / token expired:** the sign-in screen, with the message "Sign
  in again".
- **Approved in Inventory but not on the roster:** its own screen, never a
  blank app.
- **Backend `ok: false`:** show the reason. Never pretend a save succeeded;
  optimistic UI needs a rollback path (the Inventory `changeQty` lesson).
- **Network failure:** "Not saved, try again". Nothing is queued.

## Testing

- **Backend (node, fake sheets in a `vm`, like `titan-inventory-script`):**
  - role resolution: admin, lead, crew, not on the roster, archived, expired
    token, profile un-approved after the token was issued;
  - **`getCrew` for crew and lead contains no private field.** The test walks
    every key, and a planted `SECRET-WEAK` must never appear;
  - admin-only actions refuse lead and crew;
  - every write appends an Audit row with `who` taken from the token;
  - **no write ever touches the Inventory sheet** (the fake records writes per
    sheet).
- **Phone app (Playwright, backend stubbed with `page.route`):**
  - each screen per role;
  - the not-on-roster screen;
  - a failed save shows the reason and rolls back.
- `npm run verify-tests` mutations:
  - widen the crew allow-list;
  - let a lead through an admin action;
  - skip the expiry check;
  - take `who` from the request instead of the token.

## Deploying

- **Backend:** `clasp push`, then **bump the deployment version**. Pushing
  is not deploying. Afterwards, check with a real `me` call carrying a junk
  token: it must say "Sign in".
- **Phone app:** `git push` to its Pages repo. That repo is public, so code
  only, never data.

## Out of scope for Foundation

Maps, zone logging, the live watch, handoff, pairings and stats (sub-projects
2–5). Also out: any change to the Inventory app or script.

## Open items

- App name (parked).
- Who besides Matt is on `ADMIN_NAMES`. It is Matt only until he says
  otherwise.
- The repo and Sheet are created under Matt's Google account. Claude cannot
  create the Sheet; Matt does that step, guided one step at a time with a
  screenshot after each.
