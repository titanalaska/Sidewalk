// The fake backend's crew Clock fields (test/clock-fields.js) must be the server's own allow-list, or the
// Playwright tests prove the phone against rows no real crew phone ever gets. The backend lives in its own
// folder beside this repo (snow-app-script, no remote): with no checkout there (a clone of this public repo
// alone) there is nothing to compare and the test is skipped. SNOW_BACKEND_REPO points the test at another
// checkout (a worktree with the matching change); set to a path that is not there it FAILS, it never skips.
// A checkout from before the Clock tab has no PUBLIC_CLOCK_FIELDS at all: nothing to compare, skipped by
// name. A checkout that has the list must match it: a different list FAILS.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FIELDS = require('./clock-fields.js');

const asked = !!process.env.SNOW_BACKEND_REPO;
const backend = process.env.SNOW_BACKEND_REPO || path.join(__dirname, '..', '..', 'snow-app-script');

test("the fake backend's crew Clock fields are the server's PUBLIC_CLOCK_FIELDS", (t) => {
  if (!fs.existsSync(backend)) {
    assert.ok(!asked, 'SNOW_BACKEND_REPO is set to ' + backend + ', which is not there: fix the path');
    return t.skip('no snow-app-script checkout beside this repo');
  }
  const roster = require(path.join(backend, 'roster.js')); // throws (fails) if the checkout has no roster.js
  if (roster.PUBLIC_CLOCK_FIELDS === undefined) {
    assert.ok(!asked, 'SNOW_BACKEND_REPO is set to ' + backend + ', whose roster.js has no PUBLIC_CLOCK_FIELDS');
    return t.skip('that snow-app-script checkout is from before the Clock tab');
  }
  assert.ok(Array.isArray(roster.PUBLIC_CLOCK_FIELDS), 'PUBLIC_CLOCK_FIELDS is not a list');
  assert.deepStrictEqual(FIELDS, [...roster.PUBLIC_CLOCK_FIELDS]);
});
