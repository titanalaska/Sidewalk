// Print route lists (Matt, 11/10/26): one page per live route, the plan and never the log.
// lib/routelist.js turns routes, sites, zones, crew and moves into pages (data) and a page into HTML.
//
// Expected values are worked out on paper in the comments from the brief's rules, never copied
// from what the code returned.
//
// The fixture (deliberately untidy):
//   Routes, given in this order: R3 "N10", R1 "N2", RA "N1" (archived).
//     The Routes tab lists live routes by name, numeric-aware (lib/app.js renderRoutes): N2 before N10.
//     A plain string sort would put N10 first, the given order has N10 first too, so only the real rule
//     gives [N2, N10]. The archived N1 is never printed.
//   R1 "N2" site_ids: S3, SX (no record), S1, SA (archived). Printed in THAT order, skipping SX and SA:
//     S3 "Zeta Lot", then S1 "Alpha Court" (by name it would be Alpha first).
//   R3 "N10" site_ids: S2 "Beta Yard", which has no zones.
//   S1 Alpha Court: address, materials "NO SALT: fresh concrete. Sand only.", notes on two lines with & and <.
//     Zones: Z1 sidewalk "Front walk" (priority), Z2 heated "Entry pad", Z3 + Z4 hand zones named Curb north
//     (1,200 sq ft) and Curb south (800 sq ft), Z5 archived sidewalk "Old path", Z6 storage "Snow pile".
//     Curb zones are 4 ft wide: 1,200 / 4 = 300 ft and 800 / 4 = 200 ft, 500 ft in all, one item
//     "Curbs (about 500 ft)". Walks by name, then the curb item (lib/shiftlog.js walksFor):
//       Entry pad (heated), Front walk (priority), Curbs (about 500 ft).
//   S3 Zeta Lot: no address, blank materials, whitespace-only notes, one sidewalk "Lot walk".
//   S2 Beta Yard: no zones at all -> no walks -> "No walks drawn yet."
//   Crew: C1 Alex Lead, C2 Bea Member, C3 Cy Member, C4 Dee Gone (archived), C5 Eve Waiting (pending).
//   Moves (the board replays them by time): C4 -> R1 07:00, C5 -> R1 07:30, C2 -> R1 08:00, C3 -> R1 09:00,
//     C1 -> R1 as lead 10:00. Archived and pending cards are not crew. R1 board: lead Alex Lead, members
//     in the order they were placed: Bea Member, Cy Member. R3: nobody.
const test = require('node:test');
const assert = require('node:assert/strict');
const RouteList = require('../lib/routelist.js');

const mk = () => ({
  routes: [
    { id: 'R3', name: 'N10', site_ids: ['S2'] },
    { id: 'R1', name: 'N2', site_ids: ['S3', 'SX', 'S1', 'SA'] },
    { id: 'RA', name: 'N1', site_ids: ['S1'], archived: true },
  ],
  sites: [
    { id: 'S1', name: 'Alpha Court', address: '1 Main St', materials_needed: 'NO SALT: fresh concrete. Sand only.', notes: 'Gate code on <post>\nBack & forth' },
    { id: 'S2', name: 'Beta Yard' },
    { id: 'S3', name: 'Zeta Lot', address: '', materials_needed: '', notes: '   ' },
    { id: 'SA', name: 'Hidden Lot', archived: true },
  ],
  zones: [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Front walk', priority: true },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Entry pad' },
    { id: 'Z3', site_id: 'S1', type: 'hand', name: 'Curb north', area_sqft: 1200 },
    { id: 'Z4', site_id: 'S1', type: 'hand', name: 'Curb south', area_sqft: 800 },
    { id: 'Z5', site_id: 'S1', type: 'sidewalk', name: 'Old path', archived: true },
    { id: 'Z6', site_id: 'S1', type: 'storage', name: 'Snow pile' },
    { id: 'Z7', site_id: 'S3', type: 'sidewalk', name: 'Lot walk' },
  ],
  crew: [
    { id: 'C1', name: 'Alex Lead' }, { id: 'C2', name: 'Bea Member' }, { id: 'C3', name: 'Cy Member' },
    { id: 'C4', name: 'Dee Gone', archived: true }, { id: 'C5', name: 'Eve Waiting', pending: true },
  ],
  moves: [
    { id: 'M1', at: '2026-11-09T07:00:00Z', worker: 'C4', to_route: 'R1', role: 'member' },
    { id: 'M2', at: '2026-11-09T07:30:00Z', worker: 'C5', to_route: 'R1', role: 'member' },
    { id: 'M3', at: '2026-11-09T08:00:00Z', worker: 'C2', to_route: 'R1', role: 'member' },
    { id: 'M4', at: '2026-11-09T09:00:00Z', worker: 'C3', to_route: 'R1', role: 'member' },
    { id: 'M5', at: '2026-11-09T10:00:00Z', worker: 'C1', to_route: 'R1', role: 'lead' },
  ],
});

test('one page per live route, in the Routes tab order (numeric by name), never the archived one', () => {
  const pages = RouteList.pages(mk());
  assert.deepEqual(pages.map((p) => p.name), ['N2', 'N10']);
  assert.deepEqual(pages.map((p) => p.route_id), ['R1', 'R3']);
});

test('sites print in the route own site_ids order; an archived site and an id with no record are skipped', () => {
  const p = RouteList.pages(mk())[0];
  assert.deepEqual(p.sites.map((s) => s.id), ['S3', 'S1']); // not Alpha first, not SX, not SA
  assert.deepEqual(p.sites.map((s) => s.name), ['Zeta Lot', 'Alpha Court']);
});

test('site fields: address, materials and notes carried; blank ones come back blank', () => {
  const [zeta, alpha] = RouteList.pages(mk())[0].sites;
  assert.equal(alpha.address, '1 Main St');
  assert.equal(alpha.materials, 'NO SALT: fresh concrete. Sand only.');
  assert.equal(alpha.notes, 'Gate code on <post>\nBack & forth');
  assert.equal(zeta.address, '');
  assert.equal(zeta.materials, '');
  assert.equal(String(zeta.notes).trim(), '');
});

test('walks come from walksFor: heated flagged, priority flagged, curbs rolled up, archived and storage left out', () => {
  const alpha = RouteList.pages(mk())[0].sites[1];
  assert.deepEqual(alpha.walks, [
    { name: 'Entry pad', heated: true, priority: false },
    { name: 'Front walk', heated: false, priority: true },
    { name: 'Curbs (about 500 ft)', heated: false, priority: false },
  ]);
  assert.deepEqual(RouteList.pages(mk())[0].sites[0].walks, [{ name: 'Lot walk', heated: false, priority: false }]);
});

test('a site with no zones has no walks (not the Storm tab "Whole site" stand-in)', () => {
  assert.deepEqual(RouteList.pages(mk())[1].sites[0].walks, []);
});

test('crew from the Board as it stands: lead and members placed; archived and pending cards left out; empty route has nobody', () => {
  const [n2, n10] = RouteList.pages(mk());
  assert.equal(n2.lead, 'Alex Lead');
  assert.deepEqual(n2.members, ['Bea Member', 'Cy Member']);
  assert.equal(n10.lead, null);
  assert.deepEqual(n10.members, []);
});

test('no routes at all: no pages', () => {
  const o = mk(); o.routes = [];
  assert.deepEqual(RouteList.pages(o), []);
  assert.deepEqual(RouteList.pages({ routes: [{ id: 'RA', name: 'N1', archived: true }], sites: [], zones: [], crew: [], moves: [] }), []);
});

const html = (i, t) => RouteList.pageHtml(RouteList.pages(mk())[i], t || ((s) => s));
const count = (s, needle) => s.split(needle).length - 1;

test('page: the heading, a blank date (never a real one), the crew lines', () => {
  const h = html(0);
  assert.match(h, /<h1[^>]*>N2<\/h1>/);
  assert.ok(h.includes('Date:'));
  assert.ok(h.includes('____________________'));
  assert.ok(!/\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/.test(h), 'no date printed');
  assert.ok(h.includes('Lead'));
  assert.ok(h.includes('Alex Lead'));
  assert.ok(h.includes('Crew:'));
  assert.ok(h.includes('Bea Member, Cy Member'));
});

test('page: nobody placed prints the blanks to write on', () => {
  const h = html(1);
  // Lead: ____________________   Crew: ____________________ ____________________
  assert.equal(count(h, '____________________'), 1 + 1 + 2); // date, lead, two crew blanks
});

test('page: a lead alone omits the Crew line; members alone omit the Lead line', () => {
  const o = mk(); o.moves = [{ id: 'M5', at: '2026-11-09T10:00:00Z', worker: 'C1', to_route: 'R1', role: 'lead' }];
  let h = RouteList.pageHtml(RouteList.pages(o)[0], (s) => s);
  assert.ok(h.includes('Alex Lead'));
  assert.ok(!h.includes('Crew:'));
  o.moves = [{ id: 'M3', at: '2026-11-09T08:00:00Z', worker: 'C2', to_route: 'R1', role: 'member' }];
  h = RouteList.pageHtml(RouteList.pages(o)[0], (s) => s);
  assert.ok(h.includes('Crew:') && h.includes('Bea Member'));
  assert.ok(!h.includes('Lead'));
});

test('page: the NO SALT line is bold; a blank materials site prints no Materials line; one Materials: in all', () => {
  const h = html(0);
  assert.ok(h.includes('<b data-no-es>NO SALT: fresh concrete. Sand only.</b>'));
  assert.equal(count(h, 'Materials:'), 1); // Zeta Lot has none
});

test('page: notes are escaped and keep their line break; names and address are escaped', () => {
  const h = html(0);
  assert.ok(h.includes('Gate code on &lt;post&gt;<br>Back &amp; forth'));
  assert.ok(!h.includes('<post>'));
  assert.ok(h.includes('1 Main St'));
  assert.equal(count(h, 'Notes:'), 1); // Zeta Lot has whitespace-only notes: none
});

test('page: one box per walk, the heated one says so, the priority one has a star, archived and storage never print', () => {
  const h = html(0);
  assert.equal(count(h, 'class="rl-box"'), 4); // Lot walk + Entry pad + Front walk + Curbs
  assert.equal(count(h, '(heated: check only)'), 1);
  assert.ok(h.includes('Entry pad'));
  assert.ok(h.includes('★ Front walk'));
  assert.ok(!h.includes('★ Entry pad') && !h.includes('★ Curbs'));
  assert.ok(h.includes('Curbs (about 500 ft)'));
  assert.ok(!h.includes('Old path') && !h.includes('Snow pile'));
  assert.ok(!h.includes('Hidden Lot'));
});

test('page: a site with no walks says so and has no box; every site ends with the blanks line', () => {
  const h = html(1);
  assert.ok(h.includes('No walks drawn yet.'));
  assert.equal(count(h, 'class="rl-box"'), 0);
  assert.ok(h.includes('Beta Yard'));
  for (const hh of [html(0), h]) {
    assert.ok(hh.includes('Materials used'));
    assert.ok(hh.includes('In:') && hh.includes('Out:'));
  }
  assert.equal(count(html(0), 'Materials used'), 2); // two sites
});

test('page: sites come in the page order (Zeta Lot before Alpha Court)', () => {
  const h = html(0);
  assert.ok(h.indexOf('Zeta Lot') < h.indexOf('Alpha Court'));
});

test('every label goes through the translator and no data does', () => {
  const up = (s) => String(s).toUpperCase();
  const h = html(0, up);
  for (const label of ['DATE:', 'LEAD', 'CREW:', 'MATERIALS:', 'NOTES:', 'MATERIALS USED', 'IN:', 'OUT:', '(HEATED: CHECK ONLY)']) assert.ok(h.includes(label), label);
  assert.ok(html(1, up).includes('NO WALKS DRAWN YET.'));
  // data untouched
  for (const d of ['Alpha Court', 'Zeta Lot', '1 Main St', 'NO SALT: fresh concrete. Sand only.', 'Alex Lead', 'Bea Member, Cy Member', 'Entry pad', 'Front walk', 'Curbs (about 500 ft)', 'Back &amp; forth']) assert.ok(h.includes(d), d);
  assert.ok(!h.includes('ALPHA COURT') && !h.includes('ALEX LEAD') && !h.includes('ENTRY PAD'));
  // and no English label is left outside the data: take the data out, nothing English remains
  const plain = html(1, up).replace(/<[^>]*>/g, ' ').replace('Beta Yard', ' ').replace(/N10/, ' ');
  assert.ok(!/Date|Lead|Crew|Materials|Notes|In:|Out:|walks|heated/.test(plain), plain);
});

test('css is a string of rules the view can scope', () => {
  assert.equal(typeof RouteList.css, 'string');
  assert.match(RouteList.css, /\.rl-page/);
  assert.match(RouteList.css, /break-after:\s*page/);
});
