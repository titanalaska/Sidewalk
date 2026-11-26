// The Site card's machine lines (Matt, 11/24/26): one line per Bobcat (unit, attachment, operator, minutes), one per
// Snowrator (unit, operator, minutes), + Add / Remove, the walk-behind blower still a tick and minutes, a read-only
// "Already logged" list, and old shell-78 minutes carried through. The real page over file:// on Matt's phone, a small
// fake backend that mirrors saveVisit (CrewShiftLog.machineProblem, stampMachines), made-up names only.
//
// The world, worked on paper (clock 7:30 AM 10/3, so the shift is night-2026-10-02; storm ST-1 open):
//   crew:  C01 Alex Test (lead)  C02 Aaron Able  C03 Jordan Demo  C04 Pat Quit  C05 Ben Bravo  C07 Zed Zander
//          C22 Loki Haskins  C23 Jake Moss; Matt signs in as admin, named Matthew (key 'admin', not on the roster)
//   post:  night-2026-10-02, route R1 (site S1): lead C01, member C03   -> tonight's people for S1, in that order
//   units: S1 bobcat "BC5, BT13", snowrator "Snowrator 1"; S2 bobcat "BC7"; S3 bobcat "bc5 , AA1"
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');
const SL = require('../lib/shiftlog.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const STAMP = '2026-10-03T07:50:18.445-08:00';
const SHIFT = 'night-2026-10-02';
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };

function world() {
  return {
    crew: [{ id: 'C01', name: 'Alex Test', is_lead: true, rev: 1 }, { id: 'C02', name: 'Aaron Able', rev: 1 }, { id: 'C03', name: 'Jordan Demo', rev: 1 },
      { id: 'C04', name: 'Pat Quit', rev: 1 }, { id: 'C05', name: 'Ben Bravo', rev: 1 }, { id: 'C07', name: 'Zed Zander', rev: 1 },
      { id: 'C22', name: 'Loki Haskins', rev: 1 }, { id: 'C23', name: 'Jake Moss', rev: 1 }],
    routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
    sites: [{ id: 'S1', name: 'Big Clinic', rev: 1, units: { bobcat: 'BC5, BT13', snowrator: 'Snowrator 1' } },
      { id: 'S2', name: 'Mid Lot', rev: 1, units: { bobcat: 'BC7', snowrator: '' } },
      { id: 'S3', name: 'Small Shop', rev: 1, units: { bobcat: 'bc5 , AA1', snowrator: '' } }],
    zones: [{ id: 'Z1', site_id: 'S1', name: 'Main entry', type: 'sidewalk', ring: [[-149.9, 61.2], [-149.8999, 61.2], [-149.8999, 61.2001], [-149.9, 61.2001]], priority: false, note: '', rev: 1 }],
    storms: [START], log: [], visits: [],
    post: { id: 'P1', rev: 1, shift: SHIFT, posted_at: '2026-10-02T00:12:00.000Z',
      routes: [{ id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'Big Clinic' }], lead: 'C01', members: ['C03'] }],
      people: { C01: { name: 'Alex Test', phone: null, shifts: { night: 1, day: 0 } }, C03: { name: 'Jordan Demo', phone: null, shifts: { night: 1, day: 0 } } } },
  };
}
const visit = (n, siteId, byKey, byName, extra = {}) => ({ id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: siteId, by_key: byKey, by_name: byName,
  at: '2026-10-03T06:45:00.000-08:00', depth_in: '', materials_used: '', equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, machines: [], ...extra });
const mline = (type, unit, attachment, key, name, minutes, since) => ({ type, unit, attachment, operator_key: key, operator_name: name, minutes, since });

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'machines-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    const refuse = (code, reason) => ({ ok: false, code, reason, ...v });
    if (body.action === 'bootstrap') return { ok: true, me, admin_name: 'Matthew', sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: state.post, moves: state.moves || [], callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: state.zones, ...v };
    if (body.action === 'getPost') return { ok: true, post: state.post, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: {}, reset: {}, posts: [], ...v };
      out.cursor.posts = 0; out.reset.posts = false;
      [['log', state.log], ['storms', state.storms], ['visits', state.visits], ['trucks', []], ['sheets', []]].forEach(([t, rows]) => {
        const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0));
        out[t] = rows.slice(cur).map((r) => (t === 'log' ? { ...r, by_profile: 'P1' } : r));
        out.cursor[t] = rows.length; out.reset[t] = false;
      });
      return out;
    }
    if (body.action === 'saveVisit') {
      // The server's saveVisit_ (machines-1): the same refusals, the same stamping.
      // An operator no longer live is held: accepted only as the same line as one on the saver's previous card (keeping its
      // stamped name), else refused. The key is trimmed. The seq is above every row, as the server's is.
      const sent = body.machines == null ? [] : body.machines;
      if (!Array.isArray(sent)) return refuse('invalid', 'Machines must be a list');
      const lines = [], held = [];
      for (const sl of sent) {
        const line = { type: sl.type, unit: sl.unit == null ? '' : String(sl.unit).trim(), attachment: sl.attachment || '',
          operator_key: typeof sl.operator_key === 'string' ? sl.operator_key.trim() : sl.operator_key, operator_name: '', minutes: sl.minutes };
        if (line.operator_key === 'admin') line.operator_name = 'Matthew';
        else if (line.operator_key) {
          const card = state.crew.find((r) => r.id === line.operator_key && r.archived !== true && r.pending !== true);
          if (card) line.operator_name = card.name;
          else { const gone = state.crew.find((r) => r.id === line.operator_key); line.operator_name = gone ? gone.name : ''; held.push(line); }
        }
        lines.push(line);
      }
      const problem = SL.machineProblem(lines);
      if (problem) return refuse('invalid', problem);
      lines.forEach((l) => { l.minutes = Number(l.minutes); });
      const prev = SL.visitTotals(state.visits, body.site_id, SHIFT).cards.find((c) => c.by_key === 'admin') || null;
      const prevLines = (prev && prev.machines) || [], used = prevLines.map(() => false);
      for (const hl of held) {
        const at = prevLines.findIndex((p, i) => !used[i] && SL.sameLine(p, hl));
        if (at < 0) return refuse('invalid', "That person isn't on the roster");
        used[at] = true; hl.operator_name = prevLines[at].operator_name || hl.operator_name;
      }
      // The three end-of-night keys (snow-app-script saveVisit_, nightsheet): shoveled true / false / null / "" (anything else
      // "Shoveled must be yes or no"); bags and buckets whole numbers zero or more, as numbers or digits as text (else "Bags ..." /
      // "Buckets ..."); a key LEFT OUT keeps the saver's previous card's answer, a key sent as blank clears it.
      const blankV = (x) => x === undefined || x === null || (typeof x === 'string' && !x.trim());
      const wholeV = (x) => { let k; if (typeof x === 'number') k = x; else if (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x.trim())) k = Number(x.trim()); else return null; return isFinite(k) && k >= 0 && Math.floor(k) === k ? k : null; };
      if (body.shoveled !== undefined && !(body.shoveled === true || body.shoveled === false || body.shoveled === null || body.shoveled === '')) return refuse('invalid', 'Shoveled must be yes or no');
      let bagsV = body.ice_melt_bags, bucketsV = body.sand_buckets;
      if (bagsV !== undefined && !blankV(bagsV) && (bagsV = wholeV(bagsV)) === null) return refuse('invalid', 'Bags must be a whole number, zero or more');
      if (bucketsV !== undefined && !blankV(bucketsV) && (bucketsV = wholeV(bucketsV)) === null) return refuse('invalid', 'Buckets must be a whole number, zero or more');
      const keepV = (x, k) => (x === undefined ? (prev && prev[k] !== undefined ? prev[k] : '') : (blankV(x) ? '' : x));
      const three = { shoveled: keepV(body.shoveled, 'shoveled'), ice_melt_bags: keepV(bagsV, 'ice_melt_bags'), sand_buckets: keepV(bucketsV, 'sand_buckets') };
      const n = state.visits.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0) + 1;
      const row = { id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: body.site_id, by_key: 'admin', by_name: 'Matthew', at: STAMP,
        depth_in: body.depth_in === undefined ? '' : body.depth_in, materials_used: body.materials_used || '', ...three,
        equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '', ...(body.equipment || {}) }, machines: SL.stampMachines(prev, lines) };
      state.visits.push(row);
      return { ok: true, record: row, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, o = {}) {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.clock.install({ time: new Date(CLOCK) });
  const calls = [];
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');
  if (o.live) { await expect(page.locator('[data-livesite="S1"]')).toBeVisible(); return calls; }
  await page.locator('[data-openroute="R1"]').click();
  await expect(page.locator('#liveBack')).toBeVisible();
  return calls;
}
const saves = (calls) => calls.filter((c) => c.action === 'saveVisit');
const openCard = async (page) => { await page.locator('[data-card="S1"]').click(); await expect(page.locator('#dlg')).toBeVisible(); };
const line = (page, type, n) => page.locator('.vc-mline[data-mtype="' + type + '"]').nth(n - 1);
const optionTexts = (loc) => loc.locator('option').evaluateAll((os) => os.map((o) => o.textContent));
// Fill one line; any part left out stays as it is.
async function fill(page, type, n, p) {
  const l = line(page, type, n);
  if (p.unit !== undefined) await l.locator('[data-munit]').selectOption(p.unit);
  if (p.att) await l.locator('[data-matt="' + p.att + '"]').click();
  if (p.op) await l.locator('[data-mop]').selectOption(p.op);
  if (p.min !== undefined) await l.locator('[data-mmin]').fill(String(p.min));
}
const err = (page) => page.locator('#vc_err');

test('a new Bobcat line starts empty and Save names what is missing, line by line', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  const l = line(page, 'bobcat', 1);
  await expect(l.locator('[data-munit]')).toHaveValue('');
  await expect(l.locator('[data-matt="snowblower"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(l.locator('[data-matt="bucket"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(l.locator('[data-mop]')).toHaveValue('');
  await expect(l.locator('[data-mmin]')).toHaveValue('');
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Pick the unit for Bobcat 1, or remove it');
  await fill(page, 'bobcat', 1, { unit: 'BC5' });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Pick an attachment for Bobcat 1, or remove it');
  await fill(page, 'bobcat', 1, { att: 'snowblower' });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Pick who ran Bobcat 1, or remove it');
  await fill(page, 'bobcat', 1, { op: 'C22' });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Add minutes for Bobcat 1, or remove it');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(saves(calls)).toHaveLength(0);
});

test('add two Bobcats and a Snowrator: the payload carries three lines, Not sure sent as blank', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_snowrator');
  await fill(page, 'bobcat', 1, { unit: 'BC5', att: 'snowblower', op: 'C22', min: 106 });
  await fill(page, 'bobcat', 2, { unit: '__notsure', att: 'bucket', op: 'C23', min: 90 });
  await fill(page, 'snowrator', 1, { unit: 'Snowrator 1', op: 'admin', min: 0 });
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)).toHaveLength(1);
  // Worked out: Bobcat 1 BC5 / snowblower / Loki (C22) 106; Bobcat 2 Not sure -> '' / bucket / Jake (C23) 90;
  // Snowrator 1 / no attachment / Matt ('admin') 0 (a typed zero is a real answer). The walk-behind blower untouched = blank.
  expect(saves(calls)[0]).toMatchObject({ site_id: 'S1', depth_in: '', materials_used: '', equipment: { blower: '' },
    machines: [{ type: 'bobcat', unit: 'BC5', attachment: 'snowblower', operator_key: 'C22', minutes: 106 },
      { type: 'bobcat', unit: '', attachment: 'bucket', operator_key: 'C23', minutes: 90 },
      { type: 'snowrator', unit: 'Snowrator 1', attachment: '', operator_key: 'admin', minutes: 0 }] });
  expect(Object.keys(saves(calls)[0].equipment)).toEqual(['blower']);
  expect(saves(calls)[0].machines.map((m) => Object.keys(m).sort())).toEqual(Array(3).fill(['attachment', 'minutes', 'operator_key', 'type', 'unit']));
});

test('one attachment per Bobcat: tapping Bucket after Snowblower switches it', async ({ page }) => {
  await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  const sb = line(page, 'bobcat', 1).locator('[data-matt="snowblower"]'), bk = line(page, 'bobcat', 1).locator('[data-matt="bucket"]');
  await sb.click();
  await expect(sb).toHaveAttribute('aria-pressed', 'true');
  await expect(bk).toHaveAttribute('aria-pressed', 'false');
  await bk.click();
  await expect(bk).toHaveAttribute('aria-pressed', 'true');
  await expect(sb).toHaveAttribute('aria-pressed', 'false');
  // Tapping the one already on keeps it on: an attachment is never cleared to none.
  await bk.click();
  await expect(bk).toHaveAttribute('aria-pressed', 'true');
  await expect(sb).toHaveAttribute('aria-pressed', 'false');
  // A Snowrator has no attachment buttons.
  await page.click('#vc_add_snowrator');
  await expect(line(page, 'snowrator', 1).locator('[data-matt]')).toHaveCount(0);
});

test('a swap: the same operator on BC5 and BT13 saves; on BC5 twice is refused by name', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BC5', att: 'snowblower', op: 'C01', min: 40 });
  await fill(page, 'bobcat', 2, { unit: 'BC5', att: 'snowblower', op: 'C01', min: 66 });
  await page.click('#vc_save');
  // Same person, same unit twice: refused on the phone, naming him and the unit; nothing sent.
  await expect(err(page)).toHaveText('Alex Test is on BC5 twice');
  expect(saves(calls)).toHaveLength(0);
  await fill(page, 'bobcat', 2, { unit: 'BT13' });
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)).toHaveLength(1);
  // 40 + 66 = 106 Bobcat minutes, both of Alex's lines counted.
  const lines = saves(calls)[0].machines;
  expect(lines.map((m) => [m.unit, m.operator_key, m.minutes])).toEqual([['BC5', 'C01', 40], ['BT13', 'C01', 66]]);
});

test('Remove takes a line off and it is not sent', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BC5', att: 'snowblower', op: 'C22', min: 10 });
  await fill(page, 'bobcat', 2, { unit: 'BT13', att: 'bucket', op: 'C23', min: 20 });
  await line(page, 'bobcat', 1).locator('[data-mremove]').click();
  await expect(page.locator('.vc-mline[data-mtype="bobcat"]')).toHaveCount(1);
  // What is left is Bobcat 1 now, still holding the second line's picks.
  await expect(line(page, 'bobcat', 1).locator('[data-munit]')).toHaveValue('BT13');
  await expect(line(page, 'bobcat', 1).locator('[data-mmin]')).toHaveValue('20');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)[0].machines).toEqual([{ type: 'bobcat', unit: 'BT13', attachment: 'bucket', operator_key: 'C23', minutes: 20 }]);
});

test('reopening the card shows each line as saved', async ({ page }) => {
  const w = world();
  w.visits = [visit(1, 'S1', 'admin', 'Matthew', { equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: '' },
    machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 106, 1), mline('bobcat', '', 'bucket', 'C23', 'Jake Moss', 0, 1),
      mline('bobcat', 'BC99', 'bucket', 'C01', 'Alex Test', 5, 1), mline('snowrator', 'Snowrator 1', '', 'admin', 'Matthew', 30, 1)] })];
  await open(page, w);
  await openCard(page);
  await expect(page.locator('.vc-mline[data-mtype="bobcat"]')).toHaveCount(3);
  await expect(page.locator('.vc-mline[data-mtype="snowrator"]')).toHaveCount(1);
  const b1 = line(page, 'bobcat', 1), b2 = line(page, 'bobcat', 2), b3 = line(page, 'bobcat', 3), s1 = line(page, 'snowrator', 1);
  await expect(b1.locator('[data-munit]')).toHaveValue('BC5');
  await expect(b1.locator('[data-matt="snowblower"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(b1.locator('[data-mop]')).toHaveValue('C22');
  await expect(b1.locator('[data-mmin]')).toHaveValue('106');
  await expect(b2.locator('[data-munit]')).toHaveValue('__notsure');       // saved '' = Not sure
  await expect(b2.locator('[data-matt="bucket"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(b2.locator('[data-mmin]')).toHaveValue('0');                // a saved 0 is a real answer
  await expect(b3.locator('[data-munit]')).toHaveValue('BC99');            // a unit no site lists now is still shown
  await expect(s1.locator('[data-munit]')).toHaveValue('Snowrator 1');
  await expect(s1.locator('[data-mop]')).toHaveValue('admin');
  await expect(page.locator('[data-eq="blower"]')).toBeChecked();
  await expect(page.locator('[data-eqmin="blower"]')).toHaveValue('20');
});

test('a shell-78 card reopened: old Bobcat minutes show read-only, are carried through on Save, and go when removed', async ({ page }) => {
  const w = world();
  w.visits = [visit(1, 'S1', 'admin', 'Matthew', { equipment: { blower: 20, snowrator: '', bobcat: 106, sweepster: 30 } })];
  const calls = await open(page, w);
  await openCard(page);
  const old = page.locator('.vc-oldeq[data-oldeq="bobcat"]');
  await expect(old).toContainText('Bobcat 106 min, saved before machine lines');
  await expect(old).toContainText('Remove it if you add this Bobcat as a line');
  await expect(old.locator('input')).toHaveCount(0);                       // read-only: nobody types old-shape minutes
  await expect(page.locator('[data-eq="bobcat"], [data-eqmin="bobcat"], [data-eq="sweepster"]')).toHaveCount(0);
  const sw = page.locator('.vc-oldeq[data-oldeq="sweepster"]');
  await expect(sw).toContainText('Sweepster 30 min, saved before machine lines');
  await expect(sw).not.toContainText('Remove it if you add');
  await expect(page.locator('.vc-oldeq[data-oldeq="snowrator"]')).toHaveCount(0);   // blank = nothing to show
  // Save as it is: blower and both old keys go back unchanged.
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)[0].equipment).toEqual({ blower: 20, bobcat: 106, sweepster: 30 });
  expect(saves(calls)[0].machines).toEqual([]);
  // Reopen (the saved card carries them again) and Remove the Bobcat: it is not sent.
  await openCard(page);
  await page.locator('.vc-oldeq[data-oldeq="bobcat"] [data-oldremove]').click();
  await expect(page.locator('.vc-oldeq[data-oldeq="bobcat"]')).toHaveCount(0);
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)[1].equipment).toEqual({ blower: 20, sweepster: 30 });
});

test("the Unit pick lists this site's units first, then others, then Not sure", async ({ page }) => {
  await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_snowrator');
  // S1 own, in the order typed; then every other site's, A to Z ("bc5 " at S3 is BC5 again: not listed twice); then Not sure.
  expect(await optionTexts(line(page, 'bobcat', 1).locator('[data-munit]'))).toEqual(['Pick', 'BC5 (this site)', 'BT13 (this site)', 'AA1', 'BC7', 'Not sure']);
  expect(await optionTexts(line(page, 'snowrator', 1).locator('[data-munit]'))).toEqual(['Pick', 'Snowrator 1 (this site)', 'Not sure']);
  expect(await line(page, 'bobcat', 1).locator('[data-munit] option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['', 'BC5', 'BT13', 'AA1', 'BC7', '__notsure']);
});

test("the Operator pick lists tonight's route first", async ({ page }) => {
  await open(page, world());
  await openCard(page);
  await page.click('#vc_add_bobcat');
  // Route R1 tonight: lead Alex Test, then Jordan Demo; everyone else A to Z, Matt included (Pat Quit too: live today).
  expect(await optionTexts(line(page, 'bobcat', 1).locator('[data-mop]'))).toEqual(['Pick', 'Alex Test', 'Jordan Demo', 'Aaron Able', 'Ben Bravo', 'Jake Moss', 'Loki Haskins', 'Matthew', 'Pat Quit', 'Zed Zander']);
});

test("Already logged lists the other cards' counted lines; a replaced line of mine says who replaced it", async ({ page }) => {
  const w = world();
  // Matt (seq 3): BC5 Loki 100. Ben (seq 9): BC5 Loki 106 and a Snowrator for Jake. Loki is on both cards: Ben's counts, Matt's is replaced.
  w.visits = [visit(3, 'S1', 'admin', 'Matthew', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 100, 3)] }),
    visit(9, 'S1', 'C05', 'Ben Bravo', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 106, 9), mline('snowrator', 'Snowrator 1', '', 'C23', 'Jake Moss', 50, 9)] })];
  await open(page, w);
  await openCard(page);
  const logged = page.locator('#vc_logged');
  await expect(logged).toContainText('Already logged here this shift:');
  // The machine reads as the sheets print it (CrewShiftLog.machineName): unit "Snowrator 1" -> "Snowrator 1", never "Snowrator Snowrator 1".
  await expect(logged.locator('li')).toHaveText(['Ben Bravo: Bobcat BC5 Snowblower, Loki Haskins 106 min', 'Ben Bravo: Snowrator 1, Jake Moss 50 min']);
  await expect(page.locator('.vc-replaced')).toHaveCount(1);
  await expect(line(page, 'bobcat', 1).locator('.vc-replaced')).toHaveText('Ben Bravo logged Loki Haskins later; that line counts.');
});

test('Already logged is absent when nobody else has logged a line', async ({ page }) => {
  const w = world();
  w.visits = [visit(3, 'S1', 'admin', 'Matthew', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 100, 3)] })];
  await open(page, w);
  await openCard(page);
  await expect(page.locator('#vc_logged')).toHaveCount(0);
  await expect(page.locator('.vc-replaced')).toHaveCount(0);
});

test('the server refuses an archived operator: the card stays open with every line kept', async ({ page }) => {
  const w = world();
  const calls = await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_snowrator');
  await fill(page, 'bobcat', 1, { unit: 'BC5', att: 'bucket', op: 'C04', min: 55 });
  await fill(page, 'snowrator', 1, { unit: 'Snowrator 1', op: 'C22', min: 12 });
  await page.fill('#vc_depth', '4');
  w.crew.find((c) => c.id === 'C04').archived = true;      // Matt archives Pat while the card is open
  await page.click('#vc_save');
  await expect(err(page)).toHaveText("That person isn't on the roster");
  await expect(page.locator('#dlg')).toBeVisible();
  expect(saves(calls)).toHaveLength(1);
  await expect(page.locator('.vc-mline')).toHaveCount(2);
  await expect(line(page, 'bobcat', 1).locator('[data-mmin]')).toHaveValue('55');
  await expect(line(page, 'bobcat', 1).locator('[data-matt="bucket"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(line(page, 'snowrator', 1).locator('[data-mop]')).toHaveValue('C22');
  await expect(page.locator('#vc_depth')).toHaveValue('4');
  await expect(page.locator('#vc_save')).toBeEnabled();
  expect(w.visits).toHaveLength(0);
});

test('the Storm tab totals line reads Bobcat / Snowrator / Walk-behind blower', async ({ page }) => {
  const w = world();
  // Ben: two Bobcat lines 106 + 106 = 212, a Snowrator 106, the walk-behind blower 20. Alex (an old phone): Sweepster 15.
  w.visits = [visit(9, 'S1', 'C05', 'Ben Bravo', { equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: '' },
    machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 106, 9), mline('bobcat', 'BT13', 'bucket', 'C23', 'Jake Moss', 106, 9), mline('snowrator', 'Snowrator 1', '', 'C03', 'Jordan Demo', 106, 9)] }),
    visit(10, 'S1', 'C01', 'Alex Test', { equipment: { blower: '', snowrator: '', bobcat: '', sweepster: 15 } })];
  await open(page, w, { live: true });
  await expect(page.locator('[data-livesite="S1"] .live-totals > div').first()).toHaveText('Bobcat 212 min · Snowrator 106 min · Walk-behind blower 20 min · Sweepster 15 min');
});

test('line numbers count within a kind, and a Snowrator is named by its own place', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  // Bobcat, Snowrator, Bobcat: the second Bobcat is "Bobcat 2" (the Snowrator between them does not count), the Snowrator "Snowrator 1".
  await page.click('#vc_add_bobcat');
  await page.click('#vc_add_snowrator');
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BC5', att: 'snowblower', op: 'C22', min: 10 });
  await fill(page, 'bobcat', 2, { unit: 'BT13', att: 'bucket', min: 20 });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Pick who ran Bobcat 2, or remove it');
  await fill(page, 'bobcat', 2, { op: 'C23' });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Pick the unit for Snowrator 1, or remove it');
  await fill(page, 'snowrator', 1, { unit: 'Snowrator 1' });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Pick who ran Snowrator 1, or remove it');
  await fill(page, 'snowrator', 1, { op: 'C01' });
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Add minutes for Snowrator 1, or remove it');
  expect(saves(calls)).toHaveLength(0);
});

test("with no current post, Matt's Operator pick lists the Board's people for this site's route first", async ({ page }) => {
  const w = world();
  w.post = null;
  // The Board, replayed from moves: Zed Zander leads R1 (the route holding S1), Loki Haskins is a member; nobody else is placed.
  w.moves = [{ id: 'M1', worker: 'C07', to_route: 'R1', role: 'lead', at: '2026-10-03T05:00:00.000-08:00' },
    { id: 'M2', worker: 'C22', to_route: 'R1', role: 'member', at: '2026-10-03T05:01:00.000-08:00' }];
  await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  // Lead then members, then everyone else A to Z (Matt included).
  expect(await optionTexts(line(page, 'bobcat', 1).locator('[data-mop]'))).toEqual(['Pick', 'Zed Zander', 'Loki Haskins', 'Aaron Able', 'Alex Test', 'Ben Bravo', 'Jake Moss', 'Jordan Demo', 'Matthew', 'Pat Quit']);
});

test('the card fits at 320 px with two Bobcats, a Snowrator and long names', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C30', name: 'Bartholomew Montgomery-Featherstonehaugh', rev: 1 });
  w.sites[0].units.bobcat = 'BC5-ABCDEFGHIJKLMNOP, BT13';   // one 20-character unit (the longest a unit can be)
  await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat'); await page.click('#vc_add_bobcat'); await page.click('#vc_add_snowrator');
  await fill(page, 'bobcat', 1, { unit: 'BC5-ABCDEFGHIJKLMNOP', att: 'snowblower', op: 'C30', min: 106 });
  await fill(page, 'bobcat', 2, { unit: 'BT13', att: 'bucket', op: 'C30', min: 10 });
  await fill(page, 'snowrator', 1, { unit: 'Snowrator 1', op: 'C30', min: 5 });
  const m = await page.evaluate(() => {
    const dlg = document.querySelector('#dlgIn'), W = document.documentElement.clientWidth;
    const bad = [];
    dlg.querySelectorAll('.vc-mline select, .vc-mline input, .vc-mline button, #vc_add_bobcat, #vc_add_snowrator').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > W + 0.5 || r.left < -0.5) bad.push(el.outerHTML.slice(0, 60) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
      if (el.matches('button') && r.height < 43.5) bad.push('short ' + el.outerHTML.slice(0, 60) + ' ' + r.height);
    });
    return { bad, wide: document.documentElement.scrollWidth > W, dlgWide: dlg.scrollWidth > dlg.clientWidth + 1 };
  });
  expect(m.bad).toEqual([]);
  expect(m.wide).toBe(false);
  expect(m.dlgWide).toBe(false);
});

// Spanish at 320 px (Task 8, UNRUN when written): the card in Spanish with two Bobcats, a Snowrator and a long name keeps
// every control inside the screen, and the words the crew reads are Spanish while brand names, units and names stay as they are.
test('the card in Spanish fits at 320 px, brand names and people kept', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C30', name: 'Bartholomew Montgomery-Featherstonehaugh', rev: 1 });
  w.sites[0].units.bobcat = 'BC5-ABCDEFGHIJKLMNOP, BT13';
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat'); await page.click('#vc_add_bobcat'); await page.click('#vc_add_snowrator');
  await fill(page, 'bobcat', 1, { unit: 'BC5-ABCDEFGHIJKLMNOP', att: 'snowblower', op: 'C30', min: 106 });
  const l = line(page, 'bobcat', 1);
  await expect(l.locator('label').first()).toHaveText('Unidad:');
  await expect(l.locator('[data-matt="snowblower"]')).toHaveText('Soplador de nieve');
  await expect(l.locator('[data-matt="bucket"]')).toHaveText('Cucharón');
  await expect(l.locator('.vc-mremove')).toHaveText('Quitar');
  await expect(l.locator('.vc-mhead b')).toHaveText('Bobcat 1');
  await expect(page.locator('#vc_add_bobcat')).toHaveText('+ Agregar un Bobcat');
  await expect(page.locator('#vc_add_snowrator')).toHaveText('+ Agregar un Snowrator');
  await expect(line(page, 'bobcat', 1).locator('[data-munit] option[value="BC5-ABCDEFGHIJKLMNOP"]')).toHaveText('BC5-ABCDEFGHIJKLMNOP (este sitio)');
  // (worked on paper: SnowMachinePick labels this site's own unit "<unit> (this site)"; the es.js rule keeps the unit and makes the marker "(este sitio)")
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Elige la unidad de Bobcat 2, o quítala');
  await expect(page.locator('#vc_save')).toHaveText('Guardar');
  const m = await page.evaluate(() => {
    const dlg = document.querySelector('#dlgIn'), W = document.documentElement.clientWidth;
    const bad = [];
    dlg.querySelectorAll('.vc-mline select, .vc-mline input, .vc-mline button, #vc_add_bobcat, #vc_add_snowrator').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > W + 0.5 || r.left < -0.5) bad.push(el.outerHTML.slice(0, 60) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
    });
    return { bad, wide: document.documentElement.scrollWidth > W, dlgWide: dlg.scrollWidth > dlg.clientWidth + 1 };
  });
  expect(m.bad).toEqual([]);
  expect(m.wide).toBe(false);
  expect(m.dlgWide).toBe(false);
});

// ---- The Save guard (final review, 11/25/26) ----
// A first Save that would replace a counted line on SOMEONE ELSE's card sends nothing, names each such line, and the button
// reads "Save anyway"; the next tap sends. Any edit takes it back to Save. The counting rule (visitTotals) is unchanged.
const guardText = (page) => page.locator('#vc_guard .vc-guardline');
const LOKI_BC5_40 = "Saving replaces Ben Bravo's Bobcat BC5 Snowblower line for Loki Haskins (40 min). Add it here too if they ran it.";

test('the Save guard: adding only BT13 for Loki replaces Ben\'s BC5 line for him; the first Save sends nothing, Save anyway sends', async ({ page }) => {
  const w = world();
  // Ben (seq 9): Bobcat BC5 Snowblower, Loki 40 (since 9). Matt adds ONE line: Bobcat BT13 Bucket, Loki 66.
  // Worked on paper (visitTotals with Matt's would-be card, seq 10 = above every seq held, its new line since null = 10):
  // Loki's Bobcat group is supplied by the card entered last, Matt's (10 > 9), so Ben's BC5 40 would be replaced and only
  // 66 would count for Loki (not 40 + 66 = 106). The guard names Ben's line.
  w.visits = [visit(9, 'S1', 'C05', 'Ben Bravo', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 40, 9)] })];
  const calls = await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BT13', att: 'bucket', op: 'C22', min: 66 });
  await page.click('#vc_save');
  await expect(guardText(page)).toHaveText([LOKI_BC5_40]);
  await expect(page.locator('#vc_save')).toHaveText('Save anyway');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(err(page)).toHaveText('');
  expect(saves(calls)).toHaveLength(0);
  // Names and the machine are a person's words or brand + unit: under data-no-es.
  expect(await guardText(page).locator('[data-no-es]').allTextContents()).toEqual(['Ben Bravo', 'Bobcat BC5', 'Loki Haskins']);
  // Save anyway: sent as on screen.
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)).toHaveLength(1);
  expect(saves(calls)[0].machines).toEqual([{ type: 'bobcat', unit: 'BT13', attachment: 'bucket', operator_key: 'C22', minutes: 66 }]);
});

test('the Save guard: nothing of another card\'s is replaced, so the first Save sends', async ({ page }) => {
  const w = world();
  // Ben (seq 9): BC5 Loki 40. Matt adds BT13 Bucket for Jake (C23) 30: Jake's group is Matt's alone, Loki's stays Ben's. No notice.
  w.visits = [visit(9, 'S1', 'C05', 'Ben Bravo', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 40, 9)] })];
  const calls = await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BT13', att: 'bucket', op: 'C23', min: 30 });
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)).toHaveLength(1);
  await expect(page.locator('.vc-guardline')).toHaveCount(0);
});

test('the Save guard: an edit takes the button back to Save and clears the notice', async ({ page }) => {
  const w = world();
  w.visits = [visit(9, 'S1', 'C05', 'Ben Bravo', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 40, 9)] })];
  const calls = await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BT13', att: 'bucket', op: 'C22', min: 66 });
  // Each kind of edit, one at a time: the depth box, a line's minutes, an attachment tap, the walk-behind blower tick.
  const edits = [() => page.fill('#vc_depth', '3'), () => fill(page, 'bobcat', 1, { min: 65 }),
    () => line(page, 'bobcat', 1).locator('[data-matt="snowblower"]').click(), () => page.locator('[data-eq="blower"]').check()];
  for (const edit of edits) {
    await page.click('#vc_save');
    await expect(page.locator('#vc_save')).toHaveText('Save anyway');
    await expect(guardText(page)).toHaveCount(1);
    await edit();
    await expect(page.locator('#vc_save')).toHaveText('Save');
    await expect(guardText(page)).toHaveCount(0);
  }
  // Still nothing sent: every Save above met the guard first (the blower is ticked with no minutes now, so the next Save is refused).
  expect(saves(calls)).toHaveLength(0);
});

test('the Save guard: re-saving an unchanged line that Loki has since logged again raises no notice (paper row 8)', async ({ page }) => {
  const w = world();
  // Matt (seq 9): BC5 Loki 80, since 9. Loki (seq 11): BC5 Loki 100, since 11 -> Loki's own counts, Matt's is replaced.
  // Matt re-saves only to tick the walk-behind blower (20). The server keeps his Loki line's since (9: unchanged), so Loki's 100
  // still counts and nothing of Loki's card is replaced: no notice, the first Save sends. (A would-be card that stamped the
  // unchanged line as new, since 12, would claim to replace Loki's line and be wrong.)
  w.visits = [visit(9, 'S1', 'admin', 'Matthew', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 80, 9)] }),
    visit(11, 'S1', 'C22', 'Loki Haskins', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 100, 11)] })];
  const calls = await open(page, w);
  await openCard(page);
  await page.locator('[data-eq="blower"]').check();
  await page.fill('[data-eqmin="blower"]', '20');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)).toHaveLength(1);
  expect(saves(calls)[0].machines).toEqual([{ type: 'bobcat', unit: 'BC5', attachment: 'snowblower', operator_key: 'C22', minutes: 80 }]);
});

test('the replaced note when the operator logged the line again on their own card', async ({ page }) => {
  const w = world();
  // Matt (seq 3): BC5 Loki 100. Loki's own card (seq 9): BC5 Loki 106. Loki's counts; Matt's line is replaced by Loki himself.
  w.visits = [visit(3, 'S1', 'admin', 'Matthew', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 100, 3)] }),
    visit(9, 'S1', 'C22', 'Loki Haskins', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 106, 9)] })];
  await open(page, w);
  await openCard(page);
  await expect(line(page, 'bobcat', 1).locator('.vc-replaced')).toHaveText('Loki Haskins logged this line again later; that line counts.');
});

test('the Save guard in Spanish: the notice and Save anyway read Spanish, the names and the machine kept', async ({ page }) => {
  const w = world();
  w.visits = [visit(9, 'S1', 'C05', 'Ben Bravo', { machines: [mline('bobcat', 'BC5', 'snowblower', 'C22', 'Loki Haskins', 40, 9)] })];
  await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  await fill(page, 'bobcat', 1, { unit: 'BT13', att: 'bucket', op: 'C22', min: 66 });
  await page.click('#vc_save');
  // es.js: "Saving replaces " -> "Al guardar se reemplaza la línea de ", "'s " -> ": ", " Snowblower line for " -> " Soplador de nieve para ",
  // " (40 min). Add it here too if they ran it." -> " (40 min). Agrégala aquí también si la operó."
  await expect(guardText(page)).toHaveText(['Al guardar se reemplaza la línea de Ben Bravo: Bobcat BC5 Soplador de nieve para Loki Haskins (40 min). Agrégala aquí también si la operó.']);
  await expect(page.locator('#vc_save')).toHaveText('Guardar de todos modos');
  await page.fill('#vc_depth', '2');
  await expect(page.locator('#vc_save')).toHaveText('Guardar');
});

test("an operator archived since the card was saved: the unchanged line re-saves, keeping the name it was saved with", async ({ page }) => {
  const w = world();
  // Matt's card (seq 1): Bobcat BC5 Bucket, Pat Quit (C04) 55. Pat is archived since. Matt reopens the card and fixes the depth:
  // the line is the same as on his previous card, so the server accepts it and keeps "Pat Quit" as stamped.
  w.visits = [visit(1, 'S1', 'admin', 'Matthew', { machines: [mline('bobcat', 'BC5', 'bucket', 'C04', 'Pat Quit', 55, 1)] })];
  w.crew.find((c) => c.id === 'C04').archived = true;
  const calls = await open(page, w);
  await openCard(page);
  await expect(line(page, 'bobcat', 1).locator('[data-mop]')).toHaveValue('C04');   // shown as saved, though not a pick any more
  await page.fill('#vc_depth', '4');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)[0].machines).toEqual([{ type: 'bobcat', unit: 'BC5', attachment: 'bucket', operator_key: 'C04', minutes: 55 }]);
  expect(w.visits[1].machines).toEqual([{ type: 'bobcat', unit: 'BC5', attachment: 'bucket', operator_key: 'C04', operator_name: 'Pat Quit', minutes: 55, since: 1 }]);
});

// The fake's three end-of-night keys mirror the server (nightsheet, S2): left out keeps the saver's previous answer, '' clears it,
// and a bad value is refused in the server's words. Worked on paper: the seeded card says true / 2 / 1.
test('the fake: shoveled, bags and buckets left out are kept, sent empty are cleared, bad values are refused', async ({ page }) => {
  const w = world();
  w.visits = [visit(2, 'S1', 'admin', 'Matthew', { shoveled: true, ice_melt_bags: 2, sand_buckets: 1 })];
  await open(page, w);
  const post = (body) => page.evaluate(async (b) => {
    const r = await fetch('https://script.google.com/macros/s/AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn/exec', { method: 'POST', body: JSON.stringify(b) });
    return r.json();
  }, { token: 'tok-matt', ...body });
  let r = await post({ action: 'saveVisit', site_id: 'S1', depth_in: 4 });
  expect([r.record.shoveled, r.record.ice_melt_bags, r.record.sand_buckets]).toEqual([true, 2, 1]);
  r = await post({ action: 'saveVisit', site_id: 'S1', shoveled: '', ice_melt_bags: '' });
  expect([r.record.shoveled, r.record.ice_melt_bags, r.record.sand_buckets]).toEqual(['', '', 1]);
  expect((await post({ action: 'saveVisit', site_id: 'S1', shoveled: 'yes' })).reason).toBe('Shoveled must be yes or no');
  expect((await post({ action: 'saveVisit', site_id: 'S1', ice_melt_bags: 2.5 })).reason).toBe('Bags must be a whole number, zero or more');
  expect((await post({ action: 'saveVisit', site_id: 'S1', sand_buckets: -1 })).reason).toBe('Buckets must be a whole number, zero or more');
});
