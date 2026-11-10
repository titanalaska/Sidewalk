# Crew notifications: a dispatcher's tap reaches every phone

Matt Walsh, Titan Alaska. Designed 11/9/26 in conversation; Matt answered every question below himself.
Status: spec for review. Nothing built. The Android half was proven the same night with a throwaway page and
a scratch script; the iPhone half is not proven yet (see "Before the build").

## Why

Shovel Command can now show Matt and the dispatcher tonight's outlook (shell 45, 11/9/26), but only when they
open the app, and the crew learn nothing until someone texts them. Matt: "Can we just have Shovel Command
prompt them with a notification?" The app is an installed web app, and installed web apps can send real
notifications on Android and on iPhone.

## Decisions Matt made (11/9/26)

| Question | Matt's answer |
|---|---|
| When should the outlook speak up | **An evening heads-up**, not an hourly watch |
| Where does the outlook live | **Inside Shovel Command** (the outlook card, live as shell 45) |
| Card or notifications first | **Card, then notify**: the notification needs somewhere to land |
| Who gets a notification | **The whole crew** |
| Who decides when one goes out | **The dispatcher taps Send** (Matt or whoever carries the dispatcher mark). No timer, no automatic send |
| What it says | **One fixed line.** No typed message (that needs the backend to encrypt, unproven; a later step if ever) |

## What the proof showed (11/9/26)

- Plain JavaScript can make the signature a push service demands (ES256, RFC 8292 "VAPID") using only the
  SHA-256 and HMAC that Apps Script has. It reproduces the published RFC 6979 answers; Node's own crypto
  verifies its tokens; a changed token does not verify.
- It runs inside Apps Script: 31 to 80 ms per token. One token serves a whole send.
- Google's push service answered **201** for a real Android phone, and the phone showed the notification.
- **No Firebase, no outside service, no third-party code in the phone app.**

Four lessons the build must respect:

1. Apps Script's upload check refuses BigInt literals (`3n`). `BigInt(3)` runs. The signer uses no literals.
2. A new web app answers 403 to outside callers until it has been deployed once by hand in the editor. The
   snow backend already has been; nothing to do, but a scratch script will hit this.
3. A push with no payload is enough: the words live in the phone's service worker.
4. The first proof script did not record what the push service answered, and twenty minutes went to finding
   out. The real one records every answer.

## What the crew sees

**Tonight tab, a card above the post**, drawn only while this phone is not getting alerts:

| This phone | The card says |
|---|---|
| Can do it, not on yet | **Get snow alerts on this phone** and a **Turn on notifications** button |
| An iPhone, app not opened from the home screen | "To get snow alerts on an iPhone, add Shovel Command to your home screen first: Share, then Add to Home Screen." No button: the phone cannot ask from a browser tab |
| Notifications blocked in the phone's settings | "Notifications are blocked for Shovel Command in this phone's settings." No button: only the phone's settings can undo it |
| Cannot do it at all (old iPhone, odd browser) | No card |
| Alerts on | No card |

The permission request and the subscribe both start inside the tap. An iPhone refuses anything else.

**Your card** gains one row: "Snow alerts on this phone: on" with **Turn off**, or "off" with **Turn on**
(the same four states as the table).

**The notification itself.** Title "Shovel Command". The body is the fixed line, in the language the phone
had chosen when it last opened the app:

- English: **Snow tonight. Open Shovel Command for your route.**
- Spanish: **Nieve esta noche. Abre Shovel Command para ver tu ruta.**

*These words are Matt's to change in review.* Tapping it opens the app; the crew land on Tonight as always.
A second alert replaces the first on the phone (one tag), and still makes its sound.

**Signing out turns alerts off for that phone**, so a borrowed phone does not keep getting them.

## What Matt and the dispatcher see

**On the outlook card: a "Notify the crew" button**, there whether or not the outlook has been checked (the
call may rest on something the forecast does not show).

1. Tap. A dialog: "Send "Snow tonight. Open Shovel Command for your route." to 7 phones (6 people)?" with
   **Send** and **Cancel**. Zero phones: "Nobody has snow alerts turned on yet." and no Send.
2. Send. The button is off while it goes.
3. The card reports: "Sent to 7 phones at 9:41 PM." and, when they happen, "1 phone can no longer be
   reached." (removed from the list) and "2 phones did not accept it." (kept; try again).
4. The card keeps the last send on it: "Last alert: 9:41 PM by <name> · 7 phones."

**A second send within 10 minutes is refused by the server**, in its words: "Already sent at 9:41 PM by
<name>. Wait 10 minutes between alerts." *The 10 is a starting suggestion; Matt's to change in review.*

**On the roster:** a bell on the tile of anyone with at least one phone on, and a row on their card: "Snow
alerts: on (2 phones)" or "off". Admin screens only; a crew phone never learns who has alerts on.

**Their own phones:** an admin has no Tonight tab, so the outlook card carries the same one line for this
phone ("Snow alerts on this phone: off · Turn on").

## The backend (`snow-app-script`)

### Two new tabs (Matt runs `setup` once)

- **Push**: one record per phone. `{ by_key, by_name, endpoint, lang, added_at, last_at, last_status }`,
  where `by_key` is the crew id (or `admin` for Matt, who has no card). The same endpoint saved again is the
  same record, moved to whoever saved it last (a phone handed on). At most 5 live phones a person: a sixth
  archives the oldest.
- **Notices**: one row per send, append only. `{ at, by_name, sent, gone, failed }`. The 10-minute rule and
  "Last alert" read the newest row.

**A phone's address (its endpoint) never leaves the server.** No reply carries one, to anybody.

### Three new actions

| Action | Who | What |
|---|---|---|
| `savePush` `{ endpoint, lang }` | anyone signed in and on the roster, and Matt | Records this phone. The endpoint must be `https`, at most 1,000 characters, and on a known push service (Google, Apple, Mozilla, Microsoft); anything else is refused in words. `lang` is `en` or `es` |
| `dropPush` `{ endpoint }` | the same | Archives this person's record for that endpoint. An unknown one is still "ok": turning off twice is not an error |
| `notifyCrew` `{}` | admin only (Matt, a dispatcher) | The send, below |

### The send

1. Refuse inside the 10-minute gap (the reply names who sent and when; nothing is sent, nothing written).
2. The phones: every live Push record whose person is live crew (not archived, not a pending card) or Matt.
3. One token per push service, signed once, good for 12 hours.
4. Every phone gets one POST with no body: `Authorization: vapid t=…, k=…`, `TTL: 43200` (an evening
   heads-up is stale by morning), `Urgency: high`. All at once (`UrlFetchApp.fetchAll`).
5. Each answer is recorded on its record (`last_at`, `last_status`):
   - 200, 201, 202: **sent**.
   - 404, 410: **gone**. The record is archived; that phone will not be tried again.
   - anything else, or no answer: **failed**. The record stays.
6. One Notices row, one Audit row (`notifyCrew`, who from the token, the three counts).
7. The reply: `{ ok: true, sent, gone, failed, at, by_name }`. Counts only.

`ok` is true when the send ran, even if every phone failed: the counts say what happened. A missing key is
the one hard refusal: "Snow alerts are not set up yet."

### What sign-in carries

- Everyone: `push_key` (the public half of the key, so the phone can subscribe) and `push_ids` (a short
  SHA-256 fingerprint of each of this person's own endpoints, so the phone can tell whether *this* phone is
  on the list without the server ever sending an address).
- Admins also: `push_phones` on each crew record (a count, never in the crew's own allow-list),
  `push_count` (`{ phones, people }` in all, Matt's own phones included: the dialog's two numbers) and
  `last_notice` (the newest Notices row).

The dialog's numbers are as of the admin's last sign-in. The server sends to whoever is on the list at
that moment, and the result line carries the true count.

### The signer and the key

- `push.js`, pure, written test-first from the RFC 6979 P-256 answers: sign, public key from private, the
  token, the headers, the push-service allow-list, and which of sent / gone / failed a status is.
- The private key lives in Script Properties, never in a file, never in a repo. `makePushKey()` is a
  top-level function Matt runs once in the editor: it makes a key, stores it, and logs the public half only.
  **It refuses to run when a key already exists**: a new key silently strands every phone already on.
- The token's `sub` is the app's own public address. No email, no name.

### Version and permissions

- `VERSION` moves to `notify-1` (new actions, new sign-in fields); the phone's `EXPECTED_BACKEND` moves with
  it; the version-label mutation is re-pointed in the same commit.
- One new permission: calling other servers (`UrlFetchApp`). Matt runs `pushSelfTest()` once in the editor;
  it signs the published test message, checks the answer, and reaches the push service, which is what makes
  Google ask.
- Editor steps at deploy, in order, after `clasp push` and before the version is pinned: `setup`,
  `makePushKey`, `pushSelfTest`.

## The phone (`Snow-App-repo`)

- **`sw.js`** gains two handlers and nothing else changes: `push` shows the notification (words by the
  stored language, the app icon, one tag, re-alert on); `notificationclick` closes it and brings the app
  forward, or opens it. Shell 46.
- **The language the worker uses.** A service worker cannot read localStorage. The page writes the chosen
  language into a small cache, `titan-snow-prefs`, whenever it opens or the language changes. The name does
  not begin `titan-snow-shell-`, so the shell clean-up never deletes it. No stored language: English.
- **`lib/push.js`**, new: what this phone can do (`unsupported`, `install`, `blocked`, `off`, `on`), turn
  on, turn off, and the fingerprint that is compared with `push_ids`. "On" needs all three: permission
  granted, a subscription in the browser, and its fingerprint in `push_ids`. A subscription the server does
  not know (dropped as gone, or a new key) reads `off` and Turn on repairs it.
- The Tonight card, the Your card row, the outlook card's button and line, the roster bell and row.
- Spanish for every crew-facing line (the card, the row, the toasts). Admin screens stay English.
- A phone on the old app keeps working against the new server; it simply has no alerts.

## What can go wrong, and what the person sees

| What happens | What they see |
|---|---|
| The crew member taps Turn on and then Block | The "blocked" card. Nothing is saved |
| The phone subscribes but the save to the server fails | "Not saved: try again" on the card; the phone unsubscribes again so it never believes it is on |
| An iPhone below iOS 16.4 | No card |
| A phone is wiped, or the app removed | The next send gets "gone" for it; the record is archived; the dispatcher sees "1 phone can no longer be reached" |
| The push service is down | "N phones did not accept it." The records stay; send again after the gap |
| Do Not Disturb, no signal, notifications muted | Nothing, and nobody is told. **This is not an alarm** |
| Two dispatchers tap at once | The second gets the 10-minute refusal with the first one's name |

"Sent to 7 phones" means Google and Apple accepted seven. It does not mean seven people saw it. The card
says "Sent to", never "Delivered to" or "Seen by".

## Testing

Expected values worked on paper or taken from the published RFC, never pasted from what the code returned.

- **Signer** (backend, node): the RFC 6979 A.2.5 public key and both signatures; twenty fresh keys verified
  by Node's own crypto; a changed token does not verify; the header shape; the source holds no BigInt
  literal (a test reads the file, so the upload lesson cannot regress).
- **Backend** against a fake `UrlFetchApp` that records every request and answers 201, 410, 403 or nothing:
  who may call each action; the endpoint rules; the same phone saved twice is one record; the sixth phone;
  a pending or archived person's phone is skipped; gone is archived and failed is kept; the 10-minute gap on
  both sides of the line; the counts; the Audit and Notices rows; no reply anywhere contains an endpoint;
  the missing key; `makePushKey` refusing a second run.
- **Phone** (Playwright, the push system faked in the page): each of the five states on Tonight and on Your
  card; the request starting inside the tap; Block; the failed save; Turn off; sign-out; the dialog's counts
  and both buttons; the three result lines, each asserted visible and, in a run where it should not be,
  absent; the gap refusal; the roster bell on an admin phone and its absence from a crew phone; Spanish.
- **Service worker**: the notification's words in each language, the tap opening the app.
- Mutations on all of it; the full suites and the whole `verify-tests` before `/sidewalk-deploy`.

## Before the build

1. **The iPhone proof.** One crew iPhone on iOS 16.4 or newer runs the throwaway page from its home screen.
   If Apple accepts and the phone shows it, nothing here changes. If not, iPhones get a plain line on the
   Tonight card ("Snow alerts are not available on this iPhone yet.") and Android ships alone.
2. Matt's two review items: the words, and the 10 minutes.
3. The throwaway page and scratch script are deleted once the iPhone proof is done, on Matt's say.

## Not in this build

- A typed message, or a choice of messages.
- Automatic sends from the forecast.
- Alerts to one route or one person.
- Any record of who saw or opened an alert.
- Quiet hours. The dispatcher decides when to send.
- Plow Command. It can take the same pieces later.
