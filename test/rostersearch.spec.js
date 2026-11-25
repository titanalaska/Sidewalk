// Roster search (Matt, 11/18-19/26): the Roster tab gets a search box, one "Crew" heading bar with a count, and letter rows when more than 12
// people show. What is searched and lettered is lib/grouplist.js people() (its own node tests); this file is the PAGE: the structure, the
// box that must never be rebuilt under a key, a redraw while typing, a person's card closing, a sign-out, and the 320 px fit.
// The real page over file://, a small fake backend, made-up names only.
//
// The world, worked on paper. Routes R1 "N1", R2 "Valley 2". Crew (C14 is a gap):
//   C01 Abel Stone (907) 555-0101, photo, R1 lead      C02 Ana Brook 907-555-0102, R1 member    C03 Álvaro Reed
//   C04 Beto Marsh, R2 member     C05 Carla Dune     C06 Dario Field     C07 Elena Ford     C08 José Niño 9075550108, R2 lead
//   C09 Juan Carlos Pérez   C10 Karl Moss   C11 Lena Park   C12 Mateo Ridge   C13 Ñico Soto   C15 Zed Vale
//   C16 Old Hand (archived)   C17 New Card (pending: waiting to be added, never in the list)
// Listed: 14, which is more than 12, so lettered. Placed: 4 (N1 · lead, N1, Valley 2, Valley 2 · lead). Unplaced: 10.
// Order, accents ignored ("ab" < "al" < "an"; "jo" < "ju"):
//   Abel Stone, Álvaro Reed, Ana Brook | Beto Marsh | Carla Dune | Dario Field | Elena Ford | José Niño, Juan Carlos Pérez | Karl Moss |
//   Lena Park | Mateo Ridge | Ñico Soto | Zed Vale.      Letter rows: A B C D E J K L M N Z = 11.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ORDER = ['Abel Stone', 'Álvaro Reed', 'Ana Brook', 'Beto Marsh', 'Carla Dune', 'Dario Field', 'Elena Ford', 'José Niño', 'Juan Carlos Pérez',
  'Karl Moss', 'Lena Park', 'Mateo Ridge', 'Ñico Soto', 'Zed Vale'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'J', 'K', 'L', 'M', 'N', 'Z'];

const person = (id, name, extra) => ({ id, name, rev: 1, phone: '', is_lead: false, photo_thumb: null, ...extra });
function world() {
  const crew = [
    person('C01', 'Abel Stone', { phone: '(907) 555-0101', photo_thumb: PNG }),
    person('C02', 'Ana Brook', { phone: '907-555-0102' }),
    person('C03', 'Álvaro Reed'), person('C04', 'Beto Marsh'), person('C05', 'Carla Dune'), person('C06', 'Dario Field'),
    person('C07', 'Elena Ford'), person('C08', 'José Niño', { phone: '9075550108' }), person('C09', 'Juan Carlos Pérez'),
    person('C10', 'Karl Moss'), person('C11', 'Lena Park'), person('C12', 'Mateo Ridge'), person('C13', 'Ñico Soto'),
    person('C15', 'Zed Vale'),
    person('C16', 'Old Hand', { archived: true }),
    person('C17', 'New Card', { pending: true, photo_thumb: PNG }),   // a picture: Add to crew needs one (crew pictures, 11/24/26)
  ];
  const mv = (n, worker, route, role) => ({ id: 'M' + n, at: '2026-10-01T17:0' + n + ':00.000-08:00', worker, to_route: route, role });
  return {
    crew, callouts: [], gear: [], zones: [], storms: [], log: [],
    moves: [mv(1, 'C01', 'R1', 'lead'), mv(2, 'C02', 'R1', 'member'), mv(3, 'C04', 'R2', 'member'), mv(4, 'C08', 'R2', 'lead')],
    routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: [] }, { id: 'R2', name: 'Valley 2', rev: 1, site_ids: [] }],
    sites: [{ id: 'S1', name: 'Big Clinic', rev: 1 }],
  };
}
const without = (w, ids) => { w.crew = w.crew.filter((c) => !ids.includes(c.id)); return w; };

const PROFILES = [{ id: 1, name: 'Matthew', status: 'approved', hasPin: true }];

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'checknight-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, moves: state.moves, callouts: [], gear: [], ...v };
    if (body.action === 'getCrew') return { ok: true, crew: state.crew, ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    // The real saveCrew, as test/ui.spec.js's fake answers it: the record comes back one revision on and replaces the stored one.
    if (body.action === 'saveCrew') {
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      state.crew = state.crew.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

// o.width: viewport width (320). The Inventory stub answers the profile list and a good PIN, so a sign-out and a sign-in work.
async function open(page, w, o = {}) {
  await page.setViewportSize({ width: o.width || 320, height: 700 });
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w);
  await page.route(isSnow, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(JSON.parse(route.request().postData() || '{}'))) }));
  await page.route(isInv, (route) => {
    const p = Object.fromEntries(new URL(route.request().url()).searchParams);
    const out = p.action === 'getProfiles' ? { profiles: PROFILES }
      : p.action === 'verifyPin' && p.id === '1' && p.pin === '1111' ? { valid: true, success: true, id: 1, name: 'Matthew', status: 'approved', token: 'tok-matt' } : { valid: false, attemptsLeft: 4 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#addWorker')).toBeVisible();
}

const names = (page) => page.locator('#roster_list .tile .tile-name').allInnerTexts();
const letters = (page) => page.locator('#roster_list .grp-letter').allInnerTexts();
const bar = (page) => page.locator('#roster_list .grp-bar');

test('opens lettered: box, bar, list in order under Add worker; 14 people; the waiting list above the box', async ({ page }) => {
  await open(page, world());
  // order of the elements under the main column: waiting lists, Add worker, the box, the list
  const kids = await page.evaluate(() => Array.from(document.querySelector('#main').children).map((e) => e.id || e.className || e.tagName));
  expect(kids.indexOf('waitadd')).toBeGreaterThanOrEqual(0);
  expect(kids.indexOf('waitadd')).toBeLessThan(kids.indexOf('roster_q'));
  expect(kids.indexOf('roster_q')).toBeLessThan(kids.indexOf('roster_list'));
  const rowOfAdd = await page.evaluate(() => { const k = Array.from(document.querySelector('#main').children); return k.indexOf(document.getElementById('addWorker').parentElement); });
  expect(rowOfAdd).toBeLessThan(kids.indexOf('roster_q'));
  await expect(page.locator('#roster_q')).toHaveAttribute('placeholder', 'Search crew');
  await expect(page.locator('#roster_q')).toHaveAttribute('aria-label', 'Search crew');
  await expect(bar(page)).toHaveCount(1);
  await expect(bar(page).locator('h2')).toHaveText('Crew');
  await expect(bar(page).locator('.grp-count')).toHaveText('14');
  expect(await letters(page)).toEqual(LETTERS);
  expect(await names(page)).toEqual(ORDER);
  await expect(page.locator('#waitadd h2')).toHaveText('Waiting to be added (1)');
  await expect(page.locator('#roster_list')).not.toContainText('Old Hand');
  await expect(page.locator('#roster_list')).not.toContainText('New Card');
  // the placement the search below reads really is what the rows say
  const where = async (id) => page.locator('.tile[data-open="' + id + '"] .where').innerText();
  expect(await where('C01')).toBe('N1 · lead');
  expect(await where('C02')).toBe('N1');
  expect(await where('C04')).toBe('Valley 2');
  expect(await where('C08')).toBe('Valley 2 · lead');
  expect(await where('C03')).toBe('Unplaced');
});

const typed = async (page, text) => { await page.fill('#roster_q', text); };

test('jose finds José Niño alone, no letter rows', async ({ page }) => {
  await open(page, world());
  await typed(page, 'jose');
  expect(await names(page)).toEqual(['José Niño']);
  await expect(bar(page).locator('.grp-count')).toHaveText('1');
  expect(await letters(page)).toEqual([]);
});

test('juan perez finds Juan Carlos Pérez', async ({ page }) => {
  await open(page, world());
  await typed(page, 'juan perez');
  expect(await names(page)).toEqual(['Juan Carlos Pérez']);
});

test('the place words: n1, valley, lead', async ({ page }) => {
  await open(page, world());
  await typed(page, 'n1');
  expect(await names(page)).toEqual(['Abel Stone', 'Ana Brook']);
  await typed(page, 'valley');
  expect(await names(page)).toEqual(['Beto Marsh', 'José Niño']);
  await typed(page, 'lead');
  expect(await names(page)).toEqual(['Abel Stone', 'José Niño']);
});

test('unplaced: the 10 nobody has put on a route, no letter rows (10 is not more than 12)', async ({ page }) => {
  await open(page, world());
  await typed(page, 'unplaced');
  expect((await names(page)).length).toBe(10);
  await expect(bar(page).locator('.grp-count')).toHaveText('10');
  expect(await letters(page)).toEqual([]);
});

test('phone digits: 555-0102 is Ana, 555 is the three with numbers, 55 is no one', async ({ page }) => {
  await open(page, world());
  await typed(page, '555-0102');
  expect(await names(page)).toEqual(['Ana Brook']);
  await typed(page, '555');
  expect(await names(page)).toEqual(['Abel Stone', 'Ana Brook', 'José Niño']);
  await typed(page, '55');
  await expect(page.locator('#roster_list')).toContainText('No one matches');
  // The joined match (final review): a phone typed with spaces or a leading 1 is one number. "1 907 555 0102" is 19075550102 = a 1, then
  // 9075550102, which is Ana's digits alone (Abel's end 0101, José's 0108); "907 5" is 9075, which the three phones start with.
  await typed(page, '1 907 555 0102');
  expect(await names(page)).toEqual(['Ana Brook']);
  await typed(page, '907 5');
  expect(await names(page)).toEqual(['Abel Stone', 'Ana Brook', 'José Niño']);
});

test('the row\'s own words find it: what José Niño\'s row says, typed, shows him', async ({ page }) => {
  await open(page, world());
  const said = await page.locator('.tile[data-open="C08"] .where').innerText();
  expect(said).toBe('Valley 2 · lead');
  // The words are "valley", "2", "·" and "lead". Beto Marsh's row says "Valley 2" (no lead), Abel Stone's "N1 · lead" (no valley): José alone.
  await typed(page, said);
  expect(await names(page)).toEqual(['José Niño']);
});

test('nobody matches: the words, a Clear, no bar, no tiles; the waiting list stays; Clear empties and focuses the box', async ({ page }) => {
  await open(page, world());
  await typed(page, 'zzz');
  await expect(page.locator('#roster_list')).toContainText('No one matches');
  await expect(page.locator('#roster_clear')).toHaveText('Clear');
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('#roster_list .tile')).toHaveCount(0);
  await expect(page.locator('#waitadd')).toBeVisible();
  await page.click('#roster_clear');
  await expect(page.locator('#roster_q')).toHaveValue('');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('roster_q');
  await expect(page.locator('#roster_list .tile')).toHaveCount(14);
  await expect(bar(page).locator('.grp-count')).toHaveText('14');
});

test('the waiting list is never narrowed by the search', async ({ page }) => {
  await open(page, world());
  await typed(page, 'jose');
  await expect(page.locator('#waitadd')).toContainText('New Card');
});

// A save redraws the whole tab (renderRoster rebuilds the box). New Card is the only pending card: Add to crew saves it (pending false) and
// nobody waits any more. On paper: with "jose" typed, the list is José Niño alone and the bar reads 1; New Card is now a listed person, but
// "new card" does not contain "jose" (and its place is "Unplaced"), so the list and the bar do not change.
test('a save with a search on: Add to crew on the waiting card redraws the tab and the search stays', async ({ page }) => {
  await open(page, world());
  await typed(page, 'jose');
  await expect(page.locator('#waitadd')).toContainText('New Card');
  await page.click('#waitadd [data-addcrew="C17"]');
  await expect(page.locator('#waitadd')).toHaveCount(0);
  await expect(page.locator('#roster_q')).toHaveValue('jose');
  expect(await names(page)).toEqual(['José Niño']);
  await expect(bar(page).locator('.grp-count')).toHaveText('1');
});

test('a key never rebuilds the box: the same element, focused, holding what was typed', async ({ page }) => {
  await open(page, world());
  await page.evaluate(() => { document.getElementById('roster_q').__mine = true; });
  await page.focus('#roster_q');
  await page.keyboard.type('jo');
  await page.keyboard.type('se');
  const st = await page.evaluate(() => { const el = document.getElementById('roster_q'); return { mine: el.__mine === true, active: document.activeElement === el, value: el.value }; });
  expect(st).toEqual({ mine: true, active: true, value: 'jose' });
});

test('a redraw while typing (the 5-minute check finds a new card): the box keeps its text, its focus and its caret, the list its narrowing', async ({ page }) => {
  const w = world();
  await open(page, w);
  await page.focus('#roster_q');
  await page.keyboard.type('jo');
  await page.evaluate(() => document.getElementById('roster_q').setSelectionRange(1, 1));
  w.crew.push(person('C18', 'Late Card', { pending: true }));
  await page.clock.runFor(5 * 60 * 1000 + 2000);
  await expect(page.locator('#waitadd h2')).toHaveText('Waiting to be added (2)');
  const st = await page.evaluate(() => { const el = document.getElementById('roster_q'); return { value: el.value, active: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd }; });
  expect(st).toEqual({ value: 'jo', active: true, s: 1, e: 1 });
  expect(await names(page)).toEqual(['José Niño']);
});

test('never silent: a person\'s card opening and closing, and a trip to the Sites tab, leave the search on', async ({ page }) => {
  await open(page, world());
  await typed(page, 'jose');
  await page.click('.tile[data-open="C08"]');
  await expect(page.locator('#dlgClose')).toBeVisible();
  await page.click('#dlgClose');
  await expect(page.locator('#dlgClose')).toBeHidden();
  await expect(page.locator('#roster_q')).toHaveValue('jose');
  expect(await names(page)).toEqual(['José Niño']);
  await page.click('nav [data-tab="sites"]');
  await expect(page.locator('#site_q')).toBeVisible();
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#roster_q')).toHaveValue('jose');
  expect(await names(page)).toEqual(['José Niño']);
});

test('signing out lets go of the search: the next sign-in opens the whole roster', async ({ page }) => {
  await open(page, world());
  await typed(page, 'jose');
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  await page.selectOption('#si_who', '1');
  await page.fill('#si_pin', '1111');
  await page.click('#si_go');
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#roster_q')).toHaveValue('');
  await expect(page.locator('#roster_list .tile')).toHaveCount(14);
});

test('never stored: the typed text is in no localStorage or sessionStorage key or value', async ({ page }) => {
  await open(page, world());
  await typed(page, 'jose');
  const found = await page.evaluate(() => {
    const out = [];
    [localStorage, sessionStorage].forEach((st) => { for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k.includes('jose') || String(st.getItem(k)).includes('jose')) out.push(k); } });
    return out;
  });
  expect(found).toEqual([]);
});

test('fits at 320 px (no sideways scroll, bar and a letter row inside) and at 390 px a letter row spans both columns', async ({ page }) => {
  await open(page, world());
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth, r = (s) => document.querySelector(s).getBoundingClientRect();
    return { over: document.documentElement.scrollWidth - vw, vw, barL: r('#roster_list .grp-bar').left, barR: r('#roster_list .grp-bar').right, lR: r('#roster_list .grp-letter').right, lL: r('#roster_list .grp-letter').left };
  });
  expect(m.over).toBeLessThanOrEqual(0);
  expect(m.barL).toBeGreaterThanOrEqual(0); expect(m.barR).toBeLessThanOrEqual(m.vw);
  expect(m.lL).toBeGreaterThanOrEqual(0); expect(m.lR).toBeLessThanOrEqual(m.vw);
  await page.setViewportSize({ width: 390, height: 700 });
  const wide = await page.evaluate(() => ({
    grid: document.querySelector('#roster_list .grid').getBoundingClientRect().width,
    letter: document.querySelector('#roster_list .grp-letter').getBoundingClientRect().width,
    tile: document.querySelector('#roster_list .tile').getBoundingClientRect().width,
  }));
  expect(wide.tile).toBeLessThan(wide.grid * 0.75);              // two columns: a tile is about half the grid
  expect(Math.abs(wide.letter - wide.grid)).toBeLessThanOrEqual(2);
});

test('not translated: letter rows and names carry data-no-es', async ({ page }) => {
  await open(page, world());
  const r = await page.evaluate(() => ({
    letters: Array.from(document.querySelectorAll('#roster_list .grp-letter')).map((e) => e.hasAttribute('data-no-es')),
    names: Array.from(document.querySelectorAll('#roster_list .tile-name')).map((e) => e.hasAttribute('data-no-es')),
  }));
  expect(r.letters.length).toBe(11); expect(r.letters.every(Boolean)).toBe(true);
  expect(r.names.length).toBe(14); expect(r.names.every(Boolean)).toBe(true);
});

test('no crew (only an archived card): "No crew yet.", no box, Add worker still there', async ({ page }) => {
  const w = world(); w.crew = [person('C16', 'Old Hand', { archived: true })];
  await open(page, w);
  await expect(page.locator('#main')).toContainText('No crew yet.');
  await expect(page.locator('#roster_q')).toHaveCount(0);
  await expect(page.locator('#addWorker')).toBeVisible();
});

test('twelve people are not lettered: no letter row, the bar reads 12', async ({ page }) => {
  await open(page, without(world(), ['C13', 'C15']));            // 14 - 2 = 12 listed; 12 is not MORE than 12
  await expect(page.locator('#roster_list .tile')).toHaveCount(12);
  expect(await letters(page)).toEqual([]);
  await expect(bar(page).locator('.grp-count')).toHaveText('12');
});

// The box is a real tap target and does not touch Add worker (final review, 11/19/26). #site_q is 44 px tall; the Roster's box was the bare
// input (8 + 8 padding + 2 border + about 20 of text = about 38-40) with no margin, so it sat flush under Add worker's row (that row has no
// bottom margin). Wanted: height >= 44, and its top at least 8 px under Add worker's bottom.
test('the search box is at least 44 px tall and sits at least 8 px under Add worker', async ({ page }) => {
  await open(page, nobodyWaiting());
  const m = await page.evaluate(() => {
    const q = document.getElementById('roster_q').getBoundingClientRect(), a = document.getElementById('addWorker').getBoundingClientRect();
    return { h: q.height, under: q.top - a.bottom };
  });
  expect(m.h).toBeGreaterThanOrEqual(44);
  expect(m.under).toBeGreaterThanOrEqual(8);
});

// The room the new parts take (a phone-look test used to count six cards on the first screen; that count could not survive the box and the bar).
// A world with nobody waiting (no pending card), 14 listed people, 320 x 700.
// Worked on paper from app.css (every figure below was then MEASURED on the page and agrees within 0.1 px):
//   Add worker's bottom: the header is 10 + 40 + 10 padding + 1 border = 61; main's top padding 12; the Add worker row has margin-top 0 and
//     its button is 44 tall (min-height)                                                       61 + 12 + 44 = 117
//   the search box:  margin-top 8, height 44 (min-height)                                       top 125, bottom 169
//   the Crew bar:    margin-top 8 (#roster_list .grp-bar), min-height 44 (its content is 20 + 12 padding + 2 border = 34, so the floor wins)
//                    top 169 + 8 = 177, bottom 221
//   the grid:        margin-top 0 (#roster_list>.grid), so the bar's margin-bottom 8 is all there is between them (adjacent vertical margins
//                    collapse: the larger wins, and 8 > 0)                                       grid top 221 + 8 = 229
//   the A letter row: margin-top 4 (a grid item's margin does not collapse) + its own height 24.6 (14 px text at this font's normal line
//                    height of about 19.6, + 4 padding + 1 border)                               top 233, bottom 257.6
//   the grid gap 8, then the first card (78 tall: the 64 px photo + 12 padding + 2 border)        top 265.6, bottom 343.6
//   cards 2 and 3 (8 gap each): bottom of the third = 265.6 + 3 x 78 + 2 x 8                      515.6
//   the B letter row sits before the fourth card: 515.6 + 8 gap + 4 margin = top 527.6, bottom 552.2; + 8 gap = the fourth card's top 560.2,
//                    its bottom 638.2 (that is 1.8 px inside 700 - 60 = 640: too close to pin, so no test says 4).
// From Add worker's bottom to the first card's top: 265.6 - 117 = 148.6 (that is 8 + 44 + 8 + 44 + 8 + 4 + 24.6 + 8). The pin is at most
// 148.6 + 10 = 158, and more than 100 (a floor, so a gap of nothing cannot pass silently). The first screen: the third card's bottom 515.6
// is at or above 640, so at least 3 cards fit.
// A world with nobody waiting (no pending card), 14 listed people, 320 x 700.
const nobodyWaiting = () => without(world(), ['C17']);
test('the new parts cost a known amount of room: Add worker to the first card is at most 158 px', async ({ page }) => {
  await open(page, nobodyWaiting());
  await expect(page.locator('#waitadd')).toHaveCount(0);
  const gap = await page.evaluate(() => document.querySelector('.tile').getBoundingClientRect().top - document.getElementById('addWorker').getBoundingClientRect().bottom);
  expect(gap).toBeLessThanOrEqual(158);
  expect(gap).toBeGreaterThan(100);                                   // and the parts really are there (a gap of nothing would be a silent pass)
});

test('at least 3 cards on the first screen at 320 x 700', async ({ page }) => {
  await open(page, nobodyWaiting());
  const fit = await page.evaluate(() => Array.from(document.querySelectorAll('.tile')).filter((e) => e.getBoundingClientRect().bottom <= window.innerHeight - 60).length);
  expect(fit).toBeGreaterThanOrEqual(3);
});
