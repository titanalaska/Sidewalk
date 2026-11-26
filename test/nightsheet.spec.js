// The Site card's three end-of-night boxes (Matt, 11/25/26): Shoveled (Yes / No), Ice melt (bags), Sand (buckets), between
// Snow depth and Materials used. The real page over file:// at 320 px against a small fake backend that mirrors the server's
// saveVisit_ (nightsheet): `shoveled` true / false / '' (anything else "Shoveled must be yes or no"), bags and buckets whole
// numbers zero or more (else "Bags ..." / "Buckets ..."), and a key LEFT OUT keeps the saver's own previous answer at this
// site and shift while a key sent as '' clears it. Made-up names only.
//
// The world, worked on paper (clock 7:30 AM 10/3, so the shift is night-2026-10-02; storm ST-1 open; Matt is admin, key 'admin'):
//   one route R1 with one site S1 "Big Clinic"; Matt's own earlier card is seeded per test.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const STAMP = '2026-10-03T07:50:18.445-08:00';
const SHIFT = 'night-2026-10-02';
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };

function world() {
  return {
    crew: [{ id: 'C01', name: 'Alex Test', is_lead: true, rev: 1 }, { id: 'C03', name: 'Jordan Demo', rev: 1 }],
    routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
    sites: [{ id: 'S1', name: 'Big Clinic', rev: 1, units: { bobcat: 'BC5, BT13', snowrator: '' }, materials_needed: '2 bags' }],
    zones: [{ id: 'Z1', site_id: 'S1', name: 'Main entry', type: 'sidewalk', ring: [[-149.9, 61.2], [-149.8999, 61.2], [-149.8999, 61.2001], [-149.9, 61.2001]], priority: false, note: '', rev: 1 }],
    storms: [START], log: [], visits: [],
    post: { id: 'P1', rev: 1, shift: SHIFT, posted_at: '2026-10-02T00:12:00.000Z',
      routes: [{ id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'Big Clinic' }], lead: 'C01', members: ['C03'] }],
      people: { C01: { name: 'Alex Test', phone: null, shifts: { night: 1, day: 0 } }, C03: { name: 'Jordan Demo', phone: null, shifts: { night: 1, day: 0 } } } },
  };
}
// A card as the Sheet holds it. `extra` may carry shoveled / ice_melt_bags / sand_buckets (a card saved before this ship has none).
const visit = (n, extra = {}) => ({ id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: 'S1', by_key: 'admin', by_name: 'Matthew',
  at: '2026-10-03T06:45:00.000-08:00', depth_in: '', materials_used: '', equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, machines: [], ...extra });

// The server's rule for the three keys (Code.js saveVisit_, lines 1069-1073 and `keep`), worked the same way.
function threeKeys(body, prev) {
  const sh = body.shoveled;
  if (sh !== undefined && !(sh === true || sh === false || sh === null || sh === '')) return { reason: 'Shoveled must be yes or no' };
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  const whole = (v) => {
    let n;
    if (typeof v === 'number') n = v; else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim()); else return null;
    return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : null;
  };
  let bags = body.ice_melt_bags, buckets = body.sand_buckets;
  if (bags !== undefined && !blank(bags) && (bags = whole(bags)) === null) return { reason: 'Bags must be a whole number, zero or more' };
  if (buckets !== undefined && !blank(buckets) && (buckets = whole(buckets)) === null) return { reason: 'Buckets must be a whole number, zero or more' };
  const keep = (v, name) => (v === undefined ? (prev && prev[name] !== undefined ? prev[name] : '') : (blank(v) ? '' : v));
  return { shoveled: keep(sh, 'shoveled'), ice_melt_bags: keep(bags, 'ice_melt_bags'), sand_buckets: keep(buckets, 'sand_buckets') };
}

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'nightsheet-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, admin_name: 'Matthew', sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: state.post, moves: [], callouts: [], gear: [], ...v };
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
      const prev = state.visits.filter((r) => r.by_key === 'admin' && r.site_id === body.site_id && r.shift_id === SHIFT).pop() || null;
      const k = threeKeys(body, prev);
      if (k.reason) return { ok: false, code: 'invalid', reason: k.reason, ...v };
      const n = state.visits.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0) + 1;
      const row = { id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: body.site_id, by_key: 'admin', by_name: 'Matthew', at: STAMP,
        depth_in: body.depth_in === undefined ? '' : body.depth_in, materials_used: body.materials_used || '', ...k,
        equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '', ...(body.equipment || {}) }, machines: [] };
      state.visits.push(row);
      return { ok: true, record: row, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, lang) {
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
  await page.addInitScript((l) => { localStorage.setItem('titan-snow-token', 'tok-matt'); if (l) localStorage.setItem('snow-lang', l); }, lang || '');
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');
  await page.locator('[data-openroute="R1"]').click();
  await expect(page.locator('#liveBack')).toBeVisible();
  return calls;
}
const saves = (calls) => calls.filter((c) => c.action === 'saveVisit');
const openCard = async (page) => { await page.locator('[data-card="S1"]').click(); await expect(page.locator('#dlg')).toBeVisible(); };
const yes = (page) => page.locator('[data-shov="yes"]');
const no = (page) => page.locator('[data-shov="no"]');
const err = (page) => page.locator('#vc_err');

test('site card: Shoveled, Ice melt (bags) and Sand (buckets) sit between Snow depth and Materials used', async ({ page }) => {
  await open(page, world());
  await openCard(page);
  // Worked on paper: the card reads top to bottom Snow depth, Shoveled (+ Yes, No), Ice melt (bags), Sand (buckets), Materials used,
  // so each control's top edge is strictly below the one before it; the labels carry the exact words.
  const tops = await page.evaluate(() => ['vc_depth', null, 'vc_bags', 'vc_buckets', 'vc_mat'].map((id) => {
    const el = id ? document.getElementById(id) : document.querySelector('[data-shov="yes"]');
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  }));
  expect(tops.every((t) => t !== null)).toBe(true);
  for (let i = 1; i < tops.length; i++) expect(tops[i], 'control ' + i + ' below control ' + (i - 1)).toBeGreaterThan(tops[i - 1]);
  await expect(page.locator('label[for="vc_bags"]')).toHaveText('Ice melt (bags)');
  await expect(page.locator('label[for="vc_buckets"]')).toHaveText('Sand (buckets)');
  await expect(page.locator('#dlgIn label', { hasText: /^Shoveled$/ })).toHaveCount(1);
  await expect(yes(page)).toHaveText('Yes');
  await expect(no(page)).toHaveText('No');
  for (const id of ['vc_bags', 'vc_buckets']) {
    const a = await page.locator('#' + id).evaluate((el) => [el.type, el.inputMode, el.min, el.step]);
    expect(a).toEqual(['number', 'numeric', '0', '1']);
  }
  // Nothing runs off the 320 px screen.
  const bad = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, out = [];
    document.querySelectorAll('#vc_bags, #vc_buckets, [data-shov]').forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > W + 0.5 || r.left < -0.5) out.push(el.id || el.dataset.shov); });
    return { out, wide: document.documentElement.scrollWidth > W };
  });
  expect(bad).toEqual({ out: [], wide: false });
});

test('site card: neither Yes nor No is picked on a new card; tapping the picked one again clears it', async ({ page }) => {
  await open(page, world());
  await openCard(page);
  // A new card: neither pressed.
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
  await yes(page).click();
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
  // The same button again clears: neither.
  await yes(page).click();
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
  // No picks No; Yes then moves the pick over (never both).
  await no(page).click();
  await expect(no(page)).toHaveAttribute('aria-pressed', 'true');
  await yes(page).click();
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
});

test('site card: Save sends shoveled true, bags 2 and buckets 1', async ({ page }) => {
  const w = world();
  const calls = await open(page, w);
  await openCard(page);
  await yes(page).click();
  await page.fill('#vc_bags', '2');
  await page.fill('#vc_buckets', '1');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  // Worked on paper: Yes = true (a JSON boolean), 2 and 1 are numbers (typed(v, true)), never "2" / "1".
  expect(saves(calls)).toHaveLength(1);
  const b = saves(calls)[0];
  expect([b.shoveled, b.ice_melt_bags, b.sand_buckets]).toEqual([true, 2, 1]);
  expect(w.visits[0]).toMatchObject({ shoveled: true, ice_melt_bags: 2, sand_buckets: 1 });
});

test('site card: No sends false and an untouched card sends all three keys as empty text', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  await no(page).click();
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  // Worked on paper: No = false; the two empty boxes are '' (the keys are PRESENT, so the server clears rather than keeps).
  const b1 = saves(calls)[0];
  expect(Object.keys(b1)).toEqual(expect.arrayContaining(['shoveled', 'ice_melt_bags', 'sand_buckets']));
  expect([b1.shoveled, b1.ice_melt_bags, b1.sand_buckets]).toEqual([false, '', '']);
  // The card now opens with No pressed (its own saved answer). Tapping No again (back to neither) and saving sends ''.
  await openCard(page);
  await expect(no(page)).toHaveAttribute('aria-pressed', 'true');
  await no(page).click();
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const b2 = saves(calls)[1];
  expect([b2.shoveled, b2.ice_melt_bags, b2.sand_buckets]).toEqual(['', '', '']);
});

test('site card: a saved card opens with its answers; a card saved before this ship opens empty, never 0', async ({ page }) => {
  const w = world();
  w.visits = [visit(2, { shoveled: true, ice_melt_bags: 2, sand_buckets: 0 })];
  await open(page, w);
  await openCard(page);
  // Worked on paper: Yes pressed, No not; bags 2; buckets 0 was saved as the number 0 so it shows "0" (a real answer).
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#vc_bags')).toHaveValue('2');
  await expect(page.locator('#vc_buckets')).toHaveValue('0');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
});

test('site card: a saved No opens with No pressed', async ({ page }) => {
  const w = world();
  w.visits = [visit(2, { shoveled: false })];
  await open(page, w);
  await openCard(page);
  await expect(no(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#vc_bags')).toHaveValue('');
  await expect(page.locator('#vc_buckets')).toHaveValue('');
});

test('site card: a card saved before this ship (no such keys) opens with neither pressed and empty boxes, never 0', async ({ page }) => {
  const w = world();
  w.visits = [visit(2, { depth_in: 3 })]; // an old row: no shoveled, no ice_melt_bags, no sand_buckets at all
  await open(page, w);
  await openCard(page);
  await expect(yes(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(no(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#vc_bags')).toHaveValue('');
  await expect(page.locator('#vc_buckets')).toHaveValue('');
  await expect(page.locator('#vc_depth')).toHaveValue('3');
});

test('site card: 2.5 bags is refused on the card with the server\'s words, and nothing is sent', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  await page.fill('#vc_bags', '2.5');
  await page.click('#vc_save');
  // Worked on paper: 2.5 is not a whole number, so the card says the server's own sentence and sends nothing.
  await expect(err(page)).toHaveText('Bags must be a whole number, zero or more');
  expect(saves(calls)).toHaveLength(0);
  await expect(page.locator('#dlg')).toBeVisible();
  // -1 buckets is below zero: the buckets sentence (bags back to a good 2).
  await page.fill('#vc_bags', '2');
  await page.fill('#vc_buckets', '-1');
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Buckets must be a whole number, zero or more');
  expect(saves(calls)).toHaveLength(0);
  // 1.5 buckets: the same sentence.
  await page.fill('#vc_buckets', '1.5');
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Buckets must be a whole number, zero or more');
  expect(saves(calls)).toHaveLength(0);
  // -3 bags: the bags sentence.
  await page.fill('#vc_buckets', '1');
  await page.fill('#vc_bags', '-3');
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Bags must be a whole number, zero or more');
  expect(saves(calls)).toHaveLength(0);
  // Fixed: 2 bags, 1 bucket goes through.
  await page.fill('#vc_bags', '2');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)).toHaveLength(1);
  expect([saves(calls)[0].ice_melt_bags, saves(calls)[0].sand_buckets]).toEqual([2, 1]);
});

test('site card: the word "two" cannot be typed into a number box (the browser blanks it), so it saves as empty', async ({ page }) => {
  const calls = await open(page, world());
  await openCard(page);
  // A type=number input keeps no letters: the value reads '' (worked on paper), which the card sends as '' (not a refusal).
  await page.locator('#vc_buckets').evaluate((el) => { el.value = 'two'; });
  expect(await page.locator('#vc_buckets').inputValue()).toBe('');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves(calls)[0].sand_buckets).toBe('');
});

test('site card: an edit to the new boxes takes the Save anyway guard back to Save', async ({ page }) => {
  // The guard arms when a save would replace a counted line on SOMEONE ELSE's card. Worked on paper (as machines.spec's guard
  // tests): Alex's card (seq 9) has Bobcat BC5 Snowblower for Jordan, 40 min (since 9). Matt adds ONE line, Bobcat BT13 Bucket,
  // Jordan 66 (his card is seq 10, entered last), so Jordan's Bobcat group would come from Matt's card and Alex's 40 would be
  // replaced: the first Save sends nothing and reads "Save anyway". Any edit disarms it; the new controls must, like depth and materials.
  const w = world();
  w.visits = [{ ...visit(9), by_key: 'C01', by_name: 'Alex Test', machines: [{ type: 'bobcat', unit: 'BC5', attachment: 'snowblower', operator_key: 'C03', operator_name: 'Jordan Demo', minutes: 40, since: 9 }] }];
  await open(page, w);
  await openCard(page);
  await page.click('#vc_add_bobcat');
  const l = page.locator('.vc-mline[data-mtype="bobcat"]').first();
  await l.locator('[data-munit]').selectOption('BT13');
  await l.locator('[data-matt="bucket"]').click();
  await l.locator('[data-mop]').selectOption('C03');
  await l.locator('[data-mmin]').fill('66');
  await page.click('#vc_save');
  await expect(page.locator('#vc_save')).toHaveText('Save anyway');
  await yes(page).click();
  await expect(page.locator('#vc_save')).toHaveText('Save');
  await page.click('#vc_save');
  await expect(page.locator('#vc_save')).toHaveText('Save anyway');
  await page.locator('#vc_bags').fill('1');
  await expect(page.locator('#vc_save')).toHaveText('Save');
  await page.click('#vc_save');
  await expect(page.locator('#vc_save')).toHaveText('Save anyway');
  await page.locator('#vc_buckets').fill('1');
  await expect(page.locator('#vc_save')).toHaveText('Save');
});

test('site card: in Spanish the boxes read Paleado, Sí, No, Derretidor de hielo (bolsas), Arena (cubetas)', async ({ page }) => {
  await open(page, world(), 'es');
  await openCard(page);
  await expect(page.locator('#dlgIn label', { hasText: /^Paleado$/ })).toHaveCount(1);
  await expect(yes(page)).toHaveText('Sí');
  await expect(no(page)).toHaveText('No');
  await expect(page.locator('label[for="vc_bags"]')).toHaveText('Derretidor de hielo (bolsas)');
  await expect(page.locator('label[for="vc_buckets"]')).toHaveText('Arena (cubetas)');
  // The refusals read in Spanish too (worked on paper: es.js rows).
  await page.fill('#vc_bags', '2.5');
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Las bolsas deben ser un número entero, cero o más');
  await page.fill('#vc_bags', '');
  await page.fill('#vc_buckets', '-1');
  await page.click('#vc_save');
  await expect(err(page)).toHaveText('Las cubetas deben ser un número entero, cero o más');
});

test('the fake mirrors the server: a key left out keeps the saver\'s own previous answer; a key sent as empty clears it; bad values are refused', async ({ page }) => {
  const w = world();
  w.visits = [visit(2, { shoveled: true, ice_melt_bags: 2, sand_buckets: 1 })];
  const calls = await open(page, w);
  const post = (body) => page.evaluate(async (b) => {
    const r = await fetch('https://script.google.com/macros/s/AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn/exec', { method: 'POST', body: JSON.stringify(b) });
    return r.json();
  }, { token: 'tok-matt', ...body });
  // Left out: all three kept (worked on paper: true, 2, 1 from the earlier card).
  let r = await post({ action: 'saveVisit', site_id: 'S1', depth_in: 4 });
  expect(r.ok).toBe(true);
  expect([r.record.shoveled, r.record.ice_melt_bags, r.record.sand_buckets]).toEqual([true, 2, 1]);
  // Sent as '': cleared; the other two kept by being left out.
  r = await post({ action: 'saveVisit', site_id: 'S1', shoveled: '', ice_melt_bags: '' });
  expect([r.record.shoveled, r.record.ice_melt_bags, r.record.sand_buckets]).toEqual(['', '', 1]);
  // Refusals, in the server's words.
  expect((await post({ action: 'saveVisit', site_id: 'S1', shoveled: 'yes' })).reason).toBe('Shoveled must be yes or no');
  expect((await post({ action: 'saveVisit', site_id: 'S1', ice_melt_bags: 2.5 })).reason).toBe('Bags must be a whole number, zero or more');
  expect((await post({ action: 'saveVisit', site_id: 'S1', sand_buckets: -1 })).reason).toBe('Buckets must be a whole number, zero or more');
  expect(calls.length).toBeGreaterThan(0);
});

// The Storm tab's per-site totals (Matt, 11/25/26): each person's bags, buckets and Shoveled under the site, after Depth and before
// Materials. Worked on paper: Alex's card says 2 bags, Shoveled No; Bea's says 1 bag, 1 bucket, Shoveled Yes; Cy's says nothing.
// The asserted order is the card order on screen (Alex, then Bea), as the assertions below read it from the page.
// Ice melt: only Alex and Bea; Sand: only Bea; Shoveled: Alex No, Bea Yes. Cy is in none of them.
function threeCards() {
  const w = world();
  w.visits = [
    visit(1, { by_key: 'k-alex', by_name: 'Alex Test', depth_in: 3, shoveled: false, ice_melt_bags: 2, sand_buckets: '' }),
    visit(2, { by_key: 'k-bea', by_name: 'Bea Demo', depth_in: 4, shoveled: true, ice_melt_bags: 1, sand_buckets: 1, materials_used: 'salt' }),
    visit(3, { by_key: 'k-cy', by_name: 'Cy Sample', shoveled: '', ice_melt_bags: '', sand_buckets: '' }),
  ];
  return w;
}
// The totals sit under each site on the LIVE view; open() leaves us inside the route, so go back first.
const totals = async (page) => { await page.locator('#liveBack').click(); return page.locator('[data-livesite="S1"] .live-totals'); };

test('storm tab: each person\'s bags, buckets and Shoveled sit under the site, after Depth and before Materials', async ({ page }) => {
  await open(page, threeCards());
  const rows = await (await totals(page)).locator('> div').allInnerTexts();
  const flat = rows.map((r) => r.replace(/\s+/g, ' ').trim());
  const i = (p) => flat.findIndex((r) => r.startsWith(p));
  expect(flat[i('Ice melt:')]).toBe('Ice melt: Alex Test 2 bags, Bea Demo 1 bag');
  expect(flat[i('Sand:')]).toBe('Sand: Bea Demo 1 bucket');
  expect(flat[i('Shoveled:')]).toBe('Shoveled: Alex Test No, Bea Demo Yes');
  expect(i('Depth:')).toBeGreaterThanOrEqual(0);
  expect(i('Depth:')).toBeLessThan(i('Ice melt:'));
  expect(i('Ice melt:')).toBeLessThan(i('Sand:'));
  expect(i('Sand:')).toBeLessThan(i('Shoveled:'));
  expect(i('Shoveled:')).toBeLessThan(i('Materials:'));
});

test('storm tab: a typed 0 shows as "0 bags"; a blank is left out; nobody entered anything means no new line', async ({ page }) => {
  const w = world();
  w.visits = [visit(1, { by_key: 'k-alex', by_name: 'Alex Test', ice_melt_bags: 0, sand_buckets: '', shoveled: '' }),
    visit(2, { by_key: 'k-cy', by_name: 'Cy Sample', depth_in: 2, ice_melt_bags: '', sand_buckets: '', shoveled: '' })];
  await open(page, w);
  const text = (await (await totals(page)).innerText()).replace(/\s+/g, ' ');
  expect(text).toContain('Ice melt: Alex Test 0 bags');
  expect(text).not.toContain('Cy Sample 0');
  expect(text).not.toContain('Sand:');
  expect(text).not.toContain('Shoveled:');
});

test('storm tab: in Spanish the new lines read bolsas / cubetas / Sí, the names are never translated', async ({ page }) => {
  await open(page, threeCards(), 'es');
  const flat = (await (await totals(page)).locator('> div').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
  expect(flat).toContain('Derretidor de hielo: Alex Test 2 bolsas, Bea Demo 1 bolsa');
  expect(flat).toContain('Arena: Bea Demo 1 cubeta');
  expect(flat).toContain('Paleado: Alex Test No, Bea Demo Sí');
});

test('storm tab: in Spanish a person whose name is a translatable word keeps the name (data-no-es)', async ({ page }) => {
  // "Crew" is an exact-text-node Spanish rule (Cuadrilla). As a person's name it must stay "Crew": 3 bags -> "Crew 3 bolsas".
  const w = world();
  w.visits = [visit(1, { by_key: 'k-crew', by_name: 'Crew', ice_melt_bags: 3 })];
  await open(page, w, 'es');
  const flat = (await (await totals(page)).locator('> div').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
  expect(flat).toContain('Derretidor de hielo: Crew 3 bolsas');
});

// Fix wave (11/25/26, final review). The crew's own typed Materials text is the crew's words: on a Spanish phone "Ice melt: 2 bags"
// typed into Materials used must NOT be read as the Storm tab's own "Ice melt:" prefix. Worked on paper: Alex's card says materials
// "Ice melt: 2 bags", depth 3; the line reads "Materials: Ice melt: 2 bags (Alex Test)" in English and in Spanish only "Materials:"
// changes -> "Materiales: Ice melt: 2 bags (Alex Test)".
test('storm tab: in Spanish the crew\'s typed Materials text is never translated; the English line is unchanged', async ({ page }) => {
  const w = world();
  w.visits = [visit(1, { by_key: 'k-alex', by_name: 'Alex Test', depth_in: 3, materials_used: 'Ice melt: 2 bags' })];
  await open(page, w, 'es');
  const flat = (await (await totals(page)).locator('> div').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
  expect(flat).toContain('Materiales: Ice melt: 2 bags (Alex Test)');
  expect(flat.join(' | ')).not.toContain('Derretidor');
});

test('storm tab: in English the Depth and Materials lines read exactly as before', async ({ page }) => {
  const w = world();
  w.visits = [visit(1, { by_key: 'k-alex', by_name: 'Alex Test', depth_in: 3, materials_used: 'Ice melt: 2 bags' }),
    visit(2, { by_key: 'k-bea', by_name: 'Bea Demo', depth_in: 4, materials_used: 'salt' })];
  await open(page, w);
  const flat = (await (await totals(page)).locator('> div').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
  expect(flat).toContain('Depth: Alex Test 3 in, Bea Demo 4 in');
  expect(flat).toContain('Materials: Ice melt: 2 bags (Alex Test), salt (Bea Demo)');
});

// Print sheets, the end-of-night table in print at 720 px (Letter less half-inch margins). Worked on paper, night of 10/2:
//   Big Clinic (S1): Arrived TAPPED 12:55 AM on 10/3 (00:55), Left never tapped, a typed row with Out 10:05 PM -> In "12:55 AM",
//     Out "10:05 PM" + "(typed)" on a second line.
//   Camp Lot (S2, no zones = Whole site): its one walk tapped at 12:55 AM, no Arrived / Left -> the joined cell "Done 12:55 AM".
// A two-digit-hour time needs about 58 px; at 7 % (about 50 px) "12:55 AM10:05 PM" ran together. Every td.t must hold its content.
function printWorld() {
  const w = world();
  w.sites.push({ id: 'S2', name: 'Camp Lot', rev: 1, units: { bobcat: '', snowrator: '' }, materials_needed: '' });
  w.routes[0].site_ids = ['S1', 'S2'];
  w.post.routes[0].sites = [{ id: 'S1', name: 'Big Clinic' }, { id: 'S2', name: 'Camp Lot' }];
  const row = (n, site, zone, state, at, extra = {}) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: site, zone_id: zone, state,
    note: '', by_key: 'C01', by_name: 'Alex Test', at, off_route: false, snowing_warned: false, undoes: null, ...extra });
  w.log = [
    row(1, 'S1', '*', 'arrived', '2026-10-03T00:55:00.000-08:00'),
    row(2, 'S1', 'Z1', 'cleared', '2026-10-03T01:10:00.000-08:00'),
    row(3, 'S1', '*', 'typed', '2026-10-03T06:20:00.000-08:00', { by_key: 'admin', by_name: 'Matthew', time_in: '', time_out: '2026-10-02T22:05' }),
    row(4, 'S2', 'whole', 'cleared', '2026-10-03T00:55:00.000-08:00'),
  ];
  w.visits = [visit(1, { site_id: 'S1', by_key: 'C01', by_name: 'Alex Test', depth_in: 3 })];
  return w;
}
async function openPrint(page, w) {
  await open(page, w);
  await page.locator('#liveBack').click();
  await page.addInitScript(() => { window.print = () => {}; });
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('#printSheets');
  await expect(page.locator('#printsheets table.rs')).toHaveCount(1);
  await page.evaluate(() => { [...document.querySelectorAll('#printsheets .sheet')].slice(1).forEach((e) => e.remove()); });
  await page.setViewportSize({ width: 720, height: 900 });
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
}

test('print sheets: every In / Out time stays on one line inside its cell, in print at 720 px', async ({ page }) => {
  await openPrint(page, printWorld());
  const rows = await page.locator('#printsheets tr.site').evaluateAll((trs) => trs.map((tr) => ({ name: tr.querySelector('.sitecell b').textContent,
    cells: [...tr.querySelectorAll('td.t')].map((td) => ({ text: td.innerText.replace(/\s+/g, ' ').trim(), sw: td.scrollWidth, cw: td.clientWidth })) })));
  const big = rows.find((r) => r.name === 'Big Clinic'), camp = rows.find((r) => r.name === 'Camp Lot');
  expect(big.cells.map((c) => c.text)).toEqual(['12:55 AM', '10:05 PM (typed)']);
  expect(camp.cells.map((c) => c.text)).toEqual(['Done 12:55 AM']);
  for (const c of big.cells.concat(camp.cells)) expect(c.sw, c.text + ' ' + c.sw + ' > ' + c.cw).toBeLessThanOrEqual(c.cw);
  // The widths: In and Out are 9 % of 720 = 64.8 px (a little less after the border), the joined cell twice that.
  expect(big.cells[0].cw).toBeGreaterThanOrEqual(60);
});

test('print sheets: headings print black and bold even on a dark-mode phone', async ({ page }) => {
  await openPrint(page, printWorld());
  const ths = await page.locator('#printsheets table.rs th').evaluateAll((els) => els.map((th) => { const cs = getComputedStyle(th); return [cs.color, Number(cs.fontWeight)]; }));
  expect(ths.length).toBe(10);
  for (const [color, weight] of ths) { expect(color).toBe('rgb(0, 0, 0)'); expect(weight).toBeGreaterThanOrEqual(700); }
});

