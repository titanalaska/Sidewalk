// Sidewalk installs like Inventory and Bootprint: its own icon, full screen.
// titanalaska.github.io carries every Titan app, so scope and start_url must be
// "./" (= /Sidewalk/) or the install would swallow, or be swallowed by, another app.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f));
// A PNG's width and height sit in its IHDR chunk, bytes 16-23.
const pngSize = (f) => { const b = read(f); assert.strictEqual(b.toString('ascii', 1, 4), 'PNG', f + ' is not a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest: own scope, full screen, the name the crew see', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.strictEqual(m.start_url, './');
  assert.strictEqual(m.scope, './');
  assert.strictEqual(m.display, 'standalone');
  assert.strictEqual(m.name, 'Snow Crew'); // matches the page title and header
});

test('manifest icons exist at the sizes they claim, one maskable', () => {
  const m = JSON.parse(read('manifest.json'));
  for (const i of m.icons) {
    const [w, h] = pngSize(i.src.replace('./', ''));
    assert.strictEqual(w + 'x' + h, i.sizes, i.src);
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'any' && i.sizes === '192x192'));
});

test('the page links the manifest and an iPhone icon', () => {
  const html = read('index.html').toString();
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.json">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icon-192\.png">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
});

test('the offline shell carries the manifest and icons', () => {
  const sw = read('sw.js').toString();
  for (const f of ['manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) assert.ok(sw.includes("'" + f + "'"), f);
});
