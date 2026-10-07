# Roster self-service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (Claude solo, 10/6/26 evening; no subagents were asked for). TDD: write the test, watch it fail, then the code. Never paste a code result into a test.

**Goal:** a new worker fills their own roster card (phone, picture, licence, ID, on call, smokes, can operate, seasons, gear) from their phone; Matt approves the Inventory request and taps Add to crew from Sidewalk's Roster tab; crew edit their own card from Tonight.

**Spec:** `docs/superpowers/specs/2026-10-06-roster-self-service-design.md` (read it first; the self fields, refusal words and reply shapes are fixed there).

**Tech:** backend Apps Script JS (`npm test`, `npm run verify-tests` in snow-app-script); phone ES5 (`npm run test:unit`, `npx playwright test` in Snow-App-repo). Branch `roster-self` in both repos (phone cut from origin/main).

## Global constraints

- `SELF_FIELDS = ['phone','photo_thumb','can_drive','valid_id','on_call','smokes','can_operate','seasons','gear']` in roster.js, exported; `OPERATE = ['blower','sweepster','bobcat','snowrator','shovel']`.
- Refusal words (exact): `Phone is 30 characters at most` · `That picture is too big` · `That picture is not a JPEG` · `Can operate lists blower, sweepster, bobcat, snowrator or shovel` · `Seasons must be a whole number` · `Gear must be own or needs issued` · `<Label> must be yes, no or not set` (labels: Can drive, Valid ID, On call, Smokes) · `An admin sign-in has no crew card`.
- `pending_card` reason: `Your card is in. Matt will add you to the crew.`
- Versions: `VERSION = 'roster-1'`, `EXPECTED_BACKEND: 'roster-1'`, `titan-snow-shell-27`; `lib/rosterui.js` in index.html after `lib/boardui.js`, before `lib/weather.js`, and in `SHELL`.

## Task 1: backend pure rules (roster.js, auth.js)

- [ ] Tests first (`test/roster.test.js`, `test/auth.test.js`): `selfCard` shape (id, name, pending, self fields; no weaknesses/rev; missing self field → null); `validateSelf(card)` each rule; `resolveRole` pending_card (name, profile_id, crew_id), archived pending → not_on_roster, not_on_roster carries profile_id; `can('saveMyCard')` for crew/lead/admin.
- [ ] Implement: `SELF_FIELDS`, `OPERATE`, `selfCard`, `validateSelf` (returns errs[]), `applySelf(stored, card)` (copies only present self fields); auth: pending check before the lead/crew return; `SELF = ['saveMyCard']` in `can`.
- [ ] Mutations in `test-tools/mutation-check.js`: pending check removed; photo limit raised; a non-self key copied; name copied from card.

## Task 2: backend action (Code.js)

- [ ] Tests first (`test/api.test.js` or new `test/selfcard.test.js`): the spec's backend list, word for word; Inventory never written; audit who.
- [ ] Implement: in `handle_`, after resolveRole: `if (req.action === 'saveMyCard' && !a.ok && (a.code === 'not_on_roster' || a.code === 'pending_card')) return saveMyCard_(a, req, crew);` before the `!a.ok` return; pending bootstrap/me reply (`pending_card` + `card`); `saveMyCard_` under `locked_`; admin refused; `crewFor` drops pending for non-admin; `post_` / `boardStanding_` / `offRoute_` byId without pending; `VERSION = 'roster-1'`.
- [ ] Mutations: admin not refused; stored fields overwritten by a missing key; pending reply leaks the whole record; crewFor leaks pending to crew; post lists pending.

## Task 3: phone

- [ ] `lib/api.js`: `approveProfile`, `rejectProfile`.
- [ ] `lib/rosterui.js`: `thumb`, `selfForm`, `pendingScreen`, `notOnRosterScreen`, `waitingHtml` + `onClick`; pure helpers `cardFromForm(values)` and `selfFieldsOf(card)` tested under node (`test/rosterui.test.js`).
- [ ] `lib/app.js`: load() routes; Tonight's Your card; renderRoster sections + grid without pending; `thumb` from SnowRosterUI; events delegated to `SnowRosterUI.onClick`.
- [ ] `lib/boardui.js`: pool without pending. `index.html`, `sw.js` (27), `lib/config.js` (roster-1).
- [ ] Playwright (`test/ui.spec.js`, fake backend gains `saveMyCard`, `pending_card`, Inventory approve/reject): the spec's phone list.
- [ ] Hand mutations (no verify-tests here): break the self-field list, the pending filter, the Approve token; each must go red.

## Task 4: verify and record

- [ ] Backend: `npm test`, `npm run verify-tests` (no SKIPPED). Phone: `npm run test:unit`, `npx playwright test`. Counts into the handoff.
- [ ] Commit both repos; update HANDOFF.md and memory; nothing deployed.
