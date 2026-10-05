const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');

// Inventory: names and status only, like the real getProfiles (no PINs).
const PROFILES = [
  { id: 1, name: 'Matthew', status: 'approved', hasPin: true },
  { id: 3, name: 'Jordan Demo', status: 'approved', hasPin: true },
  { id: 4, name: 'Nina Nursery', status: 'approved', hasPin: true },
  { id: 6, name: 'New Ned', status: 'approved', hasPin: false },
  { id: 9, name: 'Pending Pat', status: 'pending', hasPin: true },
];
const TOKENS = { 'tok-matt': 'admin', 'tok-jordan': 'crew', 'tok-alex': 'lead' };

// A small fake of the snow backend, with the real reply shapes.
function fakeSnow(state, opts = {}) {
  return (body) => {
    const v = { version: opts.version || 'customer-1' };
    if (opts.expired && opts.expired.on) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    if (body.token === 'tok-nina') return { ok: false, code: 'not_on_roster', name: 'Nina Nursery', reason: "You're signed in, but not on the snow crew yet. Ask Matt to add you.", ...v };
    const role = TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    // Matt is not on the roster; Alex (C01) is the lead on the roster, Jordan (C03) crew.
    const me = { name: role === 'admin' ? 'Matthew' : role === 'lead' ? 'Alex Test' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : role === 'lead' ? 'C01' : 'C03' };
    state.moves = state.moves || []; state.callouts = state.callouts || []; state.gear = state.gear || []; state.posts = state.posts || [];
    if (body.action === 'bootstrap') {
      const crew = role === 'admin' ? state.crew : state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: !!c.is_lead }));
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones || [], crew, post: state.posts.at(-1) || null, ...v };
      if (role === 'admin') Object.assign(out, { moves: state.moves, callouts: state.callouts, gear: state.gear });
      return out;
    }
    // Pairings: the real backend's shapes (snow-app-script test/pairing.test.js).
    if (['getBoard', 'addMove', 'addGear', 'saveCallout', 'post'].includes(body.action) && role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
    if (body.action === 'getPost') return { ok: true, post: state.posts.at(-1) || null, ...v };
    // The real getZones: Matt gets archived zones too, everyone else live ones; site_id narrows it.
    if (body.action === 'getZones') {
      const zones = (state.zones || []).filter((z) => role === 'admin' || z.archived !== true).filter((z) => !body.site_id || z.site_id === body.site_id);
      return { ok: true, zones, ...v };
    }
    if (body.action === 'getBoard') return { ok: true, moves: state.moves, callouts: state.callouts, gear: state.gear, post: state.posts.at(-1) || null, ...v };
    if (body.action === 'addMove' || body.action === 'addGear') {
      const list = body.action === 'addMove' ? state.moves : state.gear;
      const rec = { ...body.record, id: (body.action === 'addMove' ? 'M' : 'G') + (list.length + 1), rev: 1 };
      list.push(rec);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'saveCallout') {
      const rec = { ...body.record, id: body.record.shift, rev: (body.record.rev || 0) + 1 };
      state.callouts = state.callouts.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'post') {
      const B = require('../lib/board.js'), H = require('../lib/history.js');
      const live = state.routes.filter((r) => !r.archived);
      const byId = Object.fromEntries(state.crew.map((c) => [c.id, c]));
      const board = B.boardFrom(state.moves, live, byId);
      const people = Object.fromEntries(state.crew.filter((c) => !c.archived).map((c) => {
        const w = H.shiftsWorked(state.callouts, c.id);
        return [c.id, { name: c.name, phone: c.phone || null, shifts: { night: w.night, day: w.day } }];
      }));
      const rec = { id: 'P' + (state.posts.length + 1), rev: 1, shift: body.shift, posted_at: new Date().toISOString(), people,
        routes: live.map((r) => ({ id: r.id, name: r.name, sites: (r.site_ids || []).map((id) => ({ id, name: (state.sites.find((s) => s.id === id) || {}).name })),
          lead: board.routes[r.id].lead, members: board.routes[r.id].members })) };
      state.posts.push(rec);
      return { ok: true, record: rec, ...v };
    }
    // The shift log: the real backend's reply shapes (snow-app-script test/shiftlog-api.test.js).
    // Rows are only ever appended; seq is the row's place in its tab. Crew and
    // lead rows are allow-listed (no by_profile, undoes null); Matt's are raw
    // (by_profile present, no undoes key on a tap). Refusals are {ok:false, code, reason}.
    if (['getShiftLog', 'tapZone', 'undoTap', 'stormAction', 'saveVisit', 'cleanAgain'].includes(body.action)) {
      const SL = require('../lib/shiftlog.js');
      state.log = state.log || []; state.storms = state.storms || []; state.visits = state.visits || [];
      const stamp = state.clock || '2026-10-03T07:50:18.445-08:00';
      const view = (row) => {
        if (role !== 'admin') return row;
        const { undoes, ...raw } = row;
        return { ...raw, by_profile: 'P1', ...(undoes ? { undoes } : {}) };
      };
      const refuse = (code, reason) => ({ ok: false, code, reason, ...v });
      if (body.action === 'getShiftLog') {
        const out = { ok: true, cursor: {}, reset: {}, ...v };
        // Route sheets (snow-app-script test/routesheet-api.test.js): trucks go to everyone (admin
        // rows are whole rows); the Sheets tab is Matt's only. A non-admin gets [] / cursor 0 / reset false.
        state.trucks = state.trucks || []; state.sheets = state.sheets || [];
        const tview = (row) => (role === 'admin' ? { ...row, by_profile: 'P1', rev: 1, archived: false } : row);
        [['log', state.log], ['storms', state.storms], ['visits', state.visits], ['trucks', state.trucks], ['sheets', role === 'admin' ? state.sheets : []]].forEach(([t, rows]) => {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0)), last = (body.last || {})[t];
          let reset = cur > rows.length;
          if (!reset && cur >= 1 && last != null && Number(rows[cur - 1].seq) !== Number(last)) reset = true;
          out[t] = rows.slice(reset ? 0 : cur).map(t === 'trucks' ? tview : t === 'sheets' ? (x) => x : view);
          out.cursor[t] = rows.length;
          out.reset[t] = reset;
        });
        // Posts (final review I1): Matt's poll carries every Post after his cursor, slimmed to what a sheet's
        // crew line reads (snow-app-script slimPost_): no phones, no shift counts, no site lists. Posts rows
        // have no seq, so only the cursor counts. Everyone else: none, cursor 0.
        if (role === 'admin') {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {}).posts) || 0)), reset = cur > state.posts.length;
          out.posts = state.posts.slice(reset ? 0 : cur).map((p) => ({ id: p.id, shift: p.shift, posted_at: p.posted_at,
            people: Object.fromEntries(Object.entries(p.people || {}).map(([id, x]) => [id, { name: String((x || {}).name || '') }])),
            routes: (p.routes || []).map((r) => ({ id: r.id, lead: r.lead || null, members: (r.members || []).slice(), truck: r.truck === undefined ? null : r.truck })) }));
          out.cursor.posts = state.posts.length; out.reset.posts = reset;
        } else { out.posts = []; out.cursor.posts = 0; out.reset.posts = false; }
        return out;
      }
      const storm = SL.stormState(state.storms);
      if (body.action === 'stormAction') {
        if (role === 'crew') return refuse('forbidden', 'Only Matt can do that.');
        const kind = body.kind;
        if (!['start', 'end', 'reopen', 'snowing', 'stopped', 'night_on'].includes(kind)) return refuse('invalid', 'Unknown storm control');
        if (kind === 'start' && storm.open) return refuse('invalid', 'End the storm first');
        if (kind === 'reopen' && storm.open) return refuse('invalid', 'The storm is already open');
        if (kind === 'reopen' && !storm.storm_id) return refuse('invalid', 'There is no storm to reopen');
        if (!['start', 'reopen'].includes(kind) && !storm.open) return refuse('invalid', 'No storm is open');
        const n = state.storms.length + 1, id = 'ST-' + n;
        const row = { id, seq: n, kind, storm_id: kind === 'start' ? id : storm.storm_id, at: stamp, by_name: me.name };
        state.storms.push(row);
        return { ok: true, record: view(row), ...v };
      }
      if (!storm.open) return refuse('invalid', 'No storm is open');
      // An undo names only the row (seq); a tap or a card names a site.
      if (body.action !== 'undoTap' && !state.sites.find((s) => s.id === body.site_id && !s.archived)) return refuse('invalid', 'Unknown site');
      if (body.action === 'saveVisit') {
        const n = state.visits.length + 1, eq = { blower: '', snowrator: '', bobcat: '', sweepster: '', ...(body.equipment || {}) };
        // by_key is the crew id, or 'admin' for Matt (who is not on the roster): the server's rule.
        const row = { id: 'V-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, by_key: me.crew_id || 'admin', by_name: me.name, at: stamp,
          depth_in: body.depth_in === undefined ? '' : body.depth_in, materials_used: body.materials_used || '', equipment: eq };
        state.visits.push(row);
        return { ok: true, record: view(row), ...v };
      }
      const n = state.log.length + 1;
      let row;
      // Clean again (Part B1): the server's rules -- Matt or a lead; something done in the current pass first.
      if (body.action === 'cleanAgain') {
        if (role === 'crew') return refuse('forbidden', "Only Matt or a route lead on tonight's Board can do that.");
        const why = SL.checkAgain(state.log, storm.storm_id, body.site_id);
        if (why) return refuse('invalid', why);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, zone_id: '*',
          state: 'again', note: '', by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: null };
      } else if (body.action === 'tapZone') {
        const walk = SL.walksFor(body.site_id, state.zones || []).find((w) => w.zone_id === body.zone_id);
        if (!walk) return refuse('invalid', 'That zone is not walked at this site');
        const why = SL.checkTap({ walk, state: body.state, note: body.note });
        if (why) return refuse('invalid', why);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, zone_id: body.zone_id,
          state: body.state, note: String(body.note || ''), by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false,
          // The server sets this from the switch: Treated while Snowing is saved, flagged.
          snowing_warned: body.state === 'treated' && storm.snowing, undoes: null };
      } else {
        const t = SL.undoTarget(state.log, storm.storm_id, body.seq);
        if (!t.ok) return refuse('conflict', t.reason);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: t.row.site_id, zone_id: t.row.zone_id,
          state: t.state, note: t.note, by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: t.row.id };
      }
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
    }
    // setTruck and retrySheets: the real reply shapes (snow-app-script reports for tasks 2 and 3).
    // setTruck: the server stamps who and when. The shift (final review C1): Matt names it and it must be one
    // on offer now (CrewTime.shiftChoices), else "Pick a shift"; a lead's is always the server's own shiftFor,
    // whatever is sent. A lead may set only the route the live Board has them leading. Crew never.
    if (body.action === 'setTruck') {
      const SL = require('../lib/shiftlog.js'), B = require('../lib/board.js'), T = require('../lib/time.js');
      if (role === 'crew') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const truck = typeof body.truck === 'string' ? body.truck.trim() : '';
      if (truck.length < 1 || truck.length > 20) return { ok: false, code: 'invalid', reason: 'A truck is 1 to 20 characters', ...v };
      const route = state.routes.find((r) => r.id === body.route_id && !r.archived);
      if (!route) return { ok: false, code: 'invalid', reason: 'Unknown route', ...v };
      if (role === 'lead') {
        const board = B.boardFrom(state.moves, state.routes.filter((r) => !r.archived), Object.fromEntries(state.crew.map((c) => [c.id, c])));
        if (board.routes[route.id].lead !== me.crew_id) return { ok: false, code: 'forbidden', reason: "Only Matt or that route's lead can set its truck.", ...v };
      }
      state.trucks = state.trucks || [];
      const stamp = state.clock || '2026-10-03T07:50:18.445-08:00', n = state.trucks.length + 1;
      if (role === 'admin' && !T.shiftChoices(stamp).includes(String(body.shift || ''))) return { ok: false, code: 'invalid', reason: 'Pick a shift', ...v };
      const row = { id: 'T-' + n, seq: n, route_id: route.id, shift_id: role === 'admin' ? body.shift : SL.shiftFor(stamp, state.storms || []), truck,
        by_key: me.crew_id || 'admin', by_name: me.name, at: stamp };
      state.trucks.push(row);
      const record = role === 'admin' ? { ...row, by_profile: 'P1', rev: 1, archived: false } : row;
      return { ok: true, record, ...v };
    }
    if (body.action === 'retrySheets') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      return { ...(opts.retryReply || { ok: true, storm_id: body.storm_id, failed: 1, owed: 1, scheduled: true }), ...v };
    }
    if (/^archive/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const tab = { archiveCrew: 'crew', archiveSite: 'sites', archiveRoute: 'routes', archiveZone: 'zones' }[body.action];
      const cur = (state[tab] || []).find((x) => x.id === body.id);
      if (!cur) return { ok: false, code: 'invalid', reason: 'Nothing to archive.', ...v };
      const rec = { ...cur, archived: true, rev: cur.rev + 1 };
      state[tab] = state[tab].filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (/^save/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      if (opts.saveReply) return { ...opts.saveReply, ...v };
      const tab = { saveCrew: 'crew', saveSite: 'sites', saveRoute: 'routes', saveZone: 'zones' }[body.action];
      state[tab] = state[tab] || [];
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      // The real saveSite: a site is saved with both unit keys (missing = blank, trimmed, text).
      if (tab === 'sites') rec.units = { bobcat: String(((body.record.units || {}).bobcat) || '').trim(), snowrator: String(((body.record.units || {}).snowrator) || '').trim() };
      // A fresh id per new record, as the real backend does (one fixed id let a
      // second new zone overwrite the first and hid nothing until the import test).
      if (!rec.id) rec.id = (tab === 'crew' ? 'C' : 'X') + (90 + (state._made = (state._made || 0) + 1));
      state[tab] = state[tab].filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'unknown action', ...v };
  };
}
const world = () => ({
  crew: [{ id: 'C01', name: 'Alex Test', phone: '555-0101', is_lead: true, rev: 1, profile_id: '2', weaknesses: 'slow starter' },
    { id: 'C03', name: 'Jordan Demo', phone: '555-0103', is_lead: false, rev: 1, profile_id: '3' }],
  sites: [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 }],
  routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
});

// delay: { action: ms } holds that action's reply; abortIf(body) drops a call
// the way a lost signal does (the call is still recorded first); hangIf(body)
// never answers it at all (Apps Script stuck, or a dead zone that never errors).
async function open(page, { token, snow, inv, abortSnow, clockAt, delay, abortIf, hangIf } = {}) {
  const calls = [];
  // Shift choices depend on the wall clock: pin it, never trust the test's hour.
  if (clockAt) await page.clock.install({ time: new Date(clockAt) });
  await page.route(isSnow, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ body, contentType: req.headers()['content-type'], method: req.method() });
    if (abortSnow || (abortIf && abortIf(body))) return route.abort();
    if (hangIf && hangIf(body)) return; // never fulfilled: only the page's own timeout ends it
    if (delay && delay[body.action]) await new Promise((r) => setTimeout(r, delay[body.action]));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, async (route) => {
    const p = Object.fromEntries(new URL(route.request().url()).searchParams);
    const out = inv ? inv(p) : p.action === 'getProfiles' ? { profiles: PROFILES } : {};
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  if (token) await page.addInitScript((t) => localStorage.setItem('titan-snow-token', t), token);
  await page.goto(PAGE);
  return calls;
}

test('signed out shows the sign-in screen; pending people can find their name', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  const names = await page.locator('#si_who option').allTextContents();
  expect(names).toEqual(['Choose your name', 'Jordan Demo', 'Matthew', 'New Ned', 'Nina Nursery', 'Pending Pat (waiting for approval)']);
});

test('a good PIN signs in, stores the token and lands on Tonight', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()),
    inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : p.action === 'verifyPin' && p.id === '3' && p.pin === '3333' ? { valid: true, success: true, id: 3, name: 'Jordan Demo', status: 'approved', token: 'tok-jordan' } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '3333');
  await page.click('#si_go');
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toContainText('PAC');
  expect(await page.evaluate(() => localStorage.getItem('titan-snow-token'))).toBe('tok-jordan');
  const boot = calls.find((c) => c.body.action === 'bootstrap');
  expect(boot.method).toBe('POST');
  expect(boot.contentType).toMatch(/^text\/plain/);
  expect(boot.body.token).toBe('tok-jordan');
});

test('a wrong PIN says how many tries are left', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()), inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '0000');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toHaveText('Wrong PIN. 4 tries left.');
});

test('approved in Inventory but not on the snow roster gets its own screen', async ({ page }) => {
  await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await expect(page.locator('#notroster')).toContainText('Nina Nursery');
  await expect(page.locator('#notroster')).toContainText('Ask Matt to add you');
});

test('an expired session goes back to sign-in and forgets the token', async ({ page }) => {
  await open(page, { token: 'tok-old', snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  expect(await page.evaluate(() => localStorage.getItem('titan-snow-token'))).toBeNull();
});

test('a backend version mismatch warns', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world(), { version: 'foundation-0' }) });
  // Visible, not just present: the banner's text is in the page even while hidden.
  await expect(page.locator('#verwarn')).toBeVisible();
  await expect(page.locator('#verwarn')).toContainText('Backend out of date');
});

test('a matching backend version shows no warning', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(page.locator('#verwarn')).toBeHidden();
});

test('no network on load is said plainly, with a retry', async ({ page }) => {
  await open(page, { token: 'tok-jordan', abortSnow: true });
  await expect(page.locator('main')).toContainText("Couldn't reach the server");
  await expect(page.locator('#retry')).toBeVisible();
});

test('crew see routes and sites but no roster or edit buttons', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="roster"]')).toHaveCount(0);
  await expect(page.locator('[data-edit]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('slow starter');
});

test('admin sees roster, sites and routes, with the private fields', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="roster"]')).toBeVisible();
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg')).toContainText('slow starter');
});

test('an admin save sends the revision and shows the saved record', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.fill('#f_phone', '555-0199');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const save = calls.find((c) => c.body.action === 'saveCrew');
  expect(save.body.record).toMatchObject({ id: 'C03', rev: 1, phone: '555-0199' });
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg')).toContainText('555-0199');
});

test('a conflict says reload and does not show the edit as saved', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { saveReply: { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.' } }) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.fill('#f_phone', '555-0199');
  await page.click('#f_save');
  await expect(page.locator('#f_err')).toContainText('Someone changed this');
  await page.keyboard.press('Escape');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg')).toContainText('555-0103');
  await expect(page.locator('#dlg')).not.toContainText('555-0199');
});

test('the sign-in picker on a roster record lists approved Inventory names', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  const opts = await page.locator('#f_profile option').allTextContents();
  expect(opts).toEqual(['No sign-in yet', 'Jordan Demo', 'Matthew', 'New Ned', 'Nina Nursery']);
  expect(await page.locator('#f_profile').inputValue()).toBe('3');
});

test('a photo becomes a small thumbnail in the record', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 1200, 900); return c.toDataURL('image/png').split(',')[1]; });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.locator('#f_photo').setInputFiles({ name: 'j.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#f_photo_msg')).toContainText('Photo ready');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const thumb = calls.find((c) => c.body.action === 'saveCrew').body.record.photo_thumb;
  expect(thumb.slice(0, 15)).toBe('data:image/jpeg');
  expect(thumb.length).toBeLessThan(30000);
});

test('the route editor orders sites and saves the order', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="routes"]');
  await page.click('[data-edit="route:R1"]');
  await page.selectOption('#r_add', 'S2');
  await page.click('#r_addbtn');
  await page.click('[data-up="1"]');
  await page.click('#r_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveRoute').body.record).toMatchObject({ id: 'R1', rev: 1, site_ids: ['S2', 'S1'] });
});

test('a refused save from a non-admin is shown, not swallowed', async ({ page }) => {
  // Defence in depth: even if an edit button leaked to a crew screen, the refusal must show.
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  const r = await page.evaluate(() => SnowApi.call('saveSite', { record: { id: 'S1', name: 'x', rev: 1 } }));
  expect(r).toMatchObject({ ok: false, code: 'forbidden' });
});

// ---------------- final review fixes ----------------
test('editing a worker keeps a sign-in link the picker cannot show', async ({ page }) => {
  // I1. Alex is linked to Inventory profile 2, which is not in the approved list
  // (pending, rejected, or the list failed to load). A phone-number fix must not unlink him.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C01"]');
  await page.click('#w_edit');
  expect(await page.locator('#f_profile').inputValue()).toBe('2');
  await page.fill('#f_phone', '555-0111');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveCrew').body.record.profile_id).toBe('2');
});

test('if the names cannot load, the sign-in link is left alone', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: () => ({ nope: true }) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await expect(page.locator('#f_profile')).toBeDisabled();
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveCrew').body.record.profile_id).toBe('3');
});

test('a double tap on Save sends one save', async ({ page }) => {
  // I2. Apps Script takes a second or two; the second tap must not create a duplicate.
  const calls = [];
  const snow = fakeSnow(world());
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    if (body.action === 'saveSite') await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: PROFILES }) }));
  await page.addInitScript(() => localStorage.setItem('titan-snow-token', 'tok-matt'));
  await page.goto(PAGE);
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:"]');
  await page.fill('#s_name', 'New Lot');
  await page.evaluate(() => { const b = document.getElementById('s_save'); b.click(); b.click(); });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.action === 'saveSite')).toHaveLength(1);
});

test('a first sign-in with no PIN yet claims one instead of spending a try', async ({ page }) => {
  // I3. New Ned is approved but has never set a PIN: verifyPin would count a failure.
  const invCalls = [];
  await open(page, { snow: fakeSnow(world()), inv: (p) => { invCalls.push(p.action);
    if (p.action === 'getProfiles') return { profiles: PROFILES };
    if (p.action === 'claimPin' && p.id === '6' && p.pin === '6666') return { valid: true, success: true, id: 6, name: 'New Ned', status: 'approved', token: 'tok-jordan' };
    return { valid: false, attemptsLeft: 5 }; } });
  await page.selectOption('#si_who', '6');
  await expect(page.locator('#signin')).toContainText('Choose a 4-digit PIN');
  await page.fill('#si_pin', '6666');
  await page.click('#si_go');
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toBeVisible();
  expect(invCalls).not.toContain('verifyPin');
});

test('a pending person is told they are waiting, without spending a try', async ({ page }) => {
  const invCalls = [];
  await open(page, { snow: fakeSnow(world()), inv: (p) => { invCalls.push(p.action); return p.action === 'getProfiles' ? { profiles: PROFILES } : { valid: false, attemptsLeft: 5 }; } });
  await page.selectOption('#si_who', '9');
  await page.fill('#si_pin', '9999');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toContainText('waiting for Matt');
  expect(invCalls).not.toContain('verifyPin');
});

test('a session that expires during a save says sign in again', async ({ page }) => {
  // M6, raised to Important. The token died while the dialog was open.
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { saveReply: { ok: false, code: 'signin', reason: 'Session expired. Sign in again.' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
});

test('after a conflict the app reloads the latest, so the retry can save', async ({ page }) => {
  // M7, raised to Important. Someone else saved S1 (now rev 2). Our first save
  // conflicts; the retry must carry rev 2 and show their change.
  const state = world();
  let first = true;
  const base = fakeSnow(state);
  const calls = await open(page, { token: 'tok-matt', snow: (b) => {
    if (b.action === 'saveSite' && first) {
      first = false;
      state.sites = state.sites.map((s) => (s.id === 'S1' ? { ...s, rev: 2, notes: 'theirs' } : s));
      return { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.', version: 'customer-1' };
    }
    return base(b);
  } });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#s_err')).toContainText('Someone changed this');
  await page.keyboard.press('Escape');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_notes')).toHaveValue('theirs');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.rev).toBe(2);
});

// ---------------- site maps: crew view ----------------
// A 30 m x 10 m walk near PAC at 61.2177 N: 300 m2 = 3,229 sq ft (worked by hand).
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
const mapWorld = () => {
  const w = world();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, map: { center: PAC, zoom: 18 }, materials_needed: '4-5 bags IceMelt' } : s));
  w.zones = [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', priority: true, note: 'ADA ramp first', ring: ring(PAC[0], PAC[1], 30, 10), area_sqft: 3229, rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk', priority: false, note: '', ring: ring(PAC[0], PAC[1] + 0.0003, 20, 5), area_sqft: 1076, rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ski trail', priority: false, note: 'Do not gravel', ring: ring(PAC[0] + 0.0006, PAC[1], 10, 30), area_sqft: 3229, rev: 1 },
  ];
  return w;
};
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function tiles(page, fail) {
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) =>
    fail ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'image/png', body: PNG1 }));
}
async function openMap(page, token, state, fail) {
  await tiles(page, fail);
  const calls = await open(page, { token, snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  return calls;
}
const zoneSource = (page) => page.evaluate(() => new Promise((res) => {
  const go = () => { const s = window.SnowMapView && window.SnowMapView.getSource('zones'); if (s && s._data) res(s._data.features.map((f) => ({ id: f.properties.id, type: f.properties.type }))); else setTimeout(go, 100); };
  go();
}));

// Matt 10/4/26: Bootprint's colours, two new types. The legend reads in this
// order everywhere, and Matt's editor offers the same five.
test('the legend and the editor list the five zone types in order', async ({ page }) => {
  await adminMap(page, mapWorld());
  expect(await page.locator('#maplegend span').allTextContents()).toEqual(
    ['Sidewalk', 'Hand work', 'Heated: check only, no melt', 'Snow storage', 'Do not touch']);
  await page.click('#mapedit');
  await page.click('#ed_new');
  expect(await page.locator('[data-ztype]').evaluateAll((els) => els.map((e) => e.dataset.ztype + ':' + e.textContent))).toEqual(
    ['sidewalk:Sidewalk', 'hand:Hand', 'heated:Heated', 'storage:Snow storage', 'no_touch:Do not touch']);
});

// 10/4/26: the photo switch asked the map about the city photo layer right
// after new Map(), before the style is built. MapLibre logs "non-existing
// layer moa" as a console error on every map open (six in one session in
// Claude's pane). The real library, no patches: five opens, no errors, and the
// switch still reads the city photo.
test('opening site maps logs no errors, and the photo switch reads the city photo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await openMap(page, 'tok-jordan', mapWorld());
  for (let i = 0; i < 5; i++) {
    await zoneSource(page);
    await expect(page.locator('#photoswitch')).toHaveText('Photo: City 2024');
    if (i < 4) { await page.click('nav [data-tab="sites"]'); await page.click('[data-map="S1"]'); }
  }
  expect(errors.filter((e) => /layer|maplibre|Style/i.test(e))).toEqual([]);
});

test('the crew map draws every zone with its type and a legend', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  expect(await zoneSource(page)).toEqual([{ id: 'Z1', type: 'sidewalk' }, { id: 'Z2', type: 'heated' }, { id: 'Z3', type: 'no_touch' }]);
  await expect(page.locator('#maplegend')).toContainText('Heated: check only, no melt');
  await expect(page.locator('#maplegend')).toContainText('Do not touch');
  await expect(page.locator('#mapsite')).toContainText('4-5 bags IceMelt');
  // Tiles load here, so no outage banner (gives the tile probe time to answer).
  await page.waitForTimeout(1500);
  await expect(page.locator('#mapwarn')).toBeHidden();
});

test('a priority zone is starred on the map', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('.zone-star')).toHaveCount(1);
});

test('tapping a zone shows its details and area', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  const pt = await page.evaluate(([lng, lat]) => { const p = window.SnowMapView.project([lng, lat]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    [PAC[0] + 0.00025, PAC[1] + 0.00004]);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#zonesheet')).toContainText('Main entry');
  await expect(page.locator('#zonesheet')).toContainText('ADA ramp first');
  await expect(page.locator('#zonesheet')).toContainText('3,229 sq ft');
  await expect(page.locator('#zonesheet')).toContainText('Priority');
});

test('a site with no zones says the map is not drawn yet', async ({ page }) => {
  const w = mapWorld(); w.zones = [];
  await openMap(page, 'tok-jordan', w);
  await expect(page.locator('main')).toContainText('Map not drawn yet');
  expect(await page.evaluate(() => !!window.SnowMapView)).toBe(false);
});

test('if the aerial photo fails, the zones still show', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld(), true);
  expect((await zoneSource(page)).length).toBe(3);
  // Visible, not just present: the banner's text is in the page even while hidden.
  await expect(page.locator('#mapwarn')).toBeVisible();
  await expect(page.locator('#mapwarn')).toContainText('Aerial photo unavailable');
});

test('crew have no edit-map button', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});

// ---------- site maps: Matt's zone editor ----------
// Corners are clicked at whole pixels; the expected lng/lat is the map's own
// unproject of that same pixel, so the check is exact (1e-6 deg is ~0.1 m).
async function adminMap(page, state) {
  await tiles(page);
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  return calls;
}
// Pixel offsets from the canvas CENTRE (which is PAC), all west of it: every
// zone in mapWorld starts at PAC's longitude and runs east, so this ground is
// clear at any map height (the map shrinks when the old-map sheet is open).
const CORNERS = [[-150, -60], [-40, -60], [-40, 20], [-150, 20]];
// A person scrolls the map into view before tapping it; so does the test.
const mapInView = (page) => page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
async function tapCorners(page, px) {
  const out = [];
  for (const [x, y] of px) {
    await mapInView(page);
    const r = await page.evaluate(() => { const b = window.SnowMapView.getCanvas().getBoundingClientRect(); return { l: b.left + b.width / 2, t: b.top + b.height / 2 }; });
    const cx = Math.round(r.l + x), cy = Math.round(r.t + y);
    await page.mouse.click(cx, cy);
    out.push(await page.evaluate(([a, b]) => { const c = window.SnowMapView.getCanvas().getBoundingClientRect(); const ll = window.SnowMapView.unproject([a - c.left, b - c.top]); return [ll.lng, ll.lat]; }, [cx, cy]));
  }
  return out;
}
const lastCall = (calls, action) => calls.filter((c) => c.body.action === action).at(-1);

test('Matt draws a heated priority zone and it saves with its corners', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="heated"]');
  await page.check('#z_priority');
  await page.fill('#z_name', 'Back steps');
  await page.fill('#z_note', 'Check the drain');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ site_id: 'S1', type: 'heated', priority: true, name: 'Back steps', note: 'Check the drain', rev: 0 });
  expect(rec.id).toBeFalsy();
  expect(rec.ring.length).toBe(4);
  rec.ring.forEach((p, i) => { expect(Math.abs(p[0] - want[i][0])).toBeLessThan(1e-6); expect(Math.abs(p[1] - want[i][1])).toBeLessThan(1e-6); });
  expect(await zoneSource(page)).toHaveLength(4); // the new zone is on the map now
  await expect(page.locator('.zone-star')).toHaveCount(2);
});

test('undo takes back the last corner', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await page.click('#z_undo');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Three corners');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ring = lastCall(calls, 'saveZone').body.record.ring;
  expect(ring.length).toBe(3);
  expect(Math.abs(ring[2][0] - want[2][0])).toBeLessThan(1e-6);
});

test('two corners is not a zone: blocked before it is sent', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Too small');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toContainText('At least 3 corners');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
});

test('a zone with no type picked is not sent', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.fill('#z_name', 'No type');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toContainText('Pick a type');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
});

test('Save view stores the map centre and zoom on the site, keeping its other fields', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.evaluate(() => window.SnowMapView.jumpTo({ center: [-149.9, 61.22], zoom: 17.5 }));
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  const rec = lastCall(calls, 'saveSite').body.record;
  expect(rec.id).toBe('S1');
  expect(rec.name).toBe('PAC');
  expect(rec.materials_needed).toBe('4-5 bags IceMelt');
  expect(rec.map.zoom).toBeCloseTo(17.5, 6);
  expect(rec.map.center[0]).toBeCloseTo(-149.9, 6);
  expect(rec.map.center[1]).toBeCloseTo(61.22, 6);
});

test('the old-map picture shows beside the map and is never sent or stored', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  await page.click('#mapedit');
  await page.setInputFiles('#ed_reffile', { name: 'Night 1 - PAC.png', mimeType: 'image/png', buffer: PNG1 });
  await expect(page.locator('#refpanel img')).toBeVisible();
  expect(await page.locator('#refpanel img').getAttribute('src')).toMatch(/^blob:/);
  // Work with the picture open: draw a zone and save the view.
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Traced');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  for (const c of calls) {
    const s = JSON.stringify(c.body);
    expect(s).not.toContain('data:image');
    expect(s).not.toContain('Night 1 - PAC');
    expect(s).not.toContain('blob:');
  }
  const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  expect(after).toBe(before);
  await page.click('#ref_close');
  await expect(page.locator('#refpanel')).toBeHidden();
});

test('editing a zone keeps its id and rev; Archive takes it off the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await zoneSource(page);
  await page.click('#mapedit');
  const tapZone = async (lng, lat) => {
    await mapInView(page);
    const pt = await page.evaluate(([a, b]) => { const p = window.SnowMapView.project([a, b]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lng, lat]);
    await page.mouse.click(pt.x, pt.y);
  };
  await tapZone(PAC[0] + 0.00025, PAC[1] + 0.00004); // Z1, Main entry
  await expect(page.locator('#z_name')).toHaveValue('Main entry');
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await expect(page.locator('#zonesheet')).toBeHidden(); // editing, not the crew sheet
  await page.fill('#z_name', 'Main entry + ramp');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ id: 'Z1', rev: 1, name: 'Main entry + ramp', type: 'sidewalk', priority: true, note: 'ADA ramp first' });

  // Z3 is ~240 px east of PAC at z18 (MapLibre zooms are 512 px tiles): off a
  // phone-width map. Pan to it first, as Matt would.
  await page.evaluate(([a, b]) => window.SnowMapView.jumpTo({ center: [a, b] }), [PAC[0] + 0.00065, PAC[1] + 0.0001]);
  await tapZone(PAC[0] + 0.0006 + 0.00005, PAC[1] + 0.0001); // Z3, Ski trail
  await expect(page.locator('#z_name')).toHaveValue('Ski trail');
  await page.click('#z_archive');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'archiveZone').body).toMatchObject({ id: 'Z3', rev: 1 });
  expect((await zoneSource(page)).map((z) => z.id)).toEqual(['Z1', 'Z2']);
});

test('Matt gets a map to draw on even before a site has zones', async ({ page }) => {
  const w = mapWorld(); w.zones = [];
  await adminMap(page, w);
  await expect(page.locator('#mapedit')).toBeVisible();
});

test('tapping a corner that is already there does not add another', async ({ page }) => {
  // Found in review: MapLibre fires the map click for a tap on a marker, so a
  // tap to grab corner 2 made A,B,C,D,B -- a spike that encloses only BCD.
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Four');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'saveZone').body.record.ring.length).toBe(4);
});

// Found in review: a save still in flight when Matt taps Done or Back was
// stored by the server but never shown, so he would draw it again.
async function slowZoneSaves(page) {
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'saveZone') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
}
async function drawAndSave(page) {
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Slow one');
  await page.click('#z_save');
}

test('a zone saved while Done is tapped still shows on the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#ed_done');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await expect.poll(async () => (await zoneSource(page)).length, { timeout: 5000 }).toBe(4);
});

test('a zone saved while Back is tapped is there when the map is reopened', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#mapback');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await page.waitForTimeout(1600); // the slow reply lands after Back
  await page.click('[data-map="S1"]');
  expect(await zoneSource(page)).toHaveLength(4);
});

test('a slow save never draws its zone onto another site opened meanwhile', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#mapback');
  await page.click('[data-map="S2"]'); // TUDOR-TRANSIT: no zones
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await page.waitForTimeout(1600); // the PAC zone's reply lands now
  expect(await zoneSource(page)).toEqual([]);
});

test('leads have no edit-map button either', async ({ page }) => {
  await openMap(page, 'tok-alex', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});

// ---------- the phone's Back button ----------
// Matt, 10/1/26: Back closed the whole app and he had to start over. The app is
// one page, so Back must undo one step at a time: an open box, then the map.
const phoneBack = (page) => page.evaluate(() => history.back());

test('Back on a map returns to the list, not out of the app', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await phoneBack(page);
  await expect(page.locator('.site-card')).toHaveCount(2);
  await expect(page.locator('#mapbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.SnowMapView)).toBeFalsy();
});

test('Back with an edit box open closes the box and stays on the screen', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await phoneBack(page);
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('.site-card')).toHaveCount(2);
});

test('a box closed with Cancel leaves no extra Back step behind', async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  // Straight after Cancel: no step left for a dead box (else the next Back does nothing).
  await expect.poll(() => page.evaluate(() => ((history.state && history.state.snow) || []).length)).toBe(0);
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView);
  await phoneBack(page); // one Back: off the map. Not a ghost step for the closed box.
  await expect(page.locator('.site-card')).toHaveCount(2);
  await expect(page.locator('#mapbox')).toHaveCount(0);
});

test('the in-app ‹ Back and the phone Back agree', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await page.click('#mapback');
  await expect(page.locator('.site-card')).toHaveCount(2);
  // Nothing left to undo (history moves a moment later, so wait for it).
  await expect.poll(() => page.evaluate(() => (history.state && history.state.snow) || []).then((s) => s.length)).toBe(0);
});

test('Back while drawing a zone cancels the drawing and keeps the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await phoneBack(page);
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('.zone-corner')).toHaveCount(0);
  await expect(page.locator('#mapbox')).toBeVisible();
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
  await phoneBack(page); // and the next Back leaves the map
  await expect(page.locator('.site-card')).toHaveCount(2);
});

test('switching zones while drawing does not lose the map on the next Back', async ({ page }) => {
  await adminMap(page, mapWorld());
  await zoneSource(page);
  await page.click('#mapedit');
  await page.click('#ed_new');
  // Cancel and start again in the same instant, before the history has answered the
  // Cancel: the late answer must not cancel the new drawing.
  await page.evaluate(() => { document.getElementById('z_cancel').click(); document.getElementById('ed_new').click(); });
  await expect(page.locator('#zoneform')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#zoneform')).toBeVisible(); // still drawing once the history settled
  await phoneBack(page);
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('#mapbox')).toBeVisible();
});

// ---------- polish from the site-maps review (10/1/26) ----------
test('the route edit box says where sites are renamed', async ({ page }) => {
  // Matt, 10/1: tried to rename JBER sites inside the route box, where names are plain text.
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('[data-edit="route:R1"]');
  await expect(page.locator('#r_hint')).toBeVisible();
  await expect(page.locator('#r_hint')).toContainText('Sites tab');
});

test('materials needed can be typed on a site and is sent with it', async ({ page }) => {
  const w = world();
  w.sites[0] = { ...w.sites[0], materials_needed: '2-4 bags IceMelt' };
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_mat')).toHaveValue('2-4 bags IceMelt');
  await page.fill('#s_mat', '3-5 bags IceMelt, gravel at the ramp');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.materials_needed).toBe('3-5 bags IceMelt, gravel at the ramp');
});

test('signing out from the map editor clears the map and the old-map picture', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.setInputFiles('#ed_reffile', { name: 'Night 1 - PAC.png', mimeType: 'image/png', buffer: PNG1 });
  await expect(page.locator('#refpanel')).toBeVisible();
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#refpanel')).toHaveCount(0);
  expect(await page.evaluate(() => window.SnowMapView)).toBeFalsy();
});

test('a refused Save view says so, even while a zone is being drawn', async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld(), { saveReply: { ok: false, code: 'invalid', reason: 'Test refusal: not saved' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await page.click('#mapedit');
  await page.click('#ed_new'); // drawing: the editor's message line is hidden now
  await page.click('#ed_view');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Test refusal: not saved');
});

// Matt, 10/1/26, tracing PAC: tall buildings lean over the walks in the city's
// photo. A different flight leans differently, so one tap flips the photo.
test('the photo switch flips between the city photo and Esri', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld()); // crew get it too: the lean hides walks from them as well
  await zoneSource(page);
  const moa = () => page.evaluate(() => window.SnowMapView.getLayoutProperty('moa', 'visibility') || 'visible');
  await expect(page.locator('#photoswitch')).toContainText('City 2024');
  expect(await moa()).toBe('visible');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toContainText('Esri');
  expect(await moa()).toBe('none');
  expect(await page.evaluate(() => window.SnowMapView.getLayoutProperty('esri', 'visibility') || 'visible')).toBe('visible');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toContainText('City 2024');
  expect(await moa()).toBe('visible');
  expect(await zoneSource(page)).toHaveLength(3); // the zones never move
});

// Matt, 10/1/26, first real trace: "I'm trying to move the map. It places a dot.
// I can't delete them. And I'm trying to spin the map."
test('in Move map mode a tap adds no corner; switching back adds again', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await expect(page.locator('#z_mode')).toContainText('Adding corners');
  await page.click('#z_mode');
  await expect(page.locator('#z_mode')).toContainText('Moving map');
  await tapCorners(page, CORNERS.slice(2, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  await page.click('#z_mode');
  await tapCorners(page, CORNERS.slice(2, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(3);
});

test('a tapped corner can be deleted, and Undo brings it back', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await expect(page.locator('#z_delcorner')).toBeDisabled(); // nothing chosen yet
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner.sel')).toHaveCount(1);
  await page.click('#z_delcorner');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('#z_undo');
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.locator('.zone-corner').nth(1).click();
  await page.click('#z_delcorner');
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Three left');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ring = lastCall(calls, 'saveZone').body.record.ring;
  expect(ring.length).toBe(3);
  [want[0], want[2], want[3]].forEach((w, i) => { expect(Math.abs(ring[i][0] - w[0])).toBeLessThan(1e-6); expect(Math.abs(ring[i][1] - w[1])).toBeLessThan(1e-6); });
});

test('the map turns with buttons and the compass turns it back to north', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  const bearing = () => page.evaluate(() => window.SnowMapView.getBearing());
  await page.click('#ed_rotr');
  await expect.poll(bearing).toBeCloseTo(15, 3);
  await page.click('#ed_rotl');
  await page.click('#ed_rotl');
  await expect.poll(bearing).toBeCloseTo(-15, 3);
  await page.click('.maplibregl-ctrl-compass');
  await expect.poll(bearing).toBeCloseTo(0, 3);
});

// Matt, 10/1/26: "is rotating it gone because I saved it" -- Save view kept the
// spot and zoom but dropped the turn. The turn is part of the view.
test('Save view keeps the turn, and the map reopens turned', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_rotr');
  await page.click('#ed_rotr'); // 30 degrees
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getBearing())).toBeCloseTo(30, 3);
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  expect(lastCall(calls, 'saveSite').body.record.map.bearing).toBeCloseTo(30, 3);
  await page.click('#mapback');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView);
  expect(await page.evaluate(() => window.SnowMapView.getBearing())).toBeCloseTo(30, 3);
});

// Matt, 10/1/26: drew all the way round PAC tapping New zone between walks,
// thinking each was banked. Every New zone silently threw the last one away.
test('New zone never throws away a zone in progress', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('#ed_new');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await expect(page.locator('#toast')).toContainText('Save or Cancel this zone first');
});

test('Done never throws away a zone in progress', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('#ed_done');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await expect(page.locator('#zoneform')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Save or Cancel this zone first');
});

// ---------- import from Bootprint (Matt, 10/1/26: trace in Bootprint, bring it here) ----------
const mPin = (x, y) => ({ lat: PAC[1] + y / RE / DEGR, lng: PAC[0] + x / (RE * Math.cos(PAC[1] * DEGR)) / DEGR, accuracy: 0 });
const bpRect = (x, y) => [mPin(x, y), mPin(x + 10, y), mPin(x + 10, y + 5), mPin(x, y + 5)];
const bpExport = () => Buffer.from(JSON.stringify({
  schema: 'bootprint-library-export', version: 1, exportedAt: '2026-10-01T18:00:00Z',
  jobs: [
    { id: 'FARJOB', name: 'FAR-SECRET-JOB', zones: [{ id: 1, name: 'Far walk', mode: 'area', surface: 'walk', pins: bpRect(0, 20000), widthFt: '' }] },
    { id: 'NEAR', name: 'Near PAC', zones: [
      { id: 1, name: 'West walk', mode: 'area', surface: 'walk', pins: bpRect(-80, -20), widthFt: '' },
      { id: 2, name: 'Lot', mode: 'area', surface: 'plow', pins: bpRect(-80, -60), widthFt: '' },
      { id: 3, name: 'Back run', mode: 'line', surface: 'walk', pins: [mPin(-80, -30), mPin(-50, -30)], widthFt: '6' },
    ] },
  ],
  prefs: { snowTerms: 'PREF-SECRET' },
}));
async function importFile(page, buf) {
  await page.setInputFiles('#ed_bpfile', { name: 'bootprint-library-2026-10-01.json', mimeType: 'application/json', buffer: buf });
}

test('a Bootprint job imports its walks as sidewalk zones, and nothing else leaves the laptop', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('Near PAC'); // nearest the site first
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('2 walks to add');
  await expect(page.locator('#bp_sum')).toContainText('1 lot');
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(2);
  const recs = calls.filter((c) => c.body.action === 'saveZone').map((c) => c.body.record);
  expect(recs.map((r) => [r.name, r.type, r.site_id, r.from])).toEqual([
    ['West walk', 'sidewalk', 'S1', 'bootprint:NEAR:1'], ['Back run', 'sidewalk', 'S1', 'bootprint:NEAR:3']]);
  expect(recs[1].ring.length).toBe(4); // the run came across as a strip
  await expect.poll(async () => (await zoneSource(page)).length).toBe(5);
  await expect(page.locator('#toast')).toContainText('Added 2');
  for (const c of calls) {
    const s = JSON.stringify(c.body);
    expect(s).not.toContain('FAR-SECRET-JOB');
    expect(s).not.toContain('PREF-SECRET');
    expect(s).not.toContain('bootprint-library-2026');
  }
});

// Matt 10/4/26: hand work keeps its own colour, and a pile shows the Bobcat
// operator where snow goes. A pile is not a walk, so it is counted on its own.
test('hand work and snow piles import as their own types, and piles are not called walks', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [
    { id: 'NEAR', name: 'Near PAC', zones: [
      { id: 1, name: 'Front walk', mode: 'area', surface: 'walk', pins: bpRect(-80, -20), widthFt: '' },
      { id: 2, name: 'Lot cleanout', mode: 'area', surface: 'hand', pins: bpRect(-80, -40), widthFt: '' },
      { id: 3, name: 'Snow pile 1', mode: 'area', surface: 'storage', pins: bpRect(-80, -60), widthFt: '' },
    ] }] })));
  // The job button: 2 walks (front walk + lot cleanout), 1 snow pile.
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('2 walks · 1 snow pile');
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('2 walks · 1 snow pile to add');
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(3);
  expect(calls.filter((c) => c.body.action === 'saveZone').map((c) => [c.body.record.name, c.body.record.type])).toEqual([
    ['Front walk', 'sidewalk'], ['Lot cleanout', 'hand'], ['Snow pile 1', 'storage']]);
});

test('importing the same Bootprint job twice adds nothing the second time', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(2);
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('0 walks to add');
  await expect(page.locator('#bp_sum')).toContainText('2 already imported');
  await expect(page.locator('#bp_add')).toBeDisabled();
});

test('a file that is not a Bootprint export is refused with a reason', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, Buffer.from('{"hello": 1}'));
  await expect(page.locator('#toast')).toContainText('not a Bootprint export');
  await expect(page.locator('#bp_jobs')).toHaveCount(0);
});

// ---------- pairings (sub-project 4, 10/1/26) ----------
test('the roster card edits the Crew Board fields and sends them', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.selectOption('#f_rides_with', 'C01');
  await page.selectOption('#f_gear', 'needs_issued');
  await page.check('input[data-list="keep_apart_from"][value="C01"]');
  await page.fill('#f_seasons', '2');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  expect([r.rides_with, r.gear, r.keep_apart_from, r.works_well_with, r.seasons]).toEqual(['C01', 'needs_issued', ['C01'], [], 2]);
});

test('a site can be marked as needing a clearance', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.fill('#s_clear', 'JBER');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.needs_clearance).toBe('JBER');
});

test('a blank clearance and blank seasons are sent as empty, never invented', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.needs_clearance).toBe(null);
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  expect([r.seasons, r.rides_with, r.gear]).toEqual([null, null, null]);
});

test('Matt places a lead and a member; one move per tap', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(2);
  expect(calls.filter((c) => c.body.action === 'addMove').map((c) => [c.body.record.worker, c.body.record.role])).toEqual([['C01', 'lead'], ['C03', 'member']]);
});

test('a route warns, never blocks: no driver on a crew of one', async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => ({ ...c, can_drive: false }));
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .warns')).toContainText('Nobody on this route can drive');
});

test('a site with no clearance set never warns about clearance', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await expect(page.locator('[data-route="R1"] .warns li[data-rule^="clearance"]')).toHaveCount(0);
});

test('a site that needs a clearance warns about who lacks it', async ({ page }) => {
  const w = world(); w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, needs_clearance: 'JBER' } : s));
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="clearance"]')).toContainText('Jordan Demo: no JBER clearance');
});

test('an archived worker never shows on the board', async ({ page }) => {
  const w = world(); w.crew.push({ id: 'C09', name: 'Gone Worker', archived: true, rev: 1 });
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C09', to_route: 'R1', role: 'lead' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"]')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Gone Worker');
});

test('the person card shows placed routes, shifts worked and gear on hand', async ({ page }) => {
  const w = world();
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' }];
  w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 1 }];
  w.gear = [{ id: 'G1', date: '2026-10-01', shift: 'night-2026-10-01', at: '2026-10-01T17:05:00.000-08:00', worker: 'C01', type: 'issued', item: 'Parka' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-act="card"]');
  await expect(page.locator('#dlgIn')).toContainText('N1 from 10/1');
  await expect(page.locator('#dlgIn')).toContainText('1 night · 0 days');
  await expect(page.locator('#dlgIn')).toContainText('Parka');
  await expect(page.locator('#dlgIn')).toContainText('slow starter'); // Matt's own card: private fields show
});

test('crew and leads have no Board tab', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="routes"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="board"]')).toHaveCount(0);
});

test('Post offers the shifts around now with none picked: 8:59 AM', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-02T08:59:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#post');
  await expect(page.locator('[data-shift]')).toHaveText(['Night of 10/1', 'Day of 10/2', 'Night of 10/2']);
  await expect(page.locator('[data-shift][aria-pressed="true"]')).toHaveCount(0);
});

test('Post at 9:00 AM offers today and tonight', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-02T09:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#post');
  await expect(page.locator('[data-shift]')).toHaveText(['Day of 10/2', 'Night of 10/2']);
});

test('posting sends the chosen shift and clears "Changed since post"', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T16:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#crewsees')).toContainText('Not posted');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('#changed')).toBeVisible();
  await page.click('#post');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect.poll(() => calls.filter((c) => c.body.action === 'post').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'post')[0].body.shift).toBe('night-2026-10-01');
  await expect(page.locator('#changed')).toBeHidden();
  await expect(page.locator('#crewsees')).toContainText('Night of 10/1');
});

test('Post waits for a move that is still saving', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T16:00:00-08:00' });
  await page.route(isSnow, async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.action === 'addMove') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('#post')).toBeDisabled();
  await expect(page.locator('#post')).toBeEnabled({ timeout: 5000 });
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(1);
});

test('Callout saves the board for the chosen shift', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({ shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 0 });
});

const POST = { id: 'P1', rev: 1, shift: 'night-2026-10-01', posted_at: '2026-10-02T00:12:00.000Z',
  routes: [{ id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [] },
           { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'] }],
  people: { C01: { name: 'Alex Test', phone: '555-0101', shifts: { night: 3, day: 1 } },
            C03: { name: 'Jordan Demo', phone: '555-0103', shifts: { night: 2, day: 0 } } } };

test('crew see their own route first, partners and sites', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('.tonight-route').first()).toContainText('N1');
  await expect(page.locator('.tonight-route').first()).toContainText('Alex Test');
  await expect(page.locator('.tonight-route').first().locator('[data-map="S1"]')).toBeVisible();
  await expect(page.locator('.tonight-route').first().locator('a[href="tel:555-0101"]')).toHaveCount(1);
  await expect(page.locator('#tonight-head')).toContainText('Night of 10/1');
});

test('a crew member not on the post is told so and sees the whole board', async ({ page }) => {
  const w = world(); w.posts = [{ ...POST, routes: POST.routes.map((r) => ({ ...r, members: [] })) }];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText("You're not on a route this shift");
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

test('a stale post shows no old routes', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-02T10:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
  await expect(page.locator('.tonight-route')).toHaveCount(0);
});

test('a morning post for tonight is shown, not stale', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T08:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

test('shifts worked show for everyone, night and day', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('#shifts-worked')).toContainText('Alex Test');
  await expect(page.locator('#shifts-worked')).toContainText('3 nights · 1 day');
  await expect(page.locator('#shifts-worked')).toContainText('2 nights · 0 days');
});

test('nothing posted yet is said plainly', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
});

test('a gear entry guesses the route from the shift and is sent with a calendar date', async ({ page }) => {
  const w = world(); w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 1 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="log"]');
  await page.click('#newEntry');
  await page.selectOption('#g_worker', 'C01');
  await page.selectOption('#g_shift', 'night-2026-10-01');
  await expect(page.locator('#g_route')).toHaveValue('R1');
  await page.selectOption('#g_type', 'issued');
  await page.fill('#g_item', 'Parka');
  await page.click('#g_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'addGear')[0].body.record).toMatchObject({ worker: 'C01', type: 'issued', item: 'Parka', route: 'R1', date: '2026-10-01', shift: 'night-2026-10-01' });
  await expect(page.locator('#gearlog')).toContainText('Parka');
});

test('a gear entry needs a worker, a type, an item and a shift', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="log"]');
  await page.click('#newEntry');
  await page.click('#g_save');
  await expect(page.locator('#g_err')).toContainText('Pick a worker');
  await expect(page.locator('#g_err')).toContainText('Item is required');
  expect(calls.filter((c) => c.body.action === 'addGear')).toHaveLength(0);
});

test('issued gear clears the cold-gear warning on the board', async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => (c.id === 'C03' ? { ...c, gear: 'needs_issued' } : c));
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="gear"]')).toHaveCount(1);
  const w2 = { ...w, gear: [{ id: 'G1', date: '2026-10-01', shift: 'night-2026-10-01', at: '2026-10-01T17:05:00.000-08:00', worker: 'C03', type: 'issued', item: 'Parka' }] };
  await page.unrouteAll(); // reopen with the gear logged
  await open(page, { token: 'tok-matt', snow: fakeSnow(w2) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"]')).toBeVisible();
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="gear"]')).toHaveCount(0);
});

// Review 10/1/26: Android keeps the app in memory. Opened at 4 PM, switched
// back to at 8 PM after Matt posted: Tonight must show the post, not "Not
// posted yet", without the crew knowing to tap the tab again.
test('Tonight picks up a new post when the app comes back on screen', async ({ page }) => {
  const w = world();
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
  w.posts.push(POST);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.tonight-route')).toHaveCount(2);
  await expect(page.locator('main')).not.toContainText('Not posted yet');
});

test('Tonight has a Refresh button that fetches the newest post', async ({ page }) => {
  const w = world();
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('#refreshPost')).toBeVisible();
  w.posts.push(POST);
  await page.click('#refreshPost');
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

// Review 10/1/26: a callout is who ACTUALLY went out. Someone placed who never
// showed must not get a night under "Shifts worked", which every crew phone sees.
const PLACED = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' },
  { id: 'M2', at: '2026-10-01T17:01:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];

test('a callout can mark a no-show: left off the roster, listed, with a note', async ({ page }) => {
  const w = world(); w.moves = PLACED.slice();
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('[data-noshow="C03"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#co_note', 'Jordan no call no show');
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({
    shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, no_shows: ['C03'], note: 'Jordan no call no show' });
});

test('reopening a saved callout keeps its no-shows and note', async ({ page }) => {
  const w = world(); w.moves = PLACED.slice();
  w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', started_at: '2026-10-01T20:00:00.000-08:00', note: 'short a truck',
    roster: { R1: { lead: 'C01', members: [] } }, no_shows: ['C03'], rev: 1 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#co_note')).toHaveValue('short a truck');
  await page.click('[data-noshow="C03"]'); // he turned up late after all
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({
    roster: { R1: { lead: 'C01', members: ['C03'] } }, no_shows: [], note: 'short a truck', rev: 1 });
});

// ---------------- the Storm tab: crew tap each walk ----------------
// Fixture, worked by hand. Clock 7:30 AM on 10/3 is before the 9 AM cutover, so
// the shift on offer is still "night-2026-10-02", and the post below is that
// night's: not stale. The post lists R2 (S2) first, then R1 (S1) with Jordan
// (C03) as a member, so Jordan's own route is N1 = the PAC site.
// Walks at PAC, by name: "Heated walk" (Z2, heated: Checked / Problem), then
// "Main entry" (Z1, sidewalk: Cleared / Treated / Problem). "Ski trail" (Z3) is
// no_touch and is never walked. TUDOR-TRANSIT (S2) has no zones: one "Whole site".
// The fake stamps every row at 7:50:18 AM Alaska time (-08:00 on 10/3).
const STORM_CLOCK = '2026-10-03T07:30:00-08:00';
const START_ROW = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const stormWorld = () => {
  const w = world();
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  w.zones = [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk', rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ski trail', rev: 1 },
  ];
  w.posts = [{ ...POST, shift: 'night-2026-10-02' }];
  w.storms = [START_ROW];
  return w;
};
const logRow = (n, siteId, zoneId, state, by, extra = {}) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02',
  site_id: siteId, zone_id: zoneId, state, note: '', by_key: 'C01', by_name: by, at: '2026-10-03T06:30:00.000-08:00',
  off_route: false, snowing_warned: false, undoes: null, ...extra });
async function openStorm(page, w, o = {}) {
  const calls = await open(page, { token: o.token || 'tok-jordan', snow: fakeSnow(w, o.fake), clockAt: o.clockAt || STORM_CLOCK, delay: o.delay, abortIf: o.abortIf, hangIf: o.hangIf });
  await page.click('nav [data-tab="storm"]');
  return calls;
}
const shiftCalls = (calls) => calls.filter((c) => c.body.action === 'getShiftLog');
const tapCalls = (calls) => calls.filter((c) => c.body.action === 'tapZone');
const walkRow = (page, key) => page.locator('[data-walkrow="' + key + '"]');
const walkBtn = (page, key, state) => page.locator('[data-walk="' + key + '"][data-state="' + state + '"]');
const phoneState = (page) => page.evaluate(() => SnowShiftUI.state());
// Another visibilitychange = the app coming back on screen = one poll now.
const pollNow = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
// Matt and the leads land on the live view; tapping a route opens it as the crew see it.
const openRoute = async (page, id) => { await page.locator('[data-openroute="' + id + '"]').click(); await expect(page.locator('#liveBack')).toBeVisible(); };

// Matt 10/4/26: hand work (lot rows, curbs) is walked like a sidewalk; a snow
// pile only shows where snow goes and is never walked.
test('hand work is walked like a sidewalk; a snow pile is never walked', async ({ page }) => {
  const w = stormWorld();
  w.zones.push({ id: 'Z4', site_id: 'S1', type: 'hand', name: 'Lot row', rev: 1 },
    { id: 'Z5', site_id: 'S1', type: 'storage', name: 'Snow pile 1', rev: 1 });
  await openStorm(page, w);
  // By name: Heated walk, Lot row, Main entry. No pile, no ski trail.
  expect(await page.locator('[data-walkrow]').evaluateAll((els) => els.map((e) => e.dataset.walkrow))).toEqual(['S1|Z2', 'S1|Z4', 'S1|Z1']);
  expect(await page.locator('[data-walkrow="S1|Z4"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['cleared', 'treated', 'problem']);
  await expect(page.locator('[data-walk^="S1|Z5"]')).toHaveCount(0);
});

// Part A (Matt, 10/4/26): tonight's posted Board decides what a phone offers;
// the server's live Board stays the authority.
const boardPost = (r1, r2) => ({ ...POST, shift: 'night-2026-10-02', routes: [
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: null, members: [], ...r2 },
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: null, members: [], ...r1 }] });

test('off the posted Board: the Storm tab is read-only and says why', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C01' }, {})]; // Jordan is not on it
  w.log = [logRow(2, 'S1', 'Z1', 'cleared', 'Alex Test')];
  await openStorm(page, w);
  await expect(page.locator('main')).toContainText("You're not on tonight's posted Board.");
  await page.click('#otherRoutes');
  await expect(page.locator('main')).toContainText('PAC');
  await expect(page.locator('[data-walk]')).toHaveCount(0);
  await expect(page.locator('[data-undo]')).toHaveCount(0);
  await expect(page.locator('[data-card]')).toHaveCount(0);
});

test('no post yet: the crew still get the walk buttons, and the server decides', async ({ page }) => {
  const w = stormWorld();
  w.posts = [];
  await openStorm(page, w);
  await page.click('#otherRoutes');
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
});

test('a Board lead who is crew on the roster gets the storm controls, in Matt\'s words', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C03' }, {})]; // Jordan (is_lead false) leads N1 tonight
  await openStorm(page, w);
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('[data-storm="stopped"]')).toHaveText('Snow stopped (melt + rock OK)');
  await expect(page.locator('[data-storm="end"]')).toHaveText('Close storm (cleanup done)');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await page.click('[data-storm="end"]');
  await expect(page.locator('#dlgIn h2')).toHaveText('Close the storm?');
  await expect(page.locator('#sc_yes')).toHaveText('Yes, close storm');
});

test('a roster lead who is not on the posted Board gets no storm controls', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ members: ['C03'] }, {})]; // Alex (is_lead true) is on no route tonight
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  await expect(page.locator('main')).toContainText("You're not on tonight's posted Board.");
});

// Review fix (10/4/26): Matt posts Jordan as N1's lead while Jordan has the Storm tab open.
// The 60 s post check redraws the tab, and the controls follow the new post, no reopen needed.
test('a new post that makes you lead brings the storm controls without reopening the tab', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ members: ['C03'] }, {})]; // Jordan rides N1
  await openStorm(page, w);
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  w.posts = [{ ...boardPost({ lead: 'C03' }, {}), id: 'P2', posted_at: '2026-10-03T15:30:00.000Z' }];
  await page.clock.runFor(60000); // three 20 s ticks: the third re-reads the post
  await expect(page.locator('#stormctl')).toBeVisible();
});


// ---- Clean again (Part B1, Matt 10/4/26) ----
// PAC (S1) on N1: Z1 cleared + Z2 checked by Alex (seq 1, 2: the fake numbers new rows by count). The fake stamps rows 7:50 AM.
const cleanedWorld = () => { const w = stormWorld(); w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')]; return w; };
const pressed = (page, key) => page.locator('[data-walk="' + key + '"][aria-pressed="true"]');

test('Matt cleans a site again: every walk starts over and the site shows pass 2', async ({ page }) => {
  const calls = await openStorm(page, cleanedWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
  await page.click('[data-again="S1"]');
  await expect(page.locator('#dlgIn h2')).toHaveText('Clean PAC again?');
  await expect(page.locator('#dlgIn')).toContainText('Every walk at PAC goes back to not done for pass 2. Pass 1 stays on the record.');
  await page.click('#ag_yes');
  await expect.poll(() => calls.filter((c) => c.body.action === 'cleanAgain').length).toBe(1);
  await expect(page.locator('[data-passline="S1"]')).toContainText('Pass 2 · Clean again 7:50 AM by Matthew');
  await expect(pressed(page, 'S1|Z1')).toHaveCount(0);
  await expect(pressed(page, 'S1|Z2')).toHaveCount(0);
});

test('Undo on the pass line puts pass 1 back', async ({ page }) => {
  await openStorm(page, cleanedWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await page.click('#ag_yes');
  await expect(page.locator('[data-passline="S1"]')).toBeVisible();
  await page.click('[data-passline="S1"] [data-undo]');
  await expect(page.locator('[data-passline="S1"]')).toHaveCount(0);
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
});

test('a member sees no Clean again; the posted lead does', async ({ page }) => {
  await openStorm(page, cleanedWorld()); // Jordan, a member of N1
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
  await expect(page.locator('[data-again]')).toHaveCount(0);
});

test('the posted lead gets Clean again; a refusal shows its reason', async ({ page }) => {
  const w = stormWorld(); // nothing done yet at PAC
  await openStorm(page, w, { token: 'tok-alex' }); // Alex leads N1 on the post
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await page.click('#ag_yes');
  await expect(page.locator('[data-shiftsite="S1"]')).toContainText('Nothing to clean again yet');
});

// Matt 10/4/26: an open Problem is carried into the next pass, marked with its pass,
// until someone taps that walk again. Clean again never hides it.
test('an open Problem stays in the Problems box after Clean again, marked (pass 1)', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice, needs chipper' }), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')];
  await openStorm(page, w, { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await expect(page.locator('#dlgIn')).toContainText("Copy for BT first if pass 1 isn't posted yet.");
  await page.click('#ag_yes');
  await expect(page.locator('[data-passline="S1"]')).toBeVisible();
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toContainText('ice, needs chipper');
  await expect(page.locator('#problems')).toContainText('(pass 1)');
  await openRoute(page, 'R1');
  await page.click('[data-walk="S1|Z1"][data-state="cleared"]');
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toHaveCount(0);
});

// Matt 10/4/26: short site codes ("PH", "PG") are unreadable, even to Matt. Every list shows the
// address beside the code; the name itself stays the code the crew know.
test('short site names show their address on the Routes tab, in the route editor and on the Storm tab', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => ({ ...s, address: s.id === 'S1' ? '4001 TUDOR CENTRE' : '3600 MLK' }));
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: [] }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.sitelist li').first()).toContainText('PAC');
  await expect(page.locator('.sitelist li').first()).toContainText('4001 TUDOR CENTRE');
  await page.click('[data-edit="route:R2"]');
  await expect(page.locator('#r_add option[value="S1"]')).toHaveText('PAC · 4001 TUDOR CENTRE');
  await page.click('#dlgClose');
  await openStorm(page, w);
  await expect(page.locator('.shift-site').first()).toContainText('4001 TUDOR CENTRE');
});

// Matt 10/4/26: the Sites tab groups by customer so the hospital sites sit together. A site with
// no customer yet goes last, under its own heading; nothing is guessed.
test('the Sites tab groups sites by customer, and the site form edits it', async ({ page }) => {
  const w = world();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1, customer: 'ANTHC' }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 },
    { id: 'S3', name: 'APMB', rev: 1, customer: 'ANTHC' }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  expect(await page.locator('.site-group').allTextContents()).toEqual(['ANTHC', 'No customer yet']);
  expect(await page.locator('.site-card').evaluateAll((els) => els.map((e) => e.dataset.site))).toEqual(['S3', 'S1', 'S2']);
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#s_cust')).toHaveValue('');
  await page.fill('#s_cust', 'MOA');
  await page.click('#s_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  expect(calls.find((c) => c.body.action === 'saveSite').body.record.customer).toBe('MOA');
});

test('crew see their own route\'s walks first and other routes behind a button', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  // Own route N1 only: PAC, with Heated walk before Main entry (by name).
  await expect(page.locator('.shift-site')).toHaveCount(1);
  await expect(page.locator('.shift-site')).toContainText('PAC');
  await expect(page.locator('[data-walkrow]')).toHaveCount(2);
  expect(await page.locator('[data-walkrow]').evaluateAll((els) => els.map((e) => e.dataset.walkrow))).toEqual(['S1|Z2', 'S1|Z1']);
  expect(await page.locator('[data-walkrow="S1|Z2"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['checked', 'problem']);
  expect(await page.locator('[data-walkrow="S1|Z1"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['cleared', 'treated', 'problem']);
  await expect(page.locator('[data-walk^="S1|Z3"]')).toHaveCount(0); // no_touch is never walked
  await expect(page.locator('[data-walk^="S2|"]')).toHaveCount(0);   // N2 is not Jordan's
  await expect(page.locator('main')).not.toContainText('TUDOR-TRANSIT');
  await page.click('#otherRoutes');
  await expect(page.locator('main')).toContainText('TUDOR-TRANSIT');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
});

test('a tap sends site, zone and state, and the walk shows who and when', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)).toHaveLength(1);
  const body = tapCalls(calls)[0].body;
  expect(body).toMatchObject({ action: 'tapZone', site_id: 'S1', zone_id: 'Z1', state: 'cleared', note: '' });
  // The server knows who and when and which shift: the phone sends none of it.
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'shift_id', 'storm_id', 'seq']) expect(body).not.toHaveProperty(k);
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toHaveAttribute('aria-pressed', 'true');
  await expect(walkRow(page, 'S1|Z2')).not.toContainText('Jordan Demo'); // the other walk is untouched
});

test('a problem needs a note before it can be sent', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await walkBtn(page, 'S1|Z1', 'problem').click();
  await expect(page.locator('[data-note="S1|Z1"]')).toBeVisible();
  await expect(page.locator('[data-send="S1|Z1"]')).toBeDisabled();
  expect(tapCalls(calls)).toHaveLength(0); // opening the box sent nothing
  await page.fill('[data-note="S1|Z1"]', '   ');
  await expect(page.locator('[data-send="S1|Z1"]')).toBeDisabled(); // spaces are blank
  await page.fill('[data-note="S1|Z1"]', 'ice under the mat');
  await expect(page.locator('[data-send="S1|Z1"]')).toBeEnabled();
  await page.click('[data-send="S1|Z1"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Problem · Jordan Demo · 7:50 AM');
  await expect(walkRow(page, 'S1|Z1')).toContainText('ice under the mat');
  expect(tapCalls(calls)).toHaveLength(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S1', zone_id: 'Z1', state: 'problem', note: 'ice under the mat' });
  await expect(page.locator('[data-note="S1|Z1"]')).toHaveCount(0); // the box closes once it is saved
});

test('a double tap sends one tap', async ({ page }) => {
  // Apps Script takes a second or two: the second tap must not add a second row.
  const calls = await openStorm(page, stormWorld(), { delay: { tapZone: 700 } });
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await page.evaluate(() => { const b = document.querySelector('[data-walk="S1|Z1"][data-state="cleared"]'); b.click(); b.click(); });
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  expect(tapCalls(calls)).toHaveLength(1);
  expect((await phoneState(page)).log).toHaveLength(1);
});

test('no signal: the walk says not saved and Retry sends it', async ({ page }) => {
  const net = { down: true };
  const calls = await openStorm(page, stormWorld(), { abortIf: (b) => net.down && b.action === 'tapZone' });
  await walkBtn(page, 'S1|Z1', 'treated').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Not saved');
  await expect(page.locator('[data-retry="S1|Z1"]')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).not.toContainText('Jordan Demo'); // nothing is shown as done
  net.down = false;
  await page.click('[data-retry="S1|Z1"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo · 7:50 AM');
  await expect(page.locator('[data-retry]')).toHaveCount(0);
  // The first try and the retry are the same tap.
  expect(tapCalls(calls)).toHaveLength(2);
  expect(tapCalls(calls)[1].body).toMatchObject({ site_id: 'S1', zone_id: 'Z1', state: 'treated', note: '' });
});

test('with no storm open the tap is refused and says so', async ({ page }) => {
  // Matt ends the storm while Jordan's screen is open: the phone has not heard yet.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Not saved: No storm is open');
  await expect(walkRow(page, 'S1|Z1')).not.toContainText('Jordan Demo');
  expect(w.log || []).toHaveLength(0); // nothing was written
  // The refusal also makes the phone ask again, so the banner catches up.
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  expect(shiftCalls(calls).length).toBeGreaterThanOrEqual(2);
});

test('undo sends the seq and the walk goes back', async ({ page }) => {
  // Alex cleared Main entry (seq 1), then Jordan marked it treated (seq 2).
  // Undoing seq 2 restores what the row before it said: Cleared, by Alex.
  // The fake writes that as a NEW row (seq 3, by whoever undid it).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z1', 'treated', 'Jordan Demo')];
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo');
  await expect(page.locator('[data-undo]')).toHaveCount(1);       // only the newest row on the walk
  await expect(page.locator('[data-undo="2"]')).toBeVisible();
  await page.click('[data-undo="2"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  const undo = calls.filter((c) => c.body.action === 'undoTap');
  expect(undo).toHaveLength(1);
  expect(undo[0].body.seq).toBe(2);
  expect(w.log.map((r) => [r.seq, r.state, r.undoes])).toEqual([[1, 'cleared', null], [2, 'treated', null], [3, 'cleared', 'L-2']]);
  await expect(page.locator('[data-undo="3"]')).toBeVisible(); // the new newest row can be undone in turn
  await expect(page.locator('[data-undo="2"]')).toHaveCount(0);
});

test('a poll and a tap carrying the same row show it once', async ({ page }) => {
  // Jordan taps (the fake writes L-1, seq 1) before his phone's cursor moves, so
  // the next poll (cursor 0) carries L-1 again. Then Alex treats the same walk
  // (L-2, seq 2) and the next poll carries only that. Worked by hand:
  // rows after the tap [L-1]; after poll 2 still [L-1]; after poll 3 [L-1, L-2].
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // first poll answered
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(1); // poll 2 has been merged
  const s = await phoneState(page);
  expect(shiftCalls(calls)[1].body.cursor.log).toBe(0);      // it did ask from 0, so it was handed L-1 again
  expect(s.log.map((r) => r.id)).toEqual(['L-1']);          // once
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  w.log.push(logRow(2, 'S1', 'Z1', 'treated', 'Alex Test'));
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(2);
  expect((await phoneState(page)).log.map((r) => r.id)).toEqual(['L-1', 'L-2']);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Alex Test');
  expect(w.log).toHaveLength(2);
});

test('the phone asks only for rows after its cursor', async ({ page }) => {
  // The fake holds 2 log rows and 1 storm row, no visits. First ask: from zero.
  // The reply says how many rows each tab has (2, 1, 0); the second ask carries
  // that back, plus the seq of the last row it got per tab (2, 1, none).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')];
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Alex Test');
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  const [first, second] = shiftCalls(calls).map((c) => c.body);
  // Trucks and Sheets (route sheets) are two more tabs on the same cursor; this fake has none of either.
  // Posts ride the cursor too (Matt's only: Jordan's poll gets none, cursor 0); they have no seq, so no `last`.
  expect(first.cursor).toEqual({ log: 0, storms: 0, visits: 0, trucks: 0, sheets: 0, posts: 0 });
  expect(second.cursor).toEqual({ log: 2, storms: 1, visits: 0, trucks: 0, sheets: 0, posts: 0 });
  expect(second.last).toEqual({ log: 2, storms: 1, visits: null, trucks: null, sheets: null });
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(2);
  expect((await phoneState(page)).log.map((r) => r.id)).toEqual(['L-1', 'L-2']); // nothing came twice
});

test('rows kept out of seq order in the Sheet do not make every poll reset', async ({ page }) => {
  // Matt hand-sorted the Log tab: the sheet holds [L-2, L-1] in that physical
  // order. The server checks the row at the cursor POSITION (the 2nd row, L-1),
  // so after the first poll the phone must say last = 1 (the last row it was
  // handed, in the order it was handed), not 2 (the highest seq). Saying 2
  // would mismatch row 2's seq 1: reset:true with the whole tab, every 20 s.
  const w = stormWorld();
  w.log = [logRow(2, 'S1', 'Z1', 'treated', 'Alex Test'), logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test')];
  const replies = [];
  page.on('response', async (res) => {
    if (!isSnow(new URL(res.url()))) return;
    try { const j = await res.json(); if (j.reset) replies.push(j); } catch (e) { /* not ours */ }
  });
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Alex Test'); // seq 2 is the newest row, wherever it sits
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  expect(shiftCalls(calls)[1].body.cursor.log).toBe(2);
  expect(shiftCalls(calls)[1].body.last.log).toBe(1);
  await expect.poll(() => replies.length).toBe(2);
  expect(replies[1].reset.log).toBe(false);
  expect(replies[1].log).toEqual([]);
});

test('polling runs only on the Storm tab, and only while the page is visible', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(shiftCalls(calls)).toHaveLength(1);
  // Another tab: the timer is gone. Three ticks' worth of time asks nothing.
  await page.click('nav [data-tab="tonight"]');
  await page.clock.runFor(60000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(1);
  // Back on Storm: one poll at once, and the timer runs again (one tick = one more).
  await page.click('nav [data-tab="storm"]');
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  // Page hidden (phone locked): the timer ticks but asks nothing.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(60000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(2);
  // Visible again: exactly one poll, straight away.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => shiftCalls(calls).length).toBe(3);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(3);
});

test('polling stops on an expired session and shows sign-in', async ({ page }) => {
  const expired = { on: false };
  const calls = await openStorm(page, stormWorld(), { fake: { expired } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expired.on = true;
  await page.clock.runFor(20000); // the 20 s timer fires one poll; the server says the session is gone
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  const before = shiftCalls(calls).length; // the first poll plus the one that was refused: 2
  expect(before).toBe(2);
  await page.clock.runFor(60000);          // three more timer ticks' worth of time
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(before);
});

test('a reset reply replaces the phone\'s rows', async ({ page }) => {
  // The phone has seen 3 rows (cursor 3). Then rows are deleted by hand in the
  // Sheet: only L-1 is left. The cursor (3) is past the tab (1 row), so the
  // server answers every row with reset: true. Heated walk's "Checked" (L-2)
  // and the Whole site row (L-3) must go from the phone; Main entry stays.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test'), logRow(3, 'S2', 'whole', 'cleared', 'Alex Test')];
  await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z2')).toContainText('Checked · Alex Test');
  expect((await phoneState(page)).cursor.log).toBe(3);
  w.log = [w.log[0]];
  await pollNow(page);
  await expect(walkRow(page, 'S1|Z2')).not.toContainText('Alex Test');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Alex Test');
  const s = await phoneState(page);
  expect(s.log.map((r) => r.id)).toEqual(['L-1']);
  expect(s.cursor.log).toBe(1);
});

test('a site with no zones shows one Whole site walk', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await page.click('#otherRoutes');
  await expect(page.locator('[data-walkrow^="S2|"]')).toHaveCount(1);
  await expect(walkRow(page, 'S2|whole')).toContainText('Whole site');
  expect(await page.locator('[data-walkrow="S2|whole"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['cleared', 'treated', 'problem']);
  await walkBtn(page, 'S2|whole', 'treated').click();
  await expect(walkRow(page, 'S2|whole')).toContainText('Treated · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S2', zone_id: 'whole', state: 'treated' });
});

test('the banner says whether it is snowing, or that no storm is open', async ({ page }) => {
  const w = stormWorld();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'snowing', storm_id: 'ST-1', at: '2026-10-03T06:10:00.000-08:00', by_name: 'Matthew' });
  await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
});

test('with no storm row at all the banner says no storm is open', async ({ page }) => {
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
});

test('Matt lands on the live view, and opens any route to tap its walks', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  // The live view shows no walk buttons: a route opens on tap (Task 6).
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  await expect(page.locator('[data-walk]')).toHaveCount(0);
  await openRoute(page, 'R2');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toHaveCount(0); // that route only
  await expect(page.locator('#otherRoutes')).toHaveCount(0);
  await walkBtn(page, 'S2|whole', 'cleared').click();
  await expect(walkRow(page, 'S2|whole')).toContainText('Cleared · Matthew');
  expect(tapCalls(calls)).toHaveLength(1);
  // Back to the live view: the route now counts that site as done.
  await page.click('#liveBack');
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('1 of 1 sites done');
  await expect(page.locator('[data-walk]')).toHaveCount(0);
});

test('crew still land on Tonight, with a Storm tab beside it', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="storm"]')).toBeVisible();
});

// ---------------- the Storm tab: the site card ----------------
// Replaces the paper route sheet's per-site fields: depth, materials used,
// equipment minutes. Start and finish are never typed: they are the first and
// last tap at the site this shift (CrewShiftLog.siteTimes). Same 7:30 AM clock
// as above, so the shift is "night-2026-10-02" and the fake files cards there.
const EQUIP = ['blower', 'snowrator', 'bobcat', 'sweepster'];
const visitRow = (n, siteId, byKey, byName, extra = {}) => ({ id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02',
  site_id: siteId, by_key: byKey, by_name: byName, at: '2026-10-03T06:45:00.000-08:00', depth_in: '', materials_used: '',
  equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, ...extra });
const cardBtn = (page, id) => page.locator('[data-card="' + id + '"]');
const visitCalls = (calls) => calls.filter((c) => c.body.action === 'saveVisit');
const openCard = async (page, id) => { await cardBtn(page, id).click(); await expect(page.locator('#dlg')).toBeVisible(); };

// Copy for BT (Matt, 10/3/26): the lead copies the text and posts it in BuilderTrend
// as themselves. The app never talks to BT; this only fills the clipboard.
const stubClipboard = (page) => page.addInitScript(() => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
});
test('the lead copies a site\'s BT note and sees the times to type', async ({ page }) => {
  // PAC: Main entry cleared 6:30 AM, Heated walk checked 6:45 AM, both this shift (night of 10/2, clock 7:30 AM).
  // Walks in name order: "Cleared: Main entry. Checked: Heated walk." Time in 6:30 AM, out 6:45 AM.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: '2026-10-03T06:30:00.000-08:00' }),
    logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: '2026-10-03T06:45:00.000-08:00' })];
  await stubClipboard(page);
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await openRoute(page, 'R1');
  await page.locator('[data-bt="S1"]').click();
  await expect(page.locator('#bt_in')).toHaveText('6:30 AM');
  await expect(page.locator('#bt_out')).toHaveText('6:45 AM');
  await expect(page.locator('#bt_text')).toHaveValue('Cleared: Main entry. Checked: Heated walk.');
  await page.click('#bt_copy');
  await expect(page.locator('#toast')).toContainText('Copied');
  expect(await page.evaluate(() => window.__copied)).toEqual(['Cleared: Main entry. Checked: Heated walk.']);
  // Nothing is sent anywhere: copying makes no server call.
  expect(calls.filter((c) => !['bootstrap', 'getShiftLog', 'getPost', 'getZones'].includes(c.body.action))).toEqual([]);
});
test('crew have no Copy for BT button; Matt does', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('[data-walkrow="S1|Z1"]')).toBeVisible();
  await expect(page.locator('[data-bt]')).toHaveCount(0);
});
test('Matt sees Copy for BT on a route he opens', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await expect(page.locator('[data-bt="S1"]')).toBeVisible();
});

test('the site card sends depth, materials and ticked equipment minutes only', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  // Minutes cannot be typed until the machine is ticked.
  await expect(page.locator('[data-eqmin="blower"]')).toBeDisabled();
  await page.fill('#vc_depth', '3.5');
  await page.fill('#vc_mat', 'salt, 2 bags');
  await page.check('[data-eq="blower"]');
  await expect(page.locator('[data-eqmin="blower"]')).toBeEnabled();
  await page.fill('[data-eqmin="blower"]', '30');
  await page.check('[data-eq="bobcat"]');
  await page.fill('[data-eqmin="bobcat"]', '45');
  // Ticked, typed, then unticked: the minutes are not sent.
  await page.check('[data-eq="snowrator"]');
  await page.fill('[data-eqmin="snowrator"]', '99');
  await page.uncheck('[data-eq="snowrator"]');
  await expect(page.locator('[data-eqmin="snowrator"]')).toBeDisabled();
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  const body = visitCalls(calls)[0].body;
  // Worked out: 3.5 in; the text as typed; blower 30 and bobcat 45; snowrator and sweepster unticked = blank.
  expect(body).toMatchObject({ action: 'saveVisit', site_id: 'S1', depth_in: 3.5, materials_used: 'salt, 2 bags',
    equipment: { blower: 30, snowrator: '', bobcat: 45, sweepster: '' } });
  expect(Object.keys(body.equipment).sort()).toEqual([...EQUIP].sort());
  // The server knows who, when and which shift: the phone sends none of it, nor start/finish.
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'shift_id', 'storm_id', 'seq', 'start', 'finish']) expect(body).not.toHaveProperty(k);
  expect(w.visits).toHaveLength(1);
  expect((await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
});

test('blank fields are sent blank, never 0', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  // Nothing typed, nothing ticked: depth, materials and every machine go as ''.
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const first = visitCalls(calls)[0].body;
  expect(first.depth_in).toBe('');
  expect(first.materials_used).toBe('');
  expect(first.equipment).toEqual({ blower: '', snowrator: '', bobcat: '', sweepster: '' });
  // A typed zero is a real answer and is sent as 0.
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '0');
  await page.check('[data-eq="blower"]');
  await page.fill('[data-eqmin="blower"]', '0');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const second = visitCalls(calls)[1].body;
  expect(second.depth_in).toBe(0);
  expect(second.equipment).toEqual({ blower: 0, snowrator: '', bobcat: '', sweepster: '' });
  expect(second.materials_used).toBe('');
});

test('a ticked machine needs minutes before it saves', async ({ page }) => {
  // Ticking says "this machine was used"; saved blank, the tick would be lost on reopening.
  // Blower ticked with no minutes, Bobcat also ticked with none: the first (Blower, in card order) is named.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  await page.check('[data-eq="bobcat"]');
  await page.check('[data-eq="blower"]');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('Add minutes for Blower, or untick it');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(visitCalls(calls)).toHaveLength(0);
  expect(w.visits || []).toHaveLength(0);
  // Blower filled in: now Bobcat is the one named, still nothing sent.
  await page.fill('[data-eqmin="blower"]', '30');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toHaveText('Add minutes for Bobcat, or untick it');
  expect(visitCalls(calls)).toHaveLength(0);
  // Untick it (unticked machines go as ''), and Save sends the minutes typed.
  await page.uncheck('[data-eq="bobcat"]');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  expect(visitCalls(calls)[0].body.equipment).toEqual({ blower: 30, snowrator: '', bobcat: '', sweepster: '' });
});

test('materials needed is printed beside materials used', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, materials_needed: '4-5 bags <b>IceMelt</b>' } : s));
  await openStorm(page, w);
  await openCard(page, 'S1');
  // Same row as the input, shown as text (the markup is not run).
  await expect(page.locator('.vc-matrow #vc_mat')).toHaveCount(1);
  await expect(page.locator('.vc-matrow #vc_needed')).toHaveText('Needed: 4-5 bags <b>IceMelt</b>');
  await expect(page.locator('#vc_needed b')).toHaveCount(0);
  // The typed box starts empty: the needed list is a hint, not an answer.
  await expect(page.locator('#vc_mat')).toHaveValue('');
  await page.click('#dlgClose');
  // A site with none listed prints no "Needed".
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('#vc_needed')).toHaveCount(0);
});

test('start and finish come from the first and last tap, not typed', async ({ page }) => {
  // Seeded taps at S1 this shift: 6:30 AM (L-1) and 7:10 AM (L-2). Not counted: a tap at
  // S1 on another shift (L-3, 1:00 AM 10/1). S2 has none.
  // The fake stamps Jordan's own tap at 7:50:18 AM: finish moves to 7:50 AM, start stays 6:30 AM.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: '2026-10-03T06:30:00.000-08:00' }),
    logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: '2026-10-03T07:10:00.000-08:00' }),
    logRow(3, 'S1', 'Z1', 'treated', 'Alex Test', { storm_id: 'ST-0', shift_id: 'day-2026-10-01', at: '2026-10-01T01:00:00.000-08:00' })];
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  await expect(page.locator('#vc_start')).toHaveText('6:30 AM');
  await expect(page.locator('#vc_finish')).toHaveText('7:10 AM');
  // Read-only: not form fields.
  expect(await page.locator('#vc_start, #vc_finish').evaluateAll((els) => els.map((e) => e.tagName))).not.toContain('INPUT');
  await page.click('#dlgClose');
  await walkBtn(page, 'S1|Z1', 'treated').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo · 7:50 AM');
  await openCard(page, 'S1');
  await expect(page.locator('#vc_start')).toHaveText('6:30 AM');
  await expect(page.locator('#vc_finish')).toHaveText('7:50 AM');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  for (const k of ['start', 'finish']) expect(visitCalls(calls)[0].body).not.toHaveProperty(k);
  // A site nobody has tapped yet shows a dash, not a time.
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('#vc_start')).toHaveText('—');
  await expect(page.locator('#vc_finish')).toHaveText('—');
});

test('reopening the card shows your own last save, not someone else\'s', async ({ page }) => {
  // S1, this shift (night-2026-10-02). Jordan (C03) saved V-1; Alex (C01) saved V-2
  // and then V-5, so the newest card on the site is Alex's, and Jordan must still see V-1.
  // Not Jordan's: V-3 (S1 on an earlier shift) and V-4 (another site).
  const w = stormWorld();
  w.visits = [
    visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 2, materials_used: 'salt', equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: 0 } }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: 9, materials_used: 'sand', equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } }),
    visitRow(3, 'S1', 'C03', 'Jordan Demo', { storm_id: 'ST-0', shift_id: 'day-2026-10-01', depth_in: 7, materials_used: 'old shift' }),
    visitRow(4, 'S2', 'C03', 'Jordan Demo', { depth_in: 5, materials_used: 'other site' }),
    visitRow(5, 'S1', 'C01', 'Alex Test', { depth_in: 11, materials_used: 'alex again' })];
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('2');
  await expect(page.locator('#vc_mat')).toHaveValue('salt');
  await expect(page.locator('[data-eq="blower"]')).toBeChecked();
  await expect(page.locator('[data-eqmin="blower"]')).toHaveValue('20');
  await expect(page.locator('[data-eq="sweepster"]')).toBeChecked();   // a saved 0 is a real answer: ticked, shows 0
  await expect(page.locator('[data-eqmin="sweepster"]')).toHaveValue('0');
  await expect(page.locator('[data-eq="bobcat"]')).not.toBeChecked(); // Alex's 45 is not Jordan's
  await expect(page.locator('[data-eqmin="bobcat"]')).toHaveValue('');
  // Change the depth and save: that re-save is Jordan's newest card (V-6).
  await page.fill('#vc_depth', '4');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)[0].body).toMatchObject({ depth_in: 4, materials_used: 'salt', equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: 0 } });
  expect(w.visits).toHaveLength(6);
  expect(w.visits[5]).toMatchObject({ by_key: 'C03', depth_in: 4 });
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('4');
  await expect(page.locator('#vc_mat')).toHaveValue('salt');
});

test('Matt\'s card starts blank when only crew have saved one', async ({ page }) => {
  const w = stormWorld();
  w.visits = [visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 2, materials_used: 'salt', equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: '' } })];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openRoute(page, 'R1'); // Matt lands on the live view; the card is on the route's page
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('');
  await expect(page.locator('#vc_mat')).toHaveValue('');
  await expect(page.locator('[data-eq="blower"]')).not.toBeChecked();
  await page.fill('#vc_depth', '1');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(w.visits[1]).toMatchObject({ by_key: 'admin', depth_in: 1 });
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('1'); // his own now
  expect(visitCalls(calls)).toHaveLength(1);
});

test('a card refused for no open storm says so and stays open; a double tap on Save sends one', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 600 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.evaluate(() => { const b = document.querySelector('#vc_save'); b.click(); b.click(); });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  expect(w.visits).toHaveLength(1);
  // Matt ends the storm while the card is open: the refusal shows on the card and nothing is saved.
  await openCard(page, 'S1');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toHaveText('No storm is open');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(w.visits).toHaveLength(1);
  await expect(page.locator('#vc_save')).toBeEnabled(); // can try again once the busy lock is released
});

// ---------------- the Storm tab: the live view and storm controls (Matt and leads) ----------------
// Matt and the leads land on the live view: Problems in red on top, then every
// route with how far along it is. Tapping a route opens it as the crew see it.
// Crew never get the live view or the controls (the server refuses them too).
const stormCalls = (calls) => calls.filter((c) => c.body.action === 'stormAction');
const at = (hhmm) => '2026-10-03T' + hhmm + ':00.000-08:00';
const ctl = (page, kind) => page.locator('[data-storm="' + kind + '"]');

test('problems show first, in red, with the note and who', async ({ page }) => {
  // Newest row per walk in storm ST-1, worked by hand:
  //   S1|Z1    L1 problem (Alex, 6:30, "ice under the mat")           -> a problem
  //   S1|Z2    L2 problem (Alex, 6:35), then L3 checked (Jordan, 6:40) -> checked: NOT a problem
  //   S2|whole L4 problem (Jordan, 6:50, "drain blocked")             -> a problem
  // Newest first by seq: L4 (TUDOR-TRANSIT, Whole site) then L1 (PAC, Main entry).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice under the mat', at: at('06:30') }),
    logRow(2, 'S1', 'Z2', 'problem', 'Alex Test', { note: 'heat cable dead', at: at('06:35') }),
    logRow(3, 'S1', 'Z2', 'checked', 'Jordan Demo', { by_key: 'C03', at: at('06:40') }),
    logRow(4, 'S2', 'whole', 'problem', 'Jordan Demo', { note: 'drain blocked', by_key: 'C03', at: at('06:50') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#problems')).toBeVisible();
  expect(await page.locator('[data-problem]').evaluateAll((els) => els.map((e) => e.dataset.problem))).toEqual(['S2|whole', 'S1|Z1']);
  const first = page.locator('[data-problem="S2|whole"]'), second = page.locator('[data-problem="S1|Z1"]');
  for (const t of ['TUDOR-TRANSIT', 'Whole site', 'drain blocked', 'Jordan Demo', '6:50 AM']) await expect(first).toContainText(t);
  for (const t of ['PAC', 'Main entry', 'ice under the mat', 'Alex Test', '6:30 AM']) await expect(second).toContainText(t);
  await expect(page.locator('#problems')).not.toContainText('heat cable dead'); // a problem since marked Checked is not one
  // Red (--warn, #b3261e in the light theme), and above every route.
  expect(await page.locator('#problems h2').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(179, 38, 30)');
  const problemsY = (await page.locator('#problems').boundingBox()).y, routeY = (await page.locator('[data-liveroute]').first().boundingBox()).y;
  expect(problemsY).toBeLessThan(routeY);
});

// Routes N1 (PAC, EXTRA), N10 (NEWSITE), N2 (TUDOR-TRANSIT), stored in that order.
const liveWorld = () => {
  const w = stormWorld();
  w.sites = [...w.sites, { id: 'S3', name: 'EXTRA', rev: 1 }, { id: 'S4', name: 'NEWSITE', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S3'] }, { id: 'R3', name: 'N10', rev: 1, site_ids: ['S4'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  return w;
};

// Matt, 10/3/26: with no current Post, his live view shows who the Board has on
// each route, marked as not posted. Leads never get the Board, so they keep
// seeing "Not posted" until he posts.
const boardMoves = () => [
  { id: 'M1', at: '2026-10-02T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' },
  { id: 'M2', at: '2026-10-02T17:01:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' },
];
test('with no current post, Matt sees the Board on each route, marked not posted', async ({ page }) => {
  // No post at all. The Board: Alex leads N1, Jordan on N1; N2 and N10 empty.
  const w = liveWorld(); w.posts = []; w.moves = boardMoves();
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toBeVisible();
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Board, not posted yet: Alex Test (lead), Jordan Demo');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Not posted'); // nobody on the Board either
});
test('a stale post gives way to the Board; a current post wins over it', async ({ page }) => {
  // The post is for night-2026-09-30: stale at the storm clock. The Board moved Jordan to N2 since.
  const w = liveWorld(); w.posts = [{ ...POST, shift: 'night-2026-09-30' }];
  w.moves = [...boardMoves(), { id: 'M3', at: '2026-10-02T18:00:00.000-08:00', worker: 'C03', to_route: 'R2', role: 'member' }];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Board, not posted yet: Alex Test (lead)');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Board, not posted yet: Jordan Demo');
});
test('a current post is shown even when the Board has changed since', async ({ page }) => {
  // stormWorld's post is for the current shift (Alex leads N1, Jordan on N1). The Board says Jordan moved to N2.
  const w = liveWorld();
  w.moves = [...boardMoves(), { id: 'M3', at: '2026-10-02T18:00:00.000-08:00', worker: 'C03', to_route: 'R2', role: 'member' }];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Alex Test (lead), Jordan Demo');
});
// Part A (Matt, 10/4/26, Q5): the live view and storm controls come from LEADING a route on
// tonight's posted Board, not the roster flag. With no post yet, a roster lead gets the crew
// view: the walk buttons (the server's live Board decides), no live view, no controls.
test('a roster lead with no current post gets the crew view, never the Board', async ({ page }) => {
  const w = liveWorld(); w.posts = []; w.moves = boardMoves();
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('#stormctl')).toHaveCount(0);
});

test('a route shows how many sites are done', async ({ page }) => {
  // N1 = PAC (Z1 sidewalk cleared 6:30, Z2 heated checked 6:40: both walks done -> done) + EXTRA (no zones,
  // its one Whole-site walk untapped -> not done): 1 of 2. Last tap 6:40.
  // N2 = TUDOR-TRANSIT untapped: 0 of 1, no taps yet. N10 = NEWSITE untapped: 0 of 1.
  // Numeric order is N1, N2, N10 (not N1, N10, N2). The post names Alex (lead) and Jordan on N1.
  const w = liveWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') }), logRow(2, 'S1', 'Z2', 'checked', 'Jordan Demo', { by_key: 'C03', at: at('06:40') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  expect(await page.locator('[data-liveroute]').evaluateAll((els) => els.map((e) => e.dataset.liveroute))).toEqual(['R1', 'R2', 'R3']);
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('1 of 2 sites done');
  await expect(page.locator('[data-liveroute="R1"] progress')).toHaveAttribute('value', '1');
  await expect(page.locator('[data-liveroute="R1"] progress')).toHaveAttribute('max', '2');
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Alex Test (lead), Jordan Demo');
  await expect(page.locator('[data-liveroute="R1"] .live-last')).toHaveText('Last tap 6:40 AM');
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('0 of 1 sites done');
  await expect(page.locator('[data-liveroute="R2"] progress')).toHaveAttribute('value', '0');
  await expect(page.locator('[data-liveroute="R2"] .live-last')).toHaveText('No taps yet');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Alex Test (lead)');
  await expect(page.locator('[data-liveroute="R3"] .live-count')).toHaveText('0 of 1 sites done');
  await expect(page.locator('[data-liveroute="R3"] .live-who')).toHaveText('Not posted'); // N10 is not on the post
  // Site totals under each site: Jordan's and Alex's cards at PAC, shift night-2026-10-02 (the fake's shift).
  w.visits = [visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 3.5, materials_used: 'salt', equipment: { blower: 30, snowrator: '', bobcat: '', sweepster: '' } }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: 2, materials_used: 'sand', equipment: { blower: 15, snowrator: '', bobcat: 45, sweepster: '' } })];
  await pollNow(page);
  // Worked out: blower 30 + 15 = 45, bobcat 45, nothing logged for the others; depth per person.
  const totals = page.locator('[data-livesite="S1"] .live-totals');
  await expect(totals).toContainText('Blower 45 min');
  await expect(totals).toContainText('Bobcat 45 min');
  await expect(totals).not.toContainText('Snowrator');
  await expect(totals).toContainText('Jordan Demo 3.5 in');
  await expect(totals).toContainText('Alex Test 2 in');
  await expect(page.locator('[data-livesite="S3"] .live-totals')).toHaveCount(0);
});

test('an off-route tap is marked in the live view', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') }),
    logRow(2, 'S2', 'whole', 'cleared', 'Jordan Demo', { by_key: 'C03', off_route: true, at: at('06:50') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-livesite="S2"] .offroute')).toBeVisible();
  await expect(page.locator('[data-livesite="S2"] .offroute')).toContainText('off-route');
  await expect(page.locator('[data-livesite="S2"]')).toContainText('Jordan Demo');
  await expect(page.locator('[data-livesite="S1"] .offroute')).toHaveCount(0); // Alex's tap was on his route
});

test('crew see no storm controls and no live view', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice under the mat', at: at('06:30') })];
  await openStorm(page, w); // Jordan
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible(); // the crew view is there
  await expect(page.locator('#stormctl')).toBeHidden();
  await expect(page.locator('#problems')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-storm]')).toHaveCount(0);
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('[data-openroute]')).toHaveCount(0);
  // Matt ends the storm: still no Start / Reopen for crew.
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('07:40'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('#stormctl')).toBeHidden();
  await expect(page.locator('[data-storm]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Start|End|Reopen) storm$/ })).toHaveCount(0);
});

test('a lead can start a storm; End asks first', async ({ page }) => {
  const w = stormWorld(); w.storms = [];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  // No storm yet: only Start. (Reopen needs a storm to reopen; the rest need one open.)
  await expect(ctl(page, 'start')).toHaveText('Start storm');
  for (const k of ['reopen', 'end', 'snowing', 'stopped', 'night_on']) await expect(ctl(page, k)).toHaveCount(0);
  // Start asks first; Cancel sends nothing.
  await ctl(page, 'start').click();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn')).toContainText('Are you sure?');
  expect(stormCalls(calls)).toHaveLength(0);
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(stormCalls(calls)).toHaveLength(0);
  await ctl(page, 'start').click();
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(stormCalls(calls)[0].body).toMatchObject({ action: 'stormAction', kind: 'start' });
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'storm_id', 'seq']) expect(stormCalls(calls)[0].body).not.toHaveProperty(k);
  expect(w.storms.map((r) => [r.kind, r.by_name])).toEqual([['start', 'Alex Test']]); // who comes from the token
  // Open: End, the Snowing|Stopped switch and Night shift on; no Start, no Reopen.
  for (const k of ['end', 'snowing', 'stopped', 'night_on']) await expect(ctl(page, k)).toBeVisible();
  for (const k of ['start', 'reopen']) await expect(ctl(page, k)).toHaveCount(0);
  await expect(ctl(page, 'stopped')).toHaveAttribute('aria-pressed', 'true');
  // End asks first.
  await ctl(page, 'end').click();
  await expect(page.locator('#dlgIn')).toContainText('Are you sure?');
  expect(stormCalls(calls)).toHaveLength(1);
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  expect(stormCalls(calls)).toHaveLength(2);
  expect(stormCalls(calls)[1].body).toMatchObject({ kind: 'end' });
  // Ended: Start and Reopen are on offer, End is gone.
  await expect(ctl(page, 'start')).toBeVisible();
  await expect(ctl(page, 'reopen')).toBeVisible();
  await expect(ctl(page, 'end')).toHaveCount(0);
  // Reopen and the switch do not ask.
  await ctl(page, 'reopen').click();
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#dlg')).toBeHidden();
  await ctl(page, 'snowing').click();
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  await expect(ctl(page, 'snowing')).toHaveAttribute('aria-pressed', 'true');
  expect(w.storms.map((r) => r.kind)).toEqual(['start', 'end', 'reopen', 'snowing']);
  expect(stormCalls(calls).map((c) => c.body.kind)).toEqual(['start', 'end', 'reopen', 'snowing']);
});

test('a refused storm control says why and the phone catches up', async ({ page }) => {
  // Another lead started a storm a moment ago: this phone has not heard yet. The
  // fake's reasons are the backend's ("End the storm first").
  const w = stormWorld(); w.storms = [];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(ctl(page, 'start')).toBeVisible();
  w.storms.push(START_ROW);
  await ctl(page, 'start').click();
  await page.click('#sc_yes');
  await expect(page.locator('#stormerr')).toHaveText('Not saved: End the storm first');
  expect(w.storms).toHaveLength(1); // nothing was written
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // caught up
  expect(stormCalls(calls)).toHaveLength(1);
});

test('a double tap on a storm control sends one', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt', delay: { stormAction: 600 } });
  await expect(ctl(page, 'snowing')).toBeVisible();
  await page.evaluate(() => { const b = document.querySelector('[data-storm="snowing"]'); b.click(); b.click(); });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(w.storms.filter((r) => r.kind === 'snowing')).toHaveLength(1);
});

test('night shift on is sent and shown', async ({ page }) => {
  // 7 PM on 10/3, no night_on yet: the day shift carries on (day-2026-10-03). The fake stamps the
  // night_on row 7 PM; at or after 9 AM the same date and already happened -> night-2026-10-03.
  const w = stormWorld(); w.clock = at('19:00');
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: at('19:00') });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(ctl(page, 'night_on')).toHaveText('Night shift on');
  await expect(ctl(page, 'night_on')).toHaveAttribute('aria-pressed', 'false');
  await ctl(page, 'night_on').click();
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(stormCalls(calls)[0].body).toMatchObject({ action: 'stormAction', kind: 'night_on' });
  expect(w.storms.at(-1)).toMatchObject({ kind: 'night_on', by_name: 'Matthew', at: at('19:00') });
  await expect(ctl(page, 'night_on')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // the weather is untouched
});

test('treated while snowing shows the yellow warning and still saves', async ({ page }) => {
  const w = stormWorld();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'snowing', storm_id: 'ST-1', at: at('06:10'), by_name: 'Matthew' });
  const calls = await openStorm(page, w, { delay: { tapZone: 500 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  const warn = page.locator('[data-warn="S1|Z1"]');
  await expect(warn).toBeHidden();
  await walkBtn(page, 'S1|Z1', 'treated').click();
  // The warning shows at once, while the tap is still on its way: the tap is not blocked.
  await expect(warn).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toHaveAttribute('aria-busy', 'true');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo · 7:50 AM');
  await expect(warn).toHaveText("It's still snowing: treated anyway");
  expect(tapCalls(calls)).toHaveLength(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S1', zone_id: 'Z1', state: 'treated' });
  expect(w.log).toHaveLength(1);
  expect(w.log[0]).toMatchObject({ state: 'treated', snowing_warned: true }); // saved, and flagged by the server
  // It stays after a poll (it comes from the saved row), and goes when the walk's newest row is not a Treated.
  await pollNow(page);
  await expect(warn).toBeVisible();
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  await expect(warn).toBeHidden(); // Cleared while snowing is fine
  expect(w.log[1]).toMatchObject({ state: 'cleared', snowing_warned: false });
  // Another walk shows no warning of its own.
  await expect(page.locator('[data-warn="S1|Z2"]')).toBeHidden();
});

// Matt, 10/1/26: Back closed the whole app mid-job. A route opened from the live
// view is one more step on the Back stack, so Back returns to the live view.
const backSteps = (page) => page.evaluate(() => (history.state && history.state.snow) || []);
const problemWorld = () => {
  const w = stormWorld();
  w.log = [logRow(1, 'S2', 'whole', 'problem', 'Jordan Demo', { note: 'drain blocked', by_key: 'C03', at: at('06:50') })];
  return w;
};

test('Back on a route opened from the live view returns to the live view', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-matt' });
  await expect(page.locator('#problems')).toBeVisible();
  await openRoute(page, 'R2');
  await expect(page.locator('#problems')).toBeHidden(); // the route's own page
  await expect.poll(() => backSteps(page)).toEqual(['route']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  expect(page.url()).toContain('index.html'); // still in the app, not gone back past it
  expect(await backSteps(page)).toEqual([]);
});

test('the in-app ‹ Live view and the phone Back agree', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-alex' }); // a lead gets the same
  await openRoute(page, 'R2');
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toBeVisible();
  // Nothing left to undo: the in-app button takes its Back step with it.
  await expect.poll(() => backSteps(page)).toEqual([]);
  // Open again: one Back returns to the live view (a stale step would eat the first Back).
  await openRoute(page, 'R2');
  await page.goBack();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#liveBack')).toBeHidden();
  expect(page.url()).toContain('index.html');
});

test('Back with a site card open closes the card, then the next Back leaves the route', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await openCard(page, 'S1');
  await expect.poll(() => backSteps(page)).toEqual(['route', 'dlg']);
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeVisible(); // still on the route
  await page.goBack();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
});

test('a route left open on the Storm tab is not still open when you come back', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R2');
  await page.click('nav [data-tab="board"]');
  await expect.poll(() => backSteps(page)).toEqual([]); // the route's step went with it
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
});

test('treated while stopped shows no warning', async ({ page }) => {
  const w = stormWorld();
  await openStorm(page, w);
  await walkBtn(page, 'S1|Z1', 'treated').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo');
  await expect(page.locator('[data-warn]')).toHaveCount(0);
  expect(w.log[0].snowing_warned).toBe(false);
});

// ---------------- the Storm tab: forecast hint and walk marks on the map ----------------
// The hint is the National Weather Service's, and only a hint: the Snowing/Stopped
// switch is what counts. A made-up point: -149.5149, 61.3351 (lng, lat as the map
// saves it) goes out as /points/61.34,-149.51, rounded to two decimals (~1 km).
// Clock 7:30 AM Alaska. The fixture's hours start at 7 AM (the current hour):
// Light Snow, Snow, Snow Showers, then Mostly Cloudy. The run of snow ends at the
// 10 AM period: "Snow until 10 AM".
const NWS_POINT = [-149.5149, 61.3351];
const NWS_POINTS = 'https://api.weather.gov/points/61.34,-149.51';
const NWS_HOURLY = 'https://api.weather.gov/gridpoints/ZZZ/1,1/forecast/hourly';
const NWS_PERIODS = ['Light Snow', 'Snow', 'Snow Showers', ...Array(9).fill('Mostly Cloudy')].map((t, i) => ({
  startTime: '2026-10-03T' + String(7 + i).padStart(2, '0') + ':00:00-08:00', shortForecast: t }));
async function nws(page, o = {}) {
  const seen = [];
  const cors = { 'access-control-allow-origin': '*' };
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => {
    const u = route.request().url();
    seen.push(u);
    if (o.fail) return route.abort();
    if (u === NWS_POINTS) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { forecastHourly: NWS_HOURLY } }) });
    if (u === NWS_HOURLY) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { periods: NWS_PERIODS } }) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return seen;
}
const withView = (w, id, center) => { w.sites = w.sites.map((s) => (s.id === id ? { ...s, map: { center, zoom: 18 } } : s)); return w; };

test('the forecast shows as a hint', async ({ page }) => {
  const seen = await nws(page);
  const calls = await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  await expect(page.locator('#stormhead + #stormhint')).toHaveCount(1); // right under the header, once
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);                       // the rounded point, never the saved one
  // Not on every poll: three more polls, and the tab left and re-entered inside 15 minutes.
  for (let i = 1; i <= 3; i++) { // one at a time: a poll already running swallows the next
    const before = shiftCalls(calls).length;
    await pollNow(page);
    await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
    await page.waitForTimeout(300); // let the reply land
  }
  await page.click('nav [data-tab="tonight"]');
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toHaveLength(2);
  // Once 15 minutes have gone by the next redraw asks again.
  await page.clock.fastForward('16:00');
  await expect.poll(() => seen.length).toBe(4);
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
});

test("the hint comes from the first site with a point (Matt's live view)", async ({ page }) => {
  // PAC (S1, N1) has no saved view and its zones have no outline: no point. TUDOR-TRANSIT
  // (S2, N2) has one: the live view's hint is from it.
  const seen = await nws(page);
  await openStorm(page, withView(stormWorld(), 'S2', NWS_POINT), { token: 'tok-matt' });
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);
  await expect(page.locator('#stormhead + #stormhint')).toHaveCount(1);
});

test('a crew member with no mapped site on their route gets no hint and no request', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, withView(stormWorld(), 'S2', NWS_POINT)); // Jordan's route is N1 (S1): no point
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveCount(0);
  expect(seen).toEqual([]);
});

test('a forecast failure shows no hint and taps still work', async ({ page }) => {
  const seen = await nws(page, { fail: true });
  const calls = await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect.poll(() => seen.length).toBeGreaterThanOrEqual(1); // it did try
  await expect(page.locator('#stormhint')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Snow until');
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)).toHaveLength(1);
  await pollNow(page);
  await expect(page.locator('#stormhint')).toHaveCount(0);
  expect(seen).toHaveLength(1); // no hammering a failing service
});

test('the map marks done and problem walks', async ({ page }) => {
  // Newest row per walk in storm ST-1, worked by hand:
  //   S1|Z1 (sidewalk, priority, so it carries a star) L1 problem  -> "!"
  //   S1|Z2 (heated)                                  L2 checked   -> tick
  //   S1|Z3 (no_touch)                                 never walked -> no mark
  //   S1|whole                                        L3 cleared: the site has drawn zones, so no
  //                                                    zone is "whole" and no mark is made for it
  // Then Jordan clears Z1 (L4) and a poll turns its "!" into a tick.
  const w = stormWorld();
  withView(w, 'S1', PAC);
  w.zones = mapWorld().zones;
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice under the mat', at: at('06:30') }),
    logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: at('06:35') }),
    logRow(3, 'S1', 'whole', 'cleared', 'Alex Test', { at: at('06:40') })];
  await tiles(page);
  await nws(page);
  await openStorm(page, w);
  await page.click('.shift-site [data-map="S1"]');
  await zoneSource(page);
  const mark = (z) => page.locator('.zone-mark[data-zone="' + z + '"]');
  await expect(page.locator('.zone-mark')).toHaveCount(2);
  await expect(mark('Z1')).toHaveText('!');
  await expect(mark('Z1')).toHaveClass(/\bbad\b/);
  await expect(mark('Z2')).toHaveText('✓');
  await expect(mark('Z2')).toHaveClass(/\bdone\b/);
  await expect(mark('Z3')).toHaveCount(0);
  // Bootprint's colours (Matt, 10/4/26), and a mark never sits on the priority star.
  expect(await page.evaluate(() => window.SnowMapView.getPaintProperty('zones-fill', 'fill-color')))
    .toEqual(['match', ['get', 'type'], 'sidewalk', '#1c6fb0', 'hand', '#d98c00', 'heated', '#d62828',
      'storage', '#7d5ba6', 'no_touch', '#e0218a', '#888888']);
  const star = await page.locator('.zone-star').boundingBox(), bang = await mark('Z1').boundingBox();
  expect(star.y + star.height <= bang.y + 1 || bang.y + bang.height <= star.y + 1 || star.x + star.width <= bang.x + 1 || bang.x + bang.width <= star.x + 1).toBe(true);
  // A new row while the map is open updates the marks.
  w.log.push(logRow(4, 'S1', 'Z1', 'cleared', 'Jordan Demo', { by_key: 'C03', at: at('07:00') }));
  await pollNow(page);
  await expect(mark('Z1')).toHaveText('✓');
  await expect(page.locator('.zone-mark')).toHaveCount(2);
  // Back lands on the Storm tab.
  await page.click('#mapback');
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('.zone-mark')).toHaveCount(0);
});

test('a map opened from the Sites tab carries no walk marks', async ({ page }) => {
  const w = stormWorld();
  withView(w, 'S1', PAC);
  w.zones = mapWorld().zones;
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice', at: at('06:30') })];
  await tiles(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await zoneSource(page);
  await expect(page.locator('.zone-star')).toHaveCount(1);
  await expect(page.locator('.zone-mark')).toHaveCount(0);
});

// ---------------- final review fixes (10/3/26) ----------------
// A post with Jordan (C03) as the member of one route only (Alex leads both, as in POST).
const postWith = (id, shift, jordanOn) => ({ ...POST, id, shift, posted_at: '2026-10-03T15:00:00.000Z',
  routes: POST.routes.map((r) => ({ ...r, members: r.id === jordanOn ? ['C03'] : [] })) });
const getPosts = (calls) => calls.filter((c) => c.body.action === 'getPost');

// F1: the Storm tab used to read the post only from bootstrap (or a visit to Tonight).
test('the Storm tab picks up a re-post: on entering the tab, every third poll, and back on screen', async ({ page }) => {
  // Bootstrap's post P1 has Jordan on N1 (PAC). Each re-post is read by a different trigger:
  //   P2 (Jordan on N2) lands while he is on Tonight   -> tapping Storm fetches it at once;
  //   P3 (Jordan on N1) lands on the Storm tab          -> ticks 1 and 2 (20 s, 40 s) do not fetch it,
  //                                                        tick 3 (60 s) does: one getPost more;
  //   P4 (Jordan on N2)                                 -> the app coming back on screen fetches it.
  // His own route is drawn open; the other one is behind "Other routes" (not opened here).
  const w = stormWorld();
  w.posts = [postWith('P1', 'night-2026-10-02', 'R1')];
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible();
  w.posts.push(postWith('P2', 'night-2026-10-02', 'R2'));
  await page.click('nav [data-tab="storm"]');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
  const before = getPosts(calls).length;
  w.posts.push(postWith('P3', 'night-2026-10-02', 'R1'));
  await page.clock.runFor(40000);
  await page.waitForTimeout(300);
  expect(getPosts(calls)).toHaveLength(before);
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible(); // still P2
  await page.clock.runFor(20000);
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S2|whole')).toHaveCount(0);
  expect(getPosts(calls)).toHaveLength(before + 1);
  w.posts.push(postWith('P4', 'night-2026-10-02', 'R2'));
  await pollNow(page);
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
});

test('after 9 AM a new day post shows the day route without visiting Tonight', async ({ page }) => {
  // 8:59:30 AM: the night post (night-2026-10-02) has Jordan on N1. Matt posts the day shift
  // (day-2026-10-03) with Jordan on N2. Ticks at about 8:59:50, 9:00:10, 9:00:30; the third reads the
  // post. From 9:00 the night post is stale, so without that read Jordan would be told he is on no
  // route until he happened to open Tonight. The 9 AM rule itself is unchanged.
  const w = stormWorld();
  w.posts = [postWith('P1', 'night-2026-10-02', 'R1')];
  await openStorm(page, w, { clockAt: '2026-10-03T08:59:30-08:00' });
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  w.posts.push(postWith('P2', 'day-2026-10-03', 'R2'));
  await page.clock.runFor(60000);
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(page.locator('h2.shift-route', { hasText: 'Your route' })).toContainText('N2');
  await expect(page.locator('main')).not.toContainText("You're not on a route this shift");
  await expect(page.locator('nav [data-tab="storm"][aria-current="page"]')).toBeVisible(); // never left Storm
});

// F2: a request that never answers used to hang the walk (and the polling) for good.
test('a tap the server never answers says not saved after 45 s, with Retry', async ({ page }) => {
  // Apps Script waits up to 25 s for its lock, so 45 s with no answer means it is not coming.
  const net = { hang: true };
  const calls = await openStorm(page, stormWorld(), { hangIf: (b) => net.hang && b.action === 'tapZone' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(44000);
  await page.waitForTimeout(300);
  await expect(walkRow(page, 'S1|Z1')).toHaveAttribute('aria-busy', 'true'); // 44 s: still waiting
  await expect(page.locator('[data-retry="S1|Z1"]')).toHaveCount(0);
  await page.clock.runFor(1000);
  const fail = page.locator('[data-walkrow="S1|Z1"] .walk-fail');
  await expect(fail).toBeVisible();
  await expect(fail).toContainText('Not saved: no signal');
  await expect(page.locator('[data-retry="S1|Z1"]')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).not.toHaveAttribute('aria-busy', 'true');
  await expect(walkRow(page, 'S1|Z1')).not.toContainText('Jordan Demo'); // nothing shown as done
  net.hang = false;
  await page.click('[data-retry="S1|Z1"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)).toHaveLength(2);
});

test('a poll the server never answers does not stop the polls after it', async ({ page }) => {
  // Poll 1 answers (entering the tab). Poll 2 (the 20 s tick) never answers. The ticks at 40 s and
  // 60 s find it still running and ask nothing. Its 45 s timeout ends it at 65 s; the 80 s tick asks
  // again (poll 3) and brings Alex's tap.
  const net = { hang: false };
  const w = stormWorld();
  const calls = await openStorm(page, w, { hangIf: (b) => net.hang && b.action === 'getShiftLog' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(shiftCalls(calls)).toHaveLength(1);
  net.hang = true;
  await page.clock.runFor(20000);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  net.hang = false;
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test')];
  await page.clock.runFor(40000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(2);
  await page.clock.runFor(20000);
  await expect.poll(() => shiftCalls(calls).length).toBe(3);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Alex Test');
});

// F4: zones came only from bootstrap, so a site Matt drew mid-storm refused every Whole-site tap.
test('a zone Matt draws mid-storm replaces Whole site after the refused tap', async ({ page }) => {
  // TUDOR-TRANSIT (S2) had no zones at bootstrap: one Whole-site walk. Matt draws "Front walk" (Z9,
  // sidewalk) there. With a drawn zone the site has no whole walk, so the server refuses Jordan's
  // Whole-site tap ("That zone is not walked at this site") and writes nothing. The phone reloads the
  // zones once and shows Front walk instead, and says the tap was not saved.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await page.click('#otherRoutes');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  w.zones = [...w.zones, { id: 'Z9', site_id: 'S2', type: 'sidewalk', name: 'Front walk', rev: 1 }];
  await walkBtn(page, 'S2|whole', 'cleared').click();
  await expect(walkBtn(page, 'S2|Z9', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S2|whole')).toHaveCount(0);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('TUDOR-TRANSIT');
  await expect(page.locator('#toast')).toContainText('Not saved');
  expect(calls.filter((c) => c.body.action === 'getZones')).toHaveLength(1);
  expect(w.log || []).toHaveLength(0);
  await walkBtn(page, 'S2|Z9', 'cleared').click();
  await expect(walkRow(page, 'S2|Z9')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls).at(-1).body).toMatchObject({ site_id: 'S2', zone_id: 'Z9', state: 'cleared' });
});

test('coming back on screen reloads the zones', async ({ page }) => {
  // Matt archives Main entry (Z1) at PAC while Jordan's phone is in his pocket. Back on screen:
  // that walk is gone and Heated walk (Z2) is still there.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
  w.zones = w.zones.map((z) => (z.id === 'Z1' ? { ...z, archived: true, rev: 2 } : z));
  await pollNow(page);
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
  await expect(walkRow(page, 'S1|Z2')).toBeVisible();
  expect(calls.filter((c) => c.body.action === 'getZones')).toHaveLength(1);
});

// F5: the card's save answered into whatever dialog was open by then.
test('a slow card save, cancelled, never closes or writes into the next card', async ({ page }) => {
  // Card A (PAC) saves slowly; Jordan cancels it, opens card B (TUDOR-TRANSIT), types, and taps Save
  // while A is still on its way: B says so and sends nothing. Then A lands: B stays open with its
  // typing and no word from A in it (a toast about A is fine only if it names PAC). Then B saves.
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await page.fill('#vc_mat', 'sand, 1 bag');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('Still saving the last card… try again in a moment');
  expect(visitCalls(calls)).toHaveLength(1);
  // A lands.
  await expect.poll(async () => (await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
  await page.waitForTimeout(300);
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn h2')).toHaveText('Site card: TUDOR-TRANSIT');
  await expect(page.locator('#vc_depth')).toHaveValue('7');
  await expect(page.locator('#vc_mat')).toHaveValue('sand, 1 bag');
  await expect(page.locator('#vc_err')).toHaveText(''); // the "still saving" note is gone, and A wrote nothing here
  if (await page.locator('#toast').isVisible()) await expect(page.locator('#toast')).toContainText('PAC');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(2);
  expect(visitCalls(calls)[1].body).toMatchObject({ site_id: 'S2', depth_in: 7, materials_used: 'sand, 1 bag' });
  expect(w.visits.map((v) => v.site_id)).toEqual(['S1', 'S2']);
});

test('a cancelled card whose save fails says so by name, not inside the next card', async ({ page }) => {
  // Same sequence, but Matt ends the storm before A lands: A is refused. B must not show A's
  // refusal; the toast names PAC.
  const w = stormWorld();
  await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await expect(page.locator('#toast')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#toast')).toContainText('PAC');
  await expect(page.locator('#toast')).toContainText('No storm is open');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('');
  await expect(page.locator('#vc_depth')).toHaveValue('7');
});

// ---------------- route sheets (sub-project 5, 10/3/26) ----------------
// A truck per route and shift (newest row wins), unit numbers on a site, the Print
// view (every sheet, one per page) and the Sheets status line.
// The storm clock above (7:30 AM on 10/3) is still the night of 10/2, and the fake
// files every row there, so a truck set in these tests belongs to this shift.
const SHIFT = 'night-2026-10-02';
const truckRow = (n, routeId, truck, by = 'Matthew', byKey = 'admin') => ({ id: 'T-' + n, seq: n, route_id: routeId, shift_id: SHIFT, truck, by_key: byKey, by_name: by, at: at('06:10') });
const truckCalls = (calls) => calls.filter((c) => c.body.action === 'setTruck');
// The post of this shift: N1 led by Alex (C01) with Jordan, N2 led by Alex. `o.R1` / `o.R2` override a route's fields.
const postOf = (o = {}) => ({ ...POST, shift: SHIFT, routes: [
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'], truck: null, ...(o.R1 || {}) },
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [], truck: null, ...(o.R2 || {}) }] });
// The window's print dialog is not opened in a test: count the asks instead.
const stubPrint = (page) => page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });

test("Matt sets a route's truck on the Board and it is sent", async ({ page }) => {
  // The storm clock (7:30 AM on 10/3) has the post for the night of 10/2 current, but the day and night of
  // 10/3 are on offer too, so the Board asks (10/4/26); Matt picks the night of 10/2, the post's own.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
  // Blank until someone sets it: never a made-up truck.
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('');
  await page.fill('[data-truckinput="R1"]', ' T-14 ');
  await page.click('[data-settruck="R1"]');
  await page.click('[data-shift="' + SHIFT + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/2');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  // The phone names the route, the truck and the shift (the current post's); the server stamps who and when.
  expect(Object.keys(truckCalls(calls)[0].body).sort()).toEqual(['action', 'route_id', 'shift', 'token', 'truck']);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: SHIFT }); // trimmed
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  // Any route: N2 too, and N1 keeps its own.
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: SHIFT });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('T-9');
});

// Final review C1. 4 PM on 10/3, no storm, no night_on: the shift running is the DAY of 10/3. Matt posted
// the night of 10/3 at 3:30 and sets N1's truck for it. Worked by hand: the Board sends shift
// night-2026-10-03 (the current post's), the server files it there, and every screen shows that
// shift's truck: the Board box keeps T-14 after the save, and Matt's live view says "Truck: T-14".
// (Shown for the running day shift instead, both would be blank: the bug.)
const NIGHT3 = 'night-2026-10-03';
const AT_4PM = '2026-10-03T16:00:00-08:00';
test('a truck set at 4 PM for the posted night is sent with that shift and shown after the save', async ({ page }) => {
  const w = stormWorld();
  w.storms = [];
  w.clock = '2026-10-03T16:00:30.000-08:00';
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: '2026-10-03T15:30:00.000-08:00' }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  await expect(page.locator('#dlg')).toBeHidden();                       // a current post: nothing to ask
  expect(w.trucks.map((t) => [t.route_id, t.shift_id, t.truck])).toEqual([['R1', NIGHT3, 'T-14']]);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-liveroute="R1"] [data-truckrow="R1"]')).toHaveText('Truck: T-14');
  await expect(page.locator('[data-liveroute="R2"] [data-truckrow="R2"]')).toHaveText('Truck: —');
});

test('with no current post, the Board asks once which shift its trucks are for', async ({ page }) => {
  // 4 PM on 10/3, nothing posted. The first Save asks (the shifts on offer at 4 PM: Day of 10/3, Night of
  // 10/3, none picked); Matt picks the night. The second route's Save does not ask again.
  const w = stormWorld();
  w.storms = []; w.posts = [];
  w.clock = '2026-10-03T16:00:30.000-08:00';
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: nothing is posted, so Save asks which shift');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('.shiftpick [data-shift]')).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);
  expect(truckCalls(calls)).toHaveLength(0);                             // nothing is sent before the pick
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('T-9');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
});

// Truck shift fix (10/4/26). In the afternoon the DAY post is still current, but Matt is planning TONIGHT:
// filing his trucks under the post's shift put them on the day sheet and left tonight's blank. So when a
// later shift is on offer, the Board asks Day or Night (from the post's shift on; none pre-picked), and
// Change re-opens the same question. The pick lasts until reload, never stored.
const DAY3 = 'day-2026-10-03';
const dayPostWorld = (clock) => {
  const w = stormWorld();
  w.storms = [];
  w.clock = clock;
  w.posts = [{ ...postOf(), shift: DAY3, posted_at: '2026-10-03T09:30:00.000-08:00' }];
  return w;
};
const pickerLabels = (page) => page.locator('.shiftpick [data-shift]');

test('a day post at 4 PM: Save asks Day or Night and Night files the truck under tonight', async ({ page }) => {
  // 4:00 PM on 10/3. Day post of 10/3 current. Shifts on offer: Day of 10/3, Night of 10/3 (both at or after
  // the post's day). Night is LATER than the post's shift, so Save must ask, offering exactly those two.
  const w = dayPostWorld('2026-10-03T16:00:30.000-08:00');
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);   // none pre-picked
  expect(truckCalls(calls)).toHaveLength(0);                                       // nothing sent before the pick
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  expect(w.trucks.map((t) => [t.route_id, t.shift_id, t.truck])).toEqual([['R1', NIGHT3, 'T-14']]);
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  // A second Save does not ask again.
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
  // The pick is never stored: after a reload the Board asks again.
  await page.reload();
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
});

test('a night post at 20:00 never asks', async ({ page }) => {
  // 8:00 PM on 10/3: shifts on offer are Day of 10/3 and Night of 10/3. The night post is the last shift
  // on offer, nothing is later, so its shift is sent with no picker.
  const w = stormWorld();
  w.storms = [];
  w.clock = at('20:00');
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: at('19:30') }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: at('20:00') });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
});

test("Change switches the Board's truck shift", async ({ page }) => {
  // 4 PM, day post current. Change opens the same Day/Night question; Day is picked, the label follows and
  // the next Save sends the day; Change again to Night and the label and the next Save follow that.
  const w = dayPostWorld('2026-10-03T16:00:30.000-08:00');
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await page.click('#truckchange');
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);
  await page.click('[data-shift="' + DAY3 + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Day of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  await expect(page.locator('#dlg')).toBeHidden();                                 // Change answered it: no second question
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: DAY3 });
  await page.click('#truckchange');
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
});

test("Change offers nothing earlier than the post's shift", async ({ page }) => {
  // 7:30 AM on 10/3 the shifts on offer are Night of 10/2, Day of 10/3, Night of 10/3. The post is the DAY
  // of 10/3, so the night of 10/2 (already over) is not offered.
  const w = dayPostWorld('2026-10-03T07:50:18.445-08:00');
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await page.click('#truckchange');
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
});

test('the Board loads the trucks a lead set', async ({ page }) => {
  // Alex set N1's truck from his phone this shift (the night of 10/2). Matt opens the app and goes straight
  // to the Board, never the Storm tab: the Board reads the trucks itself.
  const w = stormWorld();
  w.trucks = [truckRow(1, 'R1', 'T-22', 'Alex Test', 'C01')];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('');
  expect(shiftCalls(calls).length).toBeGreaterThanOrEqual(1);
});

test('Enter in a Board truck box saves it, before the Storm tab was ever opened', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.press('[data-truckinput="R1"]', 'Enter');
  // 7:30 AM: later shifts are on offer, so Enter asks (10/4/26). The same Enter must not pick for him:
  // the picker's first button takes focus, and the key's own keypress used to click it.
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(pickerLabels(page)).toHaveText(['Night of 10/2', 'Day of 10/3', 'Night of 10/3']);
  expect(truckCalls(calls)).toHaveLength(0);
  await page.click('[data-shift="' + SHIFT + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: SHIFT });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
});

test("a lead sees the posted night's truck read-only until that night is running", async ({ page }) => {
  // 4 PM on 10/3: the day shift is running, and the post (Alex leads N1) is for the night of 10/3, with
  // Matt's truck T-14 set for it. Alex's save would be filed under the DAY (a lead's truck is always the
  // shift running), so his screen shows the night's truck read-only: no box until the night is on.
  const w = stormWorld();
  w.storms = [];
  w.moves = boardMoves();
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: '2026-10-03T15:30:00.000-08:00' }];
  w.trucks = [{ ...truckRow(1, 'R1', 'T-14'), shift_id: NIGHT3 }];
  await openStorm(page, w, { token: 'tok-alex', clockAt: AT_4PM });
  await expect(page.locator('[data-truckrow="R1"]')).toHaveText('Truck: T-14');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
});

test("a lead changes their own route's truck from the Storm tab", async ({ page }) => {
  // The Board has Alex (C01) leading N1 only. The post says Alex leads N1 and Jordan (C03) leads N2.
  // Matt set N1's truck to T-9 at 6:10 AM; Alex changes it to T-22. N2 is not his: read-only.
  const w = stormWorld();
  w.moves = boardMoves();
  w.posts = [postOf({ R2: { lead: 'C03', members: [] } })];
  w.trucks = [truckRow(1, 'R1', 'T-9')];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-9');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveCount(0);
  await expect(page.locator('[data-truckrow="R2"]')).toHaveText('Truck: —');
  await expect(page.locator('[data-settruck="R2"]')).toHaveCount(0);
  await page.fill('[data-truckinput="R1"]', 'T-22');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-22' });
  expect(truckCalls(calls)[0].body.shift).toBeUndefined(); // a lead's truck is the shift running: the server's, never the phone's
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22'); // the newest row wins over Matt's T-9
  // The same control is on the route when it is opened.
  await openRoute(page, 'R1');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22');
});

test('a refused truck says why and keeps what was typed; a blank one is not sent', async ({ page }) => {
  // The post names Alex as N1's lead, but the Board does not: the server refuses and says so.
  const w = stormWorld();
  w.moves = [];
  w.posts = [postOf()];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('[data-truckrow="R1"] .err')).toHaveText('Type the truck first');
  expect(truckCalls(calls)).toHaveLength(0);
  await page.fill('[data-truckinput="R1"]', 'T-5');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('[data-truckrow="R1"] .err')).toContainText("Only Matt or that route's lead can set its truck.");
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-5');
  expect(truckCalls(calls)).toHaveLength(1);
});

test('crew see the truck but cannot change it', async ({ page }) => {
  // Jordan rides N1 as a MEMBER (Trucks row: T-9): no box, since only the route's lead on
  // tonight's Board sets its truck (Part A, 10/4/26). N2 has no Trucks row but the post carries T-4.
  const w = stormWorld();
  w.posts = [postOf({ R1: { lead: null, members: ['C03'] }, R2: { truck: 'T-4' } })];
  w.trucks = [truckRow(1, 'R1', 'T-9')];
  await openStorm(page, w); // Jordan, crew
  await expect(page.locator('[data-truckrow="R1"]')).toHaveText('Truck: T-9');
  await page.click('#otherRoutes');
  await expect(page.locator('[data-truckrow="R2"]')).toHaveText('Truck: T-4');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
  await expect(page.locator('[data-settruck]')).toHaveCount(0);
  // Crew print nothing and see no Sheets line.
  await expect(page.locator('#printSheets')).toHaveCount(0);
  await expect(page.locator('#sheetsstatus')).toHaveCount(0);
  // Tonight shows the same two trucks.
  await page.click('nav [data-tab="tonight"]');
  await expect(page.locator('.tonight-route.mine')).toContainText('Truck: T-9');
  await expect(page.locator('.tonight-route:not(.mine)')).toContainText('Truck: T-4');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
});

test('site units are typed in the site box and sent, blank by default', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const saves = () => calls.filter((c) => c.body.action === 'saveSite');
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_bobcat')).toHaveValue('');
  await expect(page.locator('#s_snowrator')).toHaveValue('');
  await page.click('#s_save'); // nothing typed: both fields still go, blank
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[0].body.record.units).toEqual({ bobcat: '', snowrator: '' });
  await page.click('[data-edit="site:S1"]');
  await page.fill('#s_bobcat', ' B-2 ');
  await page.fill('#s_snowrator', 'SR-1');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[1].body.record.units).toEqual({ bobcat: 'B-2', snowrator: 'SR-1' });
  // They come back; clearing one on purpose is sent as blank, and the other stays.
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_bobcat')).toHaveValue('B-2');
  await expect(page.locator('#s_snowrator')).toHaveValue('SR-1');
  await page.fill('#s_bobcat', '');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[2].body.record.units).toEqual({ bobcat: '', snowrator: 'SR-1' });
  // A new site sends both too.
  await page.click('[data-edit="site:"]');
  await page.fill('#s_name', 'New Lot');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[3].body.record.units).toEqual({ bobcat: '', snowrator: '' });
});

test('Print sheets shows one page per route and shift, with not-done sites', async ({ page }) => {
  // liveWorld: N1 = PAC + EXTRA, N10 = NEWSITE, N2 = TUDOR-TRANSIT. One tap this shift: Alex cleared Main entry (PAC).
  // The post puts Alex and Jordan on N1 and Alex on N2; it does not list N10.
  // Sheets (one per route with a tap or a posted crew), in route order: N1, N2. N10 has neither: no sheet.
  //   N1: PAC prints its tap and "Heated walk: Not done"; EXTRA has no tap at all: "Not done this shift".
  //   N2: nobody tapped, but a crew was posted: TUDOR-TRANSIT "Not done this shift".
  const w = liveWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') })];
  w.posts = [postOf()];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0)).toContainText('Route N1');
  await expect(sheets.nth(0)).toContainText('Night of 10/2');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'PAC' })).toContainText('Main entry: Cleared');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'PAC' })).toContainText('Heated walk: Not done');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'EXTRA' })).toContainText('Not done this shift');
  await expect(sheets.nth(1)).toContainText('Route N2');
  await expect(sheets.nth(1).locator('.site').filter({ hasText: 'TUDOR-TRANSIT' })).toContainText('Not done this shift');
  await expect(page.locator('#printsheets')).not.toContainText('NEWSITE');
  // One page each: a break after every sheet but the last.
  expect(await sheets.nth(0).evaluate((e) => getComputedStyle(e).breakAfter)).toBe('page');
  expect(await sheets.nth(1).evaluate((e) => getComputedStyle(e).breakAfter)).toBe('auto');
  // The print dialog is asked for once, and again from the Print button.
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  await page.click('#printNow');
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(2);
  // The sheet's own style does not leak into the app (its body rule would restyle the whole page).
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('header h1')).fontFamily)).not.toMatch(/Arial/);
});

test('Back closes the print view', async ({ page }) => {
  await stubPrint(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual(['print']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#printview')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2); // the live view, still in the app
  expect(page.url()).toContain('index.html');
  expect(await backSteps(page)).toEqual([]);
  // The in-app Back takes its step with it, so the next phone Back is not eaten by a stale one.
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await page.click('#printBack');
  await expect(page.locator('#printview')).toBeHidden();
  await expect.poll(() => backSteps(page)).toEqual([]);
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#printview')).toBeHidden();
  expect(page.url()).toContain('index.html');
});

test('the sheets status shows saved, failed with Retry, and making', async ({ page }) => {
  // Storm ST-1: Start (seq 1), End (2), Reopen (3), End again (4). The newest End is seq 4, so only
  // Sheets rows with end_seq 4 count, and the newest row per route and shift wins.
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' },
    { id: 'ST-3', seq: 3, kind: 'reopen', storm_id: 'ST-1', at: at('09:00'), by_name: 'Matthew' },
    { id: 'ST-4', seq: 4, kind: 'end', storm_id: 'ST-1', at: at('10:00'), by_name: 'Matthew' }];
  const sh = (n, route, endSeq, status) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', route_id: route, shift_id: SHIFT, end_seq: endSeq,
    file_id: status === 'saved' ? 'f' + n : '', url: status === 'saved' ? 'https://drive.example/f' + n : '', name: (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf',
    made_at: at('15:01'), status, error: status === 'failed' ? 'Drive said no' : '', updated: endSeq === 4, by_name: 'Sidewalk' });
  // The first End's set: one saved, one failed. They belong to End 2, which is no longer the newest.
  w.sheets = [sh(1, 'R1', 2, 'saved'), sh(2, 'R2', 2, 'failed')];
  const fake = {};
  // The clock is pinned at 10:05, five minutes after End 4 (10:00): too soon to offer Retry on "making".
  const calls = await openStorm(page, w, { token: 'tok-matt', fake, clockAt: at('10:05') });
  const status = page.locator('#sheetsstatus');
  const retries = () => calls.filter((c) => c.body.action === 'retrySheets');
  // The newest End (4) has no Sheets row yet: making. The old End's failed row is not counted.
  await expect(status).toBeVisible();
  await expect(status).toHaveText('Sheets: making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // End 4's files: N1 saved, N2 failed -> "1 not saved", with Retry.
  w.sheets.push(sh(3, 'R1', 4, 'saved'), sh(4, 'R2', 4, 'failed'));
  await pollNow(page);
  await expect(status).toHaveText('Sheets: 1 not saved · Retry');
  // Retry: a double tap sends one, naming the storm; the reply says it is scheduled.
  await page.evaluate(() => { const b = document.getElementById('retrySheets'); b.click(); b.click(); });
  await expect.poll(() => retries().length).toBe(1);
  expect(retries()[0].body).toMatchObject({ storm_id: 'ST-1', token: 'tok-matt' });
  await expect(page.locator('#sheetsmsg')).toContainText('Retrying');
  // A Retry while the job is already running is queued, and the phone says so.
  fake.retryReply = { ok: true, storm_id: 'ST-1', failed: 1, owed: 1, scheduled: false, running: true };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(2);
  await expect(page.locator('#sheetsmsg')).toHaveText('Sheets are being made now; your Retry is queued');
  // The job saves N2: its newest row (seq 5) is saved, so all is saved and Retry goes.
  w.sheets.push(sh(5, 'R2', 4, 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // Open again: no line while the storm is open.
  w.storms.push({ id: 'ST-5', seq: 5, kind: 'reopen', storm_id: 'ST-1', at: at('11:00'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(status).toHaveCount(0);
});

// Ten minutes after the newest End, a sheet that has still not appeared is not "being made": the job
// never ran (or died), and Matt can Retry. Before that, only the wait is shown. The clock is pinned at
// 8:09 AM, 9 minutes after an End at 8:00, then moved to 8:11 (11 minutes after).
const endedAt8 = () => {
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  w.sheets = [];
  return w;
};
const savedRow = (n, route) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', route_id: route, shift_id: SHIFT, end_seq: 2, file_id: 'f' + n,
  url: 'https://drive.example/f' + n, name: (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf', made_at: at('08:02'), status: 'saved', error: '', updated: false, by_name: 'Sidewalk' });

test('"making" offers Retry only ten minutes after the End, and Retry answers are said', async ({ page }) => {
  const w = endedAt8(), fake = {};
  const calls = await openStorm(page, w, { token: 'tok-matt', fake, clockAt: at('08:09') });
  const retries = () => calls.filter((c) => c.body.action === 'retrySheets');
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: making…'); // 9 minutes: still waiting
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000); // 8:11, 11 minutes after the End
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: making… · Retry');
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(1);
  expect(retries()[0].body).toMatchObject({ storm_id: 'ST-1' });
  await expect(page.locator('#sheetsmsg')).toContainText('Retrying');
  // Nothing owed (the sheets arrived in the meantime): the phone says so.
  fake.retryReply = { ok: true, storm_id: 'ST-1', failed: 0, owed: 0, scheduled: false };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(2);
  await expect(page.locator('#sheetsmsg')).toHaveText('Nothing to retry.');
  // A refusal is shown with its reason.
  fake.retryReply = { ok: false, code: 'invalid', reason: 'That storm is open: its sheets are made when it is ended' };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(3);
  await expect(page.locator('#sheetsmsg')).toHaveText('Retry not sent: That storm is open: its sheets are made when it is ended');
});

test('"N of M saved" offers Retry only ten minutes after the End', async ({ page }) => {
  // The post names Alex on N1 and N2: this phone expects two sheets (N1 and N2, night of 10/2).
  // Only N1's file has been made: 1 of 2. Nothing failed, so before 10 minutes it is "making", after it Retry.
  const w = endedAt8();
  w.sheets = [savedRow(1, 'R1')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000);
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · Retry');
  // The second file lands: all saved, no Retry.
  w.sheets.push(savedRow(2, 'R2'));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test("the Sheets status, Retry and Print sheets are Matt's alone", async ({ page, browser }) => {
  // Final review I2: Print is in "Matt's live view" (the spec). A lead's phone holds no Posts but the
  // newest, so its print could differ from the PDF in Drive: leads have no Print (they have Copy for BT).
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  w.sheets = [{ id: 'SH-1', seq: 1, storm_id: 'ST-1', route_id: 'R1', shift_id: SHIFT, end_seq: 2, status: 'failed', error: 'x', name: 'N1 Night of 10-2.pdf', updated: false }];
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('#stormctl')).toBeVisible();                 // the controls drew: Reopen is there
  await expect(page.locator('#sheetsstatus')).toHaveCount(0);
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await expect(page.locator('#printSheets')).toHaveCount(0);
  // Matt, same storm, his own phone: all three.
  const matt = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await matt.newPage();
    await openStorm(p2, w, { token: 'tok-matt' });
    await expect(p2.locator('#printSheets')).toBeVisible();
    await expect(p2.locator('#sheetsstatus')).toBeVisible();
    await expect(p2.locator('#retrySheets')).toBeVisible();
  } finally { await matt.close(); }
});

test('an ended storm with nothing logged says so, with no Retry', async ({ page }) => {
  // Final review M2. Started 6:00, ended 8:00, nobody tapped, carded or was posted: no sheet is owed
  // (the server makes none and writes no Sheets row). Twenty minutes later it must not still say
  // "making…" with a Retry that can only answer "Nothing to retry".
  const w = endedAt8();
  w.posts = [];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:20') });
  await expect(page.locator('#sheetsstatus')).toBeVisible();
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: none (nothing logged)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

// Final review I1. A storm from the day of 10/2 (start 10:00) into that night. Two Posts: the DAY's
// (Jordan leads N2, nobody on N1), then the night's, which is the newest (Alex leads N1 with Jordan; N2
// empty). The Board (moved at 5 PM on 10/2) has Alex and Jordan on N1, nobody on N2.
const DAY2 = 'day-2026-10-02';
const twoPostStorm = () => {
  const w = stormWorld();
  w.storms = [{ ...START_ROW, at: '2026-10-02T10:00:00.000-08:00' }];
  w.moves = boardMoves();
  w.posts = [
    { ...postOf({ R1: { lead: null, members: [] }, R2: { lead: 'C03', members: [] } }), id: 'P-day', shift: DAY2, posted_at: '2026-10-02T09:30:00.000-08:00' },
    { ...postOf({ R2: { lead: null, members: [] } }), id: 'P-night', posted_at: '2026-10-02T17:30:00.000-08:00' },
  ];
  return w;
};

test("Print of an earlier shift shows that shift's posted crew, not the Board", async ({ page }) => {
  // Taps: Jordan cleared TUDOR-TRANSIT (N2) at 11:00 on 10/2 (day of 10/2); Alex cleared Main entry (N1)
  // at 6:30 on 10/3 (night of 10/2). Sheets, worked by hand: N2 Day of 10/2 (its tap; crew from the DAY's
  // Post: Jordan leads), N1 Night of 10/2 (its tap; the night's Post: Alex, Jordan). N1 has no day sheet
  // (no tap, empty in the day Post); N2 none at night (no tap, empty in the night Post).
  // With only the newest Post, the day sheet's crew would come from the Board: "—", "not posted".
  const w = twoPostStorm();
  w.log = [logRow(1, 'S2', 'whole', 'cleared', 'Jordan Demo', { by_key: 'C03', shift_id: DAY2, at: '2026-10-02T11:00:00.000-08:00' }),
    logRow(2, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') })];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0).locator('h1')).toHaveText('Route N2Day of 10/2');
  await expect(sheets.nth(0).locator('.head')).toContainText('Lead: Jordan Demo');
  await expect(sheets.nth(0)).not.toContainText('not posted');
  await expect(sheets.nth(1).locator('h1')).toHaveText('Route N1Night of 10/2');
  await expect(sheets.nth(1).locator('.head')).toContainText('Lead: Alex Test');
  await expect(sheets.nth(1).locator('.head')).toContainText('Crew: Jordan Demo');
});

test("the Sheets count expects an earlier shift's posted crew that logged nothing", async ({ page }) => {
  // The same storm, ended at 8:00 on 10/3. One tap: Alex, Main entry (N1), 6:30, night of 10/2. Sheets owed,
  // worked by hand: N2 Day of 10/2 (the DAY's Post sent Jordan out on N2: a true "Not done") and N1 Night
  // of 10/2 (the tap). N1's night file is saved: "1 of 2 saved", not "1 saved". Nine minutes after the End.
  const w = twoPostStorm();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' });
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') })];
  w.sheets = [savedRow(1, 'R1')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toBeVisible();
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · making…');
});

test('the print rule hides the app only while Print sheets is open', async ({ page }) => {
  // Final review M6: the @media print rule hid everything but #printview on ANY print of the app (a
  // browser's own Print, a screenshot to PDF). It now applies only while the Print view is open.
  await stubPrint(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
  await page.click('#printSheets');
  await expect(page.locator('body')).toHaveClass(/(^|\s)printing(\s|$)/);
  await expect(page.locator('header')).toBeHidden();
  await expect(page.locator('#printsheets')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });                          // the bar (and its Back) is not printed
  await page.click('#printBack');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printview')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)printing(\s|$)/);
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
});

test('a note with <b> prints as text', async ({ page }) => {
  // The note, and the site's materials line, hold markup. Both must print as the characters typed.
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, materials_needed: '<script>window.__x = 1</script>' } : s));
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: '<b>ice</b> & "mud"', at: at('06:30') })];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printsheets .note')).toHaveText('<b>ice</b> & "mud"');
  await expect(page.locator('#printsheets .note b')).toHaveCount(0);
  await expect(page.locator('#printsheets')).toContainText('<script>window.__x = 1</script>');
  await expect(page.locator('#printsheets script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

// Final review minor 1: a map opened from a drilled-in route sits on top of the route.
test('Back from a site map opened on a route returns to the route, then the live view', async ({ page }) => {
  await tiles(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('.shift-site [data-map="S1"]');
  await expect(page.locator('#mapback')).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual(['route', 'map']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#mapback')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeVisible(); // the route, not the live view
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  expect(page.url()).toContain('index.html');
  expect(await backSteps(page)).toEqual([]);
});
