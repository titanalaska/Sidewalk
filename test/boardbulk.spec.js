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
// The fake stamps a batch's rows with its own clock, w.now (the page's 7:30:00 unless a test moves it), never earlier than 1 ms after the
// newest Moves row. A Post is stamped w.now + 60 s.
const { test, expect } = require('./no-real-weather.js');
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
    const v = { version: 'sitedone-1', action: body.action };
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
    let reply = fake(body);
    if (o.forbid && body.action === 'boardBatch') reply = { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', version: 'sitedone-1', action: 'boardBatch' };
    if (o.refuse && body.action === 'boardBatch') reply = { ok: false, code: 'invalid', reason: o.refuse, version: 'sitedone-1', action: 'boardBatch' };
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
const chipsOf = (page, rid) => page.locator('[data-route="' + rid + '"] .chip');
const unassigned = (page) => page.locator('section.card:has(h2:text-is("Unassigned")) .chip');
const confirmClear = async (page) => { await expect(page.locator('#clr_go')).toBeVisible(); await page.click('#clr_go'); };
const GO = { clock: '#clr_clock', storm: '#clr_storm', post: '#clr_post' };

test('buttons: Clear Board in a row under the top row, Clear route only where somebody is, Add people… on every card and doing nothing yet', async ({ page }) => {
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
  await page.click('[data-addpeople="R3"]');   // Task 5 wires it: today it does nothing
  await expect(page.locator('#dlg')).toBeHidden();
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
  await expect(page.locator('#clr_q')).toHaveText('Take 2 people off Night 1?');
  await expect(page.locator(GO.post)).toBeVisible();
  await page.click('#dlgClose');
  await backSettled(page);
  await page.click('[data-clearroute="R2"]');
  await expect(page.locator('#clr_q')).toHaveText('Take 1 person off Night 2?');
  await page.click('#dlgClose');
  expect(batchCalls(calls)).toHaveLength(0);
  await expect(chipsOf(page, 'R1')).toHaveCount(2);
});

test('the confirm says "1 person off 1 route" when that is all there is', async ({ page }) => {
  const w = world(); w.moves = [move(3, 'C03', 'R2', 'lead')];
  await open(page, w);
  await page.click('#clearboard');
  await expect(page.locator('#clr_q')).toHaveText('Take 1 person off 1 route?');
});

test('the clock line: N are still on the clock, 1 is, and no line when nobody is', async ({ page }) => {
  const w = world();
  w.clockRows = [clockRow(1, 'C01', '2026-10-03T03:00:00.000-08:00'), clockRow(2, 'C03', '2026-10-03T03:05:00.000-08:00')];
  await open(page, w);
  await page.click('#clearboard');
  await expect(page.locator(GO.clock)).toHaveText('2 are still on the clock. Tap End shift first, or their End has to be typed with Set shift.');
  await page.click('#dlgClose');
  await backSettled(page);
  await page.click('[data-clearroute="R1"]');   // only Ana is on the clock there, not Cy (R2)
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
  await expect(toast(page)).toContainText('Not saved');
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
  await expect(toast(page)).toContainText('Not saved');
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
  await expect(toast(page)).toContainText('Not saved');
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
