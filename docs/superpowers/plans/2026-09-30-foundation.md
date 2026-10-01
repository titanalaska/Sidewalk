# Snow App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidewalk crews sign in with their Titan Inventory PIN. Everyone sees the sites and routes, and Matt alone manages the crew roster (with its private fields), the sites and the routes. Every read is signed in, and private fields never leave the backend for anyone but Matt.

**Architecture:**
- **Backend:** a new Apps Script project, `snow-app-script`, with its own Sheet. It trusts Inventory's session tokens by **reading** Inventory's `Sessions` and `Profiles` tabs.
- **Pure modules** (`auth.js`, `roster.js`) hold every decision and are node-tested. `sheet.js` and `Code.js` do the I/O and are tested in a `vm` against fake spreadsheets.
- **Phone app:** a multi-file vanilla JS page (`Snow-App-repo`) published on GitHub Pages, with no data in the code.

**Tech Stack:** Apps Script V8 + clasp; vanilla JS; `node:test`; `@playwright/test` ^1.63.0 with `page.route` stubs.

**Spec:** `docs/superpowers/specs/2026-09-30-foundation-design.md`

## Additions beyond the spec (Matt: "add some stuff if you think it's needed")

1. **`bootstrap` action.** One round trip at load returns `me`, plus sites, routes and crew. Apps Script calls cost about a second each.
2. **`version` on every response.** The client shows "Backend out of date" when it doesn't match `EXPECTED_BACKEND`. This catches "pushed but not deployed" (Count mode sat dead for a day on exactly that).
3. **Row revisions (`rev`).** A save must carry the `rev` it was edited from. Otherwise it is refused with "Someone changed this since you opened it. Reload." Matt edits from both the phone and the laptop.
4. **`setup()`.** Run once from the Apps Script editor; it creates every tab with its headers.
5. **`LockService` around every write**, as in Inventory (`waitLock(25000)`; when busy it answers "busy, try again").

## Global Constraints

- **The snow backend NEVER writes Inventory's spreadsheet.** A test asserts zero writes to the Inventory fake.
- `PUBLIC_CREW_FIELDS = ['id', 'name', 'phone', 'photo_thumb', 'is_lead']`. This is the **only** shape non-admins ever receive.
- Every action requires a valid token, with no open reads, and there is **no kill switch** that opens reads.
- **`who` comes from the token**, never from the request.
- Responses are always `{ok: true, ...}` or `{ok: false, code, reason}` plus `version`. The client always parses the body, because Apps Script returns 200 on refusals.
- POST bodies are `text/plain` JSON, as Inventory does it, so there is no CORS preflight.
- `localStorage` keys are all prefixed `titan-snow-`.
- Judgment values ship blank; no invented defaults.
- Expected values are worked out by hand; every guard is proven by `verify-tests`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Matt does all Google-account steps** (create the Sheet, `clasp create`, deploy), one step at a time, confirmed by screenshot.

## Review Focus

1. **A private crew field reaches a lead or crew response.** Pinned by `roster.test.js` and the `api.test.js` SECRET walk.
2. **Someone approved in Inventory but not on the snow roster gets a blank or broken app.** Pinned by the `auth.test.js` not-on-roster case and the Playwright screen test.
3. **Approval pulled after a token was issued still lets them in.** Pinned by `auth.test.js` "un-approved after token".
4. **A phone save silently overwrites a laptop save.** Pinned by the rev tests.
5. **A "Saved" message for a refused write.** Pinned by the Playwright rollback test.

---

## Backend: `C:\Users\skull\OneDrive\claudes room\snow-app-script`

### Task 1: Scaffold + `auth.js` (pure)

**Files:** `package.json`, `.gitignore`, `.claspignore` (ignores `test/`, `test-tools/`, `node_modules/`, `package*.json`), `appsscript.json`, `auth.js`, `test/auth.test.js`

**Interfaces:**
- `SNOW_AUTH.resolveRole({token, now: Date, sessions: any[][], profiles: any[][], crew: Crew[], adminNames: string[]})` returns either `{ok: true, role: 'admin'|'lead'|'crew', name, profile_id, crew_id|null}` or `{ok: false, code: 'signin'|'not_on_roster', reason, name?}`.
- `SNOW_AUTH.can(role, action) → bool`.

- [ ] **Step 1: `appsscript.json`**

```json
{
  "timeZone": "America/Anchorage",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

- [ ] **Step 2: Write `test/auth.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../auth.js');

const NOW = new Date('2026-11-01T12:00:00Z');
// Inventory's real column order. Sessions: Token|ProfileID|Name|IssuedAt|ExpiresAt|LastSeen
const sessions = [['Token', 'ProfileID', 'Name', 'IssuedAt', 'ExpiresAt', 'LastSeen'],
  ['tok-matt', 'P1', 'Matthew', '', '2026-12-01T00:00:00Z', ''],
  ['tok-alex', 'P2', 'Alex Test', '', '2026-12-01T00:00:00Z', ''],
  ['tok-jordan', 'P3', 'Jordan Demo', '', '2026-12-01T00:00:00Z', ''],
  ['tok-old', 'P2', 'Alex Test', '', '2026-10-01T00:00:00Z', ''],
  ['tok-nursery', 'P4', 'Nina Nursery', '', '2026-12-01T00:00:00Z', ''],
  ['tok-pulled', 'P5', 'Pat Pulled', '', '2026-12-01T00:00:00Z', '']];
// Profiles: ID|Name|Position|Status|RequestedAt|ApprovedAt|PIN
const profiles = [['ID', 'Name', 'Position', 'Status', 'RequestedAt', 'ApprovedAt', 'PIN'],
  ['P1', 'Matthew', 'Manager', 'approved', '', '', '1111'],
  ['P2', 'Alex Test', 'Crew', 'approved', '', '', '2222'],
  ['P3', 'Jordan Demo', 'Crew', 'approved', '', '', '3333'],
  ['P4', 'Nina Nursery', 'Nursery', 'approved', '', '', '4444'],
  ['P5', 'Pat Pulled', 'Crew', 'rejected', '', '', '5555']];
const crew = [{ id: 'C01', profile_id: 'P2', is_lead: true, archived: false },
  { id: 'C03', profile_id: 'P3', is_lead: false, archived: false },
  { id: 'C05', profile_id: 'P5', is_lead: false, archived: false }];
const who = (token) => A.resolveRole({ token, now: NOW, sessions, profiles, crew, adminNames: ['Matthew'] });

test('admin by name, even with no crew record', () => {
  assert.deepEqual(who('tok-matt'), { ok: true, role: 'admin', name: 'Matthew', profile_id: 'P1', crew_id: null });
});
test('lead and crew come from the snow roster', () => {
  assert.deepEqual(who('tok-alex'), { ok: true, role: 'lead', name: 'Alex Test', profile_id: 'P2', crew_id: 'C01' });
  assert.equal(who('tok-jordan').role, 'crew');
});
test('approved in Inventory but not on the snow roster is its own refusal', () => {
  const r = who('tok-nursery');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_on_roster');
  assert.match(r.reason, /not on the snow crew yet/);
  assert.equal(r.name, 'Nina Nursery');
});
test('archived crew are not on the roster', () => {
  const r = A.resolveRole({ token: 'tok-jordan', now: NOW, sessions, profiles,
    crew: [{ id: 'C03', profile_id: 'P3', archived: true }], adminNames: ['Matthew'] });
  assert.equal(r.code, 'not_on_roster');
});
test('expired token is refused', () => { assert.equal(who('tok-old').code, 'signin'); });
test('un-approved after the token was issued is refused', () => {
  // Pat has a live token and a crew record, but Inventory approval was pulled.
  const r = who('tok-pulled');
  assert.equal(r.code, 'signin');
  assert.match(r.reason, /not approved/);
});
test('missing or unknown token is refused', () => {
  assert.equal(who('').code, 'signin');
  assert.equal(who('tok-nobody').code, 'signin');
});
test('admin-only actions refuse lead and crew', () => {
  for (const a of ['saveCrew', 'archiveCrew', 'saveSite', 'archiveSite', 'saveRoute', 'archiveRoute']) {
    assert.equal(A.can('admin', a), true, a);
    assert.equal(A.can('lead', a), false, a);
    assert.equal(A.can('crew', a), false, a);
  }
  for (const a of ['me', 'bootstrap', 'getCrew', 'getSites', 'getRoutes']) assert.equal(A.can('crew', a), true, a);
  assert.equal(A.can('admin', 'dropTables'), false);
});
```

- [ ] **Step 3: Run it.** `npm test` → FAIL (`Cannot find module '../auth.js'`).

- [ ] **Step 4: Write `auth.js`**

```js
// Who is asking, and what may they do. PURE: every input arrives as data, so
// node tests it directly. Apps Script concatenates files into one scope; the
// module.exports line at the bottom is for node only.
var SNOW_AUTH = (function () {
  var ANYONE = ['me', 'bootstrap', 'getCrew', 'getSites', 'getRoutes'];
  var ADMIN = ['saveCrew', 'archiveCrew', 'saveSite', 'archiveSite', 'saveRoute', 'archiveRoute'];

  function find(rows, col, value) {
    for (var i = 1; i < rows.length; i++) if (String(rows[i][col]) === value) return rows[i];
    return null;
  }

  function resolveRole(o) {
    var token = String(o.token || '').trim();
    if (!token) return { ok: false, code: 'signin', reason: 'Sign in' };
    var s = find(o.sessions, 0, token);
    if (!s) return { ok: false, code: 'signin', reason: 'Sign in' };
    var expires = s[4] ? new Date(s[4]) : null;
    if (expires && expires < o.now) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.' };
    var pid = String(s[1]);
    // Re-read the profile every time: approval can be pulled after the token was issued.
    var p = find(o.profiles, 0, pid);
    if (!p) return { ok: false, code: 'signin', reason: 'Profile no longer exists' };
    if (String(p[3]) !== 'approved') return { ok: false, code: 'signin', reason: 'Profile is not approved' };
    var name = String(p[1]);
    var c = (o.crew || []).filter(function (x) { return String(x.profile_id) === pid && x.archived !== true; })[0] || null;
    if (o.adminNames.indexOf(name) !== -1) return { ok: true, role: 'admin', name: name, profile_id: pid, crew_id: c ? c.id : null };
    if (!c) return { ok: false, code: 'not_on_roster', name: name, reason: "You're signed in, but not on the snow crew yet. Ask Matt to add you." };
    return { ok: true, role: c.is_lead === true ? 'lead' : 'crew', name: name, profile_id: pid, crew_id: c.id };
  }

  function can(role, action) {
    if (ANYONE.indexOf(action) !== -1) return role === 'admin' || role === 'lead' || role === 'crew';
    if (ADMIN.indexOf(action) !== -1) return role === 'admin';
    return false;
  }

  return { resolveRole: resolveRole, can: can };
})();
if (typeof module !== 'undefined') module.exports = SNOW_AUTH;
```

- [ ] **Step 5:** `npm test` → PASS. Commit.

### Task 2: `roster.js` (pure): the allow-list, validation, revisions

**Interfaces:**
- `SNOW_ROSTER.PUBLIC_CREW_FIELDS`
- `crewFor(role, list) → list`: admin gets everything; others get the allow-list, non-archived only.
- `checkRev(current|null, incomingRev) → null | reason`
- `validate(kind: 'crew'|'site'|'route', rec, ctx: {crew, sites}) → string[]`

- [ ] **Step 1: Write `test/roster.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../roster.js');

const full = [
  { id: 'C01', name: 'Alex Test', phone: '555-0101', photo_thumb: 'data:image/jpeg;base64,AA', is_lead: true, profile_id: 'P2',
    weaknesses: 'SECRET-WEAK', traits: 'SECRET-TRAIT', smokes: true, keep_apart_from: ['C02'], valid_id: false,
    clearances: [{ site: 'SECRET-SITE' }], rev: 3, archived: false },
  { id: 'C09', name: 'Gone', phone: '555-0109', is_lead: false, archived: true, rev: 1 },
];
test('crew and lead get only the allow-listed fields, and no archived people', () => {
  for (const role of ['crew', 'lead']) {
    const out = R.crewFor(role, full);
    assert.deepEqual(out, [{ id: 'C01', name: 'Alex Test', phone: '555-0101', photo_thumb: 'data:image/jpeg;base64,AA', is_lead: true }]);
    const text = JSON.stringify(out);
    for (const s of ['SECRET', 'smokes', 'keep_apart', 'valid_id', 'profile_id', 'clearances']) assert.ok(!text.includes(s), s);
  }
});
test('admin gets every field and the archived', () => {
  assert.deepEqual(R.crewFor('admin', full), full);
});
test('rev: a save from the current revision passes; a stale one is refused', () => {
  assert.equal(R.checkRev({ rev: 3 }, 3), null);
  assert.match(R.checkRev({ rev: 4 }, 3), /changed this since you opened it/);
  assert.equal(R.checkRev(null, 0), null);                  // creating
  assert.match(R.checkRev(null, 2), /no longer exists/);    // edited something since deleted
});
test('validate: names required; a profile can be on the roster once; routes only use real sites', () => {
  assert.deepEqual(R.validate('crew', { id: 'C02', name: ' ' }, { crew: full }), ['Name is required']);
  assert.deepEqual(R.validate('crew', { id: 'C02', name: 'Sam', profile_id: 'P2' }, { crew: full }), ['That sign-in is already on the roster as Alex Test']);
  assert.deepEqual(R.validate('crew', { id: 'C01', name: 'Alex', profile_id: 'P2' }, { crew: full }), []);   // itself
  assert.deepEqual(R.validate('site', { id: 'S1', name: 'PAC' }, {}), []);
  assert.deepEqual(R.validate('route', { id: 'R1', name: 'N1', site_ids: ['S1', 'S9'] }, { sites: [{ id: 'S1' }] }), ['Unknown site S9']);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Write `roster.js`**

```js
// What may leave the backend, and whether a write is acceptable. PURE.
var SNOW_ROSTER = (function () {
  // The ONLY crew fields a lead or crew member ever receives. An allow-list:
  // a field added to the roster later stays private unless named here.
  var PUBLIC_CREW_FIELDS = ['id', 'name', 'phone', 'photo_thumb', 'is_lead'];

  function crewFor(role, list) {
    if (role === 'admin') return list;
    return list.filter(function (c) { return c.archived !== true; }).map(function (c) {
      var o = {};
      PUBLIC_CREW_FIELDS.forEach(function (k) { o[k] = c[k] === undefined ? null : c[k]; });
      return o;
    });
  }

  function checkRev(current, incomingRev) {
    var inc = Number(incomingRev || 0);
    if (!current) return inc === 0 ? null : 'That record no longer exists. Reload.';
    return inc === Number(current.rev || 0) ? null : 'Someone changed this since you opened it. Reload and try again.';
  }

  function validate(kind, rec, ctx) {
    var errs = [];
    if (!String(rec.name || '').trim()) errs.push('Name is required');
    if (kind === 'crew' && rec.profile_id) {
      var dup = (ctx.crew || []).filter(function (c) { return c.id !== rec.id && String(c.profile_id) === String(rec.profile_id) && c.archived !== true; })[0];
      if (dup) errs.push('That sign-in is already on the roster as ' + dup.name);
    }
    if (kind === 'route') {
      var ids = (ctx.sites || []).map(function (s) { return s.id; });
      (rec.site_ids || []).forEach(function (id) { if (ids.indexOf(id) === -1) errs.push('Unknown site ' + id); });
    }
    return errs;
  }

  return { PUBLIC_CREW_FIELDS: PUBLIC_CREW_FIELDS, crewFor: crewFor, checkRev: checkRev, validate: validate };
})();
if (typeof module !== 'undefined') module.exports = SNOW_ROSTER;
```

- [ ] **Step 4:** PASS. Commit.

### Task 3: `sheet.js` + `Code.js` (I/O), tested in a `vm` against fake books

**Storage, one shape for every record tab (`Crew`, `Sites`, `Routes`):**
`ID | Name | Rev | Archived | UpdatedAt | Json`. `Name` is there so the Sheet is readable by a person. `Json` holds the full record. `Audit` is `At | Who | Action | Target | Before | After`.

**Interfaces:** `doPost(e)` → `ContentService` JSON. Internally `handle_(req) → result`. `setup()` creates the tabs. Constants: `VERSION = 'foundation-1'`, `SNOW_SHEET_ID`, `INVENTORY_SHEET_ID = '1xxb6CJZnHSjEUYjPdHYtGHkjRZY02PHXkQXKAn--jUE'`, `ADMIN_NAMES = ['Matthew']`.

- [ ] **Step 1: Write `test/fake-apps-script.js`**
  - `FakeBook(sheets)`: `getSheetByName`, `insertSheet`.
  - `FakeSheet`: `getDataRange().getValues()`, `appendRow`, and `getRange(r, c, nr, nc).setValues(v)` / `setValue`. Every write is recorded on `book.writes`.
  - `SpreadsheetApp.openById(id)` returns the book registered for that id; an unknown id throws.
  - `LockService.getScriptLock()` returns `{waitLock() {}, releaseLock() {}}`, with an optional busy mode that throws.
  - `ContentService` is a pass-through that returns `{text, mime}`.
  - `Utilities.getUuid()` is a counter.
  - `loadBackend({snow, inventory})` runs `auth.js`, `roster.js`, `sheet.js` and `Code.js` in one `vm` context, the way Apps Script concatenates files, and returns the context.

- [ ] **Step 2: Write `test/api.test.js`.** Expected values are worked out in comments. Seed the Inventory book with Task 1's sessions and profiles, and the snow book via `setup()` plus rows for C01 (Alex, lead, P2, `weaknesses: 'SECRET-WEAK'`), C03 (Jordan, crew, P3) and site S1 PAC.
  - `setup() creates every tab with headers`: Crew, Sites, Routes and Audit, with the headers above.
  - `crew bootstrap carries no private field`: `handle_({token: 'tok-jordan', action: 'bootstrap'})` has `me.role === 'crew'`, sites `[PAC]`, and crew whose JSON contains no `SECRET`.
  - `admin bootstrap carries the private fields`: Matt sees `SECRET-WEAK`.
  - `not on roster`: Nina gets `{ok: false, code: 'not_on_roster'}`.
  - `lead cannot save crew`: `{ok: false, code: 'forbidden'}`, and **no write landed** on the snow book.
  - `save writes the row, bumps rev, and audits with who from the token`:
    - Matt calls `saveCrew` on C03 with `rev: 1` and `who: 'Forged'` in the body.
    - Expect the row's Rev to be 2, and a new Audit row with Who `Matthew` (not "Forged"), Action `saveCrew` and Target `C03`.
  - `stale save is refused`: a second `saveCrew` with `rev: 1` gives `{ok: false, code: 'conflict'}`.
  - `new crew id is past the highest`: a `saveCrew` with no id, while C01 and C03 exist, creates `C04`. That's `nextWorkerId` from the Crew Board, moved into `roster.js` with its test.
  - `the Inventory book is never written`: after every case above, `inventory.writes.length === 0`.
  - `every response carries the version`: `doPost` output JSON has `version: 'foundation-1'`.
  - `a busy lock gives up cleanly`: `{ok: false, code: 'busy'}`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Write `sheet.js`: `book_()`, `tab_(name)`, `readAll_(name)`, `writeRecord_(name, rec, who, action)` (find the row by ID; `before` = the old Json; rev + 1; UpdatedAt; then append to Audit), and `inventoryAuth_()`, which **only reads** `Sessions` and `Profiles`.
- [ ] **Step 5:** Write `Code.js`:
  - `handle_(req)` reads Inventory auth and the snow crew, calls `SNOW_AUTH.resolveRole` and `SNOW_AUTH.can` (refusal: `{code: 'forbidden', reason: 'Only Matt can do that.'}`), then dispatches.
  - Writes run under `LockService` (busy → `{code: 'busy', reason: 'Busy, try again.'}`) with `validate`, then `checkRev` (refusal → `code: 'conflict'`), then `writeRecord_`.
  - `doPost` wraps everything in try/catch → `{ok: false, code: 'error', reason}`, always adds `version`, and replies as `ContentService` JSON.
  - `doGet` returns `{ok: true, version}` only. It is a health check and carries no data.
- [ ] **Step 6:** PASS. Commit.

### Task 4: Backend mutation check

- [ ] `test-tools/mutation-check.js`, modeled on Inventory's. Each mutation must turn its named test red:
  - widen `PUBLIC_CREW_FIELDS` with `'weaknesses'`;
  - `can()` lets `lead` through an ADMIN action;
  - delete the expiry check;
  - read `who` from `req.who`;
  - skip `checkRev`;
  - remove the `approved` check.
- [ ] Run `npm run verify-tests` → all caught. Commit.

---

## Phone app: `C:\Users\skull\OneDrive\claudes room\Snow-App-repo`

### Task 5: Shell, API client, sign-in

**Files:** `index.html` (shell), `app.css`, `lib/api.js`, `lib/forms.js` (copied from Crew-Board-repo along with its tests), `lib/app.js`, `test/api-client.test.js`, `test/ui.spec.js`, `playwright.config.js`, `package.json`

**Interfaces:**
- `SnowApi.call(action, body?) → Promise<result>`:
  - POSTs `text/plain` JSON `{action, token, ...body}` to `SNOW_URL`;
  - always parses the body;
  - network failure → `{ok: false, code: 'network', reason: 'Not saved, try again.'}`;
  - `code: 'signin'` clears `titan-snow-token`;
  - flags `result.version !== EXPECTED_BACKEND`.
- `SnowApi.signIn(profileId, pin)` → Inventory's `verifyPin` (via the Inventory URL) → stores the token.
- `SnowApi.requestAccess(name, position, pin)` → Inventory's `requestProfile`.

- [ ] **Failing tests first** (Playwright, with `page.route` stubbing both URLs). Each must be RED before its code exists:
  - signed-out → the sign-in screen;
  - a good PIN → the home screen showing sites, and the token stored under `titan-snow-token`;
  - `not_on_roster` → its own screen, with the name and "Ask Matt to add you";
  - an expired token mid-session → back to sign-in with "Sign in again";
  - a backend `version` mismatch → the "Backend out of date" banner;
  - a network failure on load → "Couldn't reach the server", never a blank screen;
  - **the request body is `text/plain` JSON and carries the token** (asserted on the request, as Inventory's front-end tests do).
- [ ] Implement, get to green, and commit.

### Task 6: Home, roster, sites and routes editors (role-gated)

- [ ] **Failing tests first:**
  - crew and lead see sites and routes, with **no Roster tab**;
  - admin sees Roster, Sites and Routes;
  - the roster form saves through `saveCrew` with the record's `rev`;
  - a `conflict` reply shows "Someone changed this… Reload" and **does not** show the edit as saved;
  - a `forbidden` reply rolls back;
  - a photo becomes a ≤160 px thumbnail (the Crew Board test, moved over);
  - the `profile_id` picker lists approved Inventory profiles by name. This needs a small read from Inventory `getProfiles`, admin token only. **Check before building that `getProfiles` returns names to an admin without exposing PINs.** If it doesn't, ledger a ruling and use typed names instead.
- [ ] Implement by moving the Crew Board's Crew tab, worker form and `forms.js` over. Then site and route forms (routes order their sites with up and down buttons, not drag).
- [ ] Green, then commit.

### Task 7: Service worker

- [ ] `sw.js`:
  - `CACHE_VERSION = 'titan-snow-shell-1'`;
  - cache-first for shell files only;
  - **network-only for `script.google.com`**;
  - on activate, delete only `titan-snow-shell-*` caches. **Never** another app's cache: they all share the `titanalaska.github.io` origin.
- [ ] Test: a Playwright check that a stubbed Apps Script response is never served from cache.
- [ ] Commit.

### Task 8: Review, Matt's setup steps, deploy

- [ ] A fresh whole-project review (most capable model). Fix the Critical and Important findings in one pass, each RED→GREEN.
- [ ] **Matt, one step at a time, with a screenshot after each:**
  1. Create a blank Google Sheet named "Snow App" and send its ID.
  2. Claude runs `clasp create` (standalone) and `clasp push`. Matt runs `setup` once in the editor and approves the access prompt, which needs Inventory-sheet read access.
  3. Deploy → New deployment → Web app, "Me" / "Anyone" → send the `/exec` URL.
- [ ] Claude checks `doGet` returns `{ok: true, version: 'foundation-1'}`, and that a junk-token `me` returns `code: 'signin'`.
- [ ] **Ask Matt before creating the public GitHub repo and pushing.** That is outward-facing. Then Pages, and the `/field-link` registry.
- [ ] Update CLAUDE.md (two new repos, the deploy rule "pushing is not deploying", and test counts) and memory.
