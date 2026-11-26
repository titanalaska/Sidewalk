// Status-coloured name bars (Matt, 11/19/26): the Storm tab's site name bar turns
//   red    any walk at Problem                         words "1 problem" / "N problems"
//   green  every non-curb walk Cleared/Treated/Checked words "Done"
//   amber  a standing Arrived/Left, or any walk done   words "Arrived" or "K of N walks done"
//   black  nothing yet (the phone look's bar; navy until Titan colours, 11/24/26)  no words
// Colour is never the only signal: every coloured bar carries its words. With no storm open every bar is black.
// The real page over file://, Matt's live view, a small fake backend (made-up names only). Viewport 320 px wide.
//
// The world, worked on paper (route R1, storm ST-1 open, the clock in night-2026-10-02):
//   S1 Big Clinic   9 sidewalks Z1..Z9    log: Z1 treated, Z2 cleared          -> amber "2 of 9 walks done"
//   S2 Mid Lot      8 sidewalks Y1..Y8    nothing                              -> black, no words
//   S3 Small Shop   3 sidewalks X1..X3    nothing                              -> black, no words
// Each case below adds rows to that world and works its own answer out beside it.
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');
const SL = require('../lib/shiftlog.js');
const siteTapFake = require('./sitetap-fake.js');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-10-03T07:30:00-08:00';
const STAMP = '2026-10-03T07:50:18.445-08:00';
const SHIFT = 'night-2026-10-02';
const RING = [[-149.9, 61.2], [-149.8999, 61.2], [-149.8999, 61.2001], [-149.9, 61.2001]];
const zone = (id, site, name, type) => ({ id, site_id: site, name, type, ring: RING, priority: false, note: '', rev: 1 });
const START = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const END = { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:00:00.000-08:00', by_name: 'Matthew' };
const logRow = (n, site, zoneId, state, extra) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: SHIFT, site_id: site, zone_id: zoneId, state, note: '',
  by_key: 'C01', by_name: 'Alex Test', at: '2026-10-03T06:30:00.000-08:00', off_route: false, snowing_warned: false, undoes: null, batch: null, ...(extra || {}) });

function world() {
  const zones = [];
  for (let i = 1; i <= 9; i++) zones.push(zone('Z' + i, 'S1', 'Walk ' + i, 'sidewalk'));
  for (let i = 1; i <= 8; i++) zones.push(zone('Y' + i, 'S2', 'Lot walk ' + i, 'sidewalk'));
  for (let i = 1; i <= 3; i++) zones.push(zone('X' + i, 'S3', 'Shop walk ' + i, 'sidewalk'));
  return {
    crew: [], routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2', 'S3'] }],
    sites: [{ id: 'S1', name: 'Big Clinic', address: '100 Test Way', rev: 1 }, { id: 'S2', name: 'Mid Lot', address: '200 Test Way', rev: 1 },
      { id: 'S3', name: 'Small Shop', address: '300 Test Way', rev: 1 }],
    zones, storms: [START],
    log: [logRow(1, 'S1', 'Z1', 'treated'), logRow(2, 'S1', 'Z2', 'cleared')],
  };
}
const add = (w, ...rows) => { w.log.push(...rows); return w; };

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'nightsheet-1', action: body.action };
    if (body.token !== 'tok-matt') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const me = { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, crew: state.crew, post: null, moves: [], callouts: [], gear: [], ...v };
    if (body.action === 'getZones') return { ok: true, zones: state.zones, ...v };
    if (body.action === 'getPost') return { ok: true, post: null, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: {}, reset: {}, posts: [], ...v };
      out.cursor.posts = 0; out.reset.posts = false;
      [['log', state.log], ['storms', state.storms], ['visits', []], ['trucks', []], ['sheets', []]].forEach(([t, rows]) => {
        const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0));
        out[t] = rows.slice(cur).map((r) => (t === 'log' ? { ...r, by_profile: 'P1' } : r));
        out.cursor[t] = rows.length; out.reset[t] = false;
      });
      return out;
    }
    const storm = SL.stormState(state.storms);
    const view = (r) => ({ ...r, by_profile: 'P1' });
    if (body.action === 'tapSite' || body.action === 'undoSiteTap') return { ...siteTapFake(state, body, { storm, me, stamp: STAMP, view }), ...v };
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, o = {}) {
  await page.setViewportSize({ width: 320, height: 700 });
  if (o.dark) await page.emulateMedia({ colorScheme: 'dark' });
  if (o.es) await page.addInitScript(() => localStorage.setItem('snow-lang', 'es'));
  await page.clock.install({ time: new Date(CLOCK) });
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => { localStorage.setItem('titan-snow-token', 'tok-matt'); });
  await page.goto(PAGE);
  await page.click('nav [data-tab="storm"]');
  await page.locator('[data-openroute="R1"]').click();
  await expect(page.locator('#liveBack')).toBeVisible();
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
}
const bar = (page, site) => page.locator('[data-shiftsite="' + site + '"] .site-bar');
const words = (page, site) => page.locator('[data-shiftsite="' + site + '"] .site-bar .site-status');

// WCAG 2 contrast of two computed colours.
function contrast(a, b) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = (s) => { const [r, g, bl] = s.match(/\d+/g).slice(0, 3).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl); };
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
async function colours(page, site) {
  return bar(page, site).evaluate((el) => {
    const c = (sel) => { const n = el.querySelector(sel); return n ? getComputedStyle(n).color : null; };
    return { bg: getComputedStyle(el).backgroundColor, name: c('.site-name'), addr: c('.site-addr'), status: c('.site-status') };
  });
}

test('the world as it opens: S1 amber "2 of 9 walks done", S2 and S3 black with no words', async ({ page }) => {
  await open(page, world());
  await expect(bar(page, 'S1')).toHaveAttribute('data-status', 'working');
  await expect(words(page, 'S1')).toHaveText('2 of 9 walks done');
  for (const s of ['S2', 'S3']) {
    await expect(bar(page, s)).toHaveAttribute('data-status', 'none');
    await expect(words(page, s)).toHaveCount(0);
  }
  // nothing yet = the black bar: #111 is --black in day colours (Titan colours, 11/24/26; was navy #12263d)
  expect((await colours(page, 'S2')).bg).toBe('rgb(17, 17, 17)');   // #111
});

test('Site done on the amber site turns it green, "Done"', async ({ page }) => {
  await open(page, world());
  await page.locator('[data-sitetap="S1"][data-kind="done"]').click();
  // the 7 walks left are written as cleared: 9 of 9 done -> green
  await expect(bar(page, 'S1')).toHaveAttribute('data-status', 'done');
  await expect(words(page, 'S1')).toHaveText('Done');
});

test('a Problem walk turns the bar red, "1 problem", even with the rest done', async ({ page }) => {
  // S3: X1 problem, X2 + X3 cleared -> red "1 problem"
  await open(page, add(world(), logRow(3, 'S3', 'X1', 'problem', { note: 'car on it' }), logRow(4, 'S3', 'X2', 'cleared'), logRow(5, 'S3', 'X3', 'cleared')));
  await expect(bar(page, 'S3')).toHaveAttribute('data-status', 'problem');
  await expect(words(page, 'S3')).toHaveText('1 problem');
});

test('a crew that tapped Arrived and nothing else: amber "Arrived"; a Left with nothing marked: amber "0 of 8 walks done"', async ({ page }) => {
  // S3 has an Arrived in this shift; S2 an Arrived then a Left (the latest mark is the Left).
  await open(page, add(world(), logRow(3, 'S3', '*', 'arrived'), logRow(4, 'S2', '*', 'arrived'), logRow(5, 'S2', '*', 'left')));
  await expect(bar(page, 'S3')).toHaveAttribute('data-status', 'working');
  await expect(words(page, 'S3')).toHaveText('Arrived');
  await expect(bar(page, 'S2')).toHaveAttribute('data-status', 'working');
  await expect(words(page, 'S2')).toHaveText('0 of 8 walks done');
});

test('every walk treated (a treat-only night) is green', async ({ page }) => {
  await open(page, add(world(), logRow(3, 'S3', 'X1', 'treated'), logRow(4, 'S3', 'X2', 'treated'), logRow(5, 'S3', 'X3', 'treated')));
  await expect(bar(page, 'S3')).toHaveAttribute('data-status', 'done');
});

test('Clean again starts the site over: back to black', async ({ page }) => {
  // S3 all cleared (green), then a Clean again row: the new pass has nothing -> black
  await open(page, add(world(), logRow(3, 'S3', 'X1', 'cleared'), logRow(4, 'S3', 'X2', 'cleared'), logRow(5, 'S3', 'X3', 'cleared'), logRow(6, 'S3', '*', 'again')));
  await expect(bar(page, 'S3')).toHaveAttribute('data-status', 'none');
  await expect(words(page, 'S3')).toHaveCount(0);
});

test('no storm open: every bar black, no words', async ({ page }) => {
  const w = world(); w.storms = [START, END];
  await open(page, w);
  for (const s of ['S1', 'S2', 'S3']) {
    await expect(bar(page, s)).toHaveAttribute('data-status', 'none');
    await expect(words(page, s)).toHaveCount(0);
  }
});

// One world with all four colours: S1 amber, S2 green (Y1..Y8 cleared), S3 red (X1 problem), plus black S4.
function fourColours() {
  const w = world();
  for (let i = 1; i <= 8; i++) w.log.push(logRow(2 + i, 'S2', 'Y' + i, 'cleared'));
  w.log.push(logRow(11, 'S3', 'X1', 'problem', { note: 'car' }));
  w.zones.push(zone('V1', 'S4', 'Corner walk', 'sidewalk'));
  w.sites.push({ id: 'S4', name: 'Corner Store', address: '400 Test Way', rev: 1 });
  w.routes[0].site_ids.push('S4');
  return w;
}
for (const dark of [false, true]) {
  test('readable in ' + (dark ? 'dark' : 'light') + ' mode: name, address and words at 4.5:1 or better on every colour, four different bars', async ({ page }) => {
    await open(page, fourColours(), { dark });
    const want = { S1: 'working', S2: 'done', S3: 'problem', S4: 'none' };
    const bgs = new Set();
    for (const s of Object.keys(want)) {
      await expect(bar(page, s)).toHaveAttribute('data-status', want[s]);
      const m = await colours(page, s);
      expect(m.bg).toMatch(/^rgb[(]/);                       // a solid fill
      bgs.add(m.bg);
      expect(contrast(m.name, m.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(m.addr, m.bg)).toBeGreaterThanOrEqual(4.5);
      if (want[s] !== 'none') expect(contrast(m.status, m.bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(bgs.size).toBe(4);
  });
}

test('a long site name and its words fit at 320 px: no sideways scroll, the words under the name', async ({ page }) => {
  const w = world();
  w.sites[0].name = 'Alaska Native Medical Center Main Entrance and Parking Garage Walks';
  await open(page, w);
  await expect(words(page, 'S1')).toHaveText('2 of 9 walks done');
  const m = await bar(page, 'S1').evaluate((el) => {
    const n = el.querySelector('.site-name').getBoundingClientRect(), s = el.querySelector('.site-status').getBoundingClientRect(), b = el.getBoundingClientRect();
    return { below: s.top >= n.bottom - 1, inside: s.right <= b.right + 1, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(m.below).toBe(true);
  expect(m.inside).toBe(true);
  expect(m.over).toBeLessThanOrEqual(0);
});

test('Spanish: the words read in Spanish, the site name stays', async ({ page }) => {
  // S1 amber 2 of 9; S2 green; S3 red; S4 Arrived
  const w = fourColours();
  w.log.push(logRow(12, 'S4', '*', 'arrived'));
  await open(page, w, { es: true });
  await expect(words(page, 'S1')).toHaveText('2 de 9 recorridos terminados');
  await expect(words(page, 'S2')).toHaveText('Listo');
  await expect(words(page, 'S3')).toHaveText('1 problema');
  await expect(words(page, 'S4')).toHaveText('Llegué');
  await expect(page.locator('[data-shiftsite="S1"] .site-name')).toContainText('Big Clinic');
});

// ---- Titan colours (Matt, 11/24/26): gold and black. Gold #f5b800 is only ever lettering or an edge on --black; the amber
// "started" bar stays the only gold-looking block on the Storm tab, so a crew member scanning a route for amber sees nothing
// else that looks like one. --black is #111 by day and #000 at night. Values from the design's table, never from a run.
const GOLD = 'rgb(245, 184, 0)';                                            // #f5b800
const BLACK = { false: 'rgb(17, 17, 17)', true: 'rgb(0, 0, 0)' };          // --black, keyed by dark
for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';

  test('Titan colours: no gold fill but the started bar (' + mode + ')', async ({ page }) => {
    await open(page, fourColours(), { dark });
    // "Gold-looking": red 200+, green 120..200, blue 80 or under. Gold 245,184,0, day amber 242,176,30 and night amber 224,160,16 all are.
    const found = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('header, header *, main, main *, nav, nav *').forEach((el) => {
        if (!el.getClientRects().length) return;
        const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
        if (!m) return;
        const [r, g, b, a] = m.map(Number);
        if (a === 0) return;
        if (r >= 200 && g >= 120 && g <= 200 && b <= 80) out.push(el.matches('.site-bar.st-working') ? 'started bar' : el.tagName + '.' + el.className);
      });
      return out;
    });
    expect(found).toContain('started bar');                               // S1's bar: the check can see a gold-looking fill
    expect(found.filter((x) => x !== 'started bar')).toEqual([]);
  });

  test('Titan colours: the black header reads at 320 px (' + mode + ')', async ({ page }) => {
    await open(page, fourColours(), { dark });
    const h = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el), vis = (el) => !!el && el.getClientRects().length > 0, head = document.querySelector('header');
      const parts = [document.querySelector('#who'), [...document.querySelectorAll('header .lang-btn')].find(vis), document.querySelector('#share')];
      return { bg: cs(head).backgroundColor, edge: cs(head).borderBottomColor, edgeW: cs(head).borderBottomWidth, shadow: cs(head).boxShadow,
        parts: parts.map((el) => ({ id: el ? el.id || el.dataset.lang : 'missing', shown: vis(el), bg: el && cs(el).backgroundColor, color: el && cs(el).color })) };
    });
    expect(h.bg).toBe(BLACK[dark]);
    // the 2 px gold line under the header: a 1 px border + 1 px of shadow below it, so the header stays 61 px tall
    // (the Sites tab's heading bars stick at top:61px, and the roster spec's room is worked on paper from 61)
    expect(h.edge).toBe(GOLD);
    expect(h.edgeW).toBe('1px');
    expect(h.shadow).toContain(GOLD);
    for (const p of h.parts) {
      expect(p.shown, p.id).toBe(true);
      expect(p.bg, p.id).toBe('rgb(42, 40, 36)');                          // --head-chip #2a2824, never a white box on black
      expect(contrast(p.color, p.bg), p.id).toBeGreaterThanOrEqual(4.5);  // --head-ink #e8e2d4 on it: 11.39 on paper
    }
  });

  test('Titan colours: the selected tab is more than a colour (' + mode + ')', async ({ page }) => {
    await open(page, fourColours(), { dark });
    const tabs = await page.evaluate(() => [...document.querySelectorAll('nav button')].filter((b) => b.getClientRects().length)
      .map((b) => ({ cur: b.getAttribute('aria-current') === 'page', color: getComputedStyle(b).color, shadow: getComputedStyle(b).boxShadow })));
    const cur = tabs.filter((t) => t.cur), rest = tabs.filter((t) => !t.cur);
    expect(cur).toHaveLength(1);
    expect(cur[0].color).toBe(GOLD);
    expect(cur[0].shadow).toContain(GOLD);                                 // the gold top edge
    expect(rest.length).toBeGreaterThan(0);
    for (const t of rest) {
      expect(t.color).toBe('rgb(189, 183, 168)');                         // --head-muted #bdb7a8
      expect(t.shadow).toBe('none');
    }
  });

  test('Titan colours: Site done is black with gold lettering (' + mode + ')', async ({ page }) => {
    await open(page, world(), { dark });
    const b = await page.locator('[data-sitetap="S2"][data-kind="done"]').evaluate((el) => {
      const c = getComputedStyle(el);
      return { color: c.color, bg: c.backgroundColor, edge: c.borderTopColor };
    });
    // --btn-edge: #111 by day (the button's own black), gold at night (black on a near-black card needs the edge)
    expect(b).toEqual({ color: GOLD, bg: BLACK[dark], edge: dark ? GOLD : 'rgb(17, 17, 17)' });
  });
}

test('Titan colours: a phone that turns dark while the app is open follows it', async ({ page }) => {
  await open(page, world());
  const read = () => bar(page, 'S2').evaluate((el) => ({ bar: getComputedStyle(el).backgroundColor, card: getComputedStyle(el.closest('.shift-site')).backgroundColor }));
  expect(await read()).toEqual({ bar: 'rgb(17, 17, 17)', card: 'rgb(255, 255, 255)' });   // day: --black #111, --card #fff
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await read()).toEqual({ bar: 'rgb(0, 0, 0)', card: 'rgb(38, 36, 32)' });         // night: --black #000, --card #262420
});

// ---- Titan colours, final review (11/24/26): three blues the browser draws by itself survived the re-colour, because
// app.css never coloured them: the ☎ call link (an <a>, so link blue), the live view's <progress> bars and ticked
// checkboxes (accent-color: auto). The markup below is the app's own (lib/boardui.js:86 and :829, lib/shiftlogui.js:1667,
// the Site card's walk-behind blower tick, lib/shiftlogui.js), put into the real page so app.css styles it.
//   checkbox and progress: accent-color is --ink: #141414 by day, #f5f3ee at night (never gold: a gold fill on the Storm tab
//   would read as "started"; never blue)
//   the ☎ link: --ok, the green of the crew's round call button (.callbtn): #1e7a3c by day, #7ed69a at night
const INK = { false: 'rgb(20, 20, 20)', true: 'rgb(245, 243, 238)' };
const OK = { false: 'rgb(30, 122, 60)', true: 'rgb(126, 214, 154)' };
for (const dark of [false, true]) {
  test('Titan colours: no browser-default blue on a call link, a progress bar or a ticked box (' + (dark ? 'dark' : 'light') + ')', async ({ page }) => {
    await open(page, world(), { dark });
    const m = await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<a class="call" href="tel:9075550100" aria-label="Call Test Person">☎</a>' +
        '<progress value="1" max="3"></progress><label class="inline"><input type="checkbox" checked> Test box</label>';
      document.querySelector('main').prepend(box);
      const cs = (sel) => getComputedStyle(box.querySelector(sel));
      return { call: cs('a.call').color, progress: cs('progress').accentColor, box: cs('input[type=checkbox]').accentColor };
    });
    expect(m.call).toBe(OK[dark]);
    expect(m.progress).toBe(INK[dark]);
    expect(m.box).toBe(INK[dark]);
  });
}
