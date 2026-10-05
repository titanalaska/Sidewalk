// The fake backend's crew Storms fields (test/storm-fields.js) must be the server's own allow-list, or the
// Playwright tests prove the phone against rows no real crew phone ever gets. The backend lives in its own
// folder beside this repo (snow-app-script, no remote): with no checkout there (a clone of this public repo
// alone) there is nothing to compare and the test is skipped. With the checkout there, it must match:
// a missing roster.js or a different list FAILS, it never skips.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FIELDS = require('./storm-fields.js');

const backend = path.join(__dirname, '..', '..', 'snow-app-script');

test("the fake backend's crew Storms fields are the server's PUBLIC_STORM_FIELDS", (t) => {
  if (!fs.existsSync(backend)) return t.skip('no snow-app-script checkout beside this repo');
  const roster = require(path.join(backend, 'roster.js')); // throws (fails) if the checkout has no roster.js
  assert.ok(Array.isArray(roster.PUBLIC_STORM_FIELDS), 'roster.js has no PUBLIC_STORM_FIELDS list');
  assert.deepStrictEqual(FIELDS, [...roster.PUBLIC_STORM_FIELDS]);
});
