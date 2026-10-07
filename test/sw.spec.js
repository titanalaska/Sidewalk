const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

// Served over http on its own port: a service worker cannot run from file://.
const PORT = 4173 + Math.floor(Math.random() * 500);
let server;
test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'pipe' });
  await new Promise((r) => server.stdout.once('data', r));
});
test.afterAll(() => server && server.kill());

test('with no signal, the folder address still opens the app from cache', async ({ page, context }) => {
  // Phones open https://titanalaska.github.io/<app>/ -- the folder, not index.html.
  await page.route((u) => u.href.includes('script.google.com'), (route) => route.abort());
  await page.goto('http://localhost:' + PORT + '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForTimeout(300);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('header h1')).toHaveText('Snow Crew');
  await expect(page.locator('main')).toContainText("Couldn't reach the server");
  await context.setOffline(false);
});

test('the shell is cached, Apps Script never is, and other apps\' caches survive', async ({ page }) => {
  // Same origin carries every titanalaska app: the snow worker must never delete their caches.
  await page.route((u) => u.href.includes('script.google.com'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'signin', reason: 'Sign in', version: 'pairings-1' }) }));
  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.evaluate(async () => { await caches.open('wolf-beds-v2'); await caches.open('groundwork-shell-v34'); await caches.open('titan-snow-shell-2'); await caches.open('titan-snow-shell-3'); await caches.open('titan-snow-shell-4'); await caches.open('titan-snow-shell-5'); await caches.open('titan-snow-shell-6'); await caches.open('titan-snow-shell-7'); await caches.open('titan-snow-shell-8'); await caches.open('titan-snow-shell-9'); await caches.open('titan-snow-shell-10'); await caches.open('titan-snow-shell-11'); await caches.open('titan-snow-shell-12'); await caches.open('titan-snow-shell-13'); await caches.open('titan-snow-shell-14'); await caches.open('titan-snow-shell-15'); await caches.open('titan-snow-shell-17'); await caches.open('titan-snow-shell-18'); await caches.open('titan-snow-shell-19'); await caches.open('titan-snow-shell-20'); await caches.open('titan-snow-shell-21'); await caches.open('titan-snow-shell-22'); await caches.open('titan-snow-shell-23'); await caches.open('titan-snow-shell-24'); await caches.open('titan-snow-shell-25'); });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  const state = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = await caches.open('titan-snow-shell-33');
    const urls = (await shell.keys()).map((r) => r.url);
    return { names, urls };
  });
  expect(state.names).toContain('titan-snow-shell-33');
  expect(state.names).toContain('wolf-beds-v2');
  expect(state.names).toContain('groundwork-shell-v34');
  expect(state.names).not.toContain('titan-snow-shell-2');          // its own old versions are cleaned up
  expect(state.names).not.toContain('titan-snow-shell-3');
  expect(state.names).not.toContain('titan-snow-shell-4');
  expect(state.names).not.toContain('titan-snow-shell-5');
  expect(state.names).not.toContain('titan-snow-shell-6');
  expect(state.names).not.toContain('titan-snow-shell-7');
  expect(state.names).not.toContain('titan-snow-shell-8');
  expect(state.names).not.toContain('titan-snow-shell-9');
  expect(state.names).not.toContain('titan-snow-shell-10');
  expect(state.names).not.toContain('titan-snow-shell-11');
  expect(state.names).not.toContain('titan-snow-shell-12');
  expect(state.names).not.toContain('titan-snow-shell-13');
  expect(state.names).not.toContain('titan-snow-shell-14');
  expect(state.names).not.toContain('titan-snow-shell-15');
  expect(state.names).not.toContain('titan-snow-shell-17');
  expect(state.names).not.toContain('titan-snow-shell-18');
  expect(state.names).not.toContain('titan-snow-shell-19');
  expect(state.names).not.toContain('titan-snow-shell-20');
  expect(state.names).not.toContain('titan-snow-shell-21');
  expect(state.names).not.toContain('titan-snow-shell-22');
  expect(state.names).not.toContain('titan-snow-shell-23');
  expect(state.names).not.toContain('titan-snow-shell-24');
  expect(state.names).not.toContain('titan-snow-shell-25');
  expect(state.names).not.toContain('titan-snow-shell-16');
  // The map pieces are in the shell, so a map opens with no signal (zones only, no photo).
  for (const f of ['/vendor/maplibre-gl.js', '/vendor/maplibre-gl.css', '/lib/geo.js', '/lib/mapview.js', '/lib/bpimport.js', '/lib/mapedit.js',
    '/lib/time.js', '/lib/board.js', '/lib/history.js', '/lib/gear.js', '/lib/warnings.js', '/lib/pairing.js', '/lib/boardui.js',
    '/lib/shiftlog.js', '/lib/routesheet.js', '/lib/handoff.js', '/lib/shiftlogui.js', '/lib/weather.js', '/lib/callout.js', '/lib/share.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']) {
    expect(state.urls.some((u) => u.endsWith(f)), f).toBe(true);
  }
  expect(state.urls.some((u) => u.endsWith('/lib/app.js'))).toBe(true);
  for (const name of state.names) {
    const urls = await page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
    expect(urls.filter((u) => u.includes('script.google.com'))).toEqual([]);
  }
});

test('aerial photo tiles pass straight through and are never cached', async ({ page }) => {
  // MOA and Esri tiles are other origins: the worker must not keep them (they'd
  // fill the phone, and a stale photo is worse than none).
  await page.route((u) => u.href.includes('script.google.com'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'signin', reason: 'Sign in', version: 'pairings-1' }) }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const ok = await page.evaluate(async () => {
    const a = await fetch('https://www.ancgis.com/arcgis/rest/services/imagery_public/Photo_2024/MapServer/tile/18/76543/12345');
    const b = await fetch('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/76543/12345');
    return a.ok && b.ok && !!navigator.serviceWorker.controller;
  });
  expect(ok).toBe(true); // the tiles really went through a page the worker controls
  await page.waitForTimeout(300);
  const tiles = await page.evaluate(async () => {
    const out = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) if (/ancgis|arcgisonline/.test(r.url)) out.push(n + ' ' + r.url);
    return out;
  });
  expect(tiles).toEqual([]);
});
