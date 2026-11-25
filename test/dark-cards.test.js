// Dark mode cards must stand apart from the page (Matt, 11/12/26: "it's a little blurred together ... a lack of color or
// separation" when scrolling in dark mode; light mode looked fine). Read straight from app.css, no browser needed.
//
// Contrast is the WCAG ratio (L1 + 0.05) / (L2 + 0.05) of relative luminances. Worked on paper:
//   OLD dark: card #1e1e1e (L 0.0129) on page #141414 (L 0.0070): 0.0629 / 0.0570 = 1.10  -> blurred together
//             line #333 (L 0.0331) on card #1e1e1e:               0.0831 / 0.0629 = 1.32
//   NEW dark: card #232a33 (L 0.0226) on page #060708 (L 0.0021): 0.0726 / 0.0521 = 1.39
//             line #46505c (L 0.0781) on card #232a33:            0.1281 / 0.0726 = 1.76
//             muted #b4bcc6 (L 0.4975) on card #232a33:           0.5475 / 0.0726 = 7.5
// Thresholds: card/page at least 1.3, line/card at least 1.5 (both fail on the old values), muted and ink text readable (4.5, 7).
//
// Titan colours (11/24/26): the reader moved to test/css-tokens.js, and the test that the two night copies matched went
// with the dead `data-theme` copy (test/theme.test.js says why). Night colours now live in one place only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readCss, tokens, ratio } = require('./css-tokens.js');

const css = readCss();

test('dark mode: a card stands apart from the page (contrast at least 1.3; it was 1.10)', () => {
  const t = tokens(css, 'night');
  assert.ok(ratio(t['--card'], t['--bg']) >= 1.3, 'card ' + t['--card'] + ' on page ' + t['--bg'] + ' = ' + ratio(t['--card'], t['--bg']).toFixed(2));
});

test('dark mode: a card edge shows against the card (contrast at least 1.5; it was 1.32)', () => {
  const t = tokens(css, 'night');
  assert.ok(ratio(t['--line'], t['--card']) >= 1.5, 'line ' + t['--line'] + ' on card ' + t['--card'] + ' = ' + ratio(t['--line'], t['--card']).toFixed(2));
});

test('dark mode: text on a card stays readable (muted 4.5, ink 7)', () => {
  const t = tokens(css, 'night');
  assert.ok(ratio(t['--muted'], t['--card']) >= 4.5, 'muted ' + ratio(t['--muted'], t['--card']).toFixed(2));
  assert.ok(ratio(t['--ink'], t['--card']) >= 7, 'ink ' + ratio(t['--ink'], t['--card']).toFixed(2));
});

test('light mode is unchanged: page #f6f5f2, card #fff, line #dedcd6', () => {
  const t = tokens(css, 'day');
  assert.equal(t['--bg'], '#f6f5f2');
  assert.equal(t['--card'], '#fff');
  assert.equal(t['--line'], '#dedcd6');
});

test('the heavier card shadow is for dark mode only', () => {
  // A dark-only .card rule exists inside the dark media block, and no rule outside it gives .card that shadow.
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root \.card\{[^}]*box-shadow:0 3px 14px/);
  assert.doesNotMatch(css.replace(/@media \(prefers-color-scheme: dark\)\{[^{}]*\{[^}]*\}\}/g, ''), /box-shadow:0 3px 14px/);
});
