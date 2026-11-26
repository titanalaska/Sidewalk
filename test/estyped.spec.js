// Spanish everywhere, Ship 2 (Matt, 11/25/26): the typed-words layer, lib/estyped.js (SnowEsTyped). An element marked data-typed
// (always data-no-es too, so the app's own Spanish pass leaves it alone) shows the Spanish this phone holds for its text; a miss
// is asked for in ONE batched `translate` call 400 ms later; the answer patches every element with that text; the English is
// kept and comes back on a flip to EN or a tap. Crew-typed Problem notes (data-typed="crew") show in the phone's language on
// EVERY phone. The phone's copy is localStorage `snow-es-typed`, wiped at sign-out.
// These tests put their own marked elements on the real page (the app's screens get their marks in the next task) and answer
// `translate` from this file's fake. Made-up names only. Viewport 320 x 700; the page clock is installed (timers run on it).
const { test, expect } = require('./no-real-weather.js');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');
const CLOCK = '2026-12-04T21:00:00-09:00';
const KEY = 'snow-es-typed';

// The world: S1 Big Clinic (no notes), one zone "Sidewalk north". Every test's held copy holds "Sidewalk north" in Spanish
// unless it says otherwise, so the sign-in prefetch (Spanish phones) has nothing to ask and the calls seen are the test's own.
function world() {
  return {
    sites: [{ id: 'S1', name: 'Big Clinic', address: '100 Test Way', notes: '', materials_needed: '', rev: 1 }],
    zones: [{ id: 'Z1', site_id: 'S1', name: 'Sidewalk north', type: 'sidewalk', note: '', rev: 1 }],
    routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
    crew: [], post: null, storms: [], log: [],
    calls: [],                    // every translate body, in order
    // The fake translator, as the server answers: a line the Translations tab holds (HELD below, what this phone was given
    // earlier) comes back the same; any other line '[ES] text' / '[EN] text' unless the test changes it. mode 'offline' = no
    // signal (aborted).
    answer: (lang, t) => (HELD[lang] && HELD[lang][t]) || '[' + lang.toUpperCase() + '] ' + t,
    later: () => false, refused: () => false, mode: 'ok',
  };
}
const HELD = { es: { 'Sidewalk north': 'Banqueta norte' }, en: {} };

function fakeSnow(state) {
  return (body) => {
    const v = { version: 'spanish-1', action: body.action };
    if (body.token !== 'tok-matt' && body.token !== 'tok-jordan') return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    const crew = body.token === 'tok-jordan';
    const me = crew ? { name: 'Jordan Demo', role: 'crew', crew_id: 'C03' } : { name: 'Matthew', role: 'admin', crew_id: null };
    if (body.action === 'bootstrap') return { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones, points: {}, crew: state.crew,
      post: state.post, ...(crew ? { card: { id: 'C03', name: 'Jordan Demo' } } : { moves: [], callouts: [], gear: [] }), ...v };
    if (body.action === 'getPost') return { ok: true, post: state.post, ...v };
    if (body.action === 'getShiftLog') {
      const out = { ok: true, cursor: {}, reset: {}, posts: [], clock: [], tail: { clock: null }, ...v };
      [['log', state.log], ['storms', state.storms], ['visits', []], ['trucks', []], ['sheets', []], ['posts', []], ['clock', []]].forEach(([t, rows]) => {
        out[t] = rows; out.cursor[t] = rows.length; out.reset[t] = false;
      });
      return out;
    }
    if (body.action === 'translate') {
      state.calls.push(body);
      const done = {}, later = [], refused = [];
      body.texts.forEach((t) => {
        if (state.refused(t)) refused.push(t);
        else if (state.later(t)) later.push(t);
        else done[t] = state.answer(body.lang, t);
      });
      return { ok: true, lang: body.lang, done, later, refused, ...v };
    }
    return { ok: false, code: 'error', reason: 'not in the fake: ' + body.action, ...v };
  };
}

async function open(page, w, o = {}) {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript((lang) => localStorage.setItem('snow-lang', lang), o.lang || 'es');
  const held = o.held === undefined ? HELD : o.held;
  if (held) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(held)]);
  await page.clock.install({ time: new Date(o.clock || CLOCK) });
  const fake = fakeSnow(w);
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'translate' && w.mode === 'offline') { w.calls.push(body); return route.abort('internetdisconnected'); }
    if (body.action === 'translate') {
      // how many translate calls are out at once (w.maxOut), each reply held w.delayMs of real time
      w.out = (w.out || 0) + 1; w.maxOut = Math.max(w.maxOut || 0, w.out);
      if (w.delayMs) await new Promise((r) => setTimeout(r, w.delayMs));
      const reply = JSON.stringify(fake(body));
      w.out--;
      return route.fulfill({ contentType: 'application/json', body: reply });
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.addInitScript((t) => { localStorage.setItem('titan-snow-token', t); }, o.crew ? 'tok-jordan' : 'tok-matt');
  await page.goto(PAGE);
  await expect(page.locator('#signout')).toBeVisible();
}

// Marked elements of our own, in a box of their own at the end of the body: [id, text, crew?]
async function addTyped(page, items) {
  await page.evaluate((list) => {
    let box = document.getElementById('typedbox');
    if (!box) { box = document.createElement('div'); box.id = 'typedbox'; document.body.appendChild(box); }
    list.forEach(([id, text, crew]) => {
      const s = document.createElement('span');
      s.id = id; s.setAttribute('data-no-es', ''); s.setAttribute('data-typed', crew ? 'crew' : '');
      s.textContent = text;
      box.appendChild(s);
    });
  }, items);
}
const text = (page, id) => page.locator('#' + id).evaluate((el) => el.textContent);

test('typed words: a Spanish phone shows the Spanish it holds at once, and asks the tab for that line once this session', async ({ page }) => {
  const w = world();
  await open(page, w);
  await addTyped(page, [['z', 'Sidewalk north']]);
  // held: 'Sidewalk north' -> 'Banqueta norte', shown before anything is asked (no signal needed)
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  await expect(page.locator('#z')).toHaveAttribute('data-typed-shown', '');
  expect(w.calls.length).toBe(0);
  // 400 ms later the line is asked once (the tab answers it: final review C1); never again this session
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1);
  expect(w.calls[0].texts).toEqual(['Sidewalk north']);
  await page.clock.runFor(61000);
  await addTyped(page, [['z2', 'Sidewalk north']]);
  await page.clock.runFor(61000);
  expect(w.calls.length).toBe(1);
  await expect(page.locator('#z2')).toHaveText('Banqueta norte');
});

test('typed words: a line Matt fixed by hand in the Translations tab reaches a phone that already holds the old Spanish', async ({ page }) => {
  // final review C1. This phone holds 'Sidewalk north' -> 'Banqueta norte'; the tab now says 'Banqueta del lado norte'.
  const w = world();
  w.answer = (lang, t) => (t === 'Sidewalk north' ? 'Banqueta del lado norte' : '[ES] ' + t);
  await open(page, w);
  await addTyped(page, [['z', 'Sidewalk north']]);
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  await page.clock.runFor(500);
  await expect(page.locator('#z')).toHaveText('Banqueta del lado norte');
  const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(kept.es['Sidewalk north']).toBe('Banqueta del lado norte');
});

test('typed words: a blank answer never blanks the English, and a blank kept value is not shown', async ({ page }) => {
  // final review M2: a cell cleared to spaces. The kept copy holds 'Old note' -> '   ' (dropped on read); Google answers '  '.
  // 'Sidewalk north' is held as in every test, so the sign-in fill asks nothing and the one call is this test's.
  const w = world();
  w.answer = () => '  ';
  await open(page, w, { held: { es: { 'Sidewalk north': 'Banqueta norte', 'Old note': '   ' }, en: {} } });
  await addTyped(page, [['a', 'Old note'], ['b', 'Salt the ramp']]);
  await expect(page.locator('#a')).toHaveText('Old note');
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.SnowEsTyped.pending().inflight)).toBe(0);
  await expect(page.locator('#a')).toHaveText('Old note');
  await expect(page.locator('#b')).toHaveText('Salt the ramp');
});

test('typed words: no signal never uses up a line\'s retries: once signal is back the line is translated', async ({ page }) => {
  // final review M4. Offline: ask 1 at 0.4 s and a retry every ~60 s; four retries fail (more than the 3 a "later" gets);
  // then signal is back and the next retry is answered.
  const w = world();
  w.mode = 'offline';
  await open(page, w);
  await addTyped(page, [['a', 'Salt the ramp']]);
  const settled = () => expect.poll(() => page.evaluate(() => window.SnowEsTyped.pending().inflight)).toBe(0);
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1); await settled();
  for (let n = 2; n <= 5; n++) { await page.clock.runFor(61000); await expect.poll(() => w.calls.length).toBe(n); await settled(); }
  await expect(page.locator('#a')).toHaveText('Salt the ramp');
  w.mode = 'ok';
  await page.clock.runFor(61000);
  await expect(page.locator('#a')).toHaveText('[ES] Salt the ramp');
});

test('typed words: one call at a time, and a line both on screen and in the sign-in fill is asked once', async ({ page }) => {
  // final review I2. Jordan's own route R2 = S2 (Sweep the steps, South walk); the rest = S1 (Salt the ramp, 2 bags, North walk,
  // Ice by the door). Two of those are also on screen. Every reply waits 300 ms (real time), so two calls out at once would show.
  const w = world();
  w.sites = [{ id: 'S1', name: 'Big Clinic', notes: 'Salt the ramp', materials_needed: '2 bags', rev: 1 },
    { id: 'S2', name: 'Mid Lot', notes: 'Sweep the steps', materials_needed: '', rev: 1 }];
  w.zones = [{ id: 'Z1', site_id: 'S1', name: 'North walk', type: 'sidewalk', note: 'Ice by the door', rev: 1 },
    { id: 'Z2', site_id: 'S2', name: 'South walk', type: 'sidewalk', note: '', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  w.post = { id: 'P-1', shift: 'night-2026-12-04', posted_at: '2026-12-04T20:00:00.000-09:00', people: { C03: { name: 'Jordan Demo' } },
    routes: [{ id: 'R1', name: 'N1', lead: null, members: [], sites: [{ id: 'S1', name: 'Big Clinic' }] },
      { id: 'R2', name: 'N2', lead: null, members: ['C03'], sites: [{ id: 'S2', name: 'Mid Lot' }] }] };
  w.delayMs = 300;
  await open(page, w, { crew: true, held: null });
  await addTyped(page, [['a', 'South walk'], ['b', 'North walk']]);
  await page.clock.runFor(500);
  await expect.poll(() => [].concat(...w.calls.map((c) => c.texts)).length).toBe(6);
  await expect.poll(() => page.evaluate(() => window.SnowEsTyped.pending())).toEqual({ queued: 0, inflight: 0 });
  const asked = [].concat(...w.calls.map((c) => c.texts));
  expect([...asked].sort()).toEqual(['2 bags', 'Ice by the door', 'North walk', 'Salt the ramp', 'South walk', 'Sweep the steps']);
  expect(w.maxOut).toBe(1);
  await expect(page.locator('#b')).toHaveText('[ES] North walk');
});

test('typed words: three misses are ONE translate call 400 ms later, and all three are patched', async ({ page }) => {
  const w = world();
  await open(page, w);
  await addTyped(page, [['a', 'Salt the ramp'], ['b', 'Ice by the door'], ['c', 'Back steps']]);
  // before the 400 ms debounce: still English, nothing asked
  await expect(page.locator('#a')).toHaveText('Salt the ramp');
  expect(w.calls.length).toBe(0);
  await page.clock.runFor(500);
  await expect(page.locator('#c')).toHaveText('[ES] Back steps');
  expect(w.calls.length).toBe(1);
  expect(w.calls[0].lang).toBe('es');
  expect([...w.calls[0].texts].sort()).toEqual(['Back steps', 'Ice by the door', 'Salt the ramp']);
  await expect(page.locator('#a')).toHaveText('[ES] Salt the ramp');
  await expect(page.locator('#b')).toHaveText('[ES] Ice by the door');
});

test('typed words: two elements with the same text are both patched from one answer (asked once)', async ({ page }) => {
  const w = world();
  await open(page, w);
  await addTyped(page, [['a', 'Ice by the door'], ['b', 'Ice by the door']]);
  await page.clock.runFor(500);
  await expect(page.locator('#b')).toHaveText('[ES] Ice by the door');
  await expect(page.locator('#a')).toHaveText('[ES] Ice by the door');
  expect(w.calls.map((c) => c.texts)).toEqual([['Ice by the door']]);
});

test('typed words: no signal: the English stays, never blank, no "Not saved", no toast', async ({ page }) => {
  const w = world();
  w.mode = 'offline';
  await open(page, w);
  await addTyped(page, [['a', 'Salt the ramp']]);
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1);
  await page.clock.runFor(1000);
  await expect(page.locator('#a')).toHaveText('Salt the ramp');
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.getByText('Not saved')).toHaveCount(0);
});

test('typed words: a line answered "later" is asked again after 60 s, at most 3 more times', async ({ page }) => {
  const w = world();
  w.later = () => true;
  await open(page, w);
  await addTyped(page, [['a', 'Salt the ramp']]);
  // ask 1 at 0.4 s; retries at about 60.4 s, 120.8 s, 181.2 s (60 s, then the 400 ms debounce); never a 5th ask
  // (each reply is read before the clock moves on: the retry is timed from when the "later" lands)
  const settled = () => expect.poll(() => page.evaluate(() => window.SnowEsTyped.pending().inflight)).toBe(0);
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1); await settled();
  for (let n = 2; n <= 4; n++) { await page.clock.runFor(61000); await expect.poll(() => w.calls.length).toBe(n); await settled(); }
  await page.clock.runFor(61000); await page.clock.runFor(61000);
  expect(w.calls.length).toBe(4);
  await expect(page.locator('#a')).toHaveText('Salt the ramp');
});

test('typed words: a line refused is never asked again this session, and stays English', async ({ page }) => {
  const w = world();
  w.refused = () => true;
  await open(page, w);
  await addTyped(page, [['a', 'Wash the truck']]);
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.SnowEsTyped.pending().inflight)).toBe(0);
  await addTyped(page, [['b', 'Wash the truck']]);      // a second copy of it on screen later
  await page.clock.runFor(61000);
  expect(w.calls.length).toBe(1);
  await expect(page.locator('#b')).toHaveText('Wash the truck');
});

test('typed words: a translation holding <b>x</b> & y shows those characters, never parsed as HTML', async ({ page }) => {
  const w = world();
  w.answer = () => '<b>x</b> & y';
  await open(page, w);
  await addTyped(page, [['a', 'Bold note']]);
  await page.clock.runFor(500);
  await expect(page.locator('#a')).toHaveText('<b>x</b> & y');
  expect(await page.locator('#a').evaluate((el) => el.innerHTML)).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
  await expect(page.locator('#a b')).toHaveCount(0);
});

test('typed words: an edited note shows the new English, then asks for it; the old Spanish never comes back', async ({ page }) => {
  const w = world();
  await open(page, w, { held: { es: { 'Sidewalk north': 'Banqueta norte', 'Old note': 'Nota vieja' }, en: {} } });
  await addTyped(page, [['a', 'Old note']]);
  await expect(page.locator('#a')).toHaveText('Nota vieja');
  // the note is edited: a redraw puts the new English in the same element
  await page.locator('#a').evaluate((el) => { el.textContent = 'New note'; });
  await expect(page.locator('#a')).toHaveText('New note');
  await page.clock.runFor(500);
  await expect(page.locator('#a')).toHaveText('[ES] New note');
  // one call, in the order the lines were shown: 'Old note' (held, shown for a moment: the session's one check of it, final
  // review C1) then 'New note' (a miss). The answer for 'Old note' never reaches #a: it now holds 'New note'.
  expect(w.calls.map((c) => c.texts)).toEqual([['Old note', 'New note']]);
});

test('typed words: an English phone leaves a zone name alone and asks for a crew Problem note in English', async ({ page }) => {
  const w = world();
  await open(page, w, { lang: 'en', held: null });
  await addTyped(page, [['z', 'Sidewalk north'], ['p', 'Hielo en la puerta', true]]);
  await page.clock.runFor(500);
  await expect(page.locator('#p')).toHaveText('[EN] Hielo en la puerta');
  await expect(page.locator('#z')).toHaveText('Sidewalk north');
  expect(w.calls.map((c) => [c.lang, c.texts])).toEqual([['en', ['Hielo en la puerta']]]);
});

test('typed words: a tap on a translated note shows the English for 4 s, a second tap puts the Spanish back at once', async ({ page }) => {
  const w = world();
  await open(page, w);
  await addTyped(page, [['z', 'Sidewalk north']]);
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  await page.locator('#z').click();
  await expect(page.locator('#z')).toHaveText('Sidewalk north');
  await page.clock.runFor(3900);
  await expect(page.locator('#z')).toHaveText('Sidewalk north');
  await page.clock.runFor(200);
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  await page.locator('#z').click();
  await expect(page.locator('#z')).toHaveText('Sidewalk north');
  await page.locator('#z').click();
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  // the one call is the session's check of the held line (the tab answered the same Spanish)
  expect(w.calls.map((c) => c.texts)).toEqual([['Sidewalk north']]);
});

test('typed words: EN puts every typed element back to its English; ES shows the Spanish again, with no call', async ({ page }) => {
  const w = world();
  await open(page, w);
  await addTyped(page, [['z', 'Sidewalk north']]);
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  // first the session's one check of the held line (final review C1): one call, then nothing out
  await page.clock.runFor(500);
  await expect.poll(() => w.calls.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.SnowEsTyped.pending().inflight)).toBe(0);
  await page.click('#langWrap [data-lang="en"]');
  await expect(page.locator('#z')).toHaveText('Sidewalk north');
  await expect(page.locator('#z')).not.toHaveAttribute('data-typed-shown', '');
  await page.click('#langWrap [data-lang="es"]');
  await expect(page.locator('#z')).toHaveText('Banqueta norte');
  // the flips themselves ask nothing
  await page.clock.runFor(1000);
  expect(w.calls.length).toBe(1);
});

test('typed words: an answer is kept on the phone, and sign-out wipes it', async ({ page }) => {
  const w = world();
  await open(page, w);
  await addTyped(page, [['a', 'Salt the ramp']]);
  await page.clock.runFor(500);
  await expect(page.locator('#a')).toHaveText('[ES] Salt the ramp');
  const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(kept.es['Salt the ramp']).toBe('[ES] Salt the ramp');
  expect(kept.es['Sidewalk north']).toBe('Banqueta norte');
  await page.click('#signout');
  await expect(page.locator('#si_who')).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(null);
});

test("typed words: right after sign-in a Spanish phone asks for its own route's lines first, then the rest", async ({ page }) => {
  // Jordan (C03) is on R2 in tonight's Post; R2 = S2. Lines per site in order: notes, materials needed, then each zone's
  // name and note. S2: notes "Sweep the steps", zone "South walk" -> the first call is exactly those two.
  // S1 (the rest): notes "Salt the ramp", materials "2 bags", zone "North walk", its note "Ice by the door" -> the second call.
  // Nothing is held (no snow-es-typed), and no element is on screen asking.
  const w = world();
  w.sites = [{ id: 'S1', name: 'Big Clinic', notes: 'Salt the ramp', materials_needed: '2 bags', rev: 1 },
    { id: 'S2', name: 'Mid Lot', notes: 'Sweep the steps', materials_needed: '', rev: 1 }];
  w.zones = [{ id: 'Z1', site_id: 'S1', name: 'North walk', type: 'sidewalk', note: 'Ice by the door', rev: 1 },
    { id: 'Z2', site_id: 'S2', name: 'South walk', type: 'sidewalk', note: '', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  w.post = { id: 'P-1', shift: 'night-2026-12-04', posted_at: '2026-12-04T20:00:00.000-09:00',
    people: { C03: { name: 'Jordan Demo' } },
    routes: [{ id: 'R1', name: 'N1', lead: null, members: [], sites: [{ id: 'S1', name: 'Big Clinic' }] },
      { id: 'R2', name: 'N2', lead: null, members: ['C03'], sites: [{ id: 'S2', name: 'Mid Lot' }] }] };
  await open(page, w, { crew: true, held: null });
  await expect.poll(() => w.calls.length).toBe(2);
  expect(w.calls.map((c) => [c.lang, c.texts])).toEqual([['es', ['Sweep the steps', 'South walk']],
    ['es', ['Salt the ramp', '2 bags', 'North walk', 'Ice by the door']]]);
});

test('typed words: an English phone prefetches nothing at sign-in', async ({ page }) => {
  const w = world();
  w.sites = [{ id: 'S1', name: 'Big Clinic', notes: 'Salt the ramp', materials_needed: '', rev: 1 }];
  await open(page, w, { lang: 'en', held: null });
  await page.clock.runFor(2000);
  expect(w.calls.length).toBe(0);
});
