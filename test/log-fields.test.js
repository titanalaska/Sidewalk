// The fake backend's crew Log fields (test/log-fields.js) must be the server's own allow-list, or the Playwright tests prove the phone
// against rows no real crew phone ever gets (the Site done batch field was missing from the fake's copy until the final review, M6).
// The backend is read from SNOW_SERVER_REPO when set, else from the live backend folder beside this one (snow-app-script, the main
// checkout, on master). With no checkout there is nothing to compare and the test is SKIPPED, with the reason printed; with a checkout
// there, a missing roster.js or a different list FAILS.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FIELDS = require('./log-fields.js');

const backend = process.env.SNOW_SERVER_REPO || path.join(__dirname, '..', '..', 'snow-app-script');

test("the fake backend's crew Log fields are the server's PUBLIC_LOG_FIELDS", (t) => {
  if (!fs.existsSync(backend)) return t.skip('no server checkout at ' + backend + ' (set SNOW_SERVER_REPO)');
  const roster = require(path.join(backend, 'roster.js'));
  assert.ok(Array.isArray(roster.PUBLIC_LOG_FIELDS), 'roster.js has no PUBLIC_LOG_FIELDS list');
  assert.deepStrictEqual(FIELDS, [...roster.PUBLIC_LOG_FIELDS]);
});
