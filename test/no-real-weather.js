// Where every Playwright spec gets `test` and `expect` (never from '@playwright/test' directly), so that
// no test can reach the real api.weather.gov. The reason and the rules are in no-real-weather.spec.js.
//
// What a test sees:
//   * a `weatherLeaks` fixture, an array of one line per request that asked the network for the weather.
//     It is auto: every test has it, and a test that ends with a line in it FAILS. A test that wants to
//     see a leak clears the array itself (no-real-weather.spec.js does).
// What the suite gets:
//   * every context starts with a default stub that refuses a weather request at once (a test's own route wins);
//   * the browser cannot resolve *.weather.gov, so nothing here can reach the real service;
//   * every browser context, however a test makes it (the page fixture, browser.newContext()), is watched.
const base = require('@playwright/test');

const BLOCK_ARG = '--host-resolver-rules=MAP *.weather.gov ~NOTFOUND';

const isWeather = (href) => { try { return /(^|\.)weather\.gov$/.test(new URL(href).hostname); } catch (e) { return false; } };

// Chromium's own words for a request that went to the network stack and failed there. A route's abort()
// reports ERR_FAILED (or ERR_BLOCKED_BY_CLIENT.* for abort('blockedbyclient')), and a page closing under a
// request reports ERR_ABORTED: none of those is the network.
const NETWORK_ERRORS = /ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_\w+|ADDRESS_\w+|NETWORK_\w+|TIMED_OUT|PROXY_\w+|TUNNEL_\w+|SSL_\w+|CERT_\w+)/;

// `serverAddr` is Response.serverAddr() for a request that finished; `errorText` is Request.failure().errorText
// for one that failed. A request a route answered never connects, so it has no server address.
function reachedNetwork(report) {
  return !!report.serverAddr || NETWORK_ERRORS.test(report.errorText || '');
}

// The open test's list. Events are attributed to the test that is running when they arrive.
let open = null; // { leaks: [], pending: [] }

// The default every context starts with: a weather request is refused at once, so the only forecasts a page
// ever sees are ones its test chose. Registered first, so it is the last handler asked: a page.route or
// context.route the test makes later answers before it, and route.fallback() lands here.
async function stubWeather(context) {
  await context.route((u) => isWeather(u.href), (route) => route.abort());
}

function watch(context) {
  const note = (req, how) => { if (open) open.leaks.push(req.method() + ' ' + req.url() + ' (' + how + ')'); };
  context.on('requestfinished', (req) => {
    if (!isWeather(req.url())) return;
    const book = open;
    const done = req.response().then((res) => (res ? res.serverAddr() : null)).then((serverAddr) => {
      if (reachedNetwork({ serverAddr }) && book === open) note(req, 'connected to ' + serverAddr.ipAddress);
    }).catch(() => {});
    if (book) book.pending.push(done);
  });
  context.on('requestfailed', (req) => {
    if (!isWeather(req.url())) return;
    const errorText = (req.failure() || {}).errorText;
    if (reachedNetwork({ errorText })) note(req, errorText);
  });
}

const test = base.test.extend({
  launchOptions: [{ args: [BLOCK_ARG] }, { scope: 'worker', option: true }],

  // Every context comes from browser.newContext (the context fixture, browser.newPage, a test's own call),
  // so it is the one place to put a context's stub and watcher.
  browser: [async ({ browser }, use) => {
    const make = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const context = await make(...args);
      await stubWeather(context);
      watch(context);
      return context;
    };
    await use(browser);
    browser.newContext = make;
  }, { scope: 'worker' }],

  weatherLeaks: [async ({}, use) => {
    const book = { leaks: [], pending: [] };
    open = book;
    await use(book.leaks);
    await Promise.all(book.pending);
    open = null;
    if (book.leaks.length) {
      throw new Error('The test reached the weather service (' + book.leaks.length + ' request' + (book.leaks.length === 1 ? '' : 's') +
        '). Route api.weather.gov in the test, or let the default stub answer it:\n  ' + book.leaks.join('\n  '));
    }
  }, { auto: true }],
});

module.exports = { test, expect: base.expect, reachedNetwork, isWeather };
