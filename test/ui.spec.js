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
    const v = { version: opts.version || 'shiftlog-1' };
    if (opts.expired && opts.expired.on) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    if (body.token === 'tok-nina') return { ok: false, code: 'not_on_roster', name: 'Nina Nursery', reason: "You're signed in, but not on the snow crew yet. Ask Matt to add you.", ...v };
    const role = TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: role === 'admin' ? 'Matthew' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : 'C03' };
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
    if (['getShiftLog', 'tapZone', 'undoTap', 'stormAction', 'saveVisit'].includes(body.action)) {
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
        [['log', state.log], ['storms', state.storms], ['visits', state.visits]].forEach(([t, rows]) => {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0)), last = (body.last || {})[t];
          let reset = cur > rows.length;
          if (!reset && cur >= 1 && last != null && Number(rows[cur - 1].seq) !== Number(last)) reset = true;
          out[t] = rows.slice(reset ? 0 : cur).map(view);
          out.cursor[t] = rows.length;
          out.reset[t] = reset;
        });
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
      if (body.action === 'tapZone') {
        const walk = SL.walksFor(body.site_id, state.zones || []).find((w) => w.zone_id === body.zone_id);
        if (!walk) return refuse('invalid', 'That zone is not walked at this site');
        const why = SL.checkTap({ walk, state: body.state, note: body.note });
        if (why) return refuse('invalid', why);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, zone_id: body.zone_id,
          state: body.state, note: String(body.note || ''), by_key: 'C03', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: null };
      } else {
        const t = SL.undoTarget(state.log, storm.storm_id, body.seq);
        if (!t.ok) return refuse('conflict', t.reason);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: t.row.site_id, zone_id: t.row.zone_id,
          state: t.state, note: t.note, by_key: 'C03', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: t.row.id };
      }
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
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
// the way a lost signal does (the call is still recorded first).
async function open(page, { token, snow, inv, abortSnow, clockAt, delay, abortIf } = {}) {
  const calls = [];
  // Shift choices depend on the wall clock: pin it, never trust the test's hour.
  if (clockAt) await page.clock.install({ time: new Date(clockAt) });
  await page.route(isSnow, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ body, contentType: req.headers()['content-type'], method: req.method() });
    if (abortSnow || (abortIf && abortIf(body))) return route.abort();
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
      return { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.', version: 'shiftlog-1' };
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
  const calls = await open(page, { token: o.token || 'tok-jordan', snow: fakeSnow(w, o.fake), clockAt: STORM_CLOCK, delay: o.delay, abortIf: o.abortIf });
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

test('crew see their own route\'s walks first and other routes behind a button', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped'); // first poll answered
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
  expect(first.cursor).toEqual({ log: 0, storms: 0, visits: 0 });
  expect(second.cursor).toEqual({ log: 2, storms: 1, visits: 0 });
  expect(second.last).toEqual({ log: 2, storms: 1, visits: null });
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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

test('Matt sees every route\'s walks on the Storm tab', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(page.locator('#otherRoutes')).toHaveCount(0);
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Stopped');
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
