// Titan colours (Matt, 11/24/26): gold and black, each colour written once per mode.
//
// The merge (Task 1): app.css wrote every night colour twice, once under
// `@media (prefers-color-scheme: dark){:root:not([data-theme="light"])…}` and once under `:root[data-theme="dark"]…`.
// Nothing ever set data-theme (no code in index.html or lib/, no test, since the first commit 3eebf9b), so the second copy
// was dead and went; the colours did not move across it (commit 944be46 pinned shell 77's values).
//
// The palette (Task 2): DAY_78 / NIGHT_78 are the design's table (Snow/Sidewalk specs + ledgers/2026-11-24-titan-colours-design.md,
// with its "Changes after approval"). The night block leaves out --gold and the four --head-* tokens: they are the same in
// both modes, so the day value stands at night too (palette() overlays night on day).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readCss, rules, tokens, palette, ratio, isDarkMedia } = require('./css-tokens.js');

const DAY_78 = {
  '--bg': '#f4f2ec', '--card': '#fff', '--ink': '#141414', '--muted': '#5f5b52', '--line': '#ddd8cc',
  '--warn': '#b3261e', '--warn-bg': '#fbe9e7', '--chip': '#efece4', '--amber': '#b36b00', '--amber-bg': '#fff0d1',
  '--black': '#111', '--gold': '#f5b800', '--gold-ink': '#7a5900', '--btn-edge': '#111',
  '--head-chip': '#2a2824', '--head-ink': '#e8e2d4', '--head-muted': '#bdb7a8', '--head-line': '#4a4740', '--bar-addr': '#d8d2c3',
  '--lead-bg': '#f6edd4', '--ok': '#1e7a3c', '--ok-bg': '#e6f4ea', '--pill': '#f1efe8',
  '--yellow-bg': '#fff3bf', '--yellow-ink': '#5c4400', '--yellow-line': '#e0b400',
};
const NIGHT_78 = {
  '--bg': '#000', '--card': '#262420', '--ink': '#f5f3ee', '--muted': '#b9b3a5', '--line': '#4a4740',
  '--warn': '#ff8a80', '--warn-bg': '#3a1d1b', '--chip': '#33302a', '--amber': '#ffc266', '--amber-bg': '#3d2c0c',
  '--black': '#000', '--gold-ink': '#f5b800', '--btn-edge': '#f5b800', '--bar-addr': '#b9b3a5',
  '--lead-bg': '#2e2817', '--ok': '#7ed69a', '--ok-bg': '#16301f', '--pill': '#33302a',
  '--yellow-bg': '#3d3300', '--yellow-ink': '#ffe27a', '--yellow-line': '#a88700',
};

// The night rule whose selector is `:root <suffix>`.
function nightRule(css, suffix) {
  return rules(css).find((r) => isDarkMedia(r.media) && r.selector === ':root ' + suffix);
}

test('nothing in app.css mentions data-theme (nothing ever set it: no code, no test, since 3eebf9b)', () => {
  assert.doesNotMatch(readCss(), /data-theme/);
});

test('day colours are the Titan table\'s', () => {
  assert.deepEqual(tokens(readCss(), 'day'), DAY_78);
});

test('night colours are the Titan table\'s', () => {
  assert.deepEqual(tokens(readCss(), 'night'), NIGHT_78);
});

test('the night-only rules: the card shadow and the three status colours stay; the name bar takes --black instead', () => {
  const css = readCss();
  const want = {
    '.card': 'box-shadow:0 3px 14px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.07);margin-bottom:20px',
    '.site-bar.st-problem': 'background:#b42a22',
    '.site-bar.st-done': 'background:#22783c',
    '.site-bar.st-working': 'background:#e0a010',
  };
  for (const [suffix, body] of Object.entries(want)) {
    const r = nightRule(css, suffix);
    assert.ok(r, 'no night rule for ' + suffix);
    assert.equal(r.body.trim(), body, suffix);
  }
  assert.equal(nightRule(css, '.site-bar'), undefined, 'the night .site-bar rule is gone: --black is #000 at night');
});

test('no blue is left', () => {
  const css = readCss().toLowerCase();
  // Shell 77's blues and blue-greys: the accent pair, the navy bars and their address colour, and the blue-tinted surfaces.
  for (const hex of ['#1f5fa8', '#7fb0ea', '#0b1b2e', '#12263d', '#17457a', '#c9d6e4', '#e8f0fb', '#1a2a3d',
                     '#eef1f5', '#2e3640', '#232a33', '#46505c', '#b4bcc6', '#060708'])
    assert.ok(!css.includes(hex), hex + ' still in app.css');
  const root = path.join(__dirname, '..');
  const files = ['app.css', 'index.html', ...fs.readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f)];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /--(on-)?accent\b/, f + ' still uses --accent');
});

// Contrast, worked on paper. WCAG: each channel c/255 linearised (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ^ 2.4),
// L = .2126 R + .7152 G + .0722 B, ratio = (L1 + .05) / (L2 + .05). Luminances on paper:
//   black and gold   #000 0          #111 .00561     #f5b800 .53692  #7a5900 .11283
//   day surfaces     #fff 1          #f4f2ec .88798  #efece4 .83950  #f1efe8 .86271  #f6edd4 .84923
//   day text         #141414 .00699  #5f5b52 .10529
//   night surfaces   #262420 .01778  #33302a .02984  #2e2817 .02160
//   night text       #f5f3ee .89686  #b9b3a5 .45270
//   header, bar      #2a2824 .02137  #e8e2d4 .76299  #bdb7a8 .47501  #d8d2c3 .64629
//   warnings         #b3261e .11063  #ff8a80 .40996
// e.g. --gold-ink on --chip by day: (.83950 + .05) / (.11283 + .05) = .88950 / .16283 = 5.46.
// Each row: [text, background, at least, the ratio on paper]. A row passes when the code's ratio is at least the floor AND
// within 0.03 of the paper: two readings that must agree. If they disagree, redo the paper by hand before touching either.
const DAY_PAIRS = [
  ['--ink', '--bg', 4.5, 16.46], ['--ink', '--card', 4.5, 18.42], ['--muted', '--card', 4.5, 6.76], ['--muted', '--bg', 4.5, 6.04],
  ['--muted', '--chip', 4.5, 5.73], ['--muted', '--pill', 4.5, 5.88], ['--muted', '--lead-bg', 4.5, 5.79],
  ['--gold-ink', '--card', 4.5, 6.45], ['--gold-ink', '--bg', 4.5, 5.76], ['--gold-ink', '--chip', 4.5, 5.46],
  ['--gold-ink', '--pill', 4.5, 5.61], ['--gold-ink', '--lead-bg', 4.5, 5.52], ['--gold', '--black', 4.5, 10.55],
  ['--head-ink', '--head-chip', 4.5, 11.39], ['--head-muted', '--black', 4.5, 9.44], ['--bar-addr', '--black', 4.5, 12.52],
  ['#fff', '--black', 4.5, 18.88], ['--bg', '--warn', 4.5, 5.84],
];
const NIGHT_PAIRS = [
  ['--ink', '--bg', 4.5, 18.94], ['--ink', '--card', 4.5, 13.97], ['--muted', '--card', 4.5, 7.42], ['--muted', '--bg', 4.5, 10.05],
  ['--muted', '--chip', 4.5, 6.30], ['--muted', '--pill', 4.5, 6.30], ['--muted', '--lead-bg', 4.5, 7.02],
  ['--gold-ink', '--card', 4.5, 8.66], ['--gold-ink', '--bg', 4.5, 11.74], ['--gold-ink', '--chip', 4.5, 7.35],
  ['--gold-ink', '--lead-bg', 4.5, 8.20], ['--gold', '--black', 4.5, 11.74], ['--head-ink', '--head-chip', 4.5, 11.39],
  ['--head-muted', '--black', 4.5, 10.50], ['--bar-addr', '--black', 4.5, 10.05], ['#fff', '--black', 4.5, 21.00],
  ['--bg', '--warn', 4.5, 9.20],
];

for (const [mode, pairs] of [['day', DAY_PAIRS], ['night', NIGHT_PAIRS]]) {
  test('contrast, ' + mode + ': every text-and-background pair at 4.5:1 or better, as worked on paper', () => {
    const pal = palette(readCss(), mode);
    for (const [fg, bg, floor, paper] of pairs) {
      for (const t of [fg, bg]) if (t.startsWith('--')) assert.ok(pal[t], t + ' is not set for ' + mode);
      const r = ratio(fg, bg, pal);
      assert.ok(r >= floor, fg + ' on ' + bg + ' = ' + r.toFixed(2) + ', under ' + floor);
      assert.ok(Math.abs(r - paper) < 0.03, fg + ' on ' + bg + ' = ' + r.toFixed(3) + ', paper says ' + paper);
    }
  });
}
