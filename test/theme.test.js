// Titan colours (Matt, 11/24/26), the merge: app.css wrote every night colour twice, once under
// `@media (prefers-color-scheme: dark){:root:not([data-theme="light"])…}` and once under `:root[data-theme="dark"]…`.
// Nothing ever set data-theme (no code in index.html or lib/, no test, since the first commit 3eebf9b), so the second copy
// was dead. It goes, and the colours a phone shows must not move: DAY_77 / NIGHT_77 are copied by hand from app.css at
// 528e4eb (lines 2, 3, 58, 59, 226, 227), the live shell 77.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCss, rules, tokens, isDarkMedia } = require('./css-tokens.js');

const DAY_77 = {
  '--bg': '#f6f5f2', '--card': '#fff', '--ink': '#1d1d1b', '--muted': '#6b6a66', '--line': '#dedcd6', '--accent': '#1f5fa8',
  '--on-accent': '#fff', '--warn': '#b3261e', '--warn-bg': '#fbe9e7', '--chip': '#eef1f5', '--amber': '#b36b00', '--amber-bg': '#fff0d1',
  '--lead-bg': '#e8f0fb', '--ok': '#1e7a3c', '--ok-bg': '#e6f4ea', '--pill': '#f1efe8',
  '--yellow-bg': '#fff3bf', '--yellow-ink': '#5c4400', '--yellow-line': '#e0b400',
};
const NIGHT_77 = {
  '--bg': '#060708', '--card': '#232a33', '--ink': '#eee', '--muted': '#b4bcc6', '--line': '#46505c', '--accent': '#7fb0ea',
  '--on-accent': '#0b1b2e', '--warn': '#ff8a80', '--warn-bg': '#3a1d1b', '--chip': '#2e3640', '--amber': '#ffc266', '--amber-bg': '#3d2c0c',
  '--lead-bg': '#1a2a3d', '--ok': '#7ed69a', '--ok-bg': '#16301f', '--pill': '#2e3640',
  '--yellow-bg': '#3d3300', '--yellow-ink': '#ffe27a', '--yellow-line': '#a88700',
};

// The night rule whose selector is `:root <suffix>` (or the old `:root:not([data-theme="light"]) <suffix>`).
function nightRule(css, suffix) {
  return rules(css).find((r) => isDarkMedia(r.media) && r.selector.replace(':not([data-theme="light"])', '') === ':root ' + suffix);
}

test('nothing in app.css mentions data-theme (nothing ever set it: no code, no test, since 3eebf9b)', () => {
  assert.doesNotMatch(readCss(), /data-theme/);
});

test('day colours are shell 77\'s', () => {
  assert.deepEqual(tokens(readCss(), 'day'), DAY_77);
});

test('night colours are shell 77\'s', () => {
  assert.deepEqual(tokens(readCss(), 'night'), NIGHT_77);
});

test('the night-only rules are still night-only and the same', () => {
  const css = readCss();
  const want = {
    '.card': 'box-shadow:0 3px 14px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.07);margin-bottom:20px',
    '.site-bar': 'background:#17457a',
    '.site-bar.st-problem': 'background:#b42a22',
    '.site-bar.st-done': 'background:#22783c',
    '.site-bar.st-working': 'background:#e0a010',
  };
  for (const [suffix, body] of Object.entries(want)) {
    const r = nightRule(css, suffix);
    assert.ok(r, 'no night rule for ' + suffix);
    assert.equal(r.body.trim(), body, suffix);
  }
});
