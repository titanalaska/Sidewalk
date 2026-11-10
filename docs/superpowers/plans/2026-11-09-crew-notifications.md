# Crew Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatcher's tap on the outlook card sends one fixed-line notification to every crew phone that turned alerts on.

**Architecture:** Plain web push (RFC 8030 / 8292), sent by the existing Apps Script backend with an ES256 signer written in plain JavaScript. Phones subscribe from a tap and hand the server their push address; the server keeps addresses in a new Sheet tab and never sends one back. The push carries no payload: the words live in the phone's service worker.

**Tech Stack:** Apps Script (V8, clasp) with `node --test` against `test/fake-apps-script.js`; the phone is plain script files, `node --test` plus Playwright over the real page. No new dependency on either side.

**Spec:** `docs/superpowers/specs/2026-11-09-crew-notifications-design.md` (this repo). The proof's code, for reference only and never copied without its tests: `claudes room/Snow/push-spike 2026-11-09 (throwaway proof)/`.

## Global Constraints

- The notification: title `Shovel Command`; body `Snow tonight. Open Shovel Command for your route.` (en), `Nieve esta noche. Abre Shovel Command para ver tu ruta.` (es). One tag, `snow-notice`, with re-alert on.
- Every push: no body; `TTL: 43200`; `Urgency: high`; `Authorization: vapid t=<jwt>, k=<public key>`. Token `aud` = the endpoint's origin, `exp` = now + 12 h, `sub` = `https://titanalaska.github.io/Sidewalk/`.
- An endpoint is accepted only when it is `https`, at most 1,000 characters, and its host matches `fcm.googleapis.com`, `web.push.apple.com`, `*.push.apple.com`, `updates.push.services.mozilla.com` or `*.notify.windows.com`.
- **No reply to any phone ever contains an endpoint.** Phones recognise their own by a fingerprint: the first 16 hex characters of SHA-256 over the endpoint's UTF-8 bytes.
- At most 5 live phones a person. A second send inside 10 minutes is refused.
- `push.js` holds no BigInt literal (`3n`): Apps Script's upload check refuses them. Use `BigInt(3)`.
- Backend `VERSION` = `notify-1`; phone `EXPECTED_BACKEND` = `notify-1`; phone shell `titan-snow-shell-46`. The language cache is named `titan-snow-prefs` (never a `titan-snow-shell-` name).
- The phone repo is public: no key, id, name or address in any file. `test/no-data.test.js` must pass.
- Never rename a localStorage key or the `/Sidewalk/` path. Admin screens stay English; every crew-facing line gets a Spanish row.
- House rules (`claudes room/CLAUDE.md`): expected values are worked on paper or taken from the RFC, never pasted from the code; see every test fail before it passes; each task adds mutations and they are seen to be caught; commit before a hand-mutation run; backend files LF; run the whole `verify-tests` from a clone outside OneDrive with a `Snow-App-repo` junction beside it; **look at the live Storm tab before any deploy and do not deploy with a storm open.**

## Review Focus

1. **The browser quietly replaced the phone's subscription** (a new endpoint the server has never seen): the phone must read `off`, and Turn on must repair it. Test in Task 7.
2. **The whole batch of sends throws** (Google's fetch service down): every phone counts as failed, no record is archived, the Notices row is still written, the reply is `ok` with the counts. Test in Task 4.
3. **A person archived, or a dispatcher un-marked, between turning alerts on and the send:** the archived person's phone gets nothing; the former dispatcher is refused. Test in Task 4.
4. **A phone handed to another sign-in:** the endpoint moves to the new person, and the first person's fingerprints no longer include it. Test in Task 2.
5. **Signing out with no signal:** the phone still unsubscribes locally and still signs out; nothing claims alerts are on. Test in Task 8.

---

## Where the work happens

| Repo | Branch (new worktree) | From |
|---|---|---|
| `snow-app-script` | `notify` in `snow-app-script-notify` | `master` (33767b7, live @20) |
| `Snow-App-repo` | `notify` in `Snow-App-notify` | `outlook` (live shell 45) |

Backend tests: `SNOW_PHONE_REPO="<abs path>/Snow-App-notify" node --test "test/*.test.js"`. Phone: `npm run test:unit`, then `npx playwright test -g "<name>"`; the full `npm test` at Task 10.

### Files

| File | Responsibility |
|---|---|
| backend `push.js` (new) | Pure: the signer, the token and headers, the endpoint rules, sent / gone / failed, the fingerprint |
| backend `Code.js` | The three actions, the key, the send, the sign-in fields |
| backend `sheet.js`, `auth.js` | Two tabs; who may call what |
| backend `test/push.test.js`, `test/push-api.test.js` (new), `test/fake-apps-script.js`, `test-tools/mutation-check.js` | Tests, the `Utilities` and `UrlFetchApp` fakes, mutations |
| phone `lib/push.js` (new) | What this phone can do, turn on, turn off, the fingerprint, the language cache, the card and row markup |
| phone `sw.js` | The `push` and `notificationclick` handlers |
| phone `lib/boardui.js`, `lib/rosterui.js`, `lib/shiftlogui.js`, `lib/app.js`, `lib/es.js`, `index.html`, `app.css` | Where the card, row, button and bell are drawn; Spanish; loading the new file |
| phone `test/push.test.js`, `test/sw-push.test.js` (new), `test/ui.spec.js` | Tests |

---

### Task 1: The signer (`push.js`, backend)

**Files:** Create `push.js`, `test/push.test.js`. Modify `test/fake-apps-script.js` (`FILES` gains `push.js` before `Code.js`), `test-tools/mutation-check.js` (`FILES`).

**Interfaces — Produces** `var SNOW_PUSH`, with `module.exports` for node. `host` is `{ sha256(bytes) -> bytes, hmac(keyBytes, msgBytes) -> bytes }`, bytes are arrays of 0..255:
- `sign(host, dBytes, message: string) -> number[64]` (r then s, RFC 6979 nonce)
- `publicKey(dBytes) -> number[65]` (`04 || X || Y`)
- `jwt(host, dBytes, audience, subject, expSeconds) -> string`
- `headers(host, dBytes, endpoint, subject, nowSeconds) -> { Authorization, TTL: '43200', Urgency: 'high' }`
- `b64url(bytes) -> string`, `unb64url(string) -> number[]`
- `origin(endpoint) -> 'https://host' | null`
- `endpointProblem(endpoint) -> string | null`; the words are `That is not a push service address`
- `outcome(status) -> 'sent' | 'gone' | 'failed'`
- `fingerprint(host, endpoint) -> string` (16 hex)

- [ ] **Step 1: Write the failing tests** in `test/push.test.js`, with a node-crypto `host`:

```js
const D = hexBytes('C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721');   // RFC 6979 A.2.5
test('public key: RFC 6979 A.2.5', () => assert.equal(hex(P.publicKey(D)),
  '04' + '60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6' + '7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299'));
test('signature of "sample": RFC 6979 A.2.5', () => assert.equal(hex(P.sign(host, D, 'sample')),
  'EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716' + 'F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8'));
test('signature of "test": RFC 6979 A.2.5', () => assert.equal(hex(P.sign(host, D, 'test')),
  'F1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367' + '019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083'));
```
Also: twenty fresh node keys (our `publicKey` equals node's; node `crypto.verify` with `dsaEncoding: 'ieee-p1363'` accepts our `jwt`); a token with one character changed does not verify; the token's claims are exactly `{ aud, exp, sub }` and its header `{ typ: 'JWT', alg: 'ES256' }`; `headers()` for `https://fcm.googleapis.com/fcm/send/x` has `aud` `https://fcm.googleapis.com`, `exp` = now + 43200, `TTL` `'43200'`, `Urgency` `'high'`, and `Authorization` matching `/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/`; `endpointProblem` is `null` for one address at each allowed host and the words for `http://fcm.googleapis.com/x`, `https://evil.example/x`, `https://fcm.googleapis.com.evil.example/x`, a 1,001-character address, `''` and `null`; `outcome`: 200, 201, 202 sent; 404, 410 gone; 0, 400, 401, 403, 429, 500 failed; `fingerprint` of `https://fcm.googleapis.com/fcm/send/abc` equals the first 16 hex of node's SHA-256 of that string; **`fs.readFileSync('push.js')` matches no `/\b\d+n\b/` outside comments.**

- [ ] **Step 2: Run** `node --test test/push.test.js`. Expected: FAIL, `Cannot find module '../push.js'`.
- [ ] **Step 3: Implement `push.js`.** NIST P-256 in affine coordinates with BigInt and extended-Euclid inverses; constants made with `BigInt('0x…')` and `BigInt(n)`. The curve order is `0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551` (64 hex digits; the proof first had 56 and hung).
- [ ] **Step 4: Run** the same command. Expected: PASS. Then the whole backend suite: PASS.
- [ ] **Step 5: Mutations** (add to `mutation-check.js`, run `ONLY="push.js" …`): a wrong nonce step; `exp` 13 h; `aud` the full endpoint; the host list accepting any `https`; 410 counted failed; TTL dropped. All CAUGHT.
- [ ] **Step 6: Commit** `push.js: the web push signer (ES256 in plain JavaScript), the endpoint rules and outcomes`.

### Task 2: Phones on the list (`savePush`, `dropPush`, sign-in fields)

**Files:** Modify `sheet.js` (`TABS` gains `Push: RECORD_HEAD`, `Notices: RECORD_HEAD`), `auth.js`, `Code.js`, `test/fake-apps-script.js`. Create `test/push-api.test.js`.

**Interfaces — Consumes** Task 1. **Produces:**
- `auth.js`: a new list `var PUSH = ['savePush', 'dropPush'];` that `can()` allows for admin, lead and crew; `notifyCrew` is added to `ADMIN`. Neither is reachable by a pending card or a sign-in not on the roster (`handle_` lets only `saveMyCard` through for those).
- `Code.js`: `var PUSH_MAX_PHONES = 5;` `var PUSH_HOST_ = { sha256, hmac }` over `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, …)` and `Utilities.computeHmacSha256Signature(value, key)` (Apps Script bytes are signed: convert both ways).
- A Push record: `{ id: 'PU-' + 10 hex, name: by_name, by_key, by_name, endpoint, lang, added_at, last_at: null, last_status: null }`, `by_key` = `a.crew_id || 'admin'`.
- `savePush` `{ endpoint, lang }` -> `{ ok: true, push_ids: string[] }`; `dropPush` `{ endpoint }` -> the same shape.
- `bootstrap` (slim or not) gains `push_key: string | null` and `push_ids: string[]` for everyone.
- The fake gains `Utilities.computeDigest`, `computeHmacSha256Signature`, `DigestAlgorithm` (node crypto, signed bytes).

- [ ] **Step 1: Write the failing tests** (`world()` as in `test/api.test.js`, endpoints `https://fcm.googleapis.com/fcm/send/jordan-1` and the like):
  - crew, a lead and Matt can each save; a pending card and a sign-in not on the roster cannot;
  - the stored record has exactly the fields above; `lang` other than `en` / `es` is `invalid`; a bad endpoint is `invalid` with `That is not a push service address`; nothing is written on a refusal;
  - **the same endpoint saved twice is one live record;**
  - **handed on:** Jordan saves E, then Alex saves E: one live record, `by_key` `C01`; Jordan's `push_ids` is `[]`, Alex's is `[fp(E)]`;
  - the sixth phone archives the oldest of that person's five, and nobody else's;
  - `dropPush` archives the caller's record; someone else's endpoint and an unknown one both answer `ok` and write nothing;
  - `push_ids` are 16-hex fingerprints, in `bootstrap` and `bootstrap` + `slim: true`;
  - **`JSON.stringify` of every reply in the test (save, drop, bootstrap, getCrew, for crew and for Matt) contains no `/fcm/send/`.**
- [ ] **Step 2: Run** `node --test test/push-api.test.js`. Expected: FAIL, `Unknown action` / `forbidden`.
- [ ] **Step 3: Implement** `savePush_(a, req)`, `dropPush_(a, req)` (inside `locked_`), and `pushFor_(a)` -> `{ push_key, push_ids }` merged into the bootstrap reply. Push is not a cached tab.
- [ ] **Step 4: Run.** Expected: PASS; whole suite PASS (`setup()` test now expects the two new tabs: update its list).
- [ ] **Step 5: Mutations:** a reply carries the endpoint; the same endpoint makes a second record; the cap is per everybody; `dropPush` archives another person's record; a pending card may save. All CAUGHT.
- [ ] **Step 6: Commit** `Phones turn snow alerts on and off: savePush, dropPush, the Push tab, fingerprints at sign-in`.

### Task 3: The key (`makePushKey`, `pushSelfTest`)

**Files:** Modify `Code.js`, `test/push-api.test.js`.

**Interfaces — Produces:** `var PUSH_KEY_PROP = 'PUSH_PRIVATE_KEY';` `pushKey_() -> number[32] | null`; `makePushKey()` and `pushSelfTest()`, top-level, no arguments, results through `console.log`. `push_key` in bootstrap is `SNOW_PUSH.b64url(SNOW_PUSH.publicKey(key))`, or `null` with no key.

- [ ] **Step 1: Failing tests:** with no property, `push_key` is `null`; after `makePushKey()` the property is 43 base64url characters, `push_key` is 87 characters and equals node's public key for that private key; **a second `makePushKey()` throws `A push key already exists` and the property is unchanged**; the private key appears in no log line and no reply; two fresh backends make different keys; `pushSelfTest()` logs `SELF TEST PASSED` when the RFC "sample" signature matches and makes exactly one request, to `https://fcm.googleapis.com/`.
- [ ] **Step 2: Run.** Expected: FAIL, `makePushKey is not defined`.
- [ ] **Step 3: Implement.** The private key is SHA-256 over four `Utilities.getUuid()` values and the time, reduced into 1..n-1 (Apps Script has no other random source; a v4 UUID carries 122 random bits). The fake's `getUuid` is a counter: for the "different keys" test give the fake a `opts.uuid` seed.
- [ ] **Step 4: Run.** PASS. **Step 5: Mutations:** the second run overwrites; the private key is logged; `push_key` is the private key. CAUGHT. **Step 6: Commit** `The push key: made once in the editor, kept in script properties, public half at sign-in`.

### Task 4: The send (`notifyCrew`)

**Files:** Modify `Code.js`, `test/fake-apps-script.js`, `test/push-api.test.js`.

**Interfaces — Produces:**
- `var NOTIFY_GAP_MIN = 10;` `var PUSH_SUBJECT = 'https://titanalaska.github.io/Sidewalk/';`
- `notifyCrew` `{}` -> `{ ok: true, sent, gone, failed, at, by_name }`.
- Refusals: `{ ok: false, code: 'too_soon', at, by_name, wait_min: 10, reason: 'Already sent. Wait 10 minutes between alerts.' }` (the phone composes the clock time); `{ ok: false, code: 'not_set_up', reason: 'Snow alerts are not set up yet.' }`.
- A Notices record: `{ id: 'N-' + 12 hex, name: by_name, at, by_name, sent, gone, failed }`.
- Admin bootstrap gains `push_phones: number` on every crew record, `push_count: { phones, people }` and `last_notice: { at, by_name, sent, gone, failed } | null`.
- The fake gains `UrlFetchApp.fetchAll(requests) -> responses` and `fetch(url, o)`, recording into `ctx.__push.requests`; `opts.push(url) -> status | 'throw'`, and `opts.pushDown` makes `fetchAll` itself throw. The clock: `opts.now` (a Date the backend's `new Date()` returns) so the gap is tested without waiting.

- [ ] **Step 1: Failing tests:**
  - crew and a lead are `forbidden`; Matt and a dispatcher (the mark) may send; **a dispatcher whose mark Matt removed is `forbidden` on the next call;**
  - no key: `not_set_up`, no request made;
  - three phones answering 201, 410, 403 -> `{ sent: 1, gone: 1, failed: 1 }`; the 410 record is archived, the 403 record is live with `last_status: 403`, the 201 record has `last_status: 201` and `last_at` = the send time;
  - each request: method `post`, payload `''`, the three headers, and its token verifies under node with `push_key`; two phones on one push service share one token, a phone on Apple's gets a second with `aud` `https://web.push.apple.com`;
  - **a phone whose person is archived, and one whose card is pending, get no request; Matt's own phone does;**
  - **`pushDown`:** `{ sent: 0, gone: 0, failed: 3 }`, nothing archived, the Notices row written;
  - the gap: a second send at +9 min 59 s is `too_soon` with the first one's `at` and `by_name`, makes no request and writes nothing; at +10 min it sends;
  - one Notices row and one Audit row per send, the Audit `Who` from the token;
  - admin bootstrap: `push_phones` per person, `push_count` counting Matt's phone, `last_notice` the newest row; **a crew bootstrap has none of the three and no `push_phones` anywhere;**
  - no reply contains an endpoint.
- [ ] **Step 2: Run.** Expected: FAIL, `Unknown action`.
- [ ] **Step 3: Implement `notifyCrew_(a)`** inside `locked_`: gap check, select, one `SNOW_PUSH.headers` per origin, `UrlFetchApp.fetchAll` with `muteHttpExceptions: true` in a `try` (a throw = every status 0), record each outcome, one Notices record.
- [ ] **Step 4: Run.** PASS; whole suite PASS.
- [ ] **Step 5: Mutations:** a lead may send; the gap is 9 minutes; the gap is checked after sending; gone is not archived; failed is archived; an archived person's phone is sent to; the crew see `push_phones`; a throw aborts the send; the token is per phone with the wrong `aud`. CAUGHT.
- [ ] **Step 6: Commit** `notifyCrew: a dispatcher's send to every phone on the list, with a ten-minute gap and a record of every answer`.

### Task 5: The backend's label

**Files:** Modify `Code.js` (`VERSION = 'notify-1'` and its comment line), every test that pins `'dispatch-1'`, the version-label mutation.

- [ ] **Step 1:** `sed` the label in the tests and the mutation's `find` / `caughtBy`; run the suite. Expected: FAIL on the `GET answers notify-1` tests and the reply-action tests.
- [ ] **Step 2:** Change `VERSION`. Run: PASS.
- [ ] **Step 3:** `git ls-files --eol "*.js"`: every line `i/lf w/lf`. Commit `VERSION notify-1`.

### Task 6: The service worker hears a push (phone)

**Files:** Modify `sw.js`, `test/sw.spec.js`, `test/manifest.test.js`. Create `test/sw-push.test.js`.

**Interfaces — Produces:** in `sw.js`, `var NOTICE = { en: { title, body }, es: { title, body } }` with the Global Constraints' words, `var PREFS_CACHE = 'titan-snow-prefs'`, the language read from that cache's `./prefs/lang` entry (`en` when missing or anything but `es`). `CACHE_VERSION = 'titan-snow-shell-46'`. `SHELL` is not touched here: Task 7 creates `lib/push.js` and adds its line.

- [ ] **Step 1: Failing tests** in `test/sw-push.test.js`: run `sw.js` in a `vm` with a fake `self` (captured listeners, `registration.showNotification` spy, a fake `caches`, fake `clients`):
  - a `push` event with no data shows `Shovel Command` / `Snow tonight. Open Shovel Command for your route.` with `tag: 'snow-notice'`, `renotify: true`, `icon: './icon-192.png'`, and the event waits on it;
  - with `es` in the prefs cache the body is `Nieve esta noche. Abre Shovel Command para ver tu ruta.`; with `fr`, nothing, or a cache that throws, English;
  - `notificationclick` closes the notification and focuses an open window; with none open, `openWindow('./')`;
  - activation still deletes `titan-snow-shell-45` and **does not delete `titan-snow-prefs`**.
  Update the shell pins to 46 in `sw.spec.js` / `manifest.test.js` (seed and reject 45).
- [ ] **Step 2: Run** `node --test test/sw-push.test.js test/manifest.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the two listeners; leave install / activate / fetch as they are.
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Hand mutations:** Spanish words for everyone; no tag; the click opens nothing; the prefs cache deleted on activate. CAUGHT.
- [ ] **Step 6: Commit** `The service worker shows a snow alert and opens the app; shell 46`.

### Task 7: What this phone can do (`lib/push.js`)

**Files:** Create `lib/push.js`, `test/push.test.js`. Modify `index.html` (load it before `lib/boardui.js`), `sw.js` `SHELL`.

**Interfaces — Produces** `var SnowPush`:
- `stateOf(f) -> 'unsupported' | 'install' | 'blocked' | 'off' | 'on'`, `f = { sw, push, notif, ios, standalone, permission, subscribed, known }`. Order: no `sw` / `push` / `notif` -> `ios && !standalone ? 'install' : 'unsupported'`; `permission === 'denied'` -> `blocked`; `permission === 'granted' && subscribed && known` -> `on`; else `off`.
- `fingerprint(endpoint) -> Promise<string>` (WebCrypto, 16 hex; equals the backend's).
- `refresh(S, env?) -> Promise<state>`: reads the browser, compares with `S.push.ids`, sets `S.push.state`.
- `turnOn(ctx) -> Promise<{ ok, state, reason? }>`: `Notification.requestPermission()` is the **first** call in the tap; then `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` with `S.push.key`; then `ctx.call('savePush', { endpoint, lang })`. A failed save unsubscribes and answers `{ ok: false, reason: 'Not saved: try again' }`.
- `turnOff(ctx) -> Promise<{ ok, state }>`: unsubscribes locally first, then `dropPush`; a failed `dropPush` is still `ok`.
- `rememberLang(lang) -> Promise<void>`: writes `./prefs/lang` into `titan-snow-prefs`.
- `cardHtml(ctx) -> string` (`#pushcard`, button `#pushOn`), `rowHtml(ctx) -> string` (`#pushrow`, `#pushOn` / `#pushOff`), `onClick(ev, ctx) -> boolean`.
- `app.js` keeps `S.push = { key, ids, state }` from every bootstrap, calls `refresh` after it, and `rememberLang` at start and on every language change.

- [ ] **Step 1: Failing node tests:** `stateOf` for all the rows of the spec's table (include: iPhone in a tab with no `PushManager` -> `install`; desktop with none -> `unsupported`; granted + subscribed + **not known** -> `off`); `fingerprint` equals node's SHA-256 prefix; with an injected `env`: `turnOn` calls `requestPermission` before anything asynchronous; a `denied` answer saves nothing and is `blocked`; a save that fails calls `unsubscribe` and reports the words; `turnOff` with `dropPush` failing still unsubscribes and is `ok`; **a browser endpoint the server does not list reads `off`, and `turnOn` saves the new endpoint.**
- [ ] **Step 2: Run** `node --test test/push.test.js`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement.** `env` defaults to the real `navigator` / `Notification` / `caches`; tests inject fakes.
- [ ] **Step 4: Run.** PASS; `npm run test:unit` PASS.
- [ ] **Step 5: Hand mutations:** `known` ignored; the permission asked after an `await`; a failed save leaves the subscription; `install` and `unsupported` swapped. CAUGHT.
- [ ] **Step 6: Commit** `lib/push.js: what this phone can do about snow alerts, turn on, turn off`.

### Before Task 8: the iPhone proof

The spec's "Before the build" item 1. If the proof on a crew iPhone passed (Apple accepted and the phone showed it), Task 8 is as written. If it failed, add a sixth state to Task 7's `stateOf`, `'no_iphone'` (`f.ios` true, whatever else), drawn on Tonight as the line `Snow alerts are not available on this iPhone yet.` / `Las alertas de nieve todavía no están disponibles en este iPhone.` with no button, and Android ships alone. If the proof has not been run by the time Task 8 starts, stop and ask Matt.

### Task 8: The crew's side

**Files:** Modify `lib/boardui.js` (`renderTonight`), `lib/rosterui.js` (the Your card form), `lib/app.js` (sign-out, click routing), `lib/es.js`, `app.css`, `test/ui.spec.js`, `test/es.test.js`.

**Interfaces — Consumes** Task 7. Lines, word for word, each with its Spanish row:

| English | Spanish |
|---|---|
| Get snow alerts on this phone | Recibe alertas de nieve en este teléfono |
| Turn on notifications | Activar notificaciones |
| To get snow alerts on an iPhone, add Shovel Command to your home screen first: Share, then Add to Home Screen. | Para recibir alertas de nieve en un iPhone, primero agrega Shovel Command a tu pantalla de inicio: Compartir y luego Agregar a inicio. |
| Notifications are blocked for Shovel Command in this phone's settings. | Las notificaciones de Shovel Command están bloqueadas en la configuración de este teléfono. |
| Snow alerts on this phone | Alertas de nieve en este teléfono |
| Turn on / Turn off | Activar / Desactivar |
| Snow alerts are on. / Snow alerts are off. | Alertas de nieve activadas. / Alertas de nieve desactivadas. |

*One crew member reads the Spanish on a phone before ship, as for shell 41.*

- [ ] **Step 1: Failing Playwright tests** (`push:` prefix). A helper `fakePush(page, { permission, ios, standalone, subscribed })` installs, by `addInitScript`, a fake `Notification`, `PushManager` and registration; `fakeSnow` learns `savePush` / `dropPush` / `push_key` / `push_ids` with the real reply shapes.
  - each state on Tonight: the card with its button; the iPhone line and **no button**; the blocked line and no button; `unsupported` and `on` draw **no** `#pushcard` (`toHaveCount(0)`);
  - Turn on: the request body is `{ endpoint, lang: 'en' }`; the card goes; Your card reads `on` with Turn off; the toast;
  - Block in the prompt: nothing sent, the blocked line;
  - the save refused: `Not saved: try again` on the card, the fake's `unsubscribe` called, the card still offers Turn on;
  - Turn off from Your card: `dropPush` sent, the Tonight card is back;
  - sign-out with alerts on: `dropPush` sent and the fake unsubscribed; **with every snow call aborted: still signed out, still unsubscribed;**
  - Spanish: the card and row in Spanish, `lang: 'es'` in the request, no English left.
- [ ] **Step 2: Run** `npx playwright test -g "push:"`. Expected: FAIL.
- [ ] **Step 3: Implement.** The card sits above the post on Tonight; the row is the last row of the Your card form, outside the save (it acts at once).
- [ ] **Step 4: Run.** PASS. **Step 5: Hand mutations:** the iPhone line gets a button; the card shows while on; sign-out skips the unsubscribe; `lang` always `en`. CAUGHT.
- [ ] **Step 6: Commit** `Snow alerts for the crew: the Tonight card, the Your card row, off at sign-out (EN + ES)`.

### Task 9: The dispatcher's side

**Files:** Modify `lib/shiftlogui.js` (the outlook card), `lib/app.js` (roster tile and card), `app.css`, `test/ui.spec.js`.

**Interfaces — Consumes** Task 4's reply shapes. Markup: `#notifyCrew`, the dialog's `#nt_send` / `#nt_cancel`, `#notifyResult`, `#notifyGone`, `#notifyFailed`, `#lastNotice`, `#ownPush`; `.bell` on a roster tile; a `Snow alerts` row on the roster card. `S.pushCount`, `S.lastNotice` and `push_phones` come from bootstrap and are refreshed from the send's reply.

- [ ] **Step 1: Failing Playwright tests** (`notify:` prefix):
  - the button is on the outlook card before Check outlook is tapped;
  - the dialog reads `Send "Snow tonight. Open Shovel Command for your route." to 7 phones (6 people)?`; Cancel sends nothing; with `push_count.phones` 0 it reads `Nobody has snow alerts turned on yet.` and has **no** Send;
  - Send with `{ sent: 7, gone: 0, failed: 0 }`: `Sent to 7 phones at 6:00 PM.`, `#notifyGone` and `#notifyFailed` `toHaveCount(0)`, `#lastNotice` `Last alert: 6:00 PM by Matthew · 7 phones.`;
  - `{ sent: 5, gone: 1, failed: 2 }`: `1 phone can no longer be reached.` and `2 phones did not accept it.` both visible; the singular and plural forms;
  - `too_soon`: `Already sent at 5:55 PM by Jordan Demo. Wait 10 minutes between alerts.` (the clock from the reply's `at`);
  - the button is off while the send is out, and a second tap sends nothing;
  - `not_set_up` and a lost signal say so and leave the button usable;
  - a dispatcher has the button; **a Board lead and a crew phone have neither the button nor a bell anywhere;**
  - the roster: a bell on a person with `push_phones` 2 and none on a person with 0; the card row `on (2 phones)` / `on (1 phone)` / `off`;
  - `#ownPush` on the outlook card turns this phone's own alerts on and off.
- [ ] **Step 2: Run** `npx playwright test -g "notify:"`. Expected: FAIL.
- [ ] **Step 3: Implement.** The dialog is the app's existing `showDialog`. The busy lock is the Storm tab's own pattern (`stormBusy`).
- [ ] **Step 4: Run.** PASS; the `outlook:` tests still PASS.
- [ ] **Step 5: Hand mutations:** a lead gets the button; Send with zero phones; "Delivered to"; the gone line always drawn; the second tap sends; the bell on everyone. CAUGHT.
- [ ] **Step 6: Commit** `Notify the crew: the dispatcher's button, its dialog and results, the roster bell`.

### Task 10: The phone's label and the gates

- [ ] **Step 1:** `EXPECTED_BACKEND: 'notify-1'` in `lib/config.js` (one more clause in its comment); every fake that answers `dispatch-1` answers `notify-1`. See `a matching backend version shows no warning` fail first, then pass.
- [ ] **Step 2:** `npm test` (node + Playwright), then `node --test test/no-data.test.js`. Expected: all PASS; record the two counts.
- [ ] **Step 3:** Backend: `npm test`, then the whole `verify-tests` from a clone outside OneDrive. Expected: every mutation CAUGHT, none SKIPPED.
- [ ] **Step 4:** Commit `EXPECTED_BACKEND notify-1`. A fresh reviewer reads both branches against the spec before Task 11.

### Task 11: Ship it (Matt's steps, one at a time, each confirmed by screenshot)

- [ ] **Step 1:** Open the live app's Storm tab. **A storm open: stop and ask Matt.**
- [ ] **Step 2:** `/sidewalk-deploy dry-run`, then the real run on Matt's Deploy. After `clasp push` and before the version is pinned, Matt runs in the editor, in this order: **`setup`** (file `sheet.js`), **`makePushKey`** (file `Code.js`; the log shows the public key only), **`pushSelfTest`** (approves "connect to an external service"; the log reads `SELF TEST PASSED`).
- [ ] **Step 3:** Live checks: GET answers `notify-1`; live `sw.js` is shell 46; a bootstrap carries an 87-character `push_key`.
- [ ] **Step 4:** Matt turns alerts on on his own phone, taps Notify the crew, and the notification arrives. Then one crew member reads the Spanish.
- [ ] **Step 5:** Update `claudes room/CLAUDE.md` (both rows, both test-count rows) and the snow app memory. On Matt's say, delete the throwaway `titanalaska/push-test` repo and the "Push test (throwaway)" script.
