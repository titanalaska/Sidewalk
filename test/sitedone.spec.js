// Site done / Site treated (Matt, 11/13/26): two buttons on each Storm-tab site card, the folded line a tap leaves, Show walks and one Undo.
// The real page over file://, a small fake backend with the server's reply shapes (the tapSite / undoSiteTap part is test/sitetap-fake.js,
// shared with test/ui.spec.js, and calls the same lib/shiftlog.js functions the server calls). Made-up sites only.
//
// The world, worked on paper. Birch Clinic (S1, "Curbs for the crew" ticked) has, by name (CrewShiftLog.walksFor):
//   Bay Z4 heated + new concrete | Front walk Z1 sidewalk | Ramp Z3 heated | Side walk Z2 sidewalk + new concrete | Stairs Z5 hand | curbs-1 (the "Curb - north" line)
//   (Pile Z7 is storage and Bed Z8 no_touch: never walks.)  Rows already in the Log: L-1 Z1 problem, L-2 Z5 treated.
//   Site done at S1 writes Z4 checked, Z3 checked, Z2 cleared (Z1 is a problem, Z5 treated, curbs-1 never): seq 3, 4, 5.
//   Then, of the 5 non-curb walks, Z2 Z3 Z4 Z5 are done: "4 of 5 walks done"; Z1 is a problem: "1 problem"; curbs-1 is open: "Curbs: 1 left".
//   Site treated at S1 after that would write only Z2 (cleared -> treated): Z1 problem, Z5 treated, heated never.
// Spruce Office (S2) has no zones: one "Whole site" walk. Cedar Hall (S3) is a No site (no crew_curbs) with a sidewalk and a "Curb - east" line.
// Every row the fake writes is stamped 7:50:18 AM Alaska time on 10/3.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');
const SL = require('../lib/shiftlog.js');
const siteTapFake = require('./sitetap-fake.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const STAMP = '2026-10-03T07:50:18.445-08:00';
const RING = [[-149.9, 61.2], [-149.8999, 61.2], [-149.8999, 61.2001], [-149.9, 61.2001]];
const zone = (id, site, name, type, extra) => ({ id, site_id: site, name, type, ring: RING, priority: false, note: '', rev: 1, ...(extra || {}) });
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const SNOWING = { id: 'ST-2', seq: 2, kind: 'snowing', storm_id: 'ST-1', at: '2026-10-03T06:10:00.000-08:00', by_name: 'Matthew' };
const logRow = (n, site, zoneId, state, extra) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02', site_id: site, zone_id: zoneId, state, note: '',
  by_key: 'C01', by_name: 'Alex Test', at: '2026-10-03T06:30:00.000-08:00', off_route: false, snowing_warned: false, undoes: null, batch: null, ...(extra || {}) });
const world = () => ({
  crew: [], moves: [], callouts: [], gear: [],
  routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2', 'S3'] }],
  sites: [{ id: 'S1', name: 'Birch Clinic', rev: 1, crew_curbs: true }, { id: 'S2', name: 'Spruce Office', rev: 1 }, { id: 'S3', name: 'Cedar Hall', rev: 1 }],
  zones: [
    zone('Z1', 'S1', 'Front walk', 'sidewalk'), zone('Z2', 'S1', 'Side walk', 'sidewalk', { new_concrete: true }),
    zone('Z3', 'S1', 'Ramp', 'heated'), zone('Z4', 'S1', 'Bay', 'heated', { new_concrete: true }),
    zone('Z5', 'S1', 'Stairs', 'hand'), zone('Z6', 'S1', 'Curb - north', 'hand'),
    zone('Z7', 'S1', 'Pile', 'storage'), zone('Z8', 'S1', 'Bed', 'no_touch'),
    zone('Z9', 'S3', 'Entry', 'sidewalk'), zone('Z10', 'S3', 'Curb - east', 'hand'),
  ],
  storms: [START],
  log: [logRow(1, 'S1', 'Z1', 'problem', { note: 'car on it' }), logRow(2, 'S1', 'Z5', 'treated')],
});

function fakeSnow(state, calls) {
  return (body) => {
    const v = { version: 'boardbulk-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: state.zones.filter((z) => z.archived !== true), ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: {}, reset: {}, posts: [], ...v };
      out.cursor.posts = 0; out.reset.posts = false;
      [['log', state.log], ['storms', state.storms], ['visits', []], ['trucks', []], ['sheets', []]].forEach(([t, rows]) => {
        const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0)), last = (body.last || {})[t];
        let reset = cur > rows.length;
        if (!reset && cur >= 1 && last != null && Number(rows[cur - 1].seq) !== Number(last)) reset = true;
        out[t] = rows.slice(reset ? 0 : cur).map((r) => (t === 'log' ? { ...r, by_profile: 'P1' } : r));
        out.cursor[t] = rows.length; out.reset[t] = reset;
      });
      return out;
    }
    const refuse = (code, reason) => ({ ok: false, code, reason, ...v });
    const storm = SL.stormState(state.storms);
    const view = (r) => ({ ...r, by_profile: 'P1' });
    if (body.action === 'tapSite' || body.action === 'undoSiteTap') return { ...siteTapFake(state, body, { storm, me, stamp: STAMP, view }), ...v };
    if (body.action === 'tapZone') {
      if (!storm.open) return refuse('invalid', 'No storm is open');
      const walk = SL.walksFor(body.site_id, SL.crewZones(state.zones, state.sites)).find((w) => w.zone_id === body.zone_id);
      if (!walk) return refuse('invalid', 'That zone is not walked at this site');
      const why = SL.checkTap({ walk, state: body.state, note: body.note });
      if (why) return refuse('invalid', why);
      const n = state.log.length + 1;
      const row = logRow(n, body.site_id, body.zone_id, body.state, { note: String(body.note || ''), by_key: 'admin', by_name: me.name, at: STAMP, snowing_warned: body.state === 'treated' && storm.snowing });
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
    }
    if (body.action === 'cleanAgain') {
      const why = SL.checkAgain(state.log, storm.storm_id, body.site_id);
      if (why) return refuse('invalid', why);
      const n = state.log.length + 1;
      const row = logRow(n, body.site_id, '*', 'again', { by_key: 'admin', by_name: me.name, at: STAMP });
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
    }
    return refuse('error', 'not in the fake: ' + body.action);
  };
}

// o.delay: ms to hold tapSite replies; o.abortIf(body): drop a call like a lost signal (still recorded first); o.lang.
async function openStorm(page, w, o = {}) {
  const calls = [];
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w, calls);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    if (o.abortIf && o.abortIf(body)) return route.abort();
    if (o.delay && body.action === 'tapSite') await new Promise((r) => setTimeout(r, o.delay));
    if (o.undoDelay && body.action === 'undoSiteTap') await new Promise((r) => setTimeout(r, o.undoDelay));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((lang) => { localStorage.setItem('titan-snow-token', 'tok-matt'); if (lang) localStorage.setItem('snow-lang', lang); }, o.lang || '');
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');
  await page.locator('[data-openroute="R1"]').click();
  await expect(page.locator('#liveBack')).toBeVisible();
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
  return calls;
}
const tapSiteCalls = (calls) => calls.filter((c) => c.body.action === 'tapSite');
const undoSiteCalls = (calls) => calls.filter((c) => c.body.action === 'undoSiteTap');
const BATCH = /^B-[A-Za-z0-9]{6,40}$/;
const btn = (page, site, kind) => page.locator('[data-sitetap="' + site + '"][data-kind="' + kind + '"]');
const parts = (page, site) => page.locator('[data-siteline="' + site + '"] .fold-part');
const walkRow = (page, key) => page.locator('[data-walkrow="' + key + '"]');

test('both buttons show, and Site done sends ONE tapSite with a batch id and writes what is left', async ({ page }) => {
  const w = world();
  const calls = await openStorm(page, w);
  // before any tap: both buttons, no folded line, and the walk list shows as it always did (R8)
  await expect(btn(page, 'S1', 'done')).toBeVisible();
  await expect(btn(page, 'S1', 'done')).toHaveText('Site done');
  await expect(btn(page, 'S1', 'treated')).toBeVisible();
  await expect(btn(page, 'S1', 'treated')).toHaveText('Site treated');
  await expect(page.locator('[data-siteline]')).toHaveCount(0);
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  const taps = tapSiteCalls(calls);
  expect(taps).toHaveLength(1);
  expect(taps[0].body).toMatchObject({ action: 'tapSite', site_id: 'S1', kind: 'done' });
  expect(taps[0].body.batch).toMatch(BATCH);
  // the server wrote Z4, Z3, Z2 (walksFor order), each under the batch
  expect(w.log.slice(2).map((r) => [r.zone_id, r.state, r.batch])).toEqual([['Z4', 'checked', taps[0].body.batch], ['Z3', 'checked', taps[0].body.batch], ['Z2', 'cleared', taps[0].body.batch]]);
  // 4 of 5 non-curb walks done, 1 problem, 1 curb item open, then the time
  await expect(parts(page, 'S1')).toHaveText(['4 of 5 walks done', '1 problem', 'Curbs: 1 left', '7:50 AM']);
  // nothing left for Site done; Site treated still has Z2 to treat
  await expect(btn(page, 'S1', 'done')).toHaveCount(0);
  await expect(btn(page, 'S1', 'treated')).toBeVisible();
  // the walk list is folded away
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
});

test('a curb item at Problem counts in the problems part, and is still a curb item left', async ({ page }) => {
  // L-3: the curb item (curbs-1) is a Problem. Site done writes Z4, Z3, Z2 as before. Problems = Z1 + curbs-1 = 2; curbs left = 1 (a problem is not done); non-curb walks done still 4 of 5.
  const w = world(); w.log.push(logRow(3, 'S1', 'curbs-1', 'problem', { note: 'ice' }));
  await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await expect(parts(page, 'S1')).toHaveText(['4 of 5 walks done', '2 problems', 'Curbs: 1 left', '7:50 AM']);
});

test('the site with no zones: Site done reads "All 1 walk done", no problems part, no curbs part', async ({ page }) => {
  const w = world();
  const calls = await openStorm(page, w);
  await btn(page, 'S2', 'done').click();
  await expect(parts(page, 'S2')).toHaveText(['All 1 walk done', '7:50 AM']);
  expect(tapSiteCalls(calls)).toHaveLength(1);
  expect(w.log.slice(2).map((r) => [r.site_id, r.zone_id, r.state])).toEqual([['S2', 'whole', 'cleared']]);
});

test('Show walks opens the list and Hide walks folds it; no new localStorage key', async ({ page }) => {
  await openStorm(page, world());
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  const keys = () => page.evaluate(() => Object.keys(localStorage).sort());
  const before = await keys();
  const toggle = page.locator('[data-showwalks="S1"]');
  await expect(toggle).toHaveText('Show walks');
  await toggle.click();
  await expect(toggle).toHaveText('Hide walks');
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
  await expect(walkRow(page, 'S1|Z4')).toBeVisible();
  // the folded line stays while the list is open
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  expect(await keys()).toEqual(before);
  await toggle.click();
  await expect(toggle).toHaveText('Show walks');
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
});

test('Undo sends ONE undoSiteTap with that batch and says what it undid', async ({ page }) => {
  const w = world();
  const calls = await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await page.locator('[data-undobatch]').click();
  await expect(page.locator('#toast')).toHaveText('Undone: 3 walks.');
  const undo = undoSiteCalls(calls), tap = tapSiteCalls(calls);
  expect(undo).toHaveLength(1);
  expect(undo[0].body).toMatchObject({ action: 'undoSiteTap', batch: tap[0].body.batch });
  // the fold goes, both buttons are back, the list shows again, and the three walks read as before
  await expect(page.locator('[data-siteline]')).toHaveCount(0);
  await expect(btn(page, 'S1', 'done')).toBeVisible();
  await expect(walkRow(page, 'S1|Z2')).toBeVisible();
  await expect(walkRow(page, 'S1|Z2').locator('.walk-last')).toContainText('Not done · Matthew');
  // the undo rows carry no batch
  expect(w.log.slice(5).map((r) => [r.zone_id, r.state, r.batch, r.undoes])).toEqual([['Z4', 'none', null, 'L-3'], ['Z3', 'none', null, 'L-4'], ['Z2', 'none', null, 'L-5']]);
});

test('Undo after a walk was tapped by hand keeps that walk and says so', async ({ page }) => {
  const w = world();
  await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await page.locator('[data-showwalks="S1"]').click();
  // a hand tap on the Ramp (Z3): Checked again, a newer row on that walk
  await page.locator('[data-walk="S1|Z3"][data-state="checked"]').click();
  await expect(walkRow(page, 'S1|Z3')).toContainText('Checked · Matthew · 7:50 AM');
  await page.locator('[data-undobatch]').click();
  // Z4 and Z2 undone (2); Z3 was tapped since and kept (1)
  await expect(page.locator('#toast')).toHaveText('Undone: 2 walks. 1 was tapped since and kept.');
  await expect(walkRow(page, 'S1|Z3').locator('.walk-last')).toContainText('Checked · Matthew');
  await expect(walkRow(page, 'S1|Z4').locator('.walk-last')).toContainText('Not done · Matthew');
});

test('Site treated while it is Snowing: the warning shows at once and the tap goes anyway (all new concrete: "sanded")', async ({ page }) => {
  const w = world(); w.storms.push(SNOWING);
  const calls = await openStorm(page, w, { delay: 700 });
  // S1: the only walk the tap would treat is Z2, new concrete -> "sanded anyway" (R7)
  await btn(page, 'S1', 'treated').click();
  await expect(page.locator('[data-sitetaprow="S1"] [data-warn]')).toHaveText("It's still snowing: sanded anyway");
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  const taps = tapSiteCalls(calls);
  expect(taps).toHaveLength(1);
  expect(taps[0].body).toMatchObject({ site_id: 'S1', kind: 'treated' });
  expect(w.log.slice(2).map((r) => [r.zone_id, r.state, r.snowing_warned])).toEqual([['Z2', 'treated', true]]);
  // the striped walk reads Sanded when the list is opened
  await page.locator('[data-showwalks="S1"]').click();
  await expect(walkRow(page, 'S1|Z2')).toContainText('Sanded · Matthew · 7:50 AM');
  await expect(walkRow(page, 'S1|Z2').locator('[data-warn]')).toHaveText("It's still snowing: sanded anyway");
});

test('Site treated while it is Snowing at a site with plain concrete says "treated anyway"', async ({ page }) => {
  const w = world(); w.storms.push(SNOWING);
  await openStorm(page, w, { delay: 700 });
  await btn(page, 'S3', 'treated').click();
  await expect(page.locator('[data-sitetaprow="S3"] [data-warn]')).toHaveText("It's still snowing: treated anyway");
  await expect(page.locator('[data-siteline="S3"]')).toBeVisible();
  await expect(page.locator('[data-siteline="S3"] .fold-part').first()).toHaveText('All 1 walk done');
});

test('a Site done lost to the network shows Retry, and Retry sends the SAME batch id', async ({ page }) => {
  const w = world(), net = { down: true };
  const calls = await openStorm(page, w, { abortIf: (b) => net.down && b.action === 'tapSite' });
  await btn(page, 'S1', 'done').click();
  const retry = page.locator('[data-retry="site:S1"]');
  await expect(retry).toBeVisible();
  await expect(page.locator('[data-sitetaprow="S1"] .walk-fail')).toContainText('Not saved: no signal');
  net.down = false;
  await retry.click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  const taps = tapSiteCalls(calls);
  expect(taps).toHaveLength(2);
  expect(taps[1].body.batch).toBe(taps[0].body.batch);
  expect(taps[1].body).toEqual(taps[0].body);
  expect(w.log).toHaveLength(5); // written once
});

test('a lost reply after the server wrote: Retry gets the stored rows back and writes nothing twice', async ({ page }) => {
  const w = world();
  let lose = true;
  const calls = await openStorm(page, w);
  // the first reply is dropped AFTER the server ran it (the signal went with the answer)
  await page.unroute(isSnow);
  const fake = fakeSnow(w, calls);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    const reply = JSON.stringify(fake(body));
    if (lose && body.action === 'tapSite') { lose = false; return route.abort(); }
    await route.fulfill({ contentType: 'application/json', body: reply });
  });
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-retry="site:S1"]')).toBeVisible();
  expect(w.log).toHaveLength(5);
  await page.locator('[data-retry="site:S1"]').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  expect(w.log).toHaveLength(5); // still five: the replay wrote nothing
  // The toast is hidden or says something else, never "Already done" (M8: the old check passed whenever the toast was hidden, and waited for nothing).
  await expect(page.locator('#toast')).not.toHaveText('Already done');
  await expect(parts(page, 'S1')).toHaveText(['4 of 5 walks done', '1 problem', 'Curbs: 1 left', '7:50 AM']);
});

test('two phones: a Site done after another phone did it all toasts Already done and shows the walks done', async ({ page }) => {
  const w = world();
  const calls = await openStorm(page, w);
  // another phone's batch lands in the Log after this phone loaded it
  w.log.push(logRow(3, 'S1', 'Z4', 'checked', { batch: 'B-otherphone1', at: STAMP }), logRow(4, 'S1', 'Z3', 'checked', { batch: 'B-otherphone1', at: STAMP }), logRow(5, 'S1', 'Z2', 'cleared', { batch: 'B-otherphone1', at: STAMP }));
  await expect(page.locator('[data-siteline]')).toHaveCount(0);
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('#toast')).toHaveText('Already done');
  const reply = tapSiteCalls(calls);
  expect(reply).toHaveLength(1);
  expect(w.log).toHaveLength(5); // nothing written
  // the poll that followed shows the other phone's walks done
  await expect(parts(page, 'S1')).toHaveText(['4 of 5 walks done', '1 problem', 'Curbs: 1 left', '7:50 AM']);
});

test('stale zones: a reply row for a walk this phone lacks reads the zones once', async ({ page }) => {
  const w = world();
  const calls = await openStorm(page, w);
  // Matt drew a new walk at S1 after this phone loaded its zones
  w.zones.push(zone('Z11', 'S1', 'Loading dock', 'sidewalk'));
  await expect(walkRow(page, 'S1|Z11')).toHaveCount(0);
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  await expect.poll(() => calls.filter((c) => c.body.action === 'getZones').length).toBe(1);
  await page.locator('[data-showwalks="S1"]').click();
  await expect(walkRow(page, 'S1|Z11')).toBeVisible();
  await expect(walkRow(page, 'S1|Z11')).toContainText('Cleared');
  // and a tap with nothing new on the phone's side asks for nothing more
  expect(calls.filter((c) => c.body.action === 'getZones')).toHaveLength(1);
});

test('Clean again brings both buttons back and the folded line goes', async ({ page }) => {
  const w = world();
  await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  await page.locator('[data-again="S1"]').click();
  await page.click('#ag_yes');
  await expect(page.locator('[data-siteline]')).toHaveCount(0);
  await expect(btn(page, 'S1', 'done')).toBeVisible();
  await expect(btn(page, 'S1', 'treated')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
});

test('a No site (curbs not for the crew): Site done writes the sidewalk only and the line has no curbs part', async ({ page }) => {
  const w = world();
  const calls = await openStorm(page, w);
  await btn(page, 'S3', 'done').click();
  await expect(parts(page, 'S3')).toHaveText(['All 1 walk done', '7:50 AM']);
  expect(tapSiteCalls(calls)).toHaveLength(1);
  expect(w.log.slice(2).map((r) => [r.site_id, r.zone_id, r.state])).toEqual([['S3', 'Z9', 'cleared']]);
});

test('Spanish: the buttons, the folded line, Show walks and the Undo toast', async ({ page }) => {
  await openStorm(page, world(), { lang: 'es' });
  await expect(btn(page, 'S1', 'done')).toHaveText('Sitio terminado');
  await expect(btn(page, 'S1', 'treated')).toHaveText('Sitio tratado');
  await btn(page, 'S1', 'done').click();
  await expect(parts(page, 'S1')).toHaveText(['4 de 5 recorridos terminados', '1 problema', 'Bordillos: faltan 1', '7:50 AM']);
  await expect(page.locator('[data-showwalks="S1"]')).toHaveText('Ver recorridos');
  await page.locator('[data-showwalks="S1"]').click();
  await expect(page.locator('[data-showwalks="S1"]')).toHaveText('Ocultar recorridos');
  await page.locator('[data-undobatch]').click();
  await expect(page.locator('#toast')).toHaveText('Deshecho: 3 recorridos.');
});

test('at 320 px the two buttons and the folded line sit inside the card with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openStorm(page, world());
  const inside = async () => page.evaluate(() => {
    const card = document.querySelector('[data-shiftsite="S1"]').getBoundingClientRect();
    const els = [...document.querySelectorAll('[data-shiftsite="S1"] .site-tap button, [data-shiftsite="S1"] .site-line button, [data-shiftsite="S1"] .site-line .fold-part')];
    return { n: els.length, ok: els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= card.left - 0.5 && r.right <= card.right + 0.5; }),
      scroll: document.documentElement.scrollWidth <= window.innerWidth };
  });
  expect(await inside()).toEqual({ n: 2, ok: true, scroll: true });
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  expect(await inside()).toEqual({ n: 4 + 1 + 2, ok: true, scroll: true }); // Site treated + 4 parts + Undo + Show walks
});

// ---------- the final whole-branch review (11/13/26) ----------
// A poll brings another phone's Site done in while this phone is in the middle of a walk. Paper: the partner's batch is Z4 checked, Z3 checked,
// Z2 cleared (seq 3-5), so siteBatch is standing and the list WOULD fold (4 of 5 walks done). Z2 has a Problem note box open on this phone.
const partnerBatch = (w) => w.log.push(logRow(3, 'S1', 'Z4', 'checked', { batch: 'B-otherphone1', at: STAMP }), logRow(4, 'S1', 'Z3', 'checked', { batch: 'B-otherphone1', at: STAMP }), logRow(5, 'S1', 'Z2', 'cleared', { batch: 'B-otherphone1', at: STAMP }));

test('I1: a Problem note box stays open when a poll brings in another phone\'s Site done', async ({ page }) => {
  const w = world();
  await openStorm(page, w);
  await page.locator('[data-walk="S1|Z2"][data-state="problem"]').click();
  await page.locator('[data-note="S1|Z2"]').fill('drain frozen');
  partnerBatch(w);
  await page.clock.runFor(21000); // the 20 s poll
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible(); // the batch is standing: the folded line is there
  await expect(page.locator('[data-note="S1|Z2"]')).toBeVisible();
  await expect(page.locator('[data-note="S1|Z2"]')).toHaveValue('drain frozen');
  await expect(page.locator('[data-showwalks="S1"]')).toHaveText('Hide walks');
  // the list is one list: shown whole while one walk is busy
  await expect(walkRow(page, 'S1|Z4')).toBeVisible();
  // Cancel the note: nothing busy any more, the list folds
  await page.locator('[data-cancelnote="S1|Z2"]').click();
  await expect(walkRow(page, 'S1|Z2')).toHaveCount(0);
  await expect(page.locator('[data-showwalks="S1"]')).toHaveText('Show walks');
});

test('I1: a walk tap that did not reach the server keeps its Retry on screen after Site done folds the list', async ({ page }) => {
  const w = world(), net = { down: true };
  const calls = await openStorm(page, w, { abortIf: (b) => net.down && b.action === 'tapZone' });
  await page.locator('[data-walk="S1|Z2"][data-state="cleared"]').click();
  await expect(page.locator('[data-retry="S1|Z2"]')).toBeVisible();
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  expect(tapSiteCalls(calls)).toHaveLength(1);
  // the failed walk is still there with its Retry
  await expect(page.locator('[data-retry="S1|Z2"]')).toBeVisible();
  await expect(walkRow(page, 'S1|Z2').locator('.walk-fail')).toContainText('Not saved: no signal');
  // a Retry that gets through leaves nothing busy, and the list folds
  net.down = false;
  await page.locator('[data-retry="S1|Z2"]').click();
  await expect(walkRow(page, 'S1|Z2')).toHaveCount(0);
});

test('M1: a redraw with the same Log does not ask siteBatch or siteTapWalks again; a new row does', async ({ page }) => {
  const w = world();
  await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  await page.evaluate(() => {
    window.__asked = { batch: 0, walks: 0 };
    const real = { b: CrewShiftLog.siteBatch, w: CrewShiftLog.siteTapWalks };
    CrewShiftLog.siteBatch = function () { window.__asked.batch++; return real.b.apply(this, arguments); };
    CrewShiftLog.siteTapWalks = function () { window.__asked.walks++; return real.w.apply(this, arguments); };
  });
  // Show walks / Hide walks redraw the whole tab with S.log untouched: 3 site cards, every answer already known.
  await page.locator('[data-showwalks="S1"]').click();
  await page.locator('[data-showwalks="S1"]').click();
  await expect(page.locator('[data-showwalks="S1"]')).toHaveText('Show walks');
  expect(await page.evaluate(() => window.__asked)).toEqual({ batch: 0, walks: 0 });
  // a row from another phone changes S.log: the questions are asked again (3 cards: siteBatch 3; walks 2 per card with a button)
  w.log.push(logRow(6, 'S2', 'whole', 'cleared'));
  await page.clock.runFor(21000);
  await expect(page.locator('[data-shiftsite="S2"]')).toContainText('Cleared');
  const after = await page.evaluate(() => window.__asked);
  expect(after.batch).toBeGreaterThanOrEqual(3);
  expect(after.walks).toBeGreaterThanOrEqual(2);
});

test('M2: a refused Undo clears itself once a newer row lands at the site', async ({ page }) => {
  const w = world();
  await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  w.log.splice(2); // the server does not know the batch (its rows are gone): Undo is refused, (the phone's Log stays at seq 5)
  await page.locator('[data-undobatch]').click();
  await expect(page.locator('[data-sitetaprow="S1"] .walk-fail')).toContainText('Not saved: That tap is not in this storm');
  // Paper: the refusal was made with the phone's Log at seq 5, so the row at seq 6 is newer. Rows 3-5 are other phones' hand taps.
  w.log.push(logRow(3, 'S1', 'Z4', 'checked'), logRow(4, 'S1', 'Z3', 'checked'), logRow(5, 'S1', 'Z2', 'cleared'), logRow(6, 'S1', 'Z2', 'treated'));
  await page.clock.runFor(21000);
  await expect(page.locator('[data-sitetaprow="S1"] .walk-fail')).toHaveCount(0);
});

test('M3: an Undo in flight at a site with no buttons left marks the row busy', async ({ page }) => {
  // Cedar Hall (S3): Site done clears its sidewalk, Site treated then treats it; after that neither button has a walk to write.
  // 11/14/26: this used to pass only when some other redraw happened to land while the Undo was out. That redraw was the snow
  // forecast: each api.weather.gov answer calls draw(), and this file never stubbed the weather, so real answers landed at
  // random. Under the full suite's load none landed in the window, and the row never showed busy (failed 3 of 4 full runs).
  // Now the weather is refused at once (its answers all land at page load), the page clock is run 5 s so every queued
  // forecast fetch has fired, and the reply is held 3 s: the busy row must come from the Undo itself, within 1 s.
  await page.route(/api\.weather\.gov/, (route) => route.abort());
  const w = world();
  await openStorm(page, w, { undoDelay: 3000 });
  await btn(page, 'S3', 'done').click();
  await expect(page.locator('[data-siteline="S3"]')).toBeVisible();
  await btn(page, 'S3', 'treated').click();
  await expect(btn(page, 'S3', 'treated')).toHaveCount(0);
  await expect(btn(page, 'S3', 'done')).toHaveCount(0);
  await expect(page.locator('[data-sitetaprow="S3"]')).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect(page.locator('[data-sitetaprow="S3"]')).toHaveCount(0);
  await page.locator('[data-siteline="S3"] [data-undobatch]').click();
  await expect(page.locator('[data-sitetaprow="S3"]')).toHaveAttribute('aria-busy', 'true', { timeout: 1000 });
  await expect(page.locator('#toast')).toHaveText('Undone: 1 walk.');
});

test('M4: Show walks does not outlive a new Site done (Clean again, then Site done folds the list again)', async ({ page }) => {
  const w = world();
  await openStorm(page, w);
  await btn(page, 'S1', 'done').click();
  await page.locator('[data-showwalks="S1"]').click();
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
  await page.locator('[data-again="S1"]').click();
  await page.click('#ag_yes');
  await expect(page.locator('[data-siteline]')).toHaveCount(0);
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-siteline="S1"]')).toBeVisible();
  await expect(page.locator('[data-showwalks="S1"]')).toHaveText('Show walks');
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
});

test('M5: an already-done replay polls at once, so another phone\'s undo shows without waiting 20 s', async ({ page }) => {
  const w = world();
  let lose = true;
  const calls = await openStorm(page, w);
  await page.unroute(isSnow);
  const fake = fakeSnow(w, calls);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    const reply = JSON.stringify(fake(body));
    if (lose && body.action === 'tapSite') { lose = false; return route.abort(); }
    await route.fulfill({ contentType: 'application/json', body: reply });
  });
  await btn(page, 'S1', 'done').click();
  await expect(page.locator('[data-retry="site:S1"]')).toBeVisible();
  expect(w.log).toHaveLength(5); // the server wrote Z4, Z3, Z2 (L-3..L-5), the reply was lost
  // meanwhile a partner undid the whole batch: three undo rows, seq 6-8
  w.log.push(logRow(6, 'S1', 'Z4', 'none', { undoes: 'L-3' }), logRow(7, 'S1', 'Z3', 'none', { undoes: 'L-4' }), logRow(8, 'S1', 'Z2', 'none', { undoes: 'L-5' }));
  await page.locator('[data-retry="site:S1"]').click();
  // the replay returns the three tap rows (already: true); the poll it starts brings the undo rows and the batch is gone. No clock advance.
  await expect(page.locator('[data-siteline]')).toHaveCount(0);
  await expect(btn(page, 'S1', 'done')).toBeVisible();
});

test('R4: a curbs-only No site shows Site done, and the tap writes its whole walk cleared', async ({ page }) => {
  const w = world();
  w.sites.push({ id: 'S4', name: 'Gravel Lot', rev: 1 }); // no crew_curbs: its one line is a curb the crew does not see
  w.routes[0].site_ids.push('S4');
  w.zones.push(zone('Z11', 'S4', 'Curb - west', 'hand'));
  const calls = await openStorm(page, w);
  await expect(btn(page, 'S4', 'done')).toBeVisible();
  await btn(page, 'S4', 'done').click();
  await expect(parts(page, 'S4')).toHaveText(['All 1 walk done', '7:50 AM']);
  expect(tapSiteCalls(calls)).toHaveLength(1);
  expect(w.log.slice(2).map((r) => [r.site_id, r.zone_id, r.state])).toEqual([['S4', 'whole', 'cleared']]);
});
