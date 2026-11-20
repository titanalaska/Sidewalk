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
//     "Curbs: clear 4 ft back (about 500 ft)" (wording changed on Matt's word 11/12/26). Walks by name, then the curb item (lib/shiftlog.js walksFor):
//       Entry pad (heated), Front walk (priority), Curbs: clear 4 ft back (about 500 ft).
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
    { id: 'S1', name: 'Alpha Court', address: '1 Main St', materials_needed: 'NO SALT: fresh concrete. Sand only.', notes: 'Gate code on <post>\nBack & forth',
      units: { bobcat: ' BC5 ', snowrator: '' } }, // the Sites editor's unit numbers (route sheet columns, 11/19/26)
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
  // curbs: true only on the curb item (its walk id is curbs-1, it has no zone of its own) (one line per site, 11/14/26).
  assert.deepEqual(alpha.walks, [
    { name: 'Entry pad', heated: true, priority: false, new_concrete: false, curbs: false },
    { name: 'Front walk', heated: false, priority: true, new_concrete: false, curbs: false },
    { name: 'Curbs: clear 4 ft back (about 500 ft)', heated: false, priority: false, new_concrete: false, curbs: true },
  ]);
  assert.deepEqual(RouteList.pages(mk())[0].sites[0].walks, [{ name: 'Lot walk', heated: false, priority: false, new_concrete: false, curbs: false }]);
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

// A big route prints on two landscape pages since the route sheet columns (Matt 11/19/26), and a loose page 2 must still say
// whose it is (final review, 11/19/26). A browser repeats a table's <thead> on every printed page, so the route name, the Date
// blank and the Lead / Crew lines are the FIRST row of the thead: one cell spanning every column. By hand: N2 has a curb item
// -> 9 column headers in the second row, so colspan="9"; with the curbs taken away (the heated-only case) -> 8.
test('page: the route name, date and crew head the table, so every printed page carries them', () => {
  for (const [o, cols] of [[mk(), 9], [(() => { const x = mk(); x.zones = x.zones.filter((z) => !['Z1', 'Z3', 'Z4'].includes(z.id)); return x; })(), 8]]) {
    const h = RouteList.pageHtml(RouteList.pages(o)[0], (s) => s);
    const head = h.slice(h.indexOf('<thead>'), h.indexOf('</thead>'));
    const rows = head.split('<tr').slice(1);
    assert.equal(rows.length, 2);
    assert.match(rows[0], new RegExp('<th class="rl-pagehead" colspan="' + cols + '">'));
    assert.match(rows[0], /<h1[^>]*>N2<\/h1>/);
    for (const w of ['Date:', 'Lead', 'Alex Lead', 'Crew:', 'Bea Member, Cy Member']) assert.ok(rows[0].includes(w), w);
    assert.equal(count(rows[1], '</th>'), cols);
    assert.ok(!h.slice(0, h.indexOf('<thead>')).includes('Date:'), 'the heading is not printed twice');
  }
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

// One line per site (Matt, 11/14/26: 32 pages was far too much, "a page per route"; he chose one line per site over every
// walk in small type). Each site is ONE table row: Done always; Treated when the site has a walk to treat (not heated, not
// the curb item) or no walks at all; Curbs done only on a route that has a curb item, a box at the site that has one.
// Plain walks are not listed; only the ones that need a word: ★ Priority, Heated (check only), Sand only (no salt), the
// curb item's own line. By hand on page N2:
//
// Route sheet columns (Matt, 11/19/26): Treated and Materials used are gone; Shoveled is a box at EVERY site, and Ice melt
// (bags), Sand (buckets) and Equipment are new columns. Worked again on page N2:
//   Zeta Lot: Lot walk (plain sidewalk)          -> Done box, Shoveled box, Curbs "—"; no lines; "Lot walk" not printed.
//   Alpha Court: Entry pad (heated), Front walk (sidewalk, priority), the curb item
//                                                -> Done box, Shoveled box, Curbs box;
//                                                   "★ Priority: Front walk", "Heated, check only: Entry pad", the curb line.
//   Boxes 2 + 3 = 5 (the same total as before by coincidence: Shoveled took Treated's place, so the headers are checked
//   too). Headers: the site column (no word), Done, Shoveled, Curbs done, In:, Out:, Ice melt (bags), Sand (buckets),
//   Equipment = 9, in that order.
test('page: one row per site; Done and Shoveled always, Curbs done only with curbs; only the walks that need a word', () => {
  const h = html(0);
  assert.equal(count(h, 'class="rl-site"'), 2);
  assert.equal(count(h, '</th>'), 10); // 9 column headers + the heading cell that spans them
  assert.ok(!h.includes('Treated') && !h.includes('Materials used'));
  const head = h.slice(h.indexOf('<thead>'), h.indexOf('</thead>'));
  const order = ['>Done<', '>Shoveled<', '>Curbs done<', '>In:<', '>Out:<', '>Ice melt (bags)<', '>Sand (buckets)<', '>Equipment<'].map((w) => head.indexOf(w));
  assert.ok(order.every((at) => at > 0), 'every header is there: ' + order);
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), 'headers in order');
  assert.equal(count(h, 'class="rl-box"'), 5);
  assert.equal(count(h, 'class="rl-na"'), 1); // Zeta Lot's Curbs cell
  const [zeta, alpha] = h.split('class="rl-site"').slice(1);
  assert.equal(count(zeta, 'class="rl-box"'), 2);
  assert.equal(count(alpha, 'class="rl-box"'), 3);
  assert.ok(!h.includes('Lot walk'), 'a plain walk is not listed');
  assert.ok(alpha.includes('★ <span>Priority:</span> <span data-no-es>Front walk</span>'));
  assert.ok(alpha.includes('<span>Heated, check only:</span> <span data-no-es>Entry pad</span>'));
  assert.ok(alpha.includes('<span data-no-es>Curbs: clear 4 ft back (about 500 ft)</span>')); // wording changed on Matt's word 11/12/26
  assert.equal(count(h, 'Priority:'), 1);
  assert.equal(count(h, 'Heated, check only:'), 1);
  assert.ok(!h.includes('Old path') && !h.includes('Snow pile'));
  assert.ok(!h.includes('Hidden Lot'));
});

// By hand: take Alpha Court's Front walk and both curb zones away, so its only walk is Entry pad (heated). Nothing on the page
// is a curb item -> no Curbs done column (8 headers). Shoveled is a box at every site, a heated-only one too (snow can still be
// shoveled off it; Matt approved 11/19/26): Zeta Lot Done + Shoveled = 2, Alpha Court Done + Shoveled = 2. 4 boxes, no "—".
test('page: a heated-only site still gets a Shoveled box; a route with no curbs has no Curbs done column', () => {
  const o = mk();
  o.zones = o.zones.filter((z) => !['Z1', 'Z3', 'Z4'].includes(z.id));
  const h = RouteList.pageHtml(RouteList.pages(o)[0], (s) => s);
  assert.equal(count(h, '</th>'), 9); // 8 column headers + the heading cell
  assert.ok(!h.includes('Curbs done'));
  assert.equal(count(h, 'class="rl-box"'), 4);
  assert.equal(count(h, 'class="rl-na"'), 0);
  const alpha = h.split('class="rl-site"')[2];
  assert.equal(count(alpha, 'class="rl-box"'), 2);
});

// Ice melt (bags) and Sand (buckets) are counts the crew writes in (whole ones: Matt 11/19/26, "if you crack one open, you
// use it"); nothing is printed in them, at any site.
test('page: Ice melt and Sand cells are empty at every site', () => {
  for (const h of [html(0), html(1)]) {
    const rows = h.split('class="rl-site"').slice(1);
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      const cells = row.split('class="rl-write rl-amount"').slice(1);
      assert.equal(cells.length, 2, 'two amount cells');
      for (const c of cells) assert.equal(c.slice(c.indexOf('>') + 1, c.indexOf('</td>')).replace(/<[^>]*>/g, '').trim(), '');
    }
  }
});

// The Equipment cell (Matt, 11/19/26): words to CIRCLE, not a blank. Three lines:
//   Bobcat <unit>: Bucket · Snowblower · Sweepster · Plow · Box      (no V blade: "Leave it off")
//   Operator: ____
//   Snowrator <unit>  Operator: ____    Walk-behind blower
// A unit comes from the site's units (the Sites editor's Bobcat unit # / Snowrator unit #), trimmed; a blank one prints #___.
// By hand: Alpha Court units { bobcat: ' BC5 ', snowrator: '' } -> "BC5" once, "#___" once (the Snowrator). Zeta Lot has no
// units -> "#___" twice. Operator: twice per cell. Walk-behind blower once per cell. V blade nowhere.
test('page: the Equipment cell, units from the site, V blade never', () => {
  const p = RouteList.pages(mk());
  const n2 = p.find((x) => x.name === 'N2');
  assert.deepEqual(n2.sites.map((s) => s.units), [{ bobcat: '', snowrator: '' }, { bobcat: 'BC5', snowrator: '' }]);
  const h = RouteList.pageHtml(n2, (s) => s);
  const cellOf = (row) => row.slice(row.indexOf('class="rl-equip"'), row.indexOf('</td>', row.indexOf('class="rl-equip"')));
  const [zeta, alpha] = h.split('class="rl-site"').slice(1).map(cellOf);
  for (const c of [zeta, alpha]) {
    const at = ['>Bobcat<', '>Bucket<', '>Snowblower<', '>Sweepster<', '>Plow<', '>Box<', '>Snowrator<', '>Walk-behind blower<'].map((w) => c.indexOf(w));
    assert.ok(at.every((x) => x > 0), 'every word is there: ' + at);
    assert.deepEqual(at, at.slice().sort((a, b) => a - b), 'in order');
    assert.equal(count(c, '>Operator:<'), 2);
    assert.equal(count(c, '>Walk-behind blower<'), 1);
  }
  assert.equal(count(alpha, '>BC5<'), 1);
  assert.equal(count(alpha, '#___'), 1);
  assert.ok(alpha.indexOf('>BC5<') < alpha.indexOf('>Bucket<'), 'the Bobcat unit beside the Bobcat');
  assert.equal(count(zeta, '#___'), 2);
  assert.ok(!h.includes('V blade') && !h.includes('V-blade'));
  assert.equal(count(h, 'class="rl-box"'), 5, 'the circle words are not boxes');
});

// New concrete (11/12/26): a striped walk carries the flag onto the list and prints "(sand only, no salt)" after its name;
// a plain walk never does. By hand on the Alpha Court fixture: stripe Front walk (Z1) and ONE of the two curb zones (Z3),
// so the walks are Entry pad (plain), Front walk (striped), Curbs item (striped: any zone in the item is enough). Two tags
// in all on that site; Zeta Lot's Lot walk is plain -> its page has none. The tag is a label, so it goes through the translator.
test('new concrete: a striped walk (and a curb item with one striped zone) prints (sand only, no salt); a plain walk does not', () => {
  const o = mk();
  o.zones.find((z) => z.id === 'Z1').new_concrete = true;
  o.zones.find((z) => z.id === 'Z3').new_concrete = true;
  const alpha = RouteList.pages(o)[0].sites[1];
  assert.deepEqual(alpha.walks.map((w) => [w.name, w.new_concrete]), [['Entry pad', false], ['Front walk', true], ['Curbs: clear 4 ft back (about 500 ft)', true]]);
  // One line per site (11/14/26): the striped walks are one "Sand only, no salt:" line at their site, in walk order.
  const h = RouteList.pageHtml(RouteList.pages(o)[0], (s) => s);
  assert.equal(count(h, 'Sand only, no salt:'), 1);
  assert.ok(h.includes('<span>Sand only, no salt:</span> <span data-no-es>Front walk, Curbs: clear 4 ft back (about 500 ft)</span>'));
  assert.ok(!h.split('class="rl-site"')[1].includes('Sand only'), 'Zeta Lot has no striped walk');
  assert.ok(RouteList.pageHtml(RouteList.pages(o)[0], (s) => String(s).toUpperCase()).includes('SAND ONLY, NO SALT:'));
  assert.equal(count(html(0), 'Sand only, no salt:'), 0); // the untouched fixture prints none (its materials text says 'Sand only.': data)
});

// Beta Yard has no zones: "No walks drawn yet." and still Done + Treated to tick (the crew clears the Whole site); no curbs on
// the route -> no Curbs done column. In:, Out: and Materials used are column headings: once per page, never once per site.
// Beta Yard (no zones): Done + Shoveled = 2 boxes. The write-in columns head the table once per page, never once per site.
test('page: a site with no walks says so and keeps Done and Shoveled; the write-in columns head the table once', () => {
  const h = html(1);
  assert.ok(h.includes('No walks drawn yet.'));
  assert.equal(count(h, 'class="rl-box"'), 2);
  assert.ok(h.includes('Beta Yard'));
  for (const hh of [html(0), h]) {
    assert.equal(count(hh, 'Materials used'), 0);
    for (const w of ['Ice melt (bags)', 'Sand (buckets)', 'In:', 'Out:', '>Equipment<']) assert.equal(count(hh, w), 1, w);
  }
});

test('page: sites come in the page order (Zeta Lot before Alpha Court)', () => {
  const h = html(0);
  assert.ok(h.indexOf('Zeta Lot') < h.indexOf('Alpha Court'));
});

test('every label goes through the translator and no data does', () => {
  const up = (s) => String(s).toUpperCase();
  const h = html(0, up);
  for (const label of ['DATE:', 'LEAD', 'CREW:', 'MATERIALS:', 'NOTES:', 'IN:', 'OUT:', 'DONE', 'SHOVELED', 'CURBS DONE', 'PRIORITY:', 'HEATED, CHECK ONLY:',
    'ICE MELT (BAGS)', 'SAND (BUCKETS)', 'EQUIPMENT', 'BUCKET', 'SNOWBLOWER', 'PLOW', 'BOX', 'OPERATOR:', 'WALK-BEHIND BLOWER']) assert.ok(h.includes(label), label);
  // Bobcat, Snowrator and Sweepster are brand names: printed as typed, never through the translator.
  for (const brand of ['>Bobcat<', '>Snowrator<', '>Sweepster<']) assert.ok(h.includes(brand), brand);
  assert.ok(html(1, up).includes('NO WALKS DRAWN YET.'));
  // data untouched
  for (const d of ['Alpha Court', 'Zeta Lot', '1 Main St', 'NO SALT: fresh concrete. Sand only.', 'Alex Lead', 'Bea Member, Cy Member', 'Entry pad', 'Front walk', 'Curbs: clear 4 ft back (about 500 ft)', 'Back &amp; forth']) assert.ok(h.includes(d), d);
  assert.ok(!h.includes('ALPHA COURT') && !h.includes('ALEX LEAD') && !h.includes('ENTRY PAD'));
  // and no English label is left outside the data: take the data out, nothing English remains
  const plain = html(1, up).replace(/<[^>]*>/g, ' ').replace('Beta Yard', ' ').replace(/N10/, ' ').replace(/Bobcat|Snowrator|Sweepster/g, ' ');
  assert.ok(!/Date|Lead|Crew|Materials|Notes|In:|Out:|walks|heated|Done|Treated|Curbs|Priority|Sand|Shoveled|Ice|Equipment|bags|buckets|Bucket|Snowblower|Plow|Box|Operator|Walk/.test(plain), plain);
});

// Everything from data is escaped, wherever it lands: route, site, address, materials, walk and crew names.
// Each value carries a < and an & that would read as markup if it went through raw.
test('page: every piece of data is escaped (route, site, address, materials, walk, crew)', () => {
  const o = {
    routes: [{ id: 'R1', name: 'N<2>&', site_ids: ['S1'] }],
    sites: [{ id: 'S1', name: 'Site <b>', address: '5 A&B St', materials_needed: 'NO <SALT> & sand', notes: 'n<1>', units: { bobcat: 'B<5>&', snowrator: 'S&<1>' } }],
    zones: [{ id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Walk <1>', priority: true }], // priority: a plain walk is not listed (11/14/26)
    crew: [{ id: 'C1', name: 'Lee <x>' }, { id: 'C2', name: 'Kai & Co' }],
    moves: [{ id: 'M1', at: '2026-11-09T07:00:00Z', worker: 'C1', to_route: 'R1', role: 'lead' }, { id: 'M2', at: '2026-11-09T08:00:00Z', worker: 'C2', to_route: 'R1', role: 'member' }],
  };
  const h = RouteList.pageHtml(RouteList.pages(o)[0], (s) => s);
  for (const d of ['N&lt;2&gt;&amp;', 'Site &lt;b&gt;', '5 A&amp;B St', 'NO &lt;SALT&gt; &amp; sand', 'n&lt;1&gt;', 'Walk &lt;1&gt;', 'Lee &lt;x&gt;', 'Kai &amp; Co', 'B&lt;5&gt;&amp;', 'S&amp;&lt;1&gt;']) assert.ok(h.includes(d), d);
  assert.ok(!/<(2|SALT|1|x|5)>/.test(h) && !h.includes('Site <b>'), 'a data < became a tag');
});

test('css is a string of rules the view can scope', () => {
  assert.equal(typeof RouteList.css, 'string');
  assert.match(RouteList.css, /\.rl-page/);
  assert.match(RouteList.css, /break-after:\s*page/);
  assert.match(RouteList.css, /\.rl-site \{[^}]*break-inside:\s*avoid/); // a site's row is never split across two pages
});
