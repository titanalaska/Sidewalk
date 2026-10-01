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
    const v = { version: opts.version || 'maps-1' };
    if (body.token === 'tok-nina') return { ok: false, code: 'not_on_roster', name: 'Nina Nursery', reason: "You're signed in, but not on the snow crew yet. Ask Matt to add you.", ...v };
    const role = TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: role === 'admin' ? 'Matthew' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : 'C03' };
    if (body.action === 'bootstrap') {
      const crew = role === 'admin' ? state.crew : state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: !!c.is_lead }));
      return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones || [], crew, ...v };
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
      if (!rec.id) rec.id = tab === 'crew' ? 'C99' : 'X99';
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

async function open(page, { token, snow, inv, abortSnow } = {}) {
  const calls = [];
  await page.route(isSnow, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ body, contentType: req.headers()['content-type'], method: req.method() });
    if (abortSnow) return route.abort();
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

test('a good PIN signs in, stores the token and lands on the routes', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()),
    inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : p.action === 'verifyPin' && p.id === '3' && p.pin === '3333' ? { valid: true, success: true, id: 3, name: 'Jordan Demo', status: 'approved', token: 'tok-jordan' } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '3333');
  await page.click('#si_go');
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
      return { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.', version: 'maps-1' };
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
