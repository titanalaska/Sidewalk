const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/forms');

test('next id skips past the highest, not the count', () => {
  // Three ids with a gap. The count says C04, which could collide one day. The highest says C13.
  assert.equal(F.nextWorkerId(['C01', 'C12', 'C10']), 'C13');
  assert.equal(F.nextWorkerId(['C09']), 'C10');
  assert.equal(F.nextWorkerId([]), 'C01');
  assert.equal(F.nextWorkerId(['X5', 'C02']), 'C03');
});
test('clearances: lines parse, blanks become null', () => {
  const r = F.parseClearances('JBER | yes | 2025-11-01 | 2026-10-20\n\nPORT | no | | ');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.list, [
    { site: 'JBER', cleared: true, date: '2025-11-01', expires: '2026-10-20' },
    { site: 'PORT', cleared: false, date: null, expires: null },
  ]);
});
test('clearances: a bad date is refused with its line number', () => {
  assert.deepEqual(F.parseClearances('JBER | yes | 11/1/25 | ').errors, ['line 1: dates must be YYYY-MM-DD']);
  assert.deepEqual(F.parseClearances('JBER | maybe').errors, ['line 1: cleared must be yes or no']);
});
test('clearances: format writes the same line format', () => {
  assert.equal(F.formatClearances([
    { site: 'JBER', cleared: true, date: '2025-11-01', expires: '2026-10-20' },
    { site: 'PORT', cleared: null, date: null, expires: null },
  ]), 'JBER | yes | 2025-11-01 | 2026-10-20\nPORT |  |  | ');
});
test('sites: a pipe marks the clearance', () => {
  assert.deepEqual(F.parseSites('PAC\n\nJBER gate | JBER\n'), [
    { name: 'PAC', needs_clearance: null },
    { name: 'JBER gate', needs_clearance: 'JBER' },
  ]);
  assert.equal(F.formatSites([{ name: 'PAC', needs_clearance: null }, { name: 'JBER gate', needs_clearance: 'JBER' }]), 'PAC\nJBER gate | JBER');
});
test('tri-state: blank is null, not false', () => {
  assert.equal(F.parseTri(''), null);
  assert.equal(F.parseTri('yes'), true);
  assert.equal(F.parseTri('no'), false);
  assert.equal(F.formatTri(null), '');
  assert.equal(F.formatTri(false), 'no');
});
test('list: commas split and trim', () => {
  assert.deepEqual(F.parseList(' loader, , plow truck '), ['loader', 'plow truck']);
});
