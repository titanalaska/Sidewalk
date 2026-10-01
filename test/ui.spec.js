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
    const v = { version: opts.version || 'foundation-1' };
    if (body.token === 'tok-nina') return { ok: false, code: 'not_on_roster', name: 'Nina Nursery', reason: "You're signed in, but not on the snow crew yet. Ask Matt to add you.", ...v };
    const role = TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: role === 'admin' ? 'Matthew' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : 'C03' };
    if (body.action === 'bootstrap') {
      const crew = role === 'admin' ? state.crew : state.crew.map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: !!c.is_lead }));
      return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones || [], crew, ...v };
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
  await expect(page.locator('#verwarn')).toContainText('Backend out of date');
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
      return { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.', version: 'foundation-1' };
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
  await expect(page.locator('#mapwarn')).toContainText('Aerial photo unavailable');
});

test('crew have no edit-map button', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});
