const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// A syntax error in a browser script does not throw anything you will see: the
// page just sits on "Loading…". The workspace hook only checks scripts inside
// HTML files, so every lib/*.js file is parsed here.
const dir = path.join(__dirname, '..', 'lib');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  test('browser script parses: lib/' + f, () => {
    assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(dir, f), 'utf8')));
  });
}
