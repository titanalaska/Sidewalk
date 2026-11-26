// Board bulk place, Task 4 (Matt, 11/18/26): Clear Board, Clear route, the confirm, Undo clear, on the Board tab.
// The real page over file://, a small fake backend with the server's reply shapes; boardBatch is test/boardbatch-fake.js, the same
// piece test/ui.spec.js uses, which applies the shared lib/boardbatch.js rules. Made-up names only (this repo is public).
//
// The world, worked on paper. Six crew C01..C06 (Ana, Ben, Cy, Dee, Eli, Fay Test); three live routes R1 "Night 1", R2 "Night 2",
// R3 "Night 3". Moves at 10/2 5 PM: C01 lead R1, C02 member R1, C03 lead R2. So:
//   R1 has 2 people (Ana LEAD, Ben), R2 has 1 (Cy LEAD), R3 is empty; Dee, Eli, Fay are unassigned (3 people).
//   Whole Board: "Take 3 people off 2 routes?"   R1: "Take 2 people off Night 1?"   R2: "Take 1 person off Night 2?"
// The page clock is 10/3 7:30 AM Alaska time, before the 9 AM cutover, so the shift now is night-2026-10-02 (CrewShiftLog.shiftFor).
// Clock rows (the "on the clock" line): K-1 C01 start at 3:00 AM, K-2 C03 start at 3:05 AM, both night-2026-10-02, neither ended.
//   An End shift tap on R1 covers C01 (1), on R2 covers C03 (1); a Start tap on R1 would cover Ben (1: Ana has started), on R2 nobody.
//   Whole Board: 1 + 1 = 2 are still on the clock; R1 alone: 1; with no rows at all: 0 (a Start tap would cover 3, which is NOT the count).
// Task 5, Add people… (pworld below): the same six, plus C07 "Gus Test" (a self-made card still pending) and C08 "Hal Test" (archived), neither
// ever listed. Dee (C04) was on Night 3 and taken off on 10/1, so she HAS been on a route; Eli (C05) and Fay (C06) never were; Fay is not on call.
// So Add people… lists, in this order:  "New: never on a route" 2 = Eli, then Fay (not on call goes last);  "Everyone else" 1 = Dee.
//   Search "ee" matches Dee only; "li" and "eli" match Eli only; "zzz" nothing. Night 3 (R3) is empty: no lead, so a ticked row offers Lead;
//   Night 1 (R1) has Ana as its lead: no Lead button there.
// The fake stamps a batch's rows with its own clock, w.now (the page's 7:30:00 unless a test moves it), never earlier than 1 ms after the
// newest Moves row. A Post is stamped w.now + 60 s.
const { test, expect } = require('./no-real-weather.js');
const { toScreen } = require('./crewtab.js'); // the admins' Crew tab: Crew, then the switch (bottom tabs, 11/25/26)
const path = require('path');
const url = require('url');
const B = require('../lib/board.js');
const boardBatchFake = require('./boardbatch-fake.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const NIGHT = 'night-2026-10-02';
const BATCH = /^B-[A-Za-z0-9]{6,40}$/;
const NAMES = { C01: 'Ana Test', C02: 'Ben Test', C03: 'Cy Test', C04: 'Dee Test', C05: 'Eli Test', C06: 'Fay Test' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const move = (n, worker, route, role) => ({ id: 'M' + n, at: '2026-10-02T17:00:00.000-08:00', worker, to_route: route, role, rev: 1 });
const clockRow = (n, crew, at) => ({ id: 'K-' + n, seq: n, shift_id: NIGHT, kind: 'start', crew_id: crew, name: NAMES[crew], route_id: 'R1', storm_id: 'ST-1',
  at, time_in: '', time_out: '', undoes: '', by_key: crew, by_name: NAMES[crew] });
const world = () => ({
  crew: Object.keys(NAMES).map((id) => ({ id, name: NAMES[id], rev: 1, pending: false, archived: false, on_call: true })),
  routes: [1, 2, 3].map((n) => ({ id: 'R' + n, name: 'Night ' + n, rev: 1, site_ids: [] })),
  sites: [], moves: [move(1, 'C01', 'R1', 'lead'), move(2, 'C02', 'R1', 'member'), move(3, 'C03', 'R2', 'lead')],
  storms: [START], clockRows: [], post: null, posts: [], now: new Date(CLOCK),
});

function fakeSnow(w) {
  return (body) => {
    const v = { version: 'machines-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: w.sites, routes: w.routes, zones: [], crew: w.crew, post: w.post, moves: w.moves, callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: [], ...v };
    if (body.action === 'getPost') return { ok: true, post: w.post, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: {}, reset: {}, posts: [], ...v };
      out.cursor.posts = 0; out.reset.posts = false;
      [['log', []], ['storms', w.storms], ['visits', []], ['trucks', []], ['sheets', []], ['clock', w.clockRows]].forEach(([t, rows]) => { out[t] = rows; out.cursor[t] = rows.length; out.reset[t] = true; });
      out.tail = { clock: w.clockRows.length ? w.clockRows[w.clockRows.length - 1].seq : null };
      return out;
    }
    if (body.action === 'addMove') {
      const rec = { ...body.record, id: 'M' + (w.moves.length + 1), rev: 1 };
      w.moves.push(rec);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'post') {
      const board = B.boardFrom(w.moves, w.routes, Object.fromEntries(w.crew.map((c) => [c.id, c])));
      const rec = { id: 'P' + (w.posts.length + 1), rev: 1, shift: body.shift, posted_at: new Date(w.now.getTime() + 60000).toISOString(), people: {},
        routes: w.routes.map((r) => ({ id: r.id, name: r.name, sites: [], lead: board.routes[r.id].lead, members: board.routes[r.id].members })) };
      w.posts.push(rec); w.post = rec;
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'boardBatch') return { ...boardBatchFake(w, body, { role: 'admin', now: w.now }), ...v };
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

// o.delay: ms to hold boardBatch replies. o.abortIf(body): drop the call before the server sees it (a lost signal).
// o.loseReply(body): the server DOES it, the reply is lost. o.forbid: boardBatch answers like a server without the action.
// o.refuse: boardBatch answers invalid with that reason. o.noShiftLog: the shift-log read never gets an answer (aborted).
// o.signinIf(body): boardBatch answers the expired-session reply (code signin) for that call.
async function open(page, w, o = {}) {
  const calls = [];
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    if (body.action === 'getShiftLog' && o.noShiftLog) return route.abort();
    if (o.abortIf && o.abortIf(body)) return route.abort();
    if (o.delay && body.action === 'boardBatch') await sleep(o.delay);
    const expired = o.signinIf && body.action === 'boardBatch' && o.signinIf(body);   // the server never sees an expired call
    let reply = expired ? { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', version: 'machines-1', action: 'boardBatch' } : fake(body);
    if (o.forbid && body.action === 'boardBatch') reply = { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', version: 'machines-1', action: 'boardBatch' };
    if (o.refuse && body.action === 'boardBatch') reply = { ok: false, code: 'invalid', reason: o.refuse, version: 'machines-1', action: 'boardBatch' };
    if (o.loseReply && o.loseReply(body)) return route.abort();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#post')).toBeVisible();
  return calls;
}
const batchCalls = (calls) => calls.filter((c) => c.body.action === 'boardBatch');
const moveCalls = (calls) => calls.filter((c) => c.body.action === 'addMove');
const rest = (body) => { const { token, action, ...r } = body; return r; };   // the request without the envelope
const backSettled = (page) => page.waitForFunction(() => !((history.state && history.state.snow) || []).length);
const toast = (page) => page.locator('#toast');
// The Add people view's own error line (final review F4). The dialog is in the browser's top layer: #toast paints UNDER it, so a toast
// can be "visible" to a locator and covered on screen. Every failure of the Add path is asserted here, and with a real hit test.
const pplErr = (page) => page.locator('#ppl_err');
const onTop = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q), r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, sel);
const chipsOf = (page, rid) => page.locator('[data-route="' + rid + '"] .chip');
const unassigned = (page) => page.locator('section.card:has(h2:text-is("Unassigned")) .chip');
const confirmClear = async (page) => { await expect(page.locator('#clr_go')).toBeVisible(); await page.click('#clr_go'); };
const GO = { clock: '#clr_clock', storm: '#clr_storm', post: '#clr_post' };

test('buttons: Clear Board in a row under the top row, Clear route only where somebody is, Add people… on every card', async ({ page }) => {
  const calls = await open(page, world());
  await expect(page.locator('#bulkrow')).toBeVisible();
  await expect(page.locator('#clearboard')).toBeVisible();
  await expect(page.locator('#clearboard')).toHaveText('Clear Board');
  await expect(page.locator('#bulkrow #clearedline')).toHaveCount(0);   // nothing cleared yet
  await expect(page.locator('[data-clearroute="R1"]')).toBeVisible();
  await expect(page.locator('[data-clearroute="R1"]')).toHaveText('Clear route');
  await expect(page.locator('[data-clearroute="R2"]')).toBeVisible();
  await expect(page.locator('[data-clearroute="R3"]')).toHaveCount(0);   // R3 is empty
  for (const r of ['R1', 'R2', 'R3']) {
    await expect(page.locator('[data-addpeople="' + r + '"]')).toBeVisible();
    await expect(page.locator('[data-addpeople="' + r + '"]')).toBeEnabled();
    await expect(page.locator('[data-addpeople="' + r + '"]')).toHaveText('Add people…');
  }
  const before = calls.length;
  await page.click('[data-addpeople="R3"]');   // opens the Add people view (Task 5) and sends nothing by itself
  await expect(page.locator('#ppl_list')).toBeVisible();
  expect(calls.length).toBe(before);
});

test('with nobody placed there is no Clear Board, no Clear route and no bulk row', async ({ page }) => {
  const w = world(); w.moves = [];
  await open(page, w);
  await expect(page.locator('#clearboard')).toHaveCount(0);
  await expect(page.locator('#bulkrow')).toHaveCount(0);
  await expect(page.locator('[data-clearroute]')).toHaveCount(0);
  await expect(page.locator('[data-addpeople]')).toHaveCount(3);
});

test('the confirm for the whole Board and for one route: the words, from this phone\'s copy', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator('#clr_q')).toHaveText('Take 3 people off 2 routes?');
  await expect(page.locator(GO.post)).toHaveText('The crew still sees the last Post until you tap Post.');
  await expect(page.locator(GO.storm)).toHaveText('A storm is open: people off the Board cannot tap until they are placed again.');
  await expect(page.locator('#clr_go')).toHaveText('Clear');
  await expect(page.locator('#dlgClose')).toHaveText('Cancel');
  // Cancel sends nothing
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  await page.click('[data-clearroute="R1"]');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator('#clr_q')).toHaveText('Take 2 people off Night 1?');
  await expect(page.locator(GO.post)).toBeVisible();
  await page.click('#dlgClose');
  await backSettled(page);
  await page.click('[data-clearroute="R2"]');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator('#clr_q')).toHaveText('Take 1 person off Night 2?');
  await page.click('#dlgClose');
  expect(batchCalls(calls)).toHaveLength(0);
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
});

test('the confirm says "1 person off 1 route" when that is all there is', async ({ page }) => {
  const w = world(); w.moves = [move(3, 'C03', 'R2', 'lead')];
  await open(page, w);
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator('#clr_q')).toHaveText('Take 1 person off 1 route?');
});

test('the clock line: N are still on the clock, 1 is, and no line when nobody is', async ({ page }) => {
  const w = world();
  w.clockRows = [clockRow(1, 'C01', '2026-10-03T03:00:00.000-08:00'), clockRow(2, 'C03', '2026-10-03T03:05:00.000-08:00')];
  await open(page, w);
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator(GO.clock)).toHaveText('2 are still on the clock. Tap End shift first, or their End has to be typed with Set shift.');
  await page.click('#dlgClose');
  await backSettled(page);
  await page.click('[data-clearroute="R1"]');   // only Ana is on the clock there, not Cy (R2)
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator(GO.clock)).toHaveText('1 is still on the clock. Tap End shift first, or their End has to be typed with Set shift.');
});

test('the clock line is absent when nobody is on the clock, even though a Start tap would cover people', async ({ page }) => {
  await open(page, world());   // no Clock rows: a Start would cover 3, an End covers nobody
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator(GO.clock)).toHaveCount(0);
});

test('the clock line says it could not check when the Clock rows were never read', async ({ page }) => {
  const w = world();
  w.clockRows = [clockRow(1, 'C01', '2026-10-03T03:00:00.000-08:00')];
  await open(page, w, { noShiftLog: true });
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator(GO.clock)).toHaveText('Couldn\'t check who is on the clock.');
  await expect(page.locator(GO.storm)).toHaveCount(0);   // the storm is unknown too: no claim either way
  await expect(page.locator(GO.post)).toBeVisible();
});

test('the storm line shows only while a storm is open', async ({ page }) => {
  const w = world(); w.storms = [];
  await open(page, w);
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toBeVisible();
  await expect(page.locator(GO.storm)).toHaveCount(0);
  await expect(page.locator(GO.post)).toBeVisible();
});

test('Clear Board: one boardBatch, no addMove, everyone under Unassigned, the server\'s count in the toast, and the Undo line', async ({ page }) => {
  const w = world();
  const calls = await open(page, w);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(1);
  expect(rest(bb[0].body)).toEqual({ kind: 'clear', route_id: null, batch: expect.stringMatching(BATCH) });
  expect(moveCalls(calls)).toHaveLength(0);
  await expect(unassigned(page)).toHaveCount(6);
  await expect(chipsOf(page, 'R1')).toHaveCount(0);
  await expect(chipsOf(page, 'R2')).toHaveCount(0);
  await expect(page.locator('#clearboard')).toHaveCount(0);   // nobody is placed
  await expect(page.locator('#clearedline')).toHaveText('Cleared 3 people');
  await expect(page.locator('#undoclear')).toBeVisible();
  await expect(page.locator('#undoclear')).toHaveText('Undo');
  expect(w.moves.filter((m) => m.batch === bb[0].body.batch)).toHaveLength(3);
});

test('Clear route: that route only, its own toast, the other route keeps its people', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('[data-clearroute="R1"]');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 2 people off Night 1');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(1);
  expect(rest(bb[0].body)).toEqual({ kind: 'clear', route_id: 'R1', batch: expect.stringMatching(BATCH) });
  await expect(chipsOf(page, 'R1')).toHaveCount(0);
  await expect(chipsOf(page, 'R2')).toHaveCount(1);
  await expect(page.locator('#clearboard')).toBeVisible();   // Cy is still placed
  await expect(page.locator('#clearedline')).toHaveText('Cleared 2 people');
  await expect(unassigned(page)).toHaveCount(5);
});

test('one person: "Took 1 person off the Board" and "Cleared 1 person"', async ({ page }) => {
  const w = world(); w.moves = [move(3, 'C03', 'R2', 'lead')];
  await open(page, w);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 1 person off the Board');
  await expect(page.locator('#clearedline')).toHaveText('Cleared 1 person');
});

test('Undo clear: survives a reload, sends the clear\'s batch id, puts the lead back as lead, then the line is gone', async ({ page }) => {
  const w = world();
  const calls = await open(page, w);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(page.locator('#clearedline')).toHaveText('Cleared 3 people');
  const clearBatch = batchCalls(calls)[0].body.batch;
  await backSettled(page);
  await page.reload();
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#clearedline')).toHaveText('Cleared 3 people');   // worked out from the Moves rows
  await page.click('#undoclear');
  await expect(toast(page)).toHaveText('Put 3 back.');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(2);
  expect(rest(bb[1].body)).toEqual({ kind: 'undo', clear: clearBatch, batch: expect.stringMatching(BATCH) });
  expect(bb[1].body.batch).not.toBe(clearBatch);
  await expect(page.locator('[data-route="R1"] .chip .lead')).toHaveCount(1);
  await expect(chipsOf(page, 'R1').first()).toContainText('Ana Test');
  await expect(chipsOf(page, 'R1').first().locator('.lead')).toHaveText('LEAD');
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
  await expect(chipsOf(page, 'R2')).toHaveCount(1);
  await expect(unassigned(page)).toHaveCount(3);
  await expect(page.locator('#clearedline')).toHaveCount(0);
  await expect(page.locator('#undoclear')).toHaveCount(0);
});

// Place a cleared person by hand with the one-person flow: tap the chip, tap Place here.
async function placeByHand(page, id, route) {
  await page.click('.chip[data-worker="' + id + '"]');
  await page.click('[data-place="' + route + '"][data-role="member"]');
  await expect(page.locator('[data-route="' + route + '"] .chip[data-worker="' + id + '"]')).toBeVisible();
}

test('Undo clear after one of the three was placed by hand: "Put 2 back. 1 was left as it is."', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(page.locator('#clearedline')).toBeVisible();
  await placeByHand(page, 'C01', 'R3');
  await expect(page.locator('#clearedline')).toHaveText('Cleared 3 people');   // still offered: two of them are unassigned
  await page.click('#undoclear');
  await expect(toast(page)).toHaveText('Put 2 back. 1 was left as it is.');
  await expect(chipsOf(page, 'R3')).toHaveCount(1);   // Ana stayed where she was put
  await expect(chipsOf(page, 'R1')).toHaveCount(1);   // Ben
  await expect(chipsOf(page, 'R2')).toHaveCount(1);   // Cy
  expect(batchCalls(calls)).toHaveLength(2);
});

test('Undo clear after two of the three were placed by hand: "Put 1 back. 2 were left as they are."', async ({ page }) => {
  await open(page, world());
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(page.locator('#clearedline')).toBeVisible();
  await placeByHand(page, 'C01', 'R3');
  await placeByHand(page, 'C02', 'R3');
  await page.click('#undoclear');
  await expect(toast(page)).toHaveText('Put 1 back. 2 were left as they are.');
  await expect(chipsOf(page, 'R3')).toHaveCount(2);
  await expect(chipsOf(page, 'R2')).toHaveCount(1);
});

test('Undo with nothing left to put back (another admin placed them all): "Nothing to put back", the Board redrawn from the server', async ({ page }) => {
  const w = world();
  await open(page, w);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(page.locator('#undoclear')).toBeVisible();
  // another admin places all three on R3 after this phone's last read
  const at = new Date(w.now.getTime() + 5000).toISOString();
  ['C01', 'C02', 'C03'].forEach((id, i) => w.moves.push({ id: 'X' + i, at, worker: id, to_route: 'R3', role: 'member', rev: 1 }));
  await page.click('#undoclear');
  await expect(toast(page)).toHaveText('Nothing to put back');
  await expect(chipsOf(page, 'R3')).toHaveCount(3);
  await expect(page.locator('#clearedline')).toHaveCount(0);
});

test('the Undo line goes after a Post', async ({ page }) => {
  const calls = await open(page, world());
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(page.locator('#clearedline')).toBeVisible();
  await page.click('#post');
  await page.locator('[data-shift]').first().click();
  await expect.poll(() => calls.filter((c) => c.body.action === 'post').length).toBe(1);
  await expect(page.locator('#crewsees')).toContainText('Crew sees');
  await expect(page.locator('#clearedline')).toHaveCount(0);
  await expect(page.locator('#undoclear')).toHaveCount(0);
});

test('busy: every Board button is disabled while the save is out, and a second tap on Clear sends nothing more', async ({ page }) => {
  const calls = await open(page, world(), { delay: 1200 });
  await page.click('#clearboard');
  await expect(page.locator('#clr_go')).toBeVisible();
  // two taps in the same instant: the first sends, the second finds the confirm already answered
  await page.evaluate(() => { const b = document.getElementById('clr_go'); b.click(); b.click(); });
  await expect(page.locator('#clearboard')).toBeDisabled();
  await expect(page.locator('#post')).toBeDisabled();
  await expect(page.locator('#callout')).toBeDisabled();
  await expect(page.locator('[data-clearroute="R1"]')).toBeDisabled();
  await expect(page.locator('[data-clearroute="R2"]')).toBeDisabled();
  for (const r of ['R1', 'R2', 'R3']) await expect(page.locator('[data-addpeople="' + r + '"]')).toBeDisabled();
  await expect(toast(page)).toHaveText('Took 3 people off the Board', { timeout: 5000 });
  expect(batchCalls(calls)).toHaveLength(1);
  // and Undo is locked while ITS save is out
  await page.click('#undoclear');
  await expect(page.locator('#undoclear')).toBeDisabled();
  await expect(page.locator('#post')).toBeDisabled();
  await expect(toast(page)).toHaveText('Put 3 back.', { timeout: 5000 });
  await expect(page.locator('#post')).toBeEnabled();
});

test('a failed Clear: "Not saved", the Board unchanged, and the same request again sends the SAME batch id; a different request gets a new one', async ({ page }) => {
  let aborts = 1;
  const calls = await open(page, world(), { abortIf: (b) => b.action === 'boardBatch' && aborts-- > 0 });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: no signal');
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
  await expect(page.locator('#clearboard')).toBeEnabled();
  await expect(page.locator('#clearedline')).toHaveCount(0);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(2);
  expect(bb[1].body.batch).toBe(bb[0].body.batch);
});

test('a failed Clear route, then a DIFFERENT request: a new batch id', async ({ page }) => {
  let aborts = 1;
  const calls = await open(page, world(), { abortIf: (b) => b.action === 'boardBatch' && aborts-- > 0 });
  await page.click('[data-clearroute="R1"]');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: no signal');
  await backSettled(page);
  await page.click('[data-clearroute="R2"]');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 1 person off Night 2');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(2);
  expect(bb[1].body.route_id).toBe('R2');
  expect(bb[1].body.batch).not.toBe(bb[0].body.batch);
});

test('a lost reply: the retry (same batch id) answers "Already saved" and the Board is redrawn from the server\'s rows', async ({ page }) => {
  const w = world();
  let lose = 1;
  const calls = await open(page, w, { loseReply: (b) => b.action === 'boardBatch' && lose-- > 0 });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: no signal');
  expect(w.moves.filter((m) => m.batch)).toHaveLength(3);   // it landed
  await expect(chipsOf(page, 'R1')).toHaveCount(2);         // the phone does not know
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Already saved');
  expect(w.moves.filter((m) => m.batch)).toHaveLength(3);   // nothing written twice
  expect(batchCalls(calls)[1].body.batch).toBe(batchCalls(calls)[0].body.batch);
  await expect(chipsOf(page, 'R1')).toHaveCount(0);
  await expect(unassigned(page)).toHaveCount(6);
});

test('a server that does not have the action yet: "Not saved: the server is not updated yet"', async ({ page }) => {
  await open(page, world(), { forbid: true });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: the server is not updated yet');
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
  await expect(page.locator('#clearboard')).toBeEnabled();
});

test('a refusal with a reason reads "Not saved: <reason>"', async ({ page }) => {
  await open(page, world(), { refuse: 'Pick a route' });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: Pick a route');
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
});

test('two admins: the server\'s count is in the toast (4, the confirm said 3), and the Board shows nobody placed', async ({ page }) => {
  const w = world();
  await open(page, w);
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toHaveText('Take 3 people off 2 routes?');
  // the other admin places Dee on R3 after this phone's read
  w.moves.push({ id: 'X1', at: new Date(w.now.getTime() - 60000).toISOString(), worker: 'C04', to_route: 'R3', role: 'member', rev: 1 });
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 4 people off the Board');
  await expect(page.locator('[data-route] .chip')).toHaveCount(0);
  await expect(unassigned(page)).toHaveCount(6);
  await expect(page.locator('#clearboard')).toHaveCount(0);
});

test('two admins: somebody already cleared it, so the server writes nothing: "Nobody to take off"', async ({ page }) => {
  const w = world(); w.moves = [move(3, 'C03', 'R2', 'lead')];
  await open(page, w);
  await page.click('#clearboard');
  w.moves.push({ id: 'X1', at: new Date(w.now.getTime() - 60000).toISOString(), worker: 'C03', to_route: null, role: null, rev: 1 });
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Nobody to take off');
  await expect(page.locator('[data-route] .chip')).toHaveCount(0);
  await expect(page.locator('#clearedline')).toHaveCount(0);   // nothing was cleared by this phone
});

test('a single move after a clear is never sorted before it: the server\'s rows can be LATER than this phone\'s clock', async ({ page }) => {
  // The clear's rows are stamped ten minutes after the page's clock (a phone whose clock runs behind). Ana (cleared, so under
  // Unassigned) is then placed with the one-person flow. Her move must sort AFTER the clear, or the replay puts her back off the Board.
  const w = world();
  w.now = new Date(Date.parse(CLOCK) + 10 * 60000);
  const calls = await open(page, w);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  const clearAt = Date.parse(w.moves.find((m) => m.batch).at);
  expect(clearAt).toBe(w.now.getTime());   // worked on paper: 7:40 AM, ten minutes ahead of the page
  await placeByHand(page, 'C01', 'R3');
  await expect(chipsOf(page, 'R3')).toHaveCount(1);
  await expect(unassigned(page)).toHaveCount(5);
  const mv = moveCalls(calls);
  expect(mv).toHaveLength(1);
  expect(Date.parse(mv[0].body.record.at)).toBeGreaterThan(clearAt);
  expect(Date.parse(mv[0].body.record.at)).toBeLessThanOrEqual(clearAt + 2000);   // just after it, not far
});

// The same rule for the other two doors a single move comes in by: the bottom bar's Unassign and Make lead, and Place on a roster worker card.
// The setup of the test above: a clear stamped ten minutes (7:40 AM) ahead of the page's 7:30 AM; the move's `at` must come after it.
async function clearedAhead(page, clearRoute) {
  const w = world();
  w.now = new Date(Date.parse(CLOCK) + 10 * 60000);
  const calls = await open(page, w);
  await page.click('[data-clearroute="' + clearRoute + '"]');
  await confirmClear(page);
  await expect(toast(page)).toContainText('Took 1 person off');
  const clearAt = Date.parse(w.moves.find((m) => m.batch).at);
  expect(clearAt).toBe(w.now.getTime());
  return { w, calls, clearAt };
}
const justAfter = (calls, clearAt) => {
  const mv = moveCalls(calls);
  expect(mv).toHaveLength(1);
  const at = Date.parse(mv[0].body.record.at);
  expect(at).toBeGreaterThan(clearAt);
  expect(at).toBeLessThanOrEqual(clearAt + 2000);
  return mv[0].body.record;
};

test("after a clear, the bottom bar's Unassign is stamped after the clear's rows",async ({ page }) => {
  const { calls, clearAt } = await clearedAhead(page, 'R2');   // Cy off; Ana (LEAD) and Ben stay on Night 1
  await page.click('.chip[data-worker="C01"]');
  await expect(page.locator('#bar [data-act="unassign"]')).toBeVisible();
  await page.click('#bar [data-act="unassign"]');
  await expect(unassigned(page)).toHaveCount(5);   // Cy, Dee, Eli, Fay, Ana
  await expect(chipsOf(page, 'R1')).toHaveCount(1);
  const rec = justAfter(calls, clearAt);
  expect(rec).toMatchObject({ worker: 'C01', to_route: null });
});

test("after a clear, the bottom bar's Make lead is stamped after the clear's rows",async ({ page }) => {
  const { calls, clearAt } = await clearedAhead(page, 'R2');
  await page.click('.chip[data-worker="C02"]');   // Ben, a member of Night 1
  await expect(page.locator('#bar [data-act="lead"]')).toBeVisible();
  await page.click('#bar [data-act="lead"]');
  await expect(page.locator('[data-route="R1"] .chip').first()).toContainText('Ben Test');
  await expect(page.locator('[data-route="R1"] .chip').first().locator('.lead')).toHaveText('LEAD');
  const rec = justAfter(calls, clearAt);
  expect(rec).toMatchObject({ worker: 'C02', to_route: 'R1', role: 'lead' });
});

test("after a clear, Place on a roster worker card is stamped after the clear's rows",async ({ page }) => {
  const { calls, clearAt } = await clearedAhead(page, 'R2');
  await toScreen(page, 'roster');
  await page.click('[data-open="C04"]');   // Dee, unassigned
  await page.selectOption('#w_route', 'R3');
  await page.click('#w_place');
  await expect(toast(page)).toHaveText('Dee Test placed on Night 3');
  const rec = justAfter(calls, clearAt);
  expect(rec).toMatchObject({ worker: 'C04', to_route: 'R3', role: 'member' });
  await page.click('nav [data-tab="board"]');
  await expect(chipsOf(page, 'R3')).toHaveCount(1);
  await expect(page.locator('[data-route="R3"] .chip')).toContainText('Dee Test');
});

// ---------- Task 5: Add people… ----------
const pworld = () => {
  const w = world();
  w.crew.push({ id: 'C07', name: 'Gus Test', rev: 1, pending: true, archived: false, on_call: true },
    { id: 'C08', name: 'Hal Test', rev: 1, pending: false, archived: true, on_call: true });
  w.crew.find((c) => c.id === 'C06').on_call = false;
  w.moves.push({ id: 'M4', at: '2026-10-01T10:00:00.000-08:00', worker: 'C04', to_route: 'R3', role: 'member', rev: 1 },
    { id: 'M5', at: '2026-10-01T10:30:00.000-08:00', worker: 'C04', to_route: null, role: null, rev: 1 });
  return w;
};
const openPpl = async (page, rid) => { await page.click('[data-addpeople="' + rid + '"]'); await expect(page.locator('#dlg')).toBeVisible(); };
const rowIds = (page) => page.locator('#ppl_list [data-person]').evaluateAll((els) => els.map((e) => e.dataset.person));
const tickedPpl = (page) => page.locator('#ppl_list [data-person] input:checked').evaluateAll((els) => els.map((e) => e.closest('[data-person]').dataset.person));
const tick = (page, id) => page.click('#ppl_list [data-person="' + id + '"] input');
const leadBtn = (page, id) => page.locator('#ppl_list [data-person="' + id + '"] [data-leadpick]');
const addBtn = (page) => page.locator('#ppl_add');

test('Add people: the list under two bars with counts, in the worked order; nobody on a route, no pending card, no archived card', async ({ page }) => {
  await open(page, pworld());
  await openPpl(page, 'R3');
  await expect(page.locator('#dlg h2').first()).toHaveText('Add people to Night 3');
  await expect(page.locator('#ppl_back')).toHaveText('‹ Back');
  await expect(page.locator('[data-pgrp="new"] h2')).toHaveText('New: never on a route');
  await expect(page.locator('[data-pgrp="new"] .grp-count')).toHaveText('2');
  await expect(page.locator('[data-pgrp="rest"] h2')).toHaveText('Everyone else');
  await expect(page.locator('[data-pgrp="rest"] .grp-count')).toHaveText('1');
  expect(await page.locator('#ppl_list [data-pgrp]').evaluateAll((els) => els.map((e) => e.dataset.pgrp))).toEqual(['new', 'rest']);
  expect(await rowIds(page)).toEqual(['C05', 'C06', 'C04']);   // Eli, Fay (not on call: last), then Dee in her own group
  await expect(page.locator('[data-person="C05"]')).toContainText('Eli Test');
  for (const gone of ['C01', 'C02', 'C03', 'C07', 'C08']) await expect(page.locator('[data-person="' + gone + '"]')).toHaveCount(0);
  await expect(page.locator('#ppl_q')).toHaveAttribute('placeholder', 'Search name');
  await expect(page.locator('#ppl_q')).toHaveAttribute('aria-label', 'Search name');
  await expect(addBtn(page)).toHaveText('Add ticked (0)');
  await expect(addBtn(page)).toBeDisabled();
  await expect(page.locator('#ppl_hidden')).toBeHidden();
  await expect(page.locator('[data-leadpick]')).toHaveCount(0);   // no tick, no Lead
  // the not-on-call row is greyed and still tickable
  await expect(page.locator('[data-person="C06"]')).toHaveClass(/\boff\b/);
  await expect(page.locator('[data-person="C05"]')).not.toHaveClass(/\boff\b/);
  await tick(page, 'C06');
  expect(await tickedPpl(page)).toEqual(['C06']);
});

test('Add people: tick two (Fay first), pick Eli as lead, Add: ONE boardBatch in tick order, no addMove, dialog closed, chips and toast', async ({ page }) => {
  const calls = await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C06');
  await page.click('#ppl_list [data-person="C05"] .grp-name');   // a tap on the name: the label hands it to the box
  expect(await tickedPpl(page)).toEqual(['C05', 'C06']);
  await expect(addBtn(page)).toHaveText('Add ticked (2)');
  await expect(addBtn(page)).toBeEnabled();
  await leadBtn(page, 'C05').click();
  expect(await tickedPpl(page)).toEqual(['C05', 'C06']);   // a tap on Lead did not untick the row
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 2 to Night 3');
  await expect(page.locator('#dlg')).toBeHidden();
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(1);
  expect(rest(bb[0].body)).toEqual({ kind: 'add', route_id: 'R3', workers: ['C06', 'C05'], lead: 'C05', batch: expect.stringMatching(BATCH) });
  expect(moveCalls(calls)).toHaveLength(0);
  await expect(chipsOf(page, 'R3')).toHaveCount(2);
  await expect(chipsOf(page, 'R3').first()).toContainText('Eli Test');
  await expect(chipsOf(page, 'R3').first().locator('.lead')).toHaveText('LEAD');
  await expect(chipsOf(page, 'R3').nth(1)).toContainText('Fay Test');
  await expect(unassigned(page)).toHaveCount(1);   // Dee
});

test('Add people: no lead picked sends lead null; one person reads "Added 1 to Night 3"', async ({ page }) => {
  const calls = await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 1 to Night 3');
  expect(rest(batchCalls(calls)[0].body)).toEqual({ kind: 'add', route_id: 'R3', workers: ['C05'], lead: null, batch: expect.stringMatching(BATCH) });
  await expect(chipsOf(page, 'R3').first().locator('.lead')).toHaveCount(0);   // a member
});

test('Add people: Lead buttons: none before a tick, one per ticked row, only the last pick pressed, none on a route that has a lead', async ({ page }) => {
  await open(page, pworld());
  await openPpl(page, 'R3');
  await expect(page.locator('[data-leadpick]')).toHaveCount(0);
  await tick(page, 'C05');
  await tick(page, 'C04');
  expect(await page.locator('[data-leadpick]').evaluateAll((els) => els.map((e) => e.dataset.leadpick))).toEqual(['C05', 'C04']);   // list order, ticked rows only
  await expect(leadBtn(page, 'C05')).toHaveText('Lead');
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'false');
  await leadBtn(page, 'C05').click();
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'true');
  await expect(leadBtn(page, 'C05')).toHaveText('LEAD ✓');
  await leadBtn(page, 'C04').click();   // a second pick moves the pick
  await expect(leadBtn(page, 'C04')).toHaveAttribute('aria-pressed', 'true');
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-leadpick][aria-pressed="true"]')).toHaveCount(1);
  await leadBtn(page, 'C04').click();   // a tap on the pressed one takes the pick back
  await expect(page.locator('[data-leadpick][aria-pressed="true"]')).toHaveCount(0);
  await expect(leadBtn(page, 'C04')).toHaveText('Lead');
  await page.click('#ppl_back');
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  await openPpl(page, 'R1');   // Night 1 has Ana as its lead
  await tick(page, 'C05');
  await tick(page, 'C06');
  await expect(page.locator('[data-leadpick]')).toHaveCount(0);
});

test('Add people: unticking the picked lead sends lead null', async ({ page }) => {
  const calls = await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await leadBtn(page, 'C05').click();
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'true');
  await tick(page, 'C05');   // off again
  await expect(page.locator('[data-leadpick]')).toHaveCount(0);
  await tick(page, 'C06');
  await tick(page, 'C05');   // on again: not pressed, the pick was dropped with the tick
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'false');
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 2 to Night 3');
  expect(rest(batchCalls(calls)[0].body)).toEqual({ kind: 'add', route_id: 'R3', workers: ['C06', 'C05'], lead: null, batch: expect.stringMatching(BATCH) });
});

test('Add people: search narrows the rows and the bars; a ticked row the search hides stays ticked and is sent', async ({ page }) => {
  const calls = await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await tick(page, 'C06');
  await page.fill('#ppl_q', 'ee');   // Dee only
  expect(await rowIds(page)).toEqual(['C04']);
  await expect(page.locator('[data-pgrp="new"]')).toHaveCount(0);
  await expect(page.locator('[data-pgrp="rest"] .grp-count')).toHaveText('1');
  await expect(page.locator('#ppl_hidden')).toBeVisible();
  await expect(page.locator('#ppl_hidden')).toHaveText('2 hidden by search');
  await expect(addBtn(page)).toHaveText('Add ticked (2)');
  await page.fill('#ppl_q', 'li');   // Eli: Fay is the hidden one
  expect(await rowIds(page)).toEqual(['C05']);
  await expect(page.locator('#ppl_hidden')).toHaveText('1 hidden by search');
  expect(await tickedPpl(page)).toEqual(['C05']);   // Eli's box comes back ticked from the state, not from the page
  await page.fill('#ppl_q', 'ELI');   // the query is not case sensitive
  expect(await rowIds(page)).toEqual(['C05']);
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 2 to Night 3');
  expect(rest(batchCalls(calls)[0].body).workers).toEqual(['C05', 'C06']);
});

test('Add people: a search with no match says so, and Clear brings the list back and empties the box', async ({ page }) => {
  await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C04');
  await page.fill('#ppl_q', 'zzz');
  await expect(page.locator('#ppl_nomatch')).toHaveText('No people match');
  await expect(page.locator('#ppl_reset')).toHaveText('Clear');
  await expect(page.locator('[data-person]')).toHaveCount(0);
  await expect(page.locator('#ppl_hidden')).toHaveText('1 hidden by search');
  await page.click('#ppl_reset');
  await expect(page.locator('#ppl_q')).toHaveValue('');
  expect(await rowIds(page)).toEqual(['C05', 'C06', 'C04']);
  expect(await tickedPpl(page)).toEqual(['C04']);
  await expect(page.locator('#ppl_hidden')).toBeHidden();
});

test('Add people: typing in the search box keeps the same box, its focus and its text', async ({ page }) => {
  await open(page, pworld());
  await openPpl(page, 'R3');
  await page.click('#ppl_q');
  await page.evaluate(() => { window.__q = document.getElementById('ppl_q'); });
  await page.keyboard.type('e');
  await page.keyboard.type('l');
  await page.keyboard.type('i');
  await expect(page.locator('#ppl_q')).toHaveValue('eli');
  expect(await rowIds(page)).toEqual(['C05']);
  const st = await page.evaluate(() => ({ same: document.getElementById('ppl_q') === window.__q, active: document.activeElement && document.activeElement.id,
    caret: window.__q.selectionStart }));
  expect(st).toEqual({ same: true, active: 'ppl_q', caret: 3 });
  // a tick keeps the focus where it was too (the box does not move to the top of the page)
  await tick(page, 'C05');
  expect(await page.evaluate(() => document.activeElement.type)).toBe('checkbox');
});

test('Add people: while the save is out the dialog stays, Add is disabled, a double tap sends one call, the ticks do not move', async ({ page }) => {
  const calls = await open(page, pworld(), { delay: 1200 });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await page.evaluate(() => { const b = document.getElementById('ppl_add'); b.click(); b.click(); });
  await expect(addBtn(page)).toBeDisabled();
  await expect(page.locator('#dlg')).toBeVisible();
  await page.click('#ppl_list [data-person="C06"] input', { force: true });   // a tick while saving changes nothing
  expect(await tickedPpl(page)).toEqual(['C05']);
  await expect(toast(page)).toHaveText('Added 1 to Night 3', { timeout: 5000 });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(batchCalls(calls)).toHaveLength(1);
  expect(batchCalls(calls)[0].body.workers).toEqual(['C05']);
});

test('Add people: a failed save keeps the dialog, the ticks, the lead and the search; the same request again keeps its batch id, a changed tick gets a new one', async ({ page }) => {
  let aborts = 2;
  const calls = await open(page, pworld(), { abortIf: (b) => b.action === 'boardBatch' && aborts-- > 0 });
  await openPpl(page, 'R3');
  await tick(page, 'C06');
  await tick(page, 'C05');
  await leadBtn(page, 'C05').click();
  await page.fill('#ppl_q', 'li');
  await addBtn(page).click();
  await expect(pplErr(page)).toBeVisible();
  await expect(pplErr(page)).toHaveText('Not saved: no signal');
  expect(await onTop(page, '#ppl_err')).toBe(true);
  await expect(toast(page)).toBeHidden();   // the dialog is open: the words are in the list, not in a toast under it
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(addBtn(page)).toBeEnabled();
  await expect(addBtn(page)).toHaveText('Add ticked (2)');
  await expect(page.locator('#ppl_q')).toHaveValue('li');
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'true');
  expect(await tickedPpl(page)).toEqual(['C05']);   // Fay is the one the search hides
  await expect(chipsOf(page, 'R3')).toHaveCount(0);
  await addBtn(page).click();   // the same request again
  await expect.poll(() => batchCalls(calls).length).toBe(2);
  await expect(pplErr(page)).toHaveText('Not saved: no signal');
  await expect(addBtn(page)).toBeEnabled();
  await page.fill('#ppl_q', '');
  await tick(page, 'C06');   // untick Fay: a different request
  await expect(pplErr(page)).toBeHidden();   // a tick clears the old error
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 1 to Night 3');
  await expect(pplErr(page)).toHaveText('');   // the try that saved left no error behind
  await expect(page.locator('#dlg')).toBeHidden();
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(3);
  expect(bb[1].body.batch).toBe(bb[0].body.batch);
  expect(rest(bb[1].body)).toEqual(rest(bb[0].body));
  expect(bb[0].body.workers).toEqual(['C06', 'C05']);
  expect(bb[2].body.batch).not.toBe(bb[0].body.batch);
  expect(bb[2].body.workers).toEqual(['C05']);
  expect(bb[2].body.lead).toBe('C05');
});

test('Add people: a lost reply, then Add again: "Already saved", written once, and the chips are on the route', async ({ page }) => {
  const w = pworld();
  let lose = 1;
  const calls = await open(page, w, { loseReply: (b) => b.action === 'boardBatch' && lose-- > 0 });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await tick(page, 'C06');
  await addBtn(page).click();
  await expect(pplErr(page)).toBeVisible();
  await expect(pplErr(page)).toHaveText('Not saved: no signal');
  expect(w.moves.filter((m) => m.batch)).toHaveLength(2);   // it landed
  await expect(chipsOf(page, 'R3')).toHaveCount(0);          // the phone does not know
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Already saved');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(w.moves.filter((m) => m.batch)).toHaveLength(2);   // nothing written twice
  expect(batchCalls(calls)[1].body.batch).toBe(batchCalls(calls)[0].body.batch);
  await expect(chipsOf(page, 'R3')).toHaveCount(2);
});

test('Add people: another admin placed one of them: "Added 1 to Night 3. 1 was already on a route and was left", and that chip is on the other route', async ({ page }) => {
  const w = pworld();
  await open(page, w);
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await tick(page, 'C06');
  w.moves.push({ id: 'X1', at: new Date(w.now.getTime() - 60000).toISOString(), worker: 'C06', to_route: 'R2', role: 'member', rev: 1 });
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 1 to Night 3. 1 was already on a route and was left');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(chipsOf(page, 'R3')).toHaveCount(1);
  await expect(page.locator('[data-route="R3"] .chip')).toContainText('Eli Test');
  await expect(page.locator('[data-route="R2"] .chip[data-worker="C06"]')).toBeVisible();
});

test('Add people: another admin placed all of them: "Nobody added. 2 were already on a route and were left", the dialog closes, the Board is the server\'s', async ({ page }) => {
  const w = pworld();
  await open(page, w);
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await tick(page, 'C06');
  const at = new Date(w.now.getTime() - 60000).toISOString();
  w.moves.push({ id: 'X1', at, worker: 'C05', to_route: 'R2', role: 'member', rev: 1 }, { id: 'X2', at, worker: 'C06', to_route: 'R2', role: 'member', rev: 1 });
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Nobody added. 2 were already on a route and were left');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(chipsOf(page, 'R2')).toHaveCount(3);
  await expect(chipsOf(page, 'R3')).toHaveCount(0);
});

test('Add people: one person already placed elsewhere reads "Nobody added. 1 was already on a route and was left"', async ({ page }) => {
  const w = pworld();
  await open(page, w);
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  w.moves.push({ id: 'X1', at: new Date(w.now.getTime() - 60000).toISOString(), worker: 'C05', to_route: 'R2', role: 'member', rev: 1 });
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Nobody added. 1 was already on a route and was left');
  await expect(page.locator('#dlg')).toBeHidden();
});

test('Add people: the route got a lead meanwhile: the toast says so and the picked person is a member', async ({ page }) => {
  const w = pworld();
  await open(page, w);
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await tick(page, 'C06');
  await leadBtn(page, 'C05').click();
  w.moves.push({ id: 'X1', at: new Date(w.now.getTime() - 60000).toISOString(), worker: 'C04', to_route: 'R3', role: 'lead', rev: 1 });
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 2 to Night 3. Night 3 already had a lead: Eli Test was added as a member');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(chipsOf(page, 'R3')).toHaveCount(3);
  await expect(chipsOf(page, 'R3').first()).toContainText('Dee Test');
  await expect(page.locator('[data-route="R3"] .chip .lead')).toHaveCount(1);
});

test('Add people: everyone placed reads "Everyone is placed": no search box, no Add button', async ({ page }) => {
  const w = pworld();
  w.moves.push(...['C04', 'C05', 'C06'].map((id, i) => ({ id: 'P' + i, at: '2026-10-02T18:00:00.000-08:00', worker: id, to_route: 'R3', role: 'member', rev: 1 })));
  await open(page, w);
  await openPpl(page, 'R3');
  await expect(page.locator('#ppl_none')).toHaveText('Everyone is placed');
  await expect(page.locator('#ppl_q')).toHaveCount(0);
  await expect(page.locator('#ppl_add')).toHaveCount(0);
  await expect(page.locator('#ppl_back')).toBeVisible();
  await page.click('#ppl_back');
  await expect(page.locator('#dlg')).toBeHidden();
});

test('Add people: Back and the phone\'s Back close the view and leave the Board as it was; reopening starts clean', async ({ page }) => {
  const calls = await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await leadBtn(page, 'C05').click();
  await page.fill('#ppl_q', 'li');
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  await expect(chipsOf(page, 'R3')).toHaveCount(0);
  expect(batchCalls(calls)).toHaveLength(0);
  await openPpl(page, 'R3');   // clean: no tick, no lead, no search
  await expect(page.locator('#ppl_q')).toHaveValue('');
  expect(await tickedPpl(page)).toEqual([]);
  expect(await rowIds(page)).toEqual(['C05', 'C06', 'C04']);
  await expect(addBtn(page)).toHaveText('Add ticked (0)');
  await tick(page, 'C05');
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#ppl_back');
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  await expect(chipsOf(page, 'R3')).toHaveCount(0);
  expect(batchCalls(calls)).toHaveLength(0);
});

test('Add people: opening it drops a chip selection (no bottom bar under the dialog), and the Lead buttons follow the Board as it is at each opening', async ({ page }) => {
  await open(page, pworld());
  await page.click('.chip[data-worker="C04"]');
  await expect(page.locator('#bar')).toBeVisible();
  await openPpl(page, 'R3');
  await expect(page.locator('#bar')).toHaveCount(0);
  await expect(page.locator('[data-place]')).toHaveCount(0);
  await tick(page, 'C05');
  await expect(page.locator('[data-leadpick]')).toHaveCount(1);   // Night 3 has no lead yet
  await page.click('#ppl_back');
  await backSettled(page);
  await page.click('.chip[data-worker="C04"]');
  await page.click('[data-place="R3"][data-role="lead"]');       // Dee becomes Night 3's lead by the one-person flow
  await expect(page.locator('[data-route="R3"] .chip .lead')).toHaveCount(1);
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await expect(page.locator('[data-leadpick]')).toHaveCount(0);    // decided from the Board now, not from the first opening
});

test('Add people: the one-person flow still works after the view is closed (tap a chip, Place here: one addMove, no boardBatch)', async ({ page }) => {
  const calls = await open(page, pworld());
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await page.click('#ppl_back');
  await backSettled(page);
  await placeByHand(page, 'C06', 'R3');
  expect(moveCalls(calls)).toHaveLength(1);
  expect(batchCalls(calls)).toHaveLength(0);
  await expect(chipsOf(page, 'R3')).toHaveCount(1);
});

test('Add people at 320 px with 65 unassigned: rows do not overflow, the Add bar is on screen, the list scrolls inside the view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const w = pworld();
  for (let i = 1; i <= 65; i++) w.crew.push({ id: 'Z' + String(i).padStart(3, '0'), name: 'Person Number ' + String(i).padStart(3, '0') + ' Longname', rev: 1, pending: false, archived: false, on_call: i % 7 !== 0 });
  await open(page, w);
  await openPpl(page, 'R3');
  expect(await page.locator('#ppl_list [data-person]').count()).toBe(68);
  await expect(page.locator('[data-pgrp="new"] .grp-count')).toHaveText('67');
  await tick(page, 'Z001');
  await expect(leadBtn(page, 'Z001')).toBeVisible();   // a ticked row with its Lead button, still inside the row
  const fits = await page.evaluate(() => {
    const sc = document.getElementById('ppl_scroll'), add = document.getElementById('ppl_add').getBoundingClientRect(), row = document.querySelector('[data-person="Z001"]');
    return { scrollW: [sc.scrollWidth, sc.clientWidth], page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      row: [row.scrollWidth, row.clientWidth], scrolls: sc.scrollHeight > sc.clientHeight + 200, addTop: add.top, addBottom: add.bottom, vh: window.innerHeight,
      addInScroller: sc.contains(document.getElementById('ppl_add')) };
  });
  expect(fits.scrollW[0]).toBeLessThanOrEqual(fits.scrollW[1]);
  expect(fits.page[0]).toBeLessThanOrEqual(fits.page[1]);
  expect(fits.row[0]).toBeLessThanOrEqual(fits.row[1]);
  expect(fits.scrolls).toBe(true);
  expect(fits.addInScroller).toBe(false);
  expect(fits.addTop).toBeGreaterThanOrEqual(0);
  expect(fits.addBottom).toBeLessThanOrEqual(fits.vh);
  // scroll the list to its end: the last row ends above the bar, the bar did not move
  const end = await page.evaluate(() => {
    const sc = document.getElementById('ppl_scroll'); sc.scrollTop = sc.scrollHeight;
    const rows = document.querySelectorAll('#ppl_list [data-person]'), last = rows[rows.length - 1].getBoundingClientRect(), bar = document.getElementById('ppl_add').getBoundingClientRect();
    return { lastBottom: last.bottom, barTop: bar.top, top: sc.scrollTop };
  });
  expect(end.top).toBeGreaterThan(200);
  expect(end.lastBottom).toBeLessThanOrEqual(end.barTop + 1);
  await expect(addBtn(page)).toBeInViewport();
});

// Both views write into the same #dlgIn: the route editor's Add sites view (lib/app.js editRoute) keeps its own handlers on it after it closes.
const siteWorld = () => { const w = pworld(); w.sites = [{ id: 'S1', name: 'Birch Court', address: '1 Elm St', customer: 'MOA', rev: 1 }]; return w; };
test('after Add people was opened and closed, the route editor\'s Add sites still works', async ({ page }) => {
  await open(page, siteWorld());
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await page.click('#ppl_back');
  await backSettled(page);
  await page.click('nav [data-tab="routes"]');
  await page.click('[data-edit="route:R1"]');
  await page.click('#r_pick');
  await expect(page.locator('[data-pick="S1"]')).toBeVisible();
  await page.click('[data-pick="S1"] input');
  await expect(page.locator('#pick_add')).toHaveText('Add ticked (1)');
  await page.fill('#pick_q', 'birch');
  await expect(page.locator('[data-pick="S1"]')).toBeVisible();
  await page.click('#pick_add');
  await expect(page.locator('#r_added')).toHaveText('1 added');
  await expect(page.locator('ol.sitelist.edit li')).toHaveCount(1);
});

test('after the route editor\'s Add sites was used, Add people still works (ticks, search, Lead, Add)', async ({ page }) => {
  const calls = await open(page, siteWorld());
  await page.click('nav [data-tab="routes"]');
  await page.click('[data-edit="route:R2"]');
  await page.click('#r_pick');
  await page.click('[data-pick="S1"] input');
  await page.click('#pick_add');
  await expect(page.locator('#r_added')).toBeVisible();
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  await page.click('nav [data-tab="board"]');
  await openPpl(page, 'R3');
  await page.fill('#ppl_q', 'e');
  await tick(page, 'C05');
  await leadBtn(page, 'C05').click();
  await expect(leadBtn(page, 'C05')).toHaveAttribute('aria-pressed', 'true');
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 1 to Night 3');
  expect(rest(batchCalls(calls)[0].body)).toEqual({ kind: 'add', route_id: 'R3', workers: ['C05'], lead: 'C05', batch: expect.stringMatching(BATCH) });
  await expect(chipsOf(page, 'R3').first().locator('.lead')).toHaveText('LEAD');
});

test('a single move right after a lone chip tap still shows Place here beside the bulk buttons', async ({ page }) => {
  await open(page, world());
  await page.click('.chip[data-worker="C04"]');
  await expect(page.locator('[data-place="R3"][data-role="member"]')).toBeVisible();
  await expect(page.locator('[data-clearroute="R1"]')).toBeVisible();
  await expect(page.locator('#clearboard')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test('at 320 px wide (' + scheme + ') the bulk row and a route card\'s button row do not overflow the card', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, world());
    await page.click('[data-clearroute="R1"]');
    await confirmClear(page);
    await expect(page.locator('#clearedline')).toBeVisible();   // now the row holds the Undo line AND Clear Board
    await expect(page.locator('#clearboard')).toBeVisible();
    const fits = await page.evaluate(() => {
      const one = (el) => ({ ok: el.scrollWidth <= el.clientWidth, sw: el.scrollWidth, cw: el.clientWidth });
      const row = document.getElementById('bulkrow');
      const out = { bulk: one(row), page: one(document.documentElement), rows: [] };
      document.querySelectorAll('.board-route').forEach((c) => { const r = c.querySelector('.routebulk'); out.rows.push({ card: one(c), row: r ? one(r) : null }); });
      return out;
    });
    expect(fits.bulk.ok, JSON.stringify(fits.bulk)).toBe(true);
    expect(fits.page.ok, JSON.stringify(fits.page)).toBe(true);
    expect(fits.rows).toHaveLength(3);
    for (const r of fits.rows) { expect(r.card.ok, JSON.stringify(r)).toBe(true); expect(r.row && r.row.ok, JSON.stringify(r)).toBe(true); }
  });
}

// ---------- Final review fix wave (11/18/26) ----------
const failAll = (b) => b.action === 'boardBatch';

// F4. At 320 px with 65 unassigned the dialog fills the screen: a toast under it is covered. The words must be in the list, on top.
test('F4: a failed Add ticked at 320 px with 65 unassigned says so in the list, visible and on top, and not in a toast', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const w = pworld();
  for (let i = 1; i <= 65; i++) w.crew.push({ id: 'Z' + String(i).padStart(3, '0'), name: 'Person Number ' + String(i).padStart(3, '0') + ' Longname', rev: 1, pending: false, archived: false, on_call: true });
  await open(page, w, { abortIf: failAll });
  await openPpl(page, 'R3');
  await tick(page, 'Z001');
  await addBtn(page).click();
  await expect(pplErr(page)).toBeVisible();
  await expect(pplErr(page)).toHaveText('Not saved: no signal');
  expect(await onTop(page, '#ppl_err')).toBe(true);
  await expect(pplErr(page)).toBeInViewport();
  await expect(toast(page)).toBeHidden();
  await expect(addBtn(page)).toBeEnabled();
});

test('F4: the other words a failure can carry (a server without the action) land in the list too', async ({ page }) => {
  await open(page, pworld(), { forbid: true });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await addBtn(page).click();
  await expect(pplErr(page)).toHaveText('Not saved: the server is not updated yet');
  expect(await onTop(page, '#ppl_err')).toBe(true);
  await expect(toast(page)).toBeHidden();
});

test('F4: the error goes away on the next tick, Lead pick, search key and Clear; a failed try shows it again', async ({ page }) => {
  await open(page, pworld(), { abortIf: failAll });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  const fail = async () => { await addBtn(page).click(); await expect(pplErr(page)).toHaveText('Not saved: no signal'); };
  await fail();
  await tick(page, 'C06');
  await expect(pplErr(page)).toBeHidden();
  await fail();
  await leadBtn(page, 'C05').click();
  await expect(pplErr(page)).toBeHidden();
  await fail();
  await page.fill('#ppl_q', 'zzz');   // a search key; nothing matches
  await expect(pplErr(page)).toBeHidden();
  await fail();
  await page.click('#ppl_reset');
  await expect(pplErr(page)).toBeHidden();
  await expect(page.locator('#ppl_q')).toHaveValue('');
});

test('F4: Back during the save, then a failure: the words go to the toast (the view is gone) and the list shows no error', async ({ page }) => {
  const calls = await open(page, pworld(), { delay: 1500, refuse: 'Pick a route' });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await addBtn(page).click();
  await expect.poll(() => batchCalls(calls).length).toBe(1);
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(toast(page)).toHaveText('Not saved: Pick a route', { timeout: 5000 });
  await expect(pplErr(page)).toHaveText('');
});

// The Clear paths keep the toast: their dialog is closed (Clear) or there is none (Undo) when the reply lands.
test('F4: Clear Board still says a failure in the toast, and nothing covers it', async ({ page }) => {
  await open(page, world(), { abortIf: failAll });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toHaveText('Not saved: no signal');
  expect(await onTop(page, '#toast')).toBe(true);
});

// F5. A session that expired while a bulk save was out: the sign-in screen, not a modal over it, and a Board that works afterwards.
// The Inventory fake that lets Matt sign in again; registered BEFORE the expiry so the sign-in screen's name list loads from it.
const inventoryForSignIn = (page) => page.route(isInv, async (route) => {
    const b = Object.fromEntries(new URL(route.request().url()).searchParams);   // Inventory's sign-in calls are GETs
    const reply = b.action === 'getProfiles' ? { profiles: [{ id: '1', name: 'Matthew', status: 'approved', hasPin: true }] }
      : b.action === 'verifyPin' ? { valid: true, success: true, id: 1, name: 'Matthew', status: 'approved', token: 'tok-matt' } : {};
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply) });
  });
// Counts the times the tab bar was shown from now on (sign-in hides it; a Board render would show it again).
const watchTabs = (page) => page.evaluate(() => {
  window.__tabsShown = 0;
  new MutationObserver(() => { if (!document.getElementById('tabs').hidden) window.__tabsShown++; }).observe(document.getElementById('tabs'), { attributes: true, attributeFilter: ['hidden'] });
});
const signInAgain = async (page) => {
  await expect(page.locator('#si_who option')).toHaveCount(2);
  await page.selectOption('#si_who', '1');
  await page.fill('#si_pin', '1111');
  await page.click('#si_go');
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#post')).toBeVisible();
};

test('F5: the session expires during Add ticked: the dialog is closed, the sign-in screen shows, no page error, and the Board works after signing in', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let n = 0;
  const calls = await open(page, pworld(), { signinIf: () => ++n === 1 });
  await inventoryForSignIn(page);
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await watchTabs(page);
  await addBtn(page).click();
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#tabs')).toBeHidden();      // no Board drawn under the sign-in screen: its tab bar and Sign out stay away
  await expect(page.locator('#signout')).toBeHidden();
  // Nothing drew the Board back over it, not even for a moment (the sign-in screen's own load can hide a late render's tab bar again).
  expect(await page.evaluate(() => window.__tabsShown), 'the tab bar came back after sign-in took over').toBe(0);
  await expect(page.locator('#si_err')).toHaveText('Session expired. Sign in again.');
  await signInAgain(page);
  // busy is not stuck: the Board's buttons are enabled and a Clear goes through
  await expect(page.locator('#clearboard')).toBeEnabled();
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  expect(errors).toEqual([]);
  expect(batchCalls(calls)).toHaveLength(2);
});

test('F5: the session expires during Clear Board: the sign-in screen shows, no page error, and the Board works after signing in', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let n = 0;
  await open(page, world(), { signinIf: () => ++n === 1 });
  await inventoryForSignIn(page);
  await page.click('#clearboard');
  await watchTabs(page);
  await confirmClear(page);
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#tabs')).toBeHidden();      // no Board drawn under the sign-in screen: its tab bar and Sign out stay away
  await expect(page.locator('#signout')).toBeHidden();
  // Nothing drew the Board back over it, not even for a moment (the sign-in screen's own load can hide a late render's tab bar again).
  expect(await page.evaluate(() => window.__tabsShown), 'the tab bar came back after sign-in took over').toBe(0);
  await signInAgain(page);
  await expect(page.locator('#clearboard')).toBeEnabled();
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  expect(errors).toEqual([]);
});

// F6. A failed request keeps its batch id only while a retry is plausible: the same request, within 5 minutes of the failure.
test('F6: fail, then succeed, then the SAME request again (after an Undo) sends a NEW batch id', async ({ page }) => {
  let aborts = 1;
  const calls = await open(page, world(), { abortIf: (b) => b.action === 'boardBatch' && aborts-- > 0 });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: no signal');
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  await page.click('#undoclear');
  await expect(toast(page)).toHaveText('Put 3 back.');
  await page.click('#clearboard');   // the very same request as the first: { kind: 'clear', route_id: null }
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  const bb = batchCalls(calls);
  expect(bb.map((c) => c.body.kind)).toEqual(['clear', 'clear', 'undo', 'clear']);
  expect(bb[1].body.batch).toBe(bb[0].body.batch);       // the retry kept it
  expect(bb[3].body.batch).not.toBe(bb[0].body.batch);   // the success dropped it
});

test('F6: fail, 6 minutes pass on the page clock, the same request again sends a NEW batch id', async ({ page }) => {
  let aborts = 1;
  const calls = await open(page, world(), { abortIf: (b) => b.action === 'boardBatch' && aborts-- > 0 });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: no signal');
  await page.clock.fastForward(6 * 60 * 1000);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(2);
  expect(bb[1].body.kind).toBe(bb[0].body.kind);
  expect(bb[1].body.route_id).toBe(bb[0].body.route_id);   // the same request
  expect(bb[1].body.batch).not.toBe(bb[0].body.batch);
});

test('F6: fail, 1 minute passes, the same request again keeps its batch id', async ({ page }) => {
  let aborts = 1;
  const calls = await open(page, world(), { abortIf: (b) => b.action === 'boardBatch' && aborts-- > 0 });
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Not saved: no signal');
  await page.clock.fastForward(60 * 1000);
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  const bb = batchCalls(calls);
  expect(bb).toHaveLength(2);
  expect(bb[1].body.batch).toBe(bb[0].body.batch);
});

// F7. A late Add reply must not close a dialog that is not the Add people view.
test('F7: Back during the save, a worker card opened meanwhile stays open when the reply lands; the toast shows and the Board is redrawn', async ({ page }) => {
  const calls = await open(page, pworld(), { delay: 2500 });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await addBtn(page).click();
  await expect.poll(() => batchCalls(calls).length).toBe(1);
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await backSettled(page);
  await toScreen(page, 'roster');
  await page.click('[data-open="C04"]');   // Dee's card: a dialog that can be opened while the save is out
  await expect(page.locator('#w_place')).toBeVisible();
  await expect(toast(page)).toHaveText('Added 1 to Night 3', { timeout: 6000 });
  await expect(page.locator('#w_place')).toBeVisible();   // still Dee's card
  await expect(page.locator('#dlg')).toBeVisible();
  await page.click('#dlgClose');
  await backSettled(page);
  await page.click('nav [data-tab="board"]');
  await expect(chipsOf(page, 'R3')).toHaveCount(1);
  await expect(page.locator('[data-route="R3"] .chip')).toContainText('Eli Test');
});

// F8. An archived person ticked on this phone: the server refuses the whole add by id. The list says who.
test('F8: a ticked person archived on another phone: "<Name> is no longer on the crew list", the name as text, nothing added', async ({ page }) => {
  const w = pworld();
  w.crew.find((c) => c.id === 'C05').name = 'Eli <b>Test</b>';
  const calls = await open(page, w);
  await openPpl(page, 'R3');
  await tick(page, 'C06');
  await tick(page, 'C05');
  w.crew.find((c) => c.id === 'C05').archived = true;   // archived elsewhere after this phone loaded: its list still has Eli
  await addBtn(page).click();
  await expect(pplErr(page)).toBeVisible();
  await expect(pplErr(page)).toHaveText('Not saved: Eli <b>Test</b> is no longer on the crew list. Untick them and try again.');
  await expect(pplErr(page).locator('b')).toHaveCount(0);
  expect(await onTop(page, '#ppl_err')).toBe(true);
  expect(batchCalls(calls)[0].body.workers).toEqual(['C06', 'C05']);
  expect(w.moves.filter((m) => m.batch)).toHaveLength(0);
  // Unticking them lets the rest go through.
  await tick(page, 'C05');
  await addBtn(page).click();
  await expect(toast(page)).toHaveText('Added 1 to Night 3');
});

test('F8: an id that is not a row in the list keeps the server\'s own words', async ({ page }) => {
  await open(page, pworld(), { refuse: 'Unknown worker C99' });
  await openPpl(page, 'R3');
  await tick(page, 'C05');
  await addBtn(page).click();
  await expect(pplErr(page)).toHaveText('Not saved: Unknown worker C99');
});

// F9. The Undo line's words sit level with the buttons in the same row.
test('F9: "Cleared N people" is vertically centred against the Undo button', async ({ page }) => {
  await open(page, world());
  await page.click('#clearboard');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Took 3 people off the Board');
  await placeByHand(page, 'C04', 'R3');   // the row now holds Clear Board, the words and Undo
  await expect(page.locator('#clearedline')).toBeVisible();
  const d = await page.evaluate(() => {
    const line = document.getElementById('clearedline'), rg = document.createRange();
    rg.selectNodeContents(line);
    const t = rg.getBoundingClientRect(), b = document.getElementById('undoclear').getBoundingClientRect();
    return { text: t.top + t.height / 2, button: b.top + b.height / 2, buttonH: b.height, textH: t.height };
  });
  expect(d.buttonH).toBeGreaterThan(d.textH + 4);   // the button really is the taller one, so the test can tell
  expect(Math.abs(d.text - d.button)).toBeLessThanOrEqual(1.5);
});

// Spanish everywhere (Matt 11/25/26): a toast that carries a route's name gets the name in a span of its own (lib/app.js
// holdNames), so the Spanish pass translates the words around it and never the name. World by hand: R1 renamed "Done Route"
// ("Done" is a row: Listo), Alex Test + Sam Sample on it: Clear route takes 2 people off.
test('Spanish: Clear route\'s toast reads Spanish and keeps the route name as typed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  const w = world();
  w.routes = w.routes.map((r) => (r.id === 'R1' ? { ...r, name: 'Done Route' } : r));
  await open(page, w);
  await page.click('[data-clearroute="R1"]');
  await confirmClear(page);
  await expect(toast(page)).toHaveText('Se quitó a 2 personas de Done Route');
  await expect(toast(page).locator('[data-no-es]')).toHaveText('Done Route');
});
