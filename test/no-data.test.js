// titanalaska/Sidewalk is a PUBLIC repo and Pages serves every tracked file.
// Code only: customer sites, addresses, routes and session notes live in
// snow-app-script (no remote) or behind sign-in, never here. The route list
// was one push away from going public on 10/1/26; this keeps it out.
const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');

const tracked = execSync('git ls-files', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).split('\n').filter(Boolean);

test('no data files are tracked: the only JSON is package config', () => {
  const json = tracked.filter((f) => /\.json$/i.test(f) && !/^(package|package-lock|manifest)\.json$/.test(f));
  assert.deepStrictEqual(json, []);
});

// Session notes are Markdown named HANDOFF… (HANDOFF.md, handoff-notes.md). The
// shift handoff feature (lib/handoff.js, its spec and plan) is code and docs, not notes.
const isNotes = (f) => /(^|\/)HANDOFF[^/]*\.md$/i.test(f);

test('no session handoff notes are tracked', () => {
  assert.deepStrictEqual(tracked.filter(isNotes), []);
});

test('the notes guard still knows a notes file from the handoff feature', () => {
  assert.deepStrictEqual(['HANDOFF.md', 'docs/handoff-notes.md', 'lib/handoff.js', 'docs/superpowers/specs/2026-10-05-handoff-sheets-design.md'].filter(isNotes),
    ['HANDOFF.md', 'docs/handoff-notes.md']);
});

test('no route-sheet tooling is tracked (it reads the customer PDFs)', () => {
  assert.deepStrictEqual(tracked.filter((f) => /^tools\//.test(f)), []);
});
