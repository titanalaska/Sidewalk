// No Playwright test may reach the real api.weather.gov (11/14/26).
//
// Why: the Storm tab asks the National Weather Service for each site's forecast and redraws the page when
// each answer lands. A spec that never stubbed the weather got real answers at random moments, and that
// hid a real bug in sitedone.spec.js's M3 for weeks. So now, in every spec (they all take `test` from
// ./no-real-weather.js):
//   1. every browser context starts with a default stub: a weather request is refused at once, the same
//      way every run, unless the test routes it itself (a page.route in the test wins over the default);
//   2. the browser cannot resolve *.weather.gov at all, so even a request that slips past every stub
//      cannot reach the real service (and the suite never needs the internet);
//   3. a request that does get past the stubs and asks the network is a LEAK, and the test fails.
// This file pins those three, and the rule that tells a stub from the network.
const { test, expect, reachedNetwork } = require('./no-real-weather.js');

// What a weather request looks like when Chromium reports it, worked on paper from what a probe of
// Playwright 1.63 printed (11/14/26): a request a route fulfilled has no server address; one a route
// aborted fails as ERR_FAILED (route.abort()) or ERR_BLOCKED_BY_CLIENT.Inspector (route.abort('blockedbyclient'));
// one that went to the network either connected (an address) or failed in the network stack.
test.describe('what counts as having reached the network', () => {
  const cases = [
    ['a route fulfilled it: no server address, no error', { serverAddr: null }, false],
    ['a route aborted it: ERR_FAILED', { errorText: 'net::ERR_FAILED' }, false],
    ['a route aborted it as blocked: ERR_BLOCKED_BY_CLIENT.Inspector', { errorText: 'net::ERR_BLOCKED_BY_CLIENT.Inspector' }, false],
    ['the page closed under it: ERR_ABORTED', { errorText: 'net::ERR_ABORTED' }, false],
    ['it connected: the server has an address', { serverAddr: { ipAddress: '203.0.113.7', port: 443 } }, true],
    ['the name did not resolve', { errorText: 'net::ERR_NAME_NOT_RESOLVED' }, true],
    ['the machine is offline', { errorText: 'net::ERR_INTERNET_DISCONNECTED' }, true],
    ['the connection was refused', { errorText: 'net::ERR_CONNECTION_REFUSED' }, true],
    ['the connection timed out', { errorText: 'net::ERR_CONNECTION_TIMED_OUT' }, true],
    ['the certificate was refused', { errorText: 'net::ERR_CERT_AUTHORITY_INVALID' }, true],
    ['nothing was reported at all', {}, false],
  ];
  for (const [name, report, want] of cases) {
    test(name, () => { expect(reachedNetwork(report)).toBe(want); });
  }
});

// A page with nothing on it, asking the weather service the way the app does: a plain GET from the page.
async function ask(page, href) {
  return page.evaluate(async (u) => {
    try { const r = await fetch(u); return { status: r.status, text: await r.text() }; } catch (e) { return { threw: true }; }
  }, href);
}
const POINTS = 'https://api.weather.gov/points/61.2,-149.9';
const cors = { 'access-control-allow-origin': '*' };

test('a page whose test chose no weather gets a refused request, and the guard stays quiet', async ({ page, weatherLeaks }) => {
  await page.goto('about:blank');
  expect(await ask(page, POINTS)).toEqual({ threw: true });
  await page.waitForTimeout(200); // time for a leak to be reported, if there were one
  expect(weatherLeaks).toEqual([]);
});

test('a stub the test chose answers, and wins over the default', async ({ page, weatherLeaks }) => {
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"chosen":true}' }));
  await page.goto('about:blank');
  expect(await ask(page, POINTS)).toEqual({ status: 200, text: '{"chosen":true}' });
  expect(weatherLeaks).toEqual([]);
});

test('a request a test lets through reaches the network layer, is flagged, and still cannot reach the real service', async ({ page, weatherLeaks }) => {
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => route.continue());
  await page.goto('about:blank');
  expect(await ask(page, POINTS)).toEqual({ threw: true }); // never an answer: the resolver refuses the name
  await expect.poll(() => weatherLeaks.length).toBe(1);
  expect(weatherLeaks[0]).toContain(POINTS);
  expect(weatherLeaks[0]).toContain('ERR_NAME_NOT_RESOLVED'); // the browser-level block is what stopped it
  weatherLeaks.length = 0; // this test wanted the leak: clear it so the guard's own check at the end passes
});

test('a context a test makes with browser.newContext() has the same default and the same guard', async ({ browser, weatherLeaks }) => {
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage();
    await p.goto('about:blank');
    expect(await ask(p, POINTS)).toEqual({ threw: true });
    await p.waitForTimeout(200);
    expect(weatherLeaks).toEqual([]);
    await p.route((u) => u.hostname === 'api.weather.gov', (route) => route.continue());
    expect(await ask(p, POINTS)).toEqual({ threw: true });
    await expect.poll(() => weatherLeaks.length).toBe(1); // the new context is watched: its leak is this test's
    weatherLeaks.length = 0;
  } finally { await ctx.close(); }
});

// The guard's own failure is pinned with test.fail(): this test passes only if the test below it FAILS, which
// it does only because the guard throws when the test ends with a leak still in the list. If the guard went
// quiet, the body would pass, test.fail() would call that a failure, and this file would go red.
test('a test that ends with a leak in the list fails (expected to fail: that is the guard working)', async ({ page, weatherLeaks }) => {
  test.fail();
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => route.continue());
  await page.goto('about:blank');
  expect(await ask(page, POINTS)).toEqual({ threw: true });
  await expect.poll(() => weatherLeaks.length).toBe(1); // and it is left there on purpose
});
