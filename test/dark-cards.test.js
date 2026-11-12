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
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

// Every custom property set inside blocks whose selector matches, in file order (a later block wins, as in the browser).
function tokens(selectorTest) {
  const out = {};
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  // Flatten one level of @media: "@media (...){ :root...{ ... }}" -> selector "@media (...) :root..."
  const flat = css.replace(/@media([^{]*)\{([^{}]*)\{([^{}]*)\}\s*\}/g, (all, q, sel, body) => '@media' + q + ' ' + sel + '{' + body + '}');
  while ((m = re.exec(flat))) {
    const sel = m[1].trim();
    if (!selectorTest(sel)) continue;
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i < 0) return;
      const k = d.slice(0, i).trim(), v = d.slice(i + 1).trim();
      if (k.startsWith('--')) out[k] = v.toLowerCase();
    });
  }
  return out;
}
const isLight = (s) => s === ':root';
const isMediaDark = (s) => /prefers-color-scheme:\s*dark/.test(s) && /:root:not\(\[data-theme="light"\]\)/.test(s);
const isThemeDark = (s) => s === ':root[data-theme="dark"]';

function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const KEYS = ['--bg', '--card', '--line', '--muted', '--ink', '--pill', '--chip'];

test('dark mode: the media-query dark tokens and the data-theme dark tokens are the same colours', () => {
  const a = tokens(isMediaDark), b = tokens(isThemeDark);
  KEYS.forEach((k) => assert.equal(a[k], b[k], k + ' differs between the two dark blocks'));
});

test('dark mode: a card stands apart from the page (contrast at least 1.3; it was 1.10)', () => {
  const t = tokens(isMediaDark);
  assert.ok(ratio(t['--card'], t['--bg']) >= 1.3, 'card ' + t['--card'] + ' on page ' + t['--bg'] + ' = ' + ratio(t['--card'], t['--bg']).toFixed(2));
});

test('dark mode: a card edge shows against the card (contrast at least 1.5; it was 1.32)', () => {
  const t = tokens(isMediaDark);
  assert.ok(ratio(t['--line'], t['--card']) >= 1.5, 'line ' + t['--line'] + ' on card ' + t['--card'] + ' = ' + ratio(t['--line'], t['--card']).toFixed(2));
});

test('dark mode: text on a card stays readable (muted 4.5, ink 7)', () => {
  const t = tokens(isMediaDark);
  assert.ok(ratio(t['--muted'], t['--card']) >= 4.5, 'muted ' + ratio(t['--muted'], t['--card']).toFixed(2));
  assert.ok(ratio(t['--ink'], t['--card']) >= 7, 'ink ' + ratio(t['--ink'], t['--card']).toFixed(2));
});

test('light mode is unchanged: page #f6f5f2, card #fff, line #dedcd6', () => {
  const t = tokens(isLight);
  assert.equal(t['--bg'], '#f6f5f2');
  assert.equal(t['--card'], '#fff');
  assert.equal(t['--line'], '#dedcd6');
});

test('the heavier card shadow is for dark mode only', () => {
  // A dark-only .card rule exists (media dark and data-theme dark), and no light rule gives .card that shadow.
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\) \.card\{[^}]*box-shadow:0 3px 14px/);
  assert.match(css, /:root\[data-theme="dark"\] \.card\{[^}]*box-shadow:0 3px 14px/);
  assert.doesNotMatch(css.replace(/@media \(prefers-color-scheme: dark\)\{[^{}]*\{[^}]*\}\}/g, '').replace(/:root\[data-theme="dark"\][^{]*\{[^}]*\}/g, ''), /box-shadow:0 3px 14px/);
});
