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

test('the shell is cached, Apps Script never is, and other apps\' caches survive', async ({ page }) => {
  // Same origin carries every titanalaska app: the snow worker must never delete their caches.
  await page.route((u) => u.href.includes('script.google.com'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'signin', reason: 'Sign in', version: 'foundation-1' }) }));
  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.evaluate(async () => { await caches.open('wolf-beds-v2'); await caches.open('groundwork-shell-v34'); await caches.open('titan-snow-shell-0'); });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  const state = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = await caches.open('titan-snow-shell-1');
    const urls = (await shell.keys()).map((r) => r.url);
    return { names, urls };
  });
  expect(state.names).toContain('titan-snow-shell-1');
  expect(state.names).toContain('wolf-beds-v2');
  expect(state.names).toContain('groundwork-shell-v34');
  expect(state.names).not.toContain('titan-snow-shell-0');          // its own old version is cleaned up
  expect(state.urls.some((u) => u.endsWith('/lib/app.js'))).toBe(true);
  for (const name of state.names) {
    const urls = await page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
    expect(urls.filter((u) => u.includes('script.google.com'))).toEqual([]);
  }
});
