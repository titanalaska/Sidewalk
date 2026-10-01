const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('SNOW-NOT-DEPLOYED');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');

// Inventory: names and status only, like the real getProfiles (no PINs).
const PROFILES = [
  { id: 1, name: 'Matthew', status: 'approved' },
  { id: 3, name: 'Jordan Demo', status: 'approved' },
  { id: 4, name: 'Nina Nursery', status: 'approved' },
  { id: 9, name: 'Pending Pat', status: 'pending' },
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
      return { ok: true, me, sites: state.sites, routes: state.routes, crew, ...v };
    }
    if (/^save/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      if (opts.saveReply) return { ...opts.saveReply, ...v };
      const tab = { saveCrew: 'crew', saveSite: 'sites', saveRoute: 'routes' }[body.action];
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

test('signed out shows the sign-in screen with approved names only', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  const names = await page.locator('#si_who option').allTextContents();
  expect(names).toEqual(['Choose your name', 'Jordan Demo', 'Matthew', 'Nina Nursery']);
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
  expect(opts).toEqual(['No sign-in yet', 'Jordan Demo', 'Matthew', 'Nina Nursery']);
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
