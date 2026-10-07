# Roster self-service: design

**Owner:** Matt Walsh. **Status:** designed by Claude alone on 10/6/26 (evening) on Matt's instruction
("Try to get all of that done" while he was out). **Not yet reviewed by Matt.** Every call made for him
is listed under *Assumptions for Matt* at the end; the build ships nothing until he has read them.
**Repos:** Snow-App-repo (phone, PUBLIC: code only) and snow-app-script (Apps Script backend, no remote).
Builds on Foundation (sign-in, roster) and Pairings (the Board).

## Why

The roster does not build itself (Matt, 10/5/26). Today a new worker signs in with their Titan Inventory
name and PIN (new people tap Request access, which makes a pending Inventory profile), Matt approves the
profile in Inventory, then the worker sees "not on the snow crew yet. Ask Matt to add you" until Matt
opens Roster, taps Add worker, types everything and picks their sign-in. Nothing records who tried.
Matt (10/6): people should sign in and fill out a good bit of their own card, including taking their own
picture; one person is waiting on him right now.

**Success:** a new worker needs Matt for two taps (Approve, Add to crew) and nothing else. Their phone
number, picture, licence, ID, what they can run and how many seasons they have are theirs to type, from
their own phone, before Matt ever opens the roster.

## The four pieces

1. **Waiting for approval** (Matt's Roster tab): Inventory profiles still `pending`, with **Approve** and
   **Reject**. These call Inventory's own admin actions (`approveProfile`, `rejectProfile`) with Matt's
   token, the same way sign-in calls `verifyPin`. The snow backend is not involved and still never writes
   Inventory's Sheet.
2. **Fill out your card** (the worker): an approved sign-in that is not on the roster no longer hits a
   dead end. The screen says "Fill out your card and Matt will add you", and the card is theirs to fill:
   phone, picture, licence, ID, on call, smokes, what they can operate, seasons, cold gear. Saving makes a
   roster record marked **pending**.
3. **Waiting to be added** (Matt's Roster tab): the pending cards, each with **Add to crew** (one tap:
   the record stops being pending and the person is on the crew) and the usual card (Edit, Archive).
   Archive is how a card is declined.
4. **Your card** (anyone on the crew): the same form for their own record, from the Tonight tab, so a
   changed phone number or a better picture never needs Matt.

## Self fields

The fields a person may set on their own record. An allow-list, like `PUBLIC_CREW_FIELDS`: anything not
named here is Matt's and a self save never touches it.

| Field | Form label | Rule |
|---|---|---|
| `phone` | Phone | text, 30 characters at most, blank allowed |
| `photo_thumb` | Your picture | a `data:image/jpeg;base64,` string of at most 30,000 characters, or null (the phone makes a ~160 px JPEG, as Matt's editor does) |
| `can_drive` | Can you drive a truck? | yes / no / not set (true / false / null) |
| `valid_id` | Do you have valid ID? | yes / no / not set |
| `on_call` | Can we call you out at 3 AM? | yes / no / not set |
| `smokes` | Do you smoke? | yes / no / not set |
| `can_operate` | What can you run? | a list from blower, sweepster, bobcat, snowrator, shovel |
| `seasons` | Seasons with Titan | whole number 0 or more, or null |
| `gear` | Cold-weather gear | own / needs issued / not set |

Matt's alone, unchanged: `is_lead`, `good_lead`, `cold_rated`, `logs_own_work`, `reliable_3am`, `traits`,
`weaknesses`, `clearances`, `rides_with`, `works_well_with`, `keep_apart_from`, `profile_id`, `name`.

**The name** on a self-made card is the Inventory sign-in name, set by the server from the token. The
form shows it and does not let it be typed: a card can never claim to be someone else.

## Backend

- **`pending`** is a new boolean on a Crew record. A record Matt makes has none (reads as not pending).
  A self-made card is written with `pending: true`; Add to crew saves it with `pending: false`.
- **`resolveRole`** (auth.js): a live crew record with `pending === true` is not crew. The result is
  `{ok: false, code: 'pending_card', name, profile_id, crew_id, reason: 'Your card is in. Matt will add you to the crew.'}`.
  `not_on_roster` now also carries `profile_id` (the phone does not need it; the server does).
- **New action `saveMyCard {card: {...}}`.** Reachable by a crew or lead (their own record), and, before
  the role check, by a sign-in whose code is `not_on_roster` or `pending_card`. An admin sign-in is
  refused: `invalid`, "An admin sign-in has no crew card" (Matt is not on the roster). Under the script lock:
  1. the record is the caller's live record (by `crew_id`), else a new one:
     `{id: nextWorkerId, name: <token name>, profile_id: <token profile>, pending: true, archived: false}`;
  2. each self field present in `card` replaces the stored one; a field left out keeps what is stored
     (a phone on an older app never clears anything); any other key in `card` is ignored, not refused;
  3. the self rules above are checked, in the record's own words
     (`Phone is 30 characters at most`, `That picture is too big`, `Can operate lists blower, sweepster, bobcat, snowrator or shovel`,
     `Seasons must be a whole number`, `Gear must be own or needs issued`, `<field> must be yes, no or not set`),
     then `SNOW_ROSTER.validate('crew')` as every crew save;
  4. the row is written with `rev + 1` and audited as `saveMyCard` with who from the token.
  Reply: `{ok: true, card: <self view>, pending: <bool>}`.
- **The self view** (`SNOW_ROSTER.selfCard(rec)`): `{id, name, pending}` plus the self fields. It is the
  only shape a person ever receives of their own record: never a private field, never `rev`.
- **`bootstrap` / `me` for a pending sign-in** answer `{ok: false, code: 'pending_card', name, reason, card: <self view>}`,
  so the phone can show the card and offer Edit. A `not_on_roster` answer is unchanged (the phone offers the empty form).
- **`crewFor`**: a lead or crew phone never receives a pending record (they are not crew yet). Matt's
  phone gets them whole, `pending: true`.
- **The Board** never places a pending person: on the phone the Board's pool leaves them out; on the
  server `post_` and `boardStanding_` build `workersById` without them. (A pending record has no Moves
  anyway; this keeps "Unassigned" honest.)
- **Add to crew** is Matt's ordinary `saveCrew` of the whole record with `pending: false` (no new action).
- `VERSION` → `roster-1`.

## Phone

- **New `lib/rosterui.js`** (`window.SnowRosterUI`), in index.html after boardui.js and before app.js, in the shell
  (`titan-snow-shell-27`). It owns:
  - `selfForm(ctx, card, where)`: the form, drawn into `#main` (not on the roster yet) or the dialog (Your card).
    Picture: two file inputs, **Take a picture** (`accept="image/*" capture="user"`, the front camera on a phone)
    and **Choose a photo**; either becomes the thumbnail. The name is shown, not editable. Save sends
    `saveMyCard {card}` with exactly the self fields (a photo untouched is left out, so it is kept). A refusal shows
    the server's words. On success: "Saved" and the screen it came from (pending screen, or Tonight).
  - `pendingScreen(ctx, card)`: "Hi <name>. Your card is in. Matt will add you to the crew." + the card's values + Edit your card.
  - `notOnRosterScreen(ctx, name)`: "Hi <name>. You're signed in, but not on the snow crew yet. Fill out your card and Matt will add you." + Fill out your card.
  - `waitingHtml(ctx)`: the two Roster-tab sections for Matt (see below), and their clicks.
  - `thumb(file)` (moved from app.js, used by Matt's editor too).
- **app.js**: `load()` routes `pending_card` to the pending screen, `not_on_roster` to the new screen; Sign out stays
  available on both. Tonight gains a **Your card** button beside Refresh (crew and leads). `renderRoster` draws
  Matt's two sections above the grid:
  - **Waiting for approval**: from `API.profiles()` (already fetched for the editor), the `pending` ones. Approve /
    Reject call `API.approveProfile(id)` / `API.rejectProfile(id)`; the list refetches; a failure says so in a toast.
    Nothing to show → the section is left out.
  - **Waiting to be added**: pending cards (avatar, name, phone), each with **Add to crew** (`saveCrew` of the whole
    record, `pending: false`) and tap-to-open (Matt's full card). Nothing pending → the section is left out.
  - The grid below shows only non-pending people.
- **api.js**: `approveProfile(id)` and `rejectProfile(id)`: `inv({action, id, token})`; `{ok, reason}` back.
- **boardui.js**: the Board's `byId(S.crew)` pool excludes `pending` records.

## Tests

**Backend** (`node --test`, fake sheets; one mutation per rule in `verify-tests`):
- resolveRole: a pending record is `pending_card` with name, profile_id and crew_id; an archived pending record is `not_on_roster`.
- saveMyCard by a `not_on_roster` sign-in makes a new pending record: id past the highest, name from the token
  (a name in `card` is ignored), profile_id from the token, only self fields written, audited as the token's name; Inventory never written.
- saveMyCard by a pending sign-in updates that record and keeps it pending; by crew updates their live record, keeps Matt's
  fields (`weaknesses`, `is_lead`, `keep_apart_from`) byte for byte, and `pending` unset; `rev` bumps; a stale phone sending only `phone` keeps the photo.
- Each self rule refuses with its words; a too-big picture is refused before any write; a non-self key (`is_lead: true`) is ignored.
- An admin sign-in is refused `invalid`; a lead cannot save someone else's card (there is no id in the request: it is always their own).
- crewFor: a crew bootstrap carries no pending record and no `pending` key; Matt's carries it with `pending: true`.
- A pending bootstrap answers `pending_card` with the self view and without `weaknesses` or `rev`.
- post_ never lists a pending person; a Move for a pending worker is refused (`Unknown worker`, from validate's crew list without them).

**Phone** (`node --test` for pure bits; Playwright over `file://` with the fake backend):
- Not on the roster: the screen offers the form; Save sends `saveMyCard` whose `card` has exactly the self fields, the photo as a `data:image/jpeg` URL from the picked file, no `name`; then the pending screen.
- Pending: the pending screen shows the card and Edit; the header shows Sign out.
- Crew: Tonight has Your card; the form opens with their values; Save sends only what the form holds.
- Matt: Waiting for approval lists Pending Pat; Approve calls Inventory with `action=approveProfile`, `id`, and the token; the row goes away on success; Reject likewise.
- Matt: Waiting to be added lists the pending card; Add to crew sends `saveCrew` with the whole record and `pending: false`; the person then appears in the grid and on the Board's Unassigned.
- The Board's Unassigned never shows a pending person.
- `scripts-parse` covers the new file; the shell test sees it in `sw.js`.

## Assumptions for Matt (made 10/6/26 without him)

| # | Call made | Why | If wrong |
|---|---|---|---|
| A1 | Approve/Reject Inventory requests from Sidewalk's Roster tab | he said he has one pending; this is the tap he is missing | drop the section; approve in Inventory as today |
| A2 | The self-field list above; `cold_rated` stays his | the rest are facts about themselves; cold-rated reads as his judgment | move a field either way: one line in `SELF_FIELDS` and one in the form |
| A3 | The card's name is locked to the Inventory sign-in | a card must not claim to be someone else | none expected |
| A4 | Add to crew is the only gate after Inventory approval | he keeps approval; one tap, not a second form | none expected |
| A5 | Crew never see pending cards; Matt's Board never lists them | they are not crew yet | none expected |
| A6 | A declined card is Archived | archive already exists; no new state | add a Decline that archives with a note |
| A7 | Your card lives on the Tonight tab | the first screen crew see | move the button |
