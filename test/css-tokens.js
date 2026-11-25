// Reading app.css as text, no browser: its rules, its colour tokens per mode, and WCAG 2 contrast.
// Shared by test/dark-cards.test.js and test/theme.test.js (Titan colours, 11/24/26).
//
// Day colours live in `:root{…}` blocks; night colours in `@media (prefers-color-scheme: dark){:root{…}}` blocks.
// Until the merge (Titan colours, Task 1) the night selector read `:root:not([data-theme="light"])`; both spellings
// are read as night here, so the merge's own test can show the colours did not move across it.
const fs = require('fs');
const path = require('path');

function readCss() {
  return fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
}

// Every rule in file order: { media: the @media prelude or null, selector, body }. Comments are dropped first.
function rules(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  (function walk(s, media) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const prelude = s.slice(i, open).trim(), body = s.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else out.push({ media, selector: prelude, body });
      i = j;
    }
  })(text, null);
  return out;
}

const isDarkMedia = (m) => !!m && /prefers-color-scheme:\s*dark/.test(m);
const isRoot = (sel) => sel === ':root' || sel === ':root:not([data-theme="light"])';

// The custom properties set for one mode, values lowercased; a later block wins, as in the browser.
function tokens(css, mode) {
  const out = {};
  rules(css).forEach((r) => {
    const want = mode === 'day' ? r.media === null && r.selector === ':root' : isDarkMedia(r.media) && isRoot(r.selector);
    if (!want) return;
    r.body.split(';').forEach((d) => {
      const k = d.indexOf(':');
      if (k < 0) return;
      const name = d.slice(0, k).trim(), value = d.slice(k + 1).trim();
      if (name.startsWith('--')) out[name] = value.toLowerCase();
    });
  });
  return out;
}

// What a page in that mode actually resolves: the day tokens, with the night ones on top at night.
function palette(css, mode) {
  return mode === 'night' ? { ...tokens(css, 'day'), ...tokens(css, 'night') } : tokens(css, 'day');
}

function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// WCAG ratio (L1 + 0.05) / (L2 + 0.05). a and b are hex values, or token names looked up in pal.
function ratio(a, b, pal) {
  const hex = (v) => (v.startsWith('--') ? pal[v] : v);
  const x = lum(hex(a)), y = lum(hex(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

module.exports = { readCss, rules, tokens, palette, lum, ratio, isDarkMedia };
