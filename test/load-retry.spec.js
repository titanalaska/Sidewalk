// Opening the app (Matt, 10/22/26), on the real page over file://: the load is tried once more by itself, and the card
// that comes when it still fails does not say "Not saved" (opening the app saves nothing).
//
// Why: Google now and then fails a call in 0 s, before the script's code runs. The phone's fetch rejects (Google's error page
// has no CORS header), which is exactly what route.abort() does here. Matt saw the app-open card with
// "Couldn't reach the server. Not saved, try again." and a Try again button. See test/load-retry.test.js for the rules
// (SnowApi.read: one try again after 1500 ms, only a fast network failure, never a write).
//
// This file has its own small fake backend (a spec exports nothing, and requiring another would run its tests twice). It
// answers like the real server and no better: every POST reply names its `action` and the version the phone expects.
const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const VERSION = 'outlines-1'; // lib/config.js EXPECTED_BACKEND

// Matt (tok-matt) is the admin; any other token is an expired session.
const fake = (body) => {
  const v = { version: VERSION, action: body.action };
  if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
  if (body.action === 'bootstrap') {
    return { ok: true, me: { name: 'Matthew', role: 'admin', crew_id: null }, sites: [], routes: [], zones: [], crew: [], post: null,
      moves: [], callouts: [], gear: [], points: {}, ...v };
  }
  return { ok: true, post: null, zones: [], ...v };
};

// The page signed in as `token`, WITHOUT waiting for it to finish loading: each test says what it expects.
// lostIf(n, body): true = that call (n counts the bootstrap calls from 1) is lost the way a dead signal loses it (the call is
// still recorded first). holdIf(n): that bootstrap waits in calls.held until calls.release().
async function openApp(page, { token = 'tok-matt', lostIf = () => false, holdIf = () => false, lang } = {}) {
  const calls = [];
  calls.errors = [];
  calls.held = [];
  calls.release = () => calls.held.splice(0).forEach((go) => go());
  page.on('pageerror', (e) => calls.errors.push(String(e)));
  let boots = 0;
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ body });
    const n = body.action === 'bootstrap' ? ++boots : 0;
    if (n && lostIf(n, body)) return route.abort();
    if (n && holdIf(n)) await new Promise((go) => calls.held.push(go));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: [] }) }));
  await page.addInitScript((o) => {
    localStorage.setItem('titan-snow-token', o.token);
    if (o.lang) localStorage.setItem('snow-lang', o.lang);
  }, { token, lang });
  await page.goto(PAGE);
  return calls;
}
const boots = (calls) => calls.filter((c) => c.body.action === 'bootstrap');

test('the first load is lost, the second answers: the app opens, and the card never comes', async ({ page }) => {
  // Worked on paper: bootstrap #1 lost (n === 1), #2 answered. SnowApi.read waits 1500 ms between them.
  const calls = await openApp(page, { lostIf: (n) => n === 1 });
  await expect(page.locator('nav [data-tab="sites"]')).toBeVisible();
  expect(boots(calls).length).toBe(2);
  await expect(page.locator('#retry')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText("Couldn't reach the server");
  await expect(page.locator('body')).not.toContainText('Not saved');
  expect(calls.errors).toEqual([]);
});

test('between the two tries the screen says Loading, not the card', async ({ page }) => {
  // #1 is lost; #2 is held. When #2 has reached the page's request (boots = 2) the 1500 ms wait is over and the first
  // failure has been dealt with: the card must not have been drawn in between.
  const calls = await openApp(page, { lostIf: (n) => n === 1, holdIf: (n) => n === 2 });
  await expect.poll(() => boots(calls).length).toBe(2);
  await expect(page.locator('main')).toContainText('Loading');
  await expect(page.locator('#retry')).toHaveCount(0);
  calls.release();
  await expect(page.locator('nav [data-tab="sites"]')).toBeVisible();
});

test('both loads lost: the card says Try again, never "Not saved", after exactly two tries', async ({ page }) => {
  const calls = await openApp(page, { lostIf: () => true });
  await expect(page.locator('#retry')).toBeVisible();
  await expect(page.locator('main h2')).toHaveText("Couldn't reach the server");
  await expect(page.locator('main p.muted')).toHaveText("Couldn't reach the server. Try again.");
  await expect(page.locator('body')).not.toContainText('Not saved');
  expect(boots(calls).length).toBe(2);
  expect(calls.errors).toEqual([]);
});

test('Try again on the card loads once more, and the app opens when the server is back', async ({ page }) => {
  // Loads 1 and 2 are lost (the card); the signal returns for load 3.
  const calls = await openApp(page, { lostIf: (n) => n <= 2 });
  await expect(page.locator('#retry')).toBeVisible();
  expect(boots(calls).length).toBe(2);
  await page.click('#retry');
  await expect(page.locator('nav [data-tab="sites"]')).toBeVisible();
  expect(boots(calls).length).toBe(3);
  await expect(page.locator('#retry')).toHaveCount(0);
});

test('an expired session is one request: the sign-in screen, no second try', async ({ page }) => {
  const calls = await openApp(page, { token: 'tok-old' });
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  expect(boots(calls).length).toBe(1);
});

test('in Spanish the card says it in Spanish and never "No se guardó"', async ({ page }) => {
  // lib/es.js has the row "Couldn't reach the server. Try again." -> "No se pudo conectar con el servidor. Intenta de nuevo."
  await openApp(page, { lostIf: () => true, lang: 'es' });
  await expect(page.locator('#retry')).toBeVisible();
  await expect(page.locator('main h2')).toHaveText('No se pudo conectar con el servidor');
  await expect(page.locator('main p.muted')).toHaveText('No se pudo conectar con el servidor. Intenta de nuevo.');
  await expect(page.locator('body')).not.toContainText('No se guardó');
});
