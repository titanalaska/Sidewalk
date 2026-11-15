// A spec that takes `test` straight from @playwright/test has no default weather stub and no guard, so a
// new spec could reach the real api.weather.gov without anything failing. Every spec must take `test` and
// `expect` from ./no-real-weather.js (see no-real-weather.spec.js for why). Read from the files themselves:
// only a statement that starts with import / const / let / var counts, so a comment that names the package is not a use of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SPECS = fs.readdirSync(__dirname).filter((f) => f.endsWith('.spec.js')).sort();
const DIRECT = /^\s*(?:import\b[^\n]*\bfrom\s+|(?:const|let|var)\b[^\n]*=\s*require\(\s*)['"]@playwright\/test['"]/m;
const SHARED = /^\s*(?:const|let|var)\b[^\n]*=\s*require\(\s*['"]\.\/no-real-weather\.js['"]\s*\)/m;
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

test('the spec list is the real one, not an empty glob', () => {
  assert.ok(SPECS.includes('ui.spec.js') && SPECS.includes('sitedone.spec.js') && SPECS.includes('no-real-weather.spec.js'), SPECS.join(', '));
});

test('no spec takes test/expect straight from @playwright/test', () => {
  assert.deepEqual(SPECS.filter((f) => DIRECT.test(read(f))), []);
});

test('every spec takes test/expect from ./no-real-weather.js', () => {
  assert.deepEqual(SPECS.filter((f) => !SHARED.test(read(f))), []);
});

// The two patterns, on strings worked out by hand: what counts as a use of the package, and what does not.
test('the patterns: a require or an import counts, a comment or another package does not', () => {
  const direct = [
    "const { test, expect } = require('@playwright/test');",
    'const { test } = require("@playwright/test");',
    "const { test } = require( '@playwright/test' );",
    "import { test } from '@playwright/test';",
  ];
  for (const s of direct) assert.ok(DIRECT.test(s), s);
  const notDirect = [
    "// takes test from '@playwright/test' no more",
    "const { test, expect } = require('./no-real-weather.js');",
    "const x = require('@playwright/test-utils');",
  ];
  for (const s of notDirect) assert.ok(!DIRECT.test(s), s);
  assert.ok(SHARED.test("const { test, expect } = require('./no-real-weather.js');"));
  assert.ok(SHARED.test('const { test } = require("./no-real-weather.js")'));
  assert.ok(!SHARED.test("const { test } = require('@playwright/test');"));
  assert.ok(!SHARED.test("// require('./no-real-weather.js') is what a spec should say"));
});
