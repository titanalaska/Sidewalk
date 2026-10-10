const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');

// Inventory: names and status only, like the real getProfiles (no PINs).
const PROFILES = [
  { id: 1, name: 'Matthew', status: 'approved', hasPin: true },
  { id: 3, name: 'Jordan Demo', status: 'approved', hasPin: true },
  { id: 4, name: 'Nina Nursery', status: 'approved', hasPin: true },
  { id: 6, name: 'New Ned', status: 'approved', hasPin: false },
  { id: 9, name: 'Pending Pat', status: 'pending', hasPin: true },
];
const TOKENS = { 'tok-matt': 'admin', 'tok-jordan': 'crew', 'tok-alex': 'lead' };

// A small fake of the snow backend, with the real reply shapes.
function fakeSnow(state, opts = {}) {
  return (body) => {
    const v = { version: opts.version || 'curbs-1' };
    if (opts.expired && opts.expired.on) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    // Roster self-service (10/6/26): the real backend's rules for one's own card (snow-app-script
    // saveMyCard_, test/api.test.js). Nina is approved in Inventory and not on the roster: her save
    // makes a pending card (an id past the highest, never the count); until Matt's Add to crew every
    // other action answers pending_card with the self view. Crew and leads edit their own live record.
    // roster-2 (10/7/26): cold_rated and the emergency contact are theirs; smokes is Matt's alone.
    // roster-3 (10/8/26): home_area (valley | anchorage), theirs to say.
    const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
    const selfView = (c) => ({ id: c.id, name: c.name, pending: c.pending === true, ...Object.fromEntries(SELF.map((k) => [k, c[k] === undefined ? null : c[k]])) });
    const applySelf = (stored, card) => ({ ...stored, ...Object.fromEntries(SELF.filter((k) => card && card[k] !== undefined).map((k) => [k, card[k]])) });
    const refuseCard = (card) => {
      if (typeof card.photo_thumb === 'string' && card.photo_thumb.length > 30000) return 'That picture is too big';
      if (card.seasons != null && !(Number.isInteger(card.seasons) && card.seasons >= 0)) return 'Seasons must be a whole number';
      return null;
    };
    const nina = () => state.crew.find((c) => String(c.profile_id) === '4' && !c.archived);
    if (body.token === 'tok-nina') {
      const mine = nina();
      if (body.action === 'saveMyCard') {
        const card = body.card || {}, why = refuseCard(card);
        if (why) return { ok: false, code: 'invalid', reason: why, ...v };
        if (mine) { Object.assign(mine, applySelf(mine, card), { rev: mine.rev + 1 }); return { ok: true, card: selfView(mine), pending: mine.pending === true, ...v }; }
        const max = state.crew.reduce((m, c) => Math.max(m, Number((/^C(\d+)$/.exec(c.id) || [0, 0])[1])), 0);
        const rec = applySelf({ id: 'C' + String(max + 1).padStart(2, '0'), name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, archived: false }, card);
        state.crew.push(rec);
        return { ok: true, card: selfView(rec), pending: true, ...v };
      }
      if (mine && mine.pending) return { ok: false, code: 'pending_card', name: 'Nina Nursery', reason: 'Your card is in. Matt will add you to the crew.', card: selfView(mine), ...v };
      if (!mine) return { ok: false, code: 'not_on_roster', name: 'Nina Nursery', reason: "You're signed in, but not on the snow crew yet. Ask Matt to add you.", ...v };
    }
    const role = body.token === 'tok-nina' ? 'crew' : TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    // Matt is not on the roster; Alex (C01) is the lead on the roster, Jordan (C03) crew.
    const me = body.token === 'tok-nina' ? { name: 'Nina Nursery', role: 'crew', crew_id: nina().id }
      : { name: role === 'admin' ? 'Matthew' : role === 'lead' ? 'Alex Test' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : role === 'lead' ? 'C01' : 'C03' };
    state.moves = state.moves || []; state.callouts = state.callouts || []; state.gear = state.gear || []; state.posts = state.posts || [];
    const own = () => state.crew.find((c) => c.id === me.crew_id) || { id: me.crew_id, name: me.name };
    if (body.action === 'saveMyCard') {
      if (role === 'admin') return { ok: false, code: 'invalid', reason: 'An admin sign-in has no crew card', ...v };
      const card = body.card || {}, why = refuseCard(card);
      if (why) return { ok: false, code: 'invalid', reason: why, ...v };
      const rec = own();
      Object.assign(rec, applySelf(rec, card), { rev: (rec.rev || 0) + 1 });
      return { ok: true, card: selfView(rec), pending: false, ...v };
    }
    if (body.action === 'bootstrap') {
      // Crew and leads never receive a pending card; Matt gets them whole.
      const crew = role === 'admin' ? state.crew : state.crew.filter((c) => c.pending !== true).map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: !!c.is_lead }));
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones || [], crew, post: state.posts.at(-1) || null, ...v };
      if (role === 'admin') Object.assign(out, { moves: state.moves, callouts: state.callouts, gear: state.gear });
      else out.card = selfView(own());   // one's own card, the self view (never the record)
      return out;
    }
    // Pairings: the real backend's shapes (snow-app-script test/pairing.test.js).
    if (['getBoard', 'addMove', 'addGear', 'saveCallout', 'post'].includes(body.action) && role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
    if (body.action === 'getPost') return { ok: true, post: state.posts.at(-1) || null, ...v };
    // The real getZones: Matt gets archived zones too, everyone else live ones; site_id narrows it.
    if (body.action === 'getZones') {
      const zones = (state.zones || []).filter((z) => role === 'admin' || z.archived !== true).filter((z) => !body.site_id || z.site_id === body.site_id);
      return { ok: true, zones, ...v };
    }
    if (body.action === 'getBoard') return { ok: true, moves: state.moves, callouts: state.callouts, gear: state.gear, post: state.posts.at(-1) || null, ...v };
    if (body.action === 'addMove' || body.action === 'addGear') {
      const list = body.action === 'addMove' ? state.moves : state.gear;
      const rec = { ...body.record, id: (body.action === 'addMove' ? 'M' : 'G') + (list.length + 1), rev: 1 };
      list.push(rec);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'saveCallout') {
      const rec = { ...body.record, id: body.record.shift, rev: (body.record.rev || 0) + 1 };
      state.callouts = state.callouts.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'post') {
      const B = require('../lib/board.js'), H = require('../lib/history.js');
      const live = state.routes.filter((r) => !r.archived);
      const byId = Object.fromEntries(state.crew.map((c) => [c.id, c]));
      const board = B.boardFrom(state.moves, live, byId);
      const people = Object.fromEntries(state.crew.filter((c) => !c.archived).map((c) => {
        const w = H.shiftsWorked(state.callouts, c.id);
        return [c.id, { name: c.name, phone: c.phone || null, shifts: { night: w.night, day: w.day } }];
      }));
      const rec = { id: 'P' + (state.posts.length + 1), rev: 1, shift: body.shift, posted_at: new Date().toISOString(), people,
        routes: live.map((r) => ({ id: r.id, name: r.name, sites: (r.site_ids || []).map((id) => ({ id, name: (state.sites.find((s) => s.id === id) || {}).name })),
          lead: board.routes[r.id].lead, members: board.routes[r.id].members })) };
      state.posts.push(rec);
      return { ok: true, record: rec, ...v };
    }
    // The shift log: the real backend's reply shapes (snow-app-script test/shiftlog-api.test.js).
    // Rows are only ever appended; seq is the row's place in its tab. Crew and
    // lead rows are allow-listed (no by_profile, undoes null); Matt's are raw
    // (by_profile present, no undoes key on a tap). Refusals are {ok:false, code, reason}.
    if (['getShiftLog', 'tapZone', 'undoTap', 'stormAction', 'saveVisit', 'cleanAgain', 'depthNow', 'handOff'].includes(body.action)) {
      const SL = require('../lib/shiftlog.js');
      state.log = state.log || []; state.storms = state.storms || []; state.visits = state.visits || [];
      const stamp = state.clock || '2026-10-03T07:50:18.445-08:00';
      const view = (row) => {
        if (role !== 'admin') return row;
        const { undoes, ...raw } = row;
        return { ...raw, by_profile: 'P1', ...(undoes ? { undoes } : {}) };
      };
      // Storms rows reach crew and leads through the server's allow-list (snow-app-script roster.js
      // PUBLIC_STORM_FIELDS, publicRow): a missing field is null, so a start row carries shift_id: null and
      // a handoff row loses its truck_seq and by_profile. Matt gets the whole row. The list is
      // test/storm-fields.js, checked against the backend's own by test/storm-fields.test.js.
      const STORM_FIELDS = require('./storm-fields.js');
      const stormView = (row) => (role === 'admin' ? { by_profile: 'P1', ...row } : Object.fromEntries(STORM_FIELDS.map((k) => [k, row[k] === undefined ? null : row[k]])));
      const refuse = (code, reason) => ({ ok: false, code, reason, ...v });
      if (body.action === 'getShiftLog') {
        const out = { ok: true, cursor: {}, reset: {}, ...v };
        // Route sheets (snow-app-script test/routesheet-api.test.js): trucks go to everyone (admin
        // rows are whole rows); the Sheets tab is Matt's only. A non-admin gets [] / cursor 0 / reset false.
        state.trucks = state.trucks || []; state.sheets = state.sheets || [];
        const tview = (row) => (role === 'admin' ? { ...row, by_profile: 'P1', rev: 1, archived: false } : row);
        [['log', state.log], ['storms', state.storms], ['visits', state.visits], ['trucks', state.trucks], ['sheets', role === 'admin' ? state.sheets : []]].forEach(([t, rows]) => {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0)), last = (body.last || {})[t];
          let reset = cur > rows.length;
          if (!reset && cur >= 1 && last != null && Number(rows[cur - 1].seq) !== Number(last)) reset = true;
          out[t] = rows.slice(reset ? 0 : cur).map(t === 'trucks' ? tview : t === 'sheets' ? (x) => x : t === 'storms' ? stormView : view);
          out.cursor[t] = rows.length;
          out.reset[t] = reset;
        });
        // Posts (final review I1): Matt's poll carries every Post after his cursor, slimmed to what a sheet's
        // crew line reads (snow-app-script slimPost_): no phones, no shift counts, no site lists. Posts rows
        // have no seq, so only the cursor counts. Everyone else: none, cursor 0.
        if (role === 'admin') {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {}).posts) || 0)), reset = cur > state.posts.length;
          out.posts = state.posts.slice(reset ? 0 : cur).map((p) => ({ id: p.id, shift: p.shift, posted_at: p.posted_at,
            people: Object.fromEntries(Object.entries(p.people || {}).map(([id, x]) => [id, { name: String((x || {}).name || '') }])),
            routes: (p.routes || []).map((r) => ({ id: r.id, lead: r.lead || null, members: (r.members || []).slice(), truck: r.truck === undefined ? null : r.truck })) }));
          out.cursor.posts = state.posts.length; out.reset.posts = reset;
        } else { out.posts = []; out.cursor.posts = 0; out.reset.posts = false; }
        return out;
      }
      const storm = SL.stormState(state.storms);
      if (body.action === 'stormAction') {
        if (role === 'crew') return refuse('forbidden', 'Only Matt can do that.');
        const kind = body.kind;
        if (!['start', 'end', 'reopen', 'snowing', 'stopped', 'night_on'].includes(kind)) return refuse('invalid', 'Unknown storm control');
        if (kind === 'start' && storm.open) return refuse('invalid', 'End the storm first');
        if (kind === 'reopen' && storm.open) return refuse('invalid', 'The storm is already open');
        if (kind === 'reopen' && !storm.storm_id) return refuse('invalid', 'There is no storm to reopen');
        if (!['start', 'reopen'].includes(kind) && !storm.open) return refuse('invalid', 'No storm is open');
        const n = state.storms.length + 1, id = 'ST-' + n;
        const row = { id, seq: n, kind, storm_id: kind === 'start' ? id : storm.storm_id, at: stamp, by_name: me.name };
        state.storms.push(row);
        return { ok: true, record: stormView(row), ...v };
      }
      // Hand off now (snow-app-script handOffNow_, 10/5/26): Matt or a Board lead. Refused, in this order:
      // no storm open; the server's own shift is not a night; no real tap that night in this storm (an undo,
      // a tap whose undo stands, a '*' row are not work); this night already handed off. The mark carries the
      // newest seq of Log, Visits and Trucks, and the night's routes frozen (CrewHandoff.nightRouteIds).
      if (body.action === 'handOff') {
        const HO = require('../lib/handoff.js'), RS = require('../lib/routesheet.js');
        if (role === 'crew') return refuse('forbidden', "Only Matt or a route lead on tonight's Board can do that.");
        if (!storm.open) return refuse('invalid', 'No storm is open');
        const shift = SL.shiftFor(stamp, state.storms);
        if (shift.indexOf('night-') !== 0) return refuse('invalid', "It isn't night shift");
        const stormLog = state.log.filter((r) => r.storm_id === storm.storm_id);
        if (!SL.realTaps(stormLog).some((r) => r.shift_id === shift)) return refuse('invalid', 'Nothing to hand off yet');
        const already = HO.newestHandoff(state.storms.filter((r) => r.shift_id === shift), storm.storm_id);
        if (already) return refuse('invalid', 'Already handed off at ' + RS.clock(String(already.at)));
        const top = (rows) => (rows || []).reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0), n = state.storms.length + 1;
        const mark = { id: 'ST-' + n, seq: n, kind: 'handoff', storm_id: storm.storm_id, shift_id: shift, at: stamp, by_name: me.name,
          by_profile: role === 'admin' ? 'P1' : 'P2', log_seq: top(state.log), visit_seq: top(state.visits), truck_seq: top(state.trucks) };
        mark.night_routes = HO.nightRouteIds({ storm_id: storm.storm_id, routes: state.routes, posts: state.posts, storms: state.storms,
          log: stormLog, visits: state.visits, trucks: state.trucks || [] }, mark);
        state.storms.push(mark);
        return { ok: true, record: stormView(mark), ...v };
      }
      if (!storm.open) return refuse('invalid', 'No storm is open');
      // An undo names only the row (seq); a tap or a card names a site.
      if (body.action !== 'undoTap' && !state.sites.find((s) => s.id === body.site_id && !s.archived)) return refuse('invalid', 'Unknown site');
      if (body.action === 'saveVisit') {
        const n = state.visits.length + 1, eq = { blower: '', snowrator: '', bobcat: '', sweepster: '', ...(body.equipment || {}) };
        // by_key is the crew id, or 'admin' for Matt (who is not on the roster): the server's rule.
        const row = { id: 'V-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, by_key: me.crew_id || 'admin', by_name: me.name, at: stamp,
          depth_in: body.depth_in === undefined ? '' : body.depth_in, materials_used: body.materials_used || '', equipment: eq };
        state.visits.push(row);
        return { ok: true, record: view(row), ...v };
      }
      const n = state.log.length + 1;
      let row;
      // Clean again (Part B1): the server's rules -- Matt or a lead; something done in the current pass first.
      if (body.action === 'cleanAgain') {
        if (role === 'crew') return refuse('forbidden', "Only Matt or a route lead on tonight's Board can do that.");
        const why = SL.checkAgain(state.log, storm.storm_id, body.site_id);
        if (why) return refuse('invalid', why);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, zone_id: '*',
          state: 'again', note: '', by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: null };
      } else if (body.action === 'depthNow') {
        // New snow (Part B2): the server's rules (snow-app-script depthNow_) -- Matt or a lead; a JSON number 0 to 60.
        if (role === 'crew') return refuse('forbidden', "Only Matt or a route lead on tonight's Board can do that.");
        const d = body.depth_in;
        if (typeof d !== 'number' || !isFinite(d) || d < 0 || d > 60) return refuse('invalid', 'Depth is 0 to 60 inches');
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, zone_id: '*',
          state: 'depth', depth_in: d, note: '', by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: null };
      } else if (body.action === 'tapZone') {
        const walk = SL.walksFor(body.site_id, state.zones || []).find((w) => w.zone_id === body.zone_id);
        if (!walk) return refuse('invalid', 'That zone is not walked at this site');
        const why = SL.checkTap({ walk, state: body.state, note: body.note });
        if (why) return refuse('invalid', why);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: body.site_id, zone_id: body.zone_id,
          state: body.state, note: String(body.note || ''), by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false,
          // The server sets this from the switch: Treated while Snowing is saved, flagged.
          snowing_warned: body.state === 'treated' && storm.snowing, undoes: null };
      } else {
        const t = SL.undoTarget(state.log, storm.storm_id, body.seq);
        if (!t.ok) return refuse('conflict', t.reason);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', site_id: t.row.site_id, zone_id: t.row.zone_id,
          state: t.state, note: t.note, by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false, snowing_warned: false, undoes: t.row.id };
      }
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
    }
    // setTruck and retrySheets: the real reply shapes (snow-app-script reports for tasks 2 and 3).
    // setTruck: the server stamps who and when. The shift (final review C1): Matt names it and it must be one
    // on offer now (CrewTime.shiftChoices), else "Pick a shift"; a lead's is always the server's own shiftFor,
    // whatever is sent. A lead may set only the route the live Board has them leading. Crew never.
    if (body.action === 'setTruck') {
      const SL = require('../lib/shiftlog.js'), B = require('../lib/board.js'), T = require('../lib/time.js');
      if (role === 'crew') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const truck = typeof body.truck === 'string' ? body.truck.trim() : '';
      if (truck.length < 1 || truck.length > 20) return { ok: false, code: 'invalid', reason: 'A truck is 1 to 20 characters', ...v };
      const route = state.routes.find((r) => r.id === body.route_id && !r.archived);
      if (!route) return { ok: false, code: 'invalid', reason: 'Unknown route', ...v };
      if (role === 'lead') {
        const board = B.boardFrom(state.moves, state.routes.filter((r) => !r.archived), Object.fromEntries(state.crew.map((c) => [c.id, c])));
        if (board.routes[route.id].lead !== me.crew_id) return { ok: false, code: 'forbidden', reason: "Only Matt or that route's lead can set its truck.", ...v };
      }
      state.trucks = state.trucks || [];
      const stamp = state.clock || '2026-10-03T07:50:18.445-08:00', n = state.trucks.length + 1;
      if (role === 'admin' && !T.shiftChoices(stamp).includes(String(body.shift || ''))) return { ok: false, code: 'invalid', reason: 'Pick a shift', ...v };
      const row = { id: 'T-' + n, seq: n, route_id: route.id, shift_id: role === 'admin' ? body.shift : SL.shiftFor(stamp, state.storms || []), truck,
        by_key: me.crew_id || 'admin', by_name: me.name, at: stamp };
      state.trucks.push(row);
      const record = role === 'admin' ? { ...row, by_profile: 'P1', rev: 1, archived: false } : row;
      return { ok: true, record, ...v };
    }
    if (body.action === 'retrySheets') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      return { ...(opts.retryReply || { ok: true, storm_id: body.storm_id, failed: 1, owed: 1, scheduled: true }), ...v };
    }
    if (/^archive/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      const tab = { archiveCrew: 'crew', archiveSite: 'sites', archiveRoute: 'routes', archiveZone: 'zones' }[body.action];
      const cur = (state[tab] || []).find((x) => x.id === body.id);
      if (!cur) return { ok: false, code: 'invalid', reason: 'Nothing to archive.', ...v };
      const rec = { ...cur, archived: true, rev: cur.rev + 1 };
      state[tab] = state[tab].filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (/^save/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only Matt can do that.', ...v };
      if (opts.saveReply) return { ...opts.saveReply, ...v };
      const tab = { saveCrew: 'crew', saveSite: 'sites', saveRoute: 'routes', saveZone: 'zones' }[body.action];
      state[tab] = state[tab] || [];
      // The real site checks (snow-app-script roster.js validate), word for word, joined with '; '.
      if (tab === 'sites') {
        const r = body.record, errs = [];
        if (r.callout_in != null && !(typeof r.callout_in === 'number' && r.callout_in > 0 && r.callout_in <= 24)) errs.push('Callout depth is inches, more than 0 and at most 24');
        if (r.day_rank != null && !(Number.isInteger(r.day_rank) && r.day_rank >= 1 && r.day_rank <= 99)) errs.push('Day rank is a whole number from 1 to 99');
        if (errs.length) return { ok: false, code: 'invalid', reason: errs.join('; '), ...v };
      }
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      // The real saveSite: a site is saved with both unit keys (missing = blank, trimmed, text).
      if (tab === 'sites') rec.units = { bobcat: String(((body.record.units || {}).bobcat) || '').trim(), snowrator: String(((body.record.units || {}).snowrator) || '').trim() };
      // A fresh id per new record, as the real backend does (one fixed id let a
      // second new zone overwrite the first and hid nothing until the import test).
      if (!rec.id) rec.id = (tab === 'crew' ? 'C' : 'X') + (90 + (state._made = (state._made || 0) + 1));
      state[tab] = state[tab].filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'unknown action', ...v };
  };
}
const world = () => ({
  crew: [{ id: 'C01', name: 'Alex Test', phone: '555-0101', is_lead: true, rev: 1, profile_id: '2', weaknesses: 'slow starter' },
    { id: 'C03', name: 'Jordan Demo', phone: '555-0103', is_lead: false, rev: 1, profile_id: '3' }],
  sites: [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 }],
  routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
});

// delay: { action: ms } holds that action's reply; abortIf(body) drops a call
// the way a lost signal does (the call is still recorded first); hangIf(body)
// never answers it at all (Apps Script stuck, or a dead zone that never errors).
async function open(page, { token, snow, inv, abortSnow, clockAt, delay, abortIf, hangIf } = {}) {
  const calls = [];
  calls.inv = [];   // Inventory calls, apart (approve / reject carry Matt's token)
  // Shift choices depend on the wall clock: pin it, never trust the test's hour.
  if (clockAt) await page.clock.install({ time: new Date(clockAt) });
  await page.route(isSnow, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ body, contentType: req.headers()['content-type'], method: req.method() });
    if (abortSnow || (abortIf && abortIf(body))) return route.abort();
    if (hangIf && hangIf(body)) return; // never fulfilled: only the page's own timeout ends it
    if (delay && delay[body.action]) await new Promise((r) => setTimeout(r, delay[body.action]));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, async (route) => {
    const p = Object.fromEntries(new URL(route.request().url()).searchParams);
    calls.inv.push(p);
    const out = inv ? inv(p) : p.action === 'getProfiles' ? { profiles: PROFILES } : {};
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  if (token) await page.addInitScript((t) => localStorage.setItem('titan-snow-token', t), token);
  await page.goto(PAGE);
  return calls;
}

// ---------- Share (Matt, 10/5/26: text the app to future workers) ----------
// The page here is file://…/index.html, nowhere near the real address: whatever is
// shared must still be exactly https://titanalaska.github.io/Sidewalk/.
const APP_URL = 'https://titanalaska.github.io/Sidewalk/';
// sheet: 'ok' | 'cancel' | 'refuse' | null (no share sheet); clip: true | false (clipboard works) | null (none)
async function stubShare(page, sheet, clip) {
  await page.addInitScript(([sheet, clip]) => {
    window.__shared = []; window.__copied = [];
    const def = (k, v) => Object.defineProperty(navigator, k, { value: v, configurable: true });
    def('share', sheet === null ? undefined : async (d) => {
      window.__shared.push(d);
      if (sheet === 'cancel') throw new DOMException('cancelled', 'AbortError');
      if (sheet === 'refuse') throw new DOMException('no', 'NotAllowedError');
    });
    def('clipboard', clip === null ? undefined : { writeText: async (t) => { if (!clip) throw new Error('blocked'); window.__copied.push(t); } });
  }, [sheet, clip]);
}

test('Share is on the sign-in screen and sends the fixed app address, never this page', async ({ page }) => {
  await stubShare(page, 'ok', true);
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#share')).toBeVisible();
  await page.click('#share');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const d = await page.evaluate(() => window.__shared[0]);
  expect(d.url).toBe(APP_URL);
  expect(d.text).toContain('Request access');
  expect(await page.evaluate(() => window.__copied.length)).toBe(0); // the sheet took it: nothing copied
});

test('Share is in the top bar once signed in, for crew and for Matt', async ({ page }) => {
  await stubShare(page, 'ok', true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('#who')).toContainText('Jordan');
  await expect(page.locator('#share')).toBeVisible();
  await page.click('#share');
  await expect.poll(() => page.evaluate(() => window.__shared.map((d) => d.url))).toEqual([APP_URL]);
});

test('backing out of the share sheet copies nothing and says nothing', async ({ page }) => {
  await stubShare(page, 'cancel', true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  await page.waitForTimeout(200); // a wrong fallback would copy right after the sheet's reply
  expect(await page.evaluate(() => window.__copied.length)).toBe(0);
  await expect(page.locator('#toast')).toBeHidden();
});

test('no share sheet: the message and the fixed address are copied, and it says so', async ({ page }) => {
  await stubShare(page, null, true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Link copied');
  const c = await page.evaluate(() => window.__copied);
  expect(c).toHaveLength(1);
  expect(c[0].endsWith(' ' + APP_URL)).toBe(true);
});

test('nothing to share or copy with: the link shows on screen to copy by hand', async ({ page }) => {
  await stubShare(page, null, false);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect(page.locator('#sharetext')).toBeVisible();
  expect(await page.locator('#sharetext').inputValue()).toContain(APP_URL);
  await page.click('#dlgClose');
  await expect(page.locator('#sharetext')).toBeHidden();
});

test('the top bar still fits a small phone with Share in it (Matt signed in, the longest badge)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('#signout')).toBeVisible();
  for (const id of ['#share', '#signout']) {
    const b = await page.locator(id).boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(360); // on screen, not pushed off the right edge
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('signed out shows the sign-in screen; pending people can find their name', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  const names = await page.locator('#si_who option').allTextContents();
  expect(names).toEqual(['Choose your name', 'Jordan Demo', 'Matthew', 'New Ned', 'Nina Nursery', 'Pending Pat (waiting for approval)']);
});

test('a good PIN signs in, stores the token and lands on Tonight', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()),
    inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : p.action === 'verifyPin' && p.id === '3' && p.pin === '3333' ? { valid: true, success: true, id: 3, name: 'Jordan Demo', status: 'approved', token: 'tok-jordan' } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '3333');
  await page.click('#si_go');
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toContainText('PAC');
  expect(await page.evaluate(() => localStorage.getItem('titan-snow-token'))).toBe('tok-jordan');
  const boot = calls.find((c) => c.body.action === 'bootstrap');
  expect(boot.method).toBe('POST');
  expect(boot.contentType).toMatch(/^text\/plain/);
  expect(boot.body.token).toBe('tok-jordan');
});

test('a wrong PIN says how many tries are left', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()), inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '0000');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toHaveText('Wrong PIN. 4 tries left.');
});

test('approved in Inventory but not on the snow roster gets its own screen, with the card to fill out', async ({ page }) => {
  await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await expect(page.locator('#notroster')).toContainText('Nina Nursery');
  await expect(page.locator('#notroster')).toContainText('Fill out your card and Matt will add you');
  await expect(page.locator('#fillCard')).toBeVisible();
  await expect(page.locator('#tabs')).toBeHidden();
});

test('an expired session goes back to sign-in and forgets the token', async ({ page }) => {
  await open(page, { token: 'tok-old', snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  expect(await page.evaluate(() => localStorage.getItem('titan-snow-token'))).toBeNull();
});

test('a backend version mismatch warns', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world(), { version: 'foundation-0' }) });
  // Visible, not just present: the banner's text is in the page even while hidden.
  await expect(page.locator('#verwarn')).toBeVisible();
  await expect(page.locator('#verwarn')).toContainText('Backend out of date');
});

test('a matching backend version shows no warning', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(page.locator('#verwarn')).toBeHidden();
});

test('no network on load is said plainly, with a retry', async ({ page }) => {
  await open(page, { token: 'tok-jordan', abortSnow: true });
  await expect(page.locator('main')).toContainText("Couldn't reach the server");
  await expect(page.locator('#retry')).toBeVisible();
});

test('crew see routes and sites but no roster or edit buttons', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="roster"]')).toHaveCount(0);
  await expect(page.locator('[data-edit]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('slow starter');
});

test('admin sees roster, sites and routes, with the private fields', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="roster"]')).toBeVisible();
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg')).toContainText('slow starter');
});

test('an admin save sends the revision and shows the saved record', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.fill('#f_phone', '555-0199');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const save = calls.find((c) => c.body.action === 'saveCrew');
  expect(save.body.record).toMatchObject({ id: 'C03', rev: 1, phone: '555-0199' });
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg')).toContainText('555-0199');
});

test('a conflict says reload and does not show the edit as saved', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { saveReply: { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.' } }) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.fill('#f_phone', '555-0199');
  await page.click('#f_save');
  await expect(page.locator('#f_err')).toContainText('Someone changed this');
  await page.keyboard.press('Escape');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg')).toContainText('555-0103');
  await expect(page.locator('#dlg')).not.toContainText('555-0199');
});

test('the sign-in picker on a roster record lists approved Inventory names', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  const opts = await page.locator('#f_profile option').allTextContents();
  expect(opts).toEqual(['No sign-in yet', 'Jordan Demo', 'Matthew', 'New Ned', 'Nina Nursery']);
  expect(await page.locator('#f_profile').inputValue()).toBe('3');
});

test('a photo becomes a small thumbnail in the record', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 1200, 900); return c.toDataURL('image/png').split(',')[1]; });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.locator('#f_photo').setInputFiles({ name: 'j.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#f_photo_msg')).toContainText('Photo ready');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const thumb = calls.find((c) => c.body.action === 'saveCrew').body.record.photo_thumb;
  expect(thumb.slice(0, 15)).toBe('data:image/jpeg');
  expect(thumb.length).toBeLessThan(30000);
});

test('the route editor orders sites and saves the order', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="routes"]');
  await page.click('[data-edit="route:R1"]');
  await page.selectOption('#r_add', 'S2');
  await page.click('#r_addbtn');
  await page.click('[data-up="1"]');
  await page.click('#r_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveRoute').body.record).toMatchObject({ id: 'R1', rev: 1, site_ids: ['S2', 'S1'] });
});

test('a refused save from a non-admin is shown, not swallowed', async ({ page }) => {
  // Defence in depth: even if an edit button leaked to a crew screen, the refusal must show.
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  const r = await page.evaluate(() => SnowApi.call('saveSite', { record: { id: 'S1', name: 'x', rev: 1 } }));
  expect(r).toMatchObject({ ok: false, code: 'forbidden' });
});

// ---------------- final review fixes ----------------
test('editing a worker keeps a sign-in link the picker cannot show', async ({ page }) => {
  // I1. Alex is linked to Inventory profile 2, which is not in the approved list
  // (pending, rejected, or the list failed to load). A phone-number fix must not unlink him.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C01"]');
  await page.click('#w_edit');
  expect(await page.locator('#f_profile').inputValue()).toBe('2');
  await page.fill('#f_phone', '555-0111');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveCrew').body.record.profile_id).toBe('2');
});

test('if the names cannot load, the sign-in link is left alone', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: () => ({ nope: true }) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await expect(page.locator('#f_profile')).toBeDisabled();
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveCrew').body.record.profile_id).toBe('3');
});

test('a double tap on Save sends one save', async ({ page }) => {
  // I2. Apps Script takes a second or two; the second tap must not create a duplicate.
  const calls = [];
  const snow = fakeSnow(world());
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    if (body.action === 'saveSite') await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: PROFILES }) }));
  await page.addInitScript(() => localStorage.setItem('titan-snow-token', 'tok-matt'));
  await page.goto(PAGE);
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:"]');
  await page.fill('#s_name', 'New Lot');
  await page.evaluate(() => { const b = document.getElementById('s_save'); b.click(); b.click(); });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.action === 'saveSite')).toHaveLength(1);
});

test('a first sign-in with no PIN yet claims one instead of spending a try', async ({ page }) => {
  // I3. New Ned is approved but has never set a PIN: verifyPin would count a failure.
  const invCalls = [];
  await open(page, { snow: fakeSnow(world()), inv: (p) => { invCalls.push(p.action);
    if (p.action === 'getProfiles') return { profiles: PROFILES };
    if (p.action === 'claimPin' && p.id === '6' && p.pin === '6666') return { valid: true, success: true, id: 6, name: 'New Ned', status: 'approved', token: 'tok-jordan' };
    return { valid: false, attemptsLeft: 5 }; } });
  await page.selectOption('#si_who', '6');
  await expect(page.locator('#signin')).toContainText('Choose a 4-digit PIN');
  await page.fill('#si_pin', '6666');
  await page.click('#si_go');
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toBeVisible();
  expect(invCalls).not.toContain('verifyPin');
});

test('a pending person is told they are waiting, without spending a try', async ({ page }) => {
  const invCalls = [];
  await open(page, { snow: fakeSnow(world()), inv: (p) => { invCalls.push(p.action); return p.action === 'getProfiles' ? { profiles: PROFILES } : { valid: false, attemptsLeft: 5 }; } });
  await page.selectOption('#si_who', '9');
  await page.fill('#si_pin', '9999');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toContainText('waiting for Matt');
  expect(invCalls).not.toContain('verifyPin');
});

test('a session that expires during a save says sign in again', async ({ page }) => {
  // M6, raised to Important. The token died while the dialog was open.
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { saveReply: { ok: false, code: 'signin', reason: 'Session expired. Sign in again.' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
});

test('after a conflict the app reloads the latest, so the retry can save', async ({ page }) => {
  // M7, raised to Important. Someone else saved S1 (now rev 2). Our first save
  // conflicts; the retry must carry rev 2 and show their change.
  const state = world();
  let first = true;
  const base = fakeSnow(state);
  const calls = await open(page, { token: 'tok-matt', snow: (b) => {
    if (b.action === 'saveSite' && first) {
      first = false;
      state.sites = state.sites.map((s) => (s.id === 'S1' ? { ...s, rev: 2, notes: 'theirs' } : s));
      return { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.', version: 'curbs-1' };
    }
    return base(b);
  } });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#s_err')).toContainText('Someone changed this');
  await page.keyboard.press('Escape');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_notes')).toHaveValue('theirs');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.rev).toBe(2);
});

// ---------------- site maps: crew view ----------------
// A 30 m x 10 m walk near PAC at 61.2177 N: 300 m2 = 3,229 sq ft (worked by hand).
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
const mapWorld = () => {
  const w = world();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, map: { center: PAC, zoom: 18 }, materials_needed: '4-5 bags IceMelt' } : s));
  w.zones = [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', priority: true, note: 'ADA ramp first', ring: ring(PAC[0], PAC[1], 30, 10), area_sqft: 3229, rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk', priority: false, note: '', ring: ring(PAC[0], PAC[1] + 0.0003, 20, 5), area_sqft: 1076, rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ski trail', priority: false, note: 'Do not gravel', ring: ring(PAC[0] + 0.0006, PAC[1], 10, 30), area_sqft: 3229, rev: 1 },
  ];
  return w;
};
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function tiles(page, fail) {
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) =>
    fail ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'image/png', body: PNG1 }));
}
async function openMap(page, token, state, fail) {
  await tiles(page, fail);
  const calls = await open(page, { token, snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  return calls;
}
const zoneSource = (page) => page.evaluate(() => new Promise((res) => {
  const go = () => { const s = window.SnowMapView && window.SnowMapView.getSource('zones'); if (s && s._data) res(s._data.features.map((f) => ({ id: f.properties.id, type: f.properties.type }))); else setTimeout(go, 100); };
  go();
}));

// Matt 10/4/26: Bootprint's colours, two new types. The legend reads in this
// order everywhere, and Matt's editor offers the same five.
test('the legend and the editor list the five zone types in order', async ({ page }) => {
  await adminMap(page, mapWorld());
  expect(await page.locator('#maplegend span').allTextContents()).toEqual(
    ['Sidewalk', 'Hand work', 'Heated: check only, no melt', 'Snow storage', 'Do not touch']);
  await page.click('#mapedit');
  await page.click('#ed_new');
  expect(await page.locator('[data-ztype]').evaluateAll((els) => els.map((e) => e.dataset.ztype + ':' + e.textContent))).toEqual(
    ['sidewalk:Sidewalk', 'hand:Hand', 'heated:Heated', 'storage:Snow storage', 'no_touch:Do not touch']);
});

// 10/4/26: the photo switch asked the map about the city photo layer right
// after new Map(), before the style is built. MapLibre logs "non-existing
// layer moa" as a console error on every map open (six in one session in
// Claude's pane). The real library, no patches: five opens, no errors, and the
// switch still reads the city photo.
test('opening site maps logs no errors, and the photo switch reads the city photo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await openMap(page, 'tok-jordan', mapWorld());
  for (let i = 0; i < 5; i++) {
    await zoneSource(page);
    await expect(page.locator('#photoswitch')).toHaveText('Photo: City 2024');
    if (i < 4) { await page.click('nav [data-tab="sites"]'); await page.click('[data-map="S1"]'); }
  }
  expect(errors.filter((e) => /layer|maplibre|Style/i.test(e))).toEqual([]);
});

test('the crew map draws every zone with its type and a legend', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  expect(await zoneSource(page)).toEqual([{ id: 'Z1', type: 'sidewalk' }, { id: 'Z2', type: 'heated' }, { id: 'Z3', type: 'no_touch' }]);
  await expect(page.locator('#maplegend')).toContainText('Heated: check only, no melt');
  await expect(page.locator('#maplegend')).toContainText('Do not touch');
  await expect(page.locator('#mapsite')).toContainText('4-5 bags IceMelt');
  // Tiles load here, so no outage banner (gives the tile probe time to answer).
  await page.waitForTimeout(1500);
  await expect(page.locator('#mapwarn')).toBeHidden();
});

test('a priority zone is starred on the map', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('.zone-star')).toHaveCount(1);
});

test('tapping a zone shows its details and area', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  const pt = await page.evaluate(([lng, lat]) => { const p = window.SnowMapView.project([lng, lat]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    [PAC[0] + 0.00025, PAC[1] + 0.00004]);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#zonesheet')).toContainText('Main entry');
  await expect(page.locator('#zonesheet')).toContainText('ADA ramp first');
  await expect(page.locator('#zonesheet')).toContainText('3,229 sq ft');
  await expect(page.locator('#zonesheet')).toContainText('Priority');
});

test('a site with no zones says the map is not drawn yet', async ({ page }) => {
  const w = mapWorld(); w.zones = [];
  await openMap(page, 'tok-jordan', w);
  await expect(page.locator('main')).toContainText('Map not drawn yet');
  expect(await page.evaluate(() => !!window.SnowMapView)).toBe(false);
});

test('if the aerial photo fails, the zones still show', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld(), true);
  expect((await zoneSource(page)).length).toBe(3);
  // Visible, not just present: the banner's text is in the page even while hidden.
  await expect(page.locator('#mapwarn')).toBeVisible();
  await expect(page.locator('#mapwarn')).toContainText('Aerial photo unavailable');
});

test('crew have no edit-map button', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});

// ---------- site maps: Matt's zone editor ----------
// Corners are clicked at whole pixels; the expected lng/lat is the map's own
// unproject of that same pixel, so the check is exact (1e-6 deg is ~0.1 m).
async function adminMap(page, state) {
  await tiles(page);
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  return calls;
}
// Pixel offsets from the canvas CENTRE (which is PAC), all west of it: every
// zone in mapWorld starts at PAC's longitude and runs east, so this ground is
// clear at any map height (the map shrinks when the old-map sheet is open).
const CORNERS = [[-150, -60], [-40, -60], [-40, 20], [-150, 20]];
// A person scrolls the map into view before tapping it; so does the test.
const mapInView = (page) => page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
async function tapCorners(page, px) {
  const out = [];
  for (const [x, y] of px) {
    await mapInView(page);
    const r = await page.evaluate(() => { const b = window.SnowMapView.getCanvas().getBoundingClientRect(); return { l: b.left + b.width / 2, t: b.top + b.height / 2 }; });
    const cx = Math.round(r.l + x), cy = Math.round(r.t + y);
    await page.mouse.click(cx, cy);
    out.push(await page.evaluate(([a, b]) => { const c = window.SnowMapView.getCanvas().getBoundingClientRect(); const ll = window.SnowMapView.unproject([a - c.left, b - c.top]); return [ll.lng, ll.lat]; }, [cx, cy]));
  }
  return out;
}
const lastCall = (calls, action) => calls.filter((c) => c.body.action === action).at(-1);

test('Matt draws a heated priority zone and it saves with its corners', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="heated"]');
  await page.check('#z_priority');
  await page.fill('#z_name', 'Back steps');
  await page.fill('#z_note', 'Check the drain');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ site_id: 'S1', type: 'heated', priority: true, name: 'Back steps', note: 'Check the drain', rev: 0 });
  expect(rec.id).toBeFalsy();
  expect(rec.ring.length).toBe(4);
  rec.ring.forEach((p, i) => { expect(Math.abs(p[0] - want[i][0])).toBeLessThan(1e-6); expect(Math.abs(p[1] - want[i][1])).toBeLessThan(1e-6); });
  expect(await zoneSource(page)).toHaveLength(4); // the new zone is on the map now
  await expect(page.locator('.zone-star')).toHaveCount(2);
});

test('undo takes back the last corner', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await page.click('#z_undo');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Three corners');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ring = lastCall(calls, 'saveZone').body.record.ring;
  expect(ring.length).toBe(3);
  expect(Math.abs(ring[2][0] - want[2][0])).toBeLessThan(1e-6);
});

test('two corners is not a zone: blocked before it is sent', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Too small');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toContainText('At least 3 corners');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
});

test('a zone with no type picked is not sent', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.fill('#z_name', 'No type');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toContainText('Pick a type');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
});

test('Save view stores the map centre and zoom on the site, keeping its other fields', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.evaluate(() => window.SnowMapView.jumpTo({ center: [-149.9, 61.22], zoom: 17.5 }));
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  const rec = lastCall(calls, 'saveSite').body.record;
  expect(rec.id).toBe('S1');
  expect(rec.name).toBe('PAC');
  expect(rec.materials_needed).toBe('4-5 bags IceMelt');
  expect(rec.map.zoom).toBeCloseTo(17.5, 6);
  expect(rec.map.center[0]).toBeCloseTo(-149.9, 6);
  expect(rec.map.center[1]).toBeCloseTo(61.22, 6);
});

test('the old-map picture shows beside the map and is never sent or stored', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  // After Edit map, which stores its own on/off flag: from here, nothing new may be kept.
  const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  await page.setInputFiles('#ed_reffile', { name: 'Night 1 - PAC.png', mimeType: 'image/png', buffer: PNG1 });
  await expect(page.locator('#refpanel img')).toBeVisible();
  expect(await page.locator('#refpanel img').getAttribute('src')).toMatch(/^blob:/);
  // Work with the picture open: draw a zone and save the view.
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Traced');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  for (const c of calls) {
    const s = JSON.stringify(c.body);
    expect(s).not.toContain('data:image');
    expect(s).not.toContain('Night 1 - PAC');
    expect(s).not.toContain('blob:');
  }
  const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  expect(after).toBe(before);
  await page.click('#ref_close');
  await expect(page.locator('#refpanel')).toBeHidden();
});

test('editing a zone keeps its id and rev; Archive takes it off the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await zoneSource(page);
  await page.click('#mapedit');
  const tapZone = async (lng, lat) => {
    await mapInView(page);
    const pt = await page.evaluate(([a, b]) => { const p = window.SnowMapView.project([a, b]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lng, lat]);
    await page.mouse.click(pt.x, pt.y);
  };
  await tapZone(PAC[0] + 0.00025, PAC[1] + 0.00004); // Z1, Main entry
  await expect(page.locator('#z_name')).toHaveValue('Main entry');
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await expect(page.locator('#zonesheet')).toBeHidden(); // editing, not the crew sheet
  await page.fill('#z_name', 'Main entry + ramp');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ id: 'Z1', rev: 1, name: 'Main entry + ramp', type: 'sidewalk', priority: true, note: 'ADA ramp first' });

  // Z3 is ~240 px east of PAC at z18 (MapLibre zooms are 512 px tiles): off a
  // phone-width map. Pan to it first, as Matt would.
  await page.evaluate(([a, b]) => window.SnowMapView.jumpTo({ center: [a, b] }), [PAC[0] + 0.00065, PAC[1] + 0.0001]);
  await tapZone(PAC[0] + 0.0006 + 0.00005, PAC[1] + 0.0001); // Z3, Ski trail
  await expect(page.locator('#z_name')).toHaveValue('Ski trail');
  await page.click('#z_archive');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'archiveZone').body).toMatchObject({ id: 'Z3', rev: 1 });
  expect((await zoneSource(page)).map((z) => z.id)).toEqual(['Z1', 'Z2']);
});

test('Matt gets a map to draw on even before a site has zones', async ({ page }) => {
  const w = mapWorld(); w.zones = [];
  await adminMap(page, w);
  await expect(page.locator('#mapedit')).toBeVisible();
});

test('tapping a corner that is already there does not add another', async ({ page }) => {
  // Found in review: MapLibre fires the map click for a tap on a marker, so a
  // tap to grab corner 2 made A,B,C,D,B -- a spike that encloses only BCD.
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Four');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'saveZone').body.record.ring.length).toBe(4);
});

// Found in review: a save still in flight when Matt taps Done or Back was
// stored by the server but never shown, so he would draw it again.
async function slowZoneSaves(page) {
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'saveZone') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
}
async function drawAndSave(page) {
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Slow one');
  await page.click('#z_save');
}

test('a zone saved while Done is tapped still shows on the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#ed_done');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await expect.poll(async () => (await zoneSource(page)).length, { timeout: 5000 }).toBe(4);
});

test('a zone saved while Back is tapped is there when the map is reopened', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#mapback');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await page.waitForTimeout(1600); // the slow reply lands after Back
  await page.click('[data-map="S1"]');
  expect(await zoneSource(page)).toHaveLength(4);
});

test('a slow save never draws its zone onto another site opened meanwhile', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#mapback');
  await page.click('[data-map="S2"]'); // TUDOR-TRANSIT: no zones
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await page.waitForTimeout(1600); // the PAC zone's reply lands now
  expect(await zoneSource(page)).toEqual([]);
});

test('leads have no edit-map button either', async ({ page }) => {
  await openMap(page, 'tok-alex', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});

// ---------- the phone's Back button ----------
// Matt, 10/1/26: Back closed the whole app and he had to start over. The app is
// one page, so Back must undo one step at a time: an open box, then the map.
const phoneBack = (page) => page.evaluate(() => history.back());

test('Back on a map returns to the list, not out of the app', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await phoneBack(page);
  await expect(page.locator('.site-card')).toHaveCount(2);
  await expect(page.locator('#mapbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.SnowMapView)).toBeFalsy();
});

test('Back with an edit box open closes the box and stays on the screen', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await phoneBack(page);
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('.site-card')).toHaveCount(2);
});

test('a box closed with Cancel leaves no extra Back step behind', async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  // Straight after Cancel: no step left for a dead box (else the next Back does nothing).
  await expect.poll(() => page.evaluate(() => ((history.state && history.state.snow) || []).length)).toBe(0);
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView);
  await phoneBack(page); // one Back: off the map. Not a ghost step for the closed box.
  await expect(page.locator('.site-card')).toHaveCount(2);
  await expect(page.locator('#mapbox')).toHaveCount(0);
});

test('the in-app ‹ Back and the phone Back agree', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await page.click('#mapback');
  await expect(page.locator('.site-card')).toHaveCount(2);
  // Nothing left to undo (history moves a moment later, so wait for it).
  await expect.poll(() => page.evaluate(() => (history.state && history.state.snow) || []).then((s) => s.length)).toBe(0);
});

test('Back while drawing a zone cancels the drawing and keeps the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await phoneBack(page);
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('.zone-corner')).toHaveCount(0);
  await expect(page.locator('#mapbox')).toBeVisible();
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
  await phoneBack(page); // and the next Back leaves the map
  await expect(page.locator('.site-card')).toHaveCount(2);
});

test('switching zones while drawing does not lose the map on the next Back', async ({ page }) => {
  await adminMap(page, mapWorld());
  await zoneSource(page);
  await page.click('#mapedit');
  await page.click('#ed_new');
  // Cancel and start again in the same instant, before the history has answered the
  // Cancel: the late answer must not cancel the new drawing.
  await page.evaluate(() => { document.getElementById('z_cancel').click(); document.getElementById('ed_new').click(); });
  await expect(page.locator('#zoneform')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#zoneform')).toBeVisible(); // still drawing once the history settled
  await phoneBack(page);
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('#mapbox')).toBeVisible();
});

// ---------- polish from the site-maps review (10/1/26) ----------
test('the route edit box says where sites are renamed', async ({ page }) => {
  // Matt, 10/1: tried to rename JBER sites inside the route box, where names are plain text.
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('[data-edit="route:R1"]');
  await expect(page.locator('#r_hint')).toBeVisible();
  await expect(page.locator('#r_hint')).toContainText('Sites tab');
});

test('materials needed can be typed on a site and is sent with it', async ({ page }) => {
  const w = world();
  w.sites[0] = { ...w.sites[0], materials_needed: '2-4 bags IceMelt' };
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_mat')).toHaveValue('2-4 bags IceMelt');
  await page.fill('#s_mat', '3-5 bags IceMelt, gravel at the ramp');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.materials_needed).toBe('3-5 bags IceMelt, gravel at the ramp');
});

test('signing out from the map editor clears the map and the old-map picture', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.setInputFiles('#ed_reffile', { name: 'Night 1 - PAC.png', mimeType: 'image/png', buffer: PNG1 });
  await expect(page.locator('#refpanel')).toBeVisible();
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#refpanel')).toHaveCount(0);
  expect(await page.evaluate(() => window.SnowMapView)).toBeFalsy();
});

test('a refused Save view says so, even while a zone is being drawn', async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld(), { saveReply: { ok: false, code: 'invalid', reason: 'Test refusal: not saved' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await page.click('#mapedit');
  await page.click('#ed_new'); // drawing: the editor's message line is hidden now
  await page.click('#ed_view');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Test refusal: not saved');
});

// Matt, 10/1/26, tracing PAC: tall buildings lean over the walks in the city's
// photo. A different flight leans differently, so one tap flips the photo.
test('the photo switch flips between the city photo and Esri', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld()); // crew get it too: the lean hides walks from them as well
  await zoneSource(page);
  const moa = () => page.evaluate(() => window.SnowMapView.getLayoutProperty('moa', 'visibility') || 'visible');
  await expect(page.locator('#photoswitch')).toContainText('City 2024');
  expect(await moa()).toBe('visible');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toContainText('Esri');
  expect(await moa()).toBe('none');
  expect(await page.evaluate(() => window.SnowMapView.getLayoutProperty('esri', 'visibility') || 'visible')).toBe('visible');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toContainText('City 2024');
  expect(await moa()).toBe('visible');
  expect(await zoneSource(page)).toHaveLength(3); // the zones never move
});

// Matt, 10/1/26, first real trace: "I'm trying to move the map. It places a dot.
// I can't delete them. And I'm trying to spin the map."
test('in Move map mode a tap adds no corner; switching back adds again', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await expect(page.locator('#z_mode')).toContainText('Adding corners');
  await page.click('#z_mode');
  await expect(page.locator('#z_mode')).toContainText('Moving map');
  await tapCorners(page, CORNERS.slice(2, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  await page.click('#z_mode');
  await tapCorners(page, CORNERS.slice(2, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(3);
});

test('a tapped corner can be deleted, and Undo brings it back', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await expect(page.locator('#z_delcorner')).toBeDisabled(); // nothing chosen yet
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner.sel')).toHaveCount(1);
  await page.click('#z_delcorner');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('#z_undo');
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.locator('.zone-corner').nth(1).click();
  await page.click('#z_delcorner');
  await page.click('[data-ztype="sidewalk"]');
  await page.fill('#z_name', 'Three left');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ring = lastCall(calls, 'saveZone').body.record.ring;
  expect(ring.length).toBe(3);
  [want[0], want[2], want[3]].forEach((w, i) => { expect(Math.abs(ring[i][0] - w[0])).toBeLessThan(1e-6); expect(Math.abs(ring[i][1] - w[1])).toBeLessThan(1e-6); });
});

test('the map turns with buttons and the compass turns it back to north', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  const bearing = () => page.evaluate(() => window.SnowMapView.getBearing());
  await page.click('#ed_rotr');
  await expect.poll(bearing).toBeCloseTo(15, 3);
  await page.click('#ed_rotl');
  await page.click('#ed_rotl');
  await expect.poll(bearing).toBeCloseTo(-15, 3);
  await page.click('.maplibregl-ctrl-compass');
  await expect.poll(bearing).toBeCloseTo(0, 3);
});

// Matt, 10/1/26: "is rotating it gone because I saved it" -- Save view kept the
// spot and zoom but dropped the turn. The turn is part of the view.
test('Save view keeps the turn, and the map reopens turned', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_rotr');
  await page.click('#ed_rotr'); // 30 degrees
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getBearing())).toBeCloseTo(30, 3);
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  expect(lastCall(calls, 'saveSite').body.record.map.bearing).toBeCloseTo(30, 3);
  await page.click('#mapback');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView);
  expect(await page.evaluate(() => window.SnowMapView.getBearing())).toBeCloseTo(30, 3);
});

// Matt, 10/1/26: drew all the way round PAC tapping New zone between walks,
// thinking each was banked. Every New zone silently threw the last one away.
test('New zone never throws away a zone in progress', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('#ed_new');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await expect(page.locator('#toast')).toContainText('Save or Cancel this zone first');
});

test('Done never throws away a zone in progress', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('#ed_done');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await expect(page.locator('#zoneform')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Save or Cancel this zone first');
});

// ---------- import from Bootprint (Matt, 10/1/26: trace in Bootprint, bring it here) ----------
const mPin = (x, y) => ({ lat: PAC[1] + y / RE / DEGR, lng: PAC[0] + x / (RE * Math.cos(PAC[1] * DEGR)) / DEGR, accuracy: 0 });
const bpRect = (x, y) => [mPin(x, y), mPin(x + 10, y), mPin(x + 10, y + 5), mPin(x, y + 5)];
const bpExport = () => Buffer.from(JSON.stringify({
  schema: 'bootprint-library-export', version: 1, exportedAt: '2026-10-01T18:00:00Z',
  jobs: [
    { id: 'FARJOB', name: 'FAR-SECRET-JOB', zones: [{ id: 1, name: 'Far walk', mode: 'area', surface: 'walk', pins: bpRect(0, 20000), widthFt: '' }] },
    { id: 'NEAR', name: 'Near PAC', zones: [
      { id: 1, name: 'West walk', mode: 'area', surface: 'walk', pins: bpRect(-80, -20), widthFt: '' },
      { id: 2, name: 'Lot', mode: 'area', surface: 'plow', pins: bpRect(-80, -60), widthFt: '' },
      { id: 3, name: 'Back run', mode: 'line', surface: 'walk', pins: [mPin(-80, -30), mPin(-50, -30)], widthFt: '6' },
    ] },
  ],
  prefs: { snowTerms: 'PREF-SECRET' },
}));
async function importFile(page, buf) {
  await page.setInputFiles('#ed_bpfile', { name: 'bootprint-library-2026-10-01.json', mimeType: 'application/json', buffer: buf });
}

test('a Bootprint job imports its walks as sidewalk zones, and nothing else leaves the laptop', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('Near PAC'); // nearest the site first
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('2 walks to add');
  await expect(page.locator('#bp_sum')).toContainText('1 lot');
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(2);
  const recs = calls.filter((c) => c.body.action === 'saveZone').map((c) => c.body.record);
  expect(recs.map((r) => [r.name, r.type, r.site_id, r.from])).toEqual([
    ['West walk', 'sidewalk', 'S1', 'bootprint:NEAR:1'], ['Back run', 'sidewalk', 'S1', 'bootprint:NEAR:3']]);
  expect(recs[1].ring.length).toBe(4); // the run came across as a strip
  await expect.poll(async () => (await zoneSource(page)).length).toBe(5);
  await expect(page.locator('#toast')).toContainText('Added 2');
  for (const c of calls) {
    const s = JSON.stringify(c.body);
    expect(s).not.toContain('FAR-SECRET-JOB');
    expect(s).not.toContain('PREF-SECRET');
    expect(s).not.toContain('bootprint-library-2026');
  }
});

// Matt 10/4/26: hand work keeps its own colour, and a pile shows the Bobcat
// operator where snow goes. A pile is not a walk, so it is counted on its own.
test('hand work and snow piles import as their own types, and piles are not called walks', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [
    { id: 'NEAR', name: 'Near PAC', zones: [
      { id: 1, name: 'Front walk', mode: 'area', surface: 'walk', pins: bpRect(-80, -20), widthFt: '' },
      { id: 2, name: 'Lot cleanout', mode: 'area', surface: 'hand', pins: bpRect(-80, -40), widthFt: '' },
      { id: 3, name: 'Snow pile 1', mode: 'area', surface: 'storage', pins: bpRect(-80, -60), widthFt: '' },
    ] }] })));
  // The job button: 2 walks (front walk + lot cleanout), 1 snow pile.
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('2 walks · 1 snow pile');
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('2 walks · 1 snow pile to add');
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(3);
  expect(calls.filter((c) => c.body.action === 'saveZone').map((c) => [c.body.record.name, c.body.record.type])).toEqual([
    ['Front walk', 'sidewalk'], ['Lot cleanout', 'hand'], ['Snow pile 1', 'storage']]);
});

test('importing the same Bootprint job twice adds nothing the second time', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(2);
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('0 walks to add');
  await expect(page.locator('#bp_sum')).toContainText('2 already imported');
  await expect(page.locator('#bp_add')).toBeDisabled();
});

// Matt's imports, 10/4/26: the job list rendered off screen, ~1 zone per 2-3 s
// saved with no word on screen, and Done mid-way stopped it ("Added 2 of 5").
test('the Bootprint job list is brought onto the screen when the file is read', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.evaluate(() => window.scrollTo(0, 0)); // where Matt was: the map buttons at the top
  await importFile(page, bpExport());
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toBeVisible();
  // toBeVisible passes off screen; the list's top must be inside the window.
  await expect.poll(() => page.locator('#bp_jobs').evaluate((el) => {
    const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight;
  })).toBe(true);
});

async function importSlowly(page) {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page); // 1.2 s per zone; bpExport's near job has 2
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await page.click('#bp_add');
  await expect(page.locator('#bp_add')).toHaveText('Adding 1 of 2…');
  return calls;
}
const zoneSaves = (calls) => calls.filter((c) => c.body.action === 'saveZone').length;

test('an import says "Adding n of N…" and locks its panel until it is done', async ({ page }) => {
  const calls = await importSlowly(page);
  await expect(page.locator('#bp_add')).toBeDisabled();
  await expect(page.locator('#bp_cancel')).toBeDisabled();
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toBeDisabled();
  await expect(page.locator('#bp_add')).toHaveText('Adding 2 of 2…', { timeout: 3000 });
  await expect(page.locator('#toast')).toContainText('Added 2 zones from Bootprint');
  expect(zoneSaves(calls)).toBe(2);
  await expect(page.locator('#bpimport')).toBeHidden();
});

test('Done, New zone and a tab mid-import are refused with a word, and every zone still saves', async ({ page }) => {
  const calls = await importSlowly(page);
  for (const sel of ['#ed_done', '#ed_new', 'nav [data-tab="routes"]']) {
    await page.evaluate(() => { document.getElementById('toast').style.display = 'none'; }); // the next toast must be a new one
    await page.click(sel);
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).not.toContainText('Added');
  }
  await expect(page.locator('#zoneform')).toBeHidden();   // New zone did not start a drawing
  await expect(page.locator('#bpimport')).toBeVisible();  // Done did not close the editor
  await expect(page.locator('#toast')).toContainText('Added 2 zones from Bootprint', { timeout: 5000 });
  expect(zoneSaves(calls)).toBe(2);
  await expect(page.locator('#ed_new')).toBeVisible();    // still in the editor, on the map
});

test('the phone\'s Back and ‹ Back mid-import leave the map open, and the import finishes', async ({ page }) => {
  const calls = await importSlowly(page);
  for (const press of [() => phoneBack(page), () => page.click('#mapback')]) {
    await page.evaluate(() => { document.getElementById('toast').style.display = 'none'; }); // the next toast must be a new one
    await press();
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).not.toContainText('Added'); // Matt was told why, before the end
    await expect(page.locator('#mapbox')).toBeVisible();
  }
  await expect(page.locator('#toast')).toContainText('Added 2 zones from Bootprint', { timeout: 5000 });
  expect(zoneSaves(calls)).toBe(2);
  await expect.poll(async () => (await zoneSource(page)).length).toBe(5);
  // Once done, Back works as before: it closes the map.
  await phoneBack(page);
  await expect(page.locator('#mapbox')).toHaveCount(0);
});

test('the file pickers do not open mid-import', async ({ page }) => {
  await importSlowly(page);
  let opened = 0;
  page.on('filechooser', () => { opened++; });
  await page.click('label.filebtn:has(#ed_bpfile)');
  await page.click('label.filebtn:has(#ed_reffile)');
  await page.waitForTimeout(400);
  expect(opened).toBe(0);
  await expect(page.locator('#toast')).toBeVisible();
});

// Matt 10/4/26: mapping site after site, the editor dropped back to view after
// every Back and every reload. Edit map now stays on until Done.
const inEditor = (page) => expect(page.locator('#ed_new')).toBeVisible();
async function reopenS1(page) {
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
}

test('Edit map stays on after ‹ Back, the phone\'s Back and a reload, until Done', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await inEditor(page);
  await page.click('#mapback');
  await page.click('[data-map="S2"]'); // another site: still in the editor
  await inEditor(page);
  await expect(page.locator('#mapedit')).toBeHidden();
  await phoneBack(page);
  await expect(page.locator('#mapbox')).toHaveCount(0);
  await page.reload();
  await reopenS1(page);
  await inEditor(page);
  await page.click('#ed_done');
  await expect(page.locator('#ed_new')).toHaveCount(0);
  await page.click('#mapback');
  await reopenS1(page);
  await expect(page.locator('#mapedit')).toBeVisible(); // Done ended it: the map opens to view
  await expect(page.locator('#ed_new')).toHaveCount(0);
});

test('signing out ends Edit map: the next map opens to view', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await inEditor(page);
  await page.click('#signout');
  expect(await page.evaluate(() => localStorage.getItem('titan-snow-editing'))).toBeNull();
});

test('a crew phone never opens a map in the editor, whatever this device remembers', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('titan-snow-editing', '1'));
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#ed_new')).toHaveCount(0);
  await expect(page.locator('#edbar')).toHaveCount(0);
});

// 10/9/26, Fire Station #10 (14861 Mountain Air Dr): MapLibre parses an inline style on
// the NEXT ANIMATION FRAME, and frames stop while the page is off screen (the phone's
// screen off, the app behind another; the desktop pane's window hidden). SnowMap.open
// still hands the map over after its 8 s fallback, so Edit map came on over a map whose
// style was not parsed yet: the editor's addSource('draft') threw "Style is not done
// loading", the bar never came, and with Edit map remembered the map said it couldn't
// load. The aerial tiles are held open as well, as they were that night: the editor
// must never wait for the photo, which may never come.
// Frames are held from the tap on the site until the test lets them go; MapLibre looks
// requestAnimationFrame up on each call, so the page's own copy is what it gets. The stub
// stays in place and passes frames through once released: Playwright's own in-page script
// keeps a bound copy of whatever it first found there, and polls its waits with it.
const tilesHang = (page) => page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), () => { /* never answered */ });
const holdFrames = (page) => page.evaluate(() => {
  const real = window.requestAnimationFrame.bind(window), held = [];
  let holding = true;
  window.requestAnimationFrame = (cb) => (holding ? (held.push(cb), 0) : real(cb));
  window.__frames = { release: () => { holding = false; held.splice(0).forEach((cb) => real(cb)); } };
});
const releaseFrames = (page) => page.evaluate(() => window.__frames.release());
const draftFeatures = (page) => page.evaluate(() => {
  const s = window.SnowMapView.getSource('draft'), d = s && s._data;
  return !d ? -1 : d.type === 'FeatureCollection' ? d.features.length : 1;
});
async function unparsedMap(page, errors) {
  page.on('pageerror', (e) => errors.push(String(e)));
  await tilesHang(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await holdFrames(page);
  await page.click('[data-map="S1"]');
  // The 8 s fallback hands the map over with its style still unparsed (no zones source yet).
  await expect(page.locator('#mapedit')).toBeEnabled({ timeout: 12000 });
  expect(await page.evaluate(() => !!window.SnowMapView.getSource('zones'))).toBe(false);
}

test('Edit map on a map whose style is still unparsed: the bar comes, and the import previews once the style parses', async ({ page }) => {
  const errors = [];
  await unparsedMap(page, errors);
  await page.click('#mapedit');
  await expect(page.locator('#ed_new')).toBeVisible();
  await expect(page.locator('#ed_bpfile')).toHaveCount(1);
  await expect(page.locator('#ed_reffile')).toHaveCount(1);
  // The file can be picked and the job chosen before the style is there; the preview waits for it.
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('2 walks to add');
  expect(await draftFeatures(page)).toBe(-1);
  await releaseFrames(page);
  await page.waitForFunction(() => window.SnowMapView.getSource('zones'));
  await expect.poll(() => draftFeatures(page)).toBe(2);
  // The photo never came (its tiles are still held): the preview did not wait for it.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.SnowMapView.isStyleLoaded())).toBe(false);
  expect(errors).toEqual([]);
});

test('with Edit map remembered, a map whose style is still unparsed opens in the editor, and a zone can be started', async ({ page }) => {
  const errors = [];
  await page.addInitScript(() => localStorage.setItem('titan-snow-editing', '1'));
  await unparsedMap(page, errors);
  await expect(page.locator('#ed_new')).toBeVisible();
  await expect(page.locator('#mapwarn')).not.toContainText("couldn't load");
  await page.click('#ed_new');
  await expect(page.locator('#zoneform')).toBeVisible();
  // Corners tapped before the style is there are kept (the markers are the page's own);
  // their outline is drawn the moment the draft arrives with the style.
  await tapCorners(page, CORNERS.slice(0, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  expect(await draftFeatures(page)).toBe(-1);
  await releaseFrames(page);
  await page.waitForFunction(() => window.SnowMapView.getSource('zones'));
  await expect.poll(() => draftFeatures(page)).toBe(1); // the outline, drawn on the draft that arrived with the style
  expect(await page.evaluate(() => window.SnowMapView.getSource('draft')._data.geometry.type)).toBe('Polygon');
  expect(errors).toEqual([]);
});

test('a file that is not a Bootprint export is refused with a reason', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, Buffer.from('{"hello": 1}'));
  await expect(page.locator('#toast')).toContainText('not a Bootprint export');
  await expect(page.locator('#bp_jobs')).toHaveCount(0);
});

// ---------- pairings (sub-project 4, 10/1/26) ----------
test('the roster card edits the Crew Board fields and sends them', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.selectOption('#f_rides_with', 'C01');
  await page.selectOption('#f_gear', 'needs_issued');
  await page.check('input[data-list="keep_apart_from"][value="C01"]');
  await page.fill('#f_seasons', '2');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  expect([r.rides_with, r.gear, r.keep_apart_from, r.works_well_with, r.seasons]).toEqual(['C01', 'needs_issued', ['C01'], [], 2]);
});

test('a site can be marked as needing a clearance', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.fill('#s_clear', 'JBER');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.needs_clearance).toBe('JBER');
});

test('a blank clearance and blank seasons are sent as empty, never invented', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.needs_clearance).toBe(null);
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  expect([r.seasons, r.rides_with, r.gear]).toEqual([null, null, null]);
});

test('Matt places a lead and a member; one move per tap', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(2);
  expect(calls.filter((c) => c.body.action === 'addMove').map((c) => [c.body.record.worker, c.body.record.role])).toEqual([['C01', 'lead'], ['C03', 'member']]);
});

test('a route warns, never blocks: no driver on a crew of one', async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => ({ ...c, can_drive: false }));
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .warns')).toContainText('Nobody on this route can drive');
});

test("a lead who can't drive is placed anyway, and the route names them (Matt, 10/7/26 field test)", async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => ({ ...c, can_drive: c.id === 'C03' }));   // Alex can't, Jordan can
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(2);                 // placed, not blocked
  await expect(page.locator('[data-route="R1"] .warns [data-rule="lead-no-licence"]')).toHaveText("Alex Test leads but can't drive");
  await expect(page.locator('[data-route="R1"] .warns')).not.toContainText('Nobody on this route can drive');   // Jordan drives
});

test('a site with no clearance set never warns about clearance', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await expect(page.locator('[data-route="R1"] .warns li[data-rule^="clearance"]')).toHaveCount(0);
});

test('a site that needs a clearance warns about who lacks it', async ({ page }) => {
  const w = world(); w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, needs_clearance: 'JBER' } : s));
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="clearance"]')).toContainText('Jordan Demo: no JBER clearance');
});

test('an archived worker never shows on the board', async ({ page }) => {
  const w = world(); w.crew.push({ id: 'C09', name: 'Gone Worker', archived: true, rev: 1 });
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C09', to_route: 'R1', role: 'lead' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"]')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Gone Worker');
});

test('the person card shows placed routes, shifts worked and gear on hand', async ({ page }) => {
  const w = world();
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' }];
  w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 1 }];
  w.gear = [{ id: 'G1', date: '2026-10-01', shift: 'night-2026-10-01', at: '2026-10-01T17:05:00.000-08:00', worker: 'C01', type: 'issued', item: 'Parka' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-act="card"]');
  await expect(page.locator('#dlgIn')).toContainText('N1 from 10/1');
  await expect(page.locator('#dlgIn')).toContainText('1 night · 0 days');
  await expect(page.locator('#dlgIn')).toContainText('Parka');
  await expect(page.locator('#dlgIn')).toContainText('slow starter'); // Matt's own card: private fields show
});

test('crew and leads have no Board tab', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="routes"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="board"]')).toHaveCount(0);
});

test('Post offers the shifts around now with none picked: 8:59 AM', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-02T08:59:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#post');
  await expect(page.locator('[data-shift]')).toHaveText(['Night of 10/1', 'Day of 10/2', 'Night of 10/2']);
  await expect(page.locator('[data-shift][aria-pressed="true"]')).toHaveCount(0);
});

test('Post at 9:00 AM offers today and tonight', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-02T09:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#post');
  await expect(page.locator('[data-shift]')).toHaveText(['Day of 10/2', 'Night of 10/2']);
});

test('posting sends the chosen shift and clears "Changed since post"', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T16:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#crewsees')).toContainText('Not posted');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('#changed')).toBeVisible();
  await page.click('#post');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect.poll(() => calls.filter((c) => c.body.action === 'post').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'post')[0].body.shift).toBe('night-2026-10-01');
  await expect(page.locator('#changed')).toBeHidden();
  await expect(page.locator('#crewsees')).toContainText('Night of 10/1');
});

test('Post waits for a move that is still saving', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T16:00:00-08:00' });
  await page.route(isSnow, async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.action === 'addMove') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('#post')).toBeDisabled();
  await expect(page.locator('#post')).toBeEnabled({ timeout: 5000 });
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(1);
});

test('Callout saves the board for the chosen shift', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({ shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 0 });
});

const POST = { id: 'P1', rev: 1, shift: 'night-2026-10-01', posted_at: '2026-10-02T00:12:00.000Z',
  routes: [{ id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [] },
           { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'] }],
  people: { C01: { name: 'Alex Test', phone: '555-0101', shifts: { night: 3, day: 1 } },
            C03: { name: 'Jordan Demo', phone: '555-0103', shifts: { night: 2, day: 0 } } } };

test('crew see their own route first, partners and sites', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('.tonight-route').first()).toContainText('N1');
  await expect(page.locator('.tonight-route').first()).toContainText('Alex Test');
  await expect(page.locator('.tonight-route').first().locator('[data-map="S1"]')).toBeVisible();
  await expect(page.locator('.tonight-route').first().locator('a[href="tel:555-0101"]')).toHaveCount(1);
  await expect(page.locator('#tonight-head')).toContainText('Night of 10/1');
});

test('a crew member not on the post is told so and sees the whole board', async ({ page }) => {
  const w = world(); w.posts = [{ ...POST, routes: POST.routes.map((r) => ({ ...r, members: [] })) }];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText("You're not on a route this shift");
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

test('a stale post shows no old routes', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-02T10:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
  await expect(page.locator('.tonight-route')).toHaveCount(0);
});

test('a morning post for tonight is shown, not stale', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T08:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

test('shifts worked show for everyone, night and day', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('#shifts-worked')).toContainText('Alex Test');
  await expect(page.locator('#shifts-worked')).toContainText('3 nights · 1 day');
  await expect(page.locator('#shifts-worked')).toContainText('2 nights · 0 days');
});

test('nothing posted yet is said plainly', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
});

test('a gear entry guesses the route from the shift and is sent with a calendar date', async ({ page }) => {
  const w = world(); w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 1 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="log"]');
  await page.click('#newEntry');
  await page.selectOption('#g_worker', 'C01');
  await page.selectOption('#g_shift', 'night-2026-10-01');
  await expect(page.locator('#g_route')).toHaveValue('R1');
  await page.selectOption('#g_type', 'issued');
  await page.fill('#g_item', 'Parka');
  await page.click('#g_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'addGear')[0].body.record).toMatchObject({ worker: 'C01', type: 'issued', item: 'Parka', route: 'R1', date: '2026-10-01', shift: 'night-2026-10-01' });
  await expect(page.locator('#gearlog')).toContainText('Parka');
});

test('a gear entry needs a worker, a type, an item and a shift', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="log"]');
  await page.click('#newEntry');
  await page.click('#g_save');
  await expect(page.locator('#g_err')).toContainText('Pick a worker');
  await expect(page.locator('#g_err')).toContainText('Item is required');
  expect(calls.filter((c) => c.body.action === 'addGear')).toHaveLength(0);
});

test('issued gear clears the cold-gear warning on the board', async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => (c.id === 'C03' ? { ...c, gear: 'needs_issued' } : c));
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="gear"]')).toHaveCount(1);
  const w2 = { ...w, gear: [{ id: 'G1', date: '2026-10-01', shift: 'night-2026-10-01', at: '2026-10-01T17:05:00.000-08:00', worker: 'C03', type: 'issued', item: 'Parka' }] };
  await page.unrouteAll(); // reopen with the gear logged
  await open(page, { token: 'tok-matt', snow: fakeSnow(w2) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"]')).toBeVisible();
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="gear"]')).toHaveCount(0);
});

// Review 10/1/26: Android keeps the app in memory. Opened at 4 PM, switched
// back to at 8 PM after Matt posted: Tonight must show the post, not "Not
// posted yet", without the crew knowing to tap the tab again.
test('Tonight picks up a new post when the app comes back on screen', async ({ page }) => {
  const w = world();
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
  w.posts.push(POST);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.tonight-route')).toHaveCount(2);
  await expect(page.locator('main')).not.toContainText('Not posted yet');
});

test('Tonight has a Refresh button that fetches the newest post', async ({ page }) => {
  const w = world();
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('#refreshPost')).toBeVisible();
  w.posts.push(POST);
  await page.click('#refreshPost');
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

// Review 10/1/26: a callout is who ACTUALLY went out. Someone placed who never
// showed must not get a night under "Shifts worked", which every crew phone sees.
const PLACED = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' },
  { id: 'M2', at: '2026-10-01T17:01:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];

test('a callout can mark a no-show: left off the roster, listed, with a note', async ({ page }) => {
  const w = world(); w.moves = PLACED.slice();
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('[data-noshow="C03"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#co_note', 'Jordan no call no show');
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({
    shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, no_shows: ['C03'], note: 'Jordan no call no show' });
});

test('reopening a saved callout keeps its no-shows and note', async ({ page }) => {
  const w = world(); w.moves = PLACED.slice();
  w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', started_at: '2026-10-01T20:00:00.000-08:00', note: 'short a truck',
    roster: { R1: { lead: 'C01', members: [] } }, no_shows: ['C03'], rev: 1 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#co_note')).toHaveValue('short a truck');
  await page.click('[data-noshow="C03"]'); // he turned up late after all
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({
    roster: { R1: { lead: 'C01', members: ['C03'] } }, no_shows: [], note: 'short a truck', rev: 1 });
});

// ---------------- the Storm tab: crew tap each walk ----------------
// Fixture, worked by hand. Clock 7:30 AM on 10/3 is before the 9 AM cutover, so
// the shift on offer is still "night-2026-10-02", and the post below is that
// night's: not stale. The post lists R2 (S2) first, then R1 (S1) with Jordan
// (C03) as a member, so Jordan's own route is N1 = the PAC site.
// Walks at PAC, by name: "Heated walk" (Z2, heated: Checked / Problem), then
// "Main entry" (Z1, sidewalk: Cleared / Treated / Problem). "Ski trail" (Z3) is
// no_touch and is never walked. TUDOR-TRANSIT (S2) has no zones: one "Whole site".
// The fake stamps every row at 7:50:18 AM Alaska time (-08:00 on 10/3).
const STORM_CLOCK = '2026-10-03T07:30:00-08:00';
const START_ROW = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const stormWorld = () => {
  const w = world();
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  w.zones = [
    { id: 'Z1', site_id: 'S1', type: 'sidewalk', name: 'Main entry', rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'heated', name: 'Heated walk', rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ski trail', rev: 1 },
  ];
  w.posts = [{ ...POST, shift: 'night-2026-10-02' }];
  w.storms = [START_ROW];
  return w;
};
const logRow = (n, siteId, zoneId, state, by, extra = {}) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02',
  site_id: siteId, zone_id: zoneId, state, note: '', by_key: 'C01', by_name: by, at: '2026-10-03T06:30:00.000-08:00',
  off_route: false, snowing_warned: false, undoes: null, ...extra });
async function openStorm(page, w, o = {}) {
  const calls = await open(page, { token: o.token || 'tok-jordan', snow: fakeSnow(w, o.fake), clockAt: o.clockAt || STORM_CLOCK, delay: o.delay, abortIf: o.abortIf, hangIf: o.hangIf });
  await page.click('nav [data-tab="storm"]');
  return calls;
}
const shiftCalls = (calls) => calls.filter((c) => c.body.action === 'getShiftLog');
const tapCalls = (calls) => calls.filter((c) => c.body.action === 'tapZone');
const walkRow = (page, key) => page.locator('[data-walkrow="' + key + '"]');
const walkBtn = (page, key, state) => page.locator('[data-walk="' + key + '"][data-state="' + state + '"]');
const phoneState = (page) => page.evaluate(() => SnowShiftUI.state());
// Another visibilitychange = the app coming back on screen = one poll now.
const pollNow = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
// The app mirrors what is open onto the browser history (the phone's Back button) and pops it
// with history.go(), which answers later. Before a second page.goto in one test, wait for that
// pop to land: with nothing open, the app's own stack is empty.
const backSettled = (page) => page.waitForFunction(() => !((history.state && history.state.snow) || []).length);
// Matt and the leads land on the live view; tapping a route opens it as the crew see it.
const openRoute = async (page, id) => { await page.locator('[data-openroute="' + id + '"]').click(); await expect(page.locator('#liveBack')).toBeVisible(); };

// Matt 10/4/26: hand work (lot rows, curbs) is walked like a sidewalk; a snow
// pile only shows where snow goes and is never walked.
test('hand work is walked like a sidewalk; a snow pile is never walked', async ({ page }) => {
  const w = stormWorld();
  w.zones.push({ id: 'Z4', site_id: 'S1', type: 'hand', name: 'Lot row', rev: 1 },
    { id: 'Z5', site_id: 'S1', type: 'storage', name: 'Snow pile 1', rev: 1 });
  await openStorm(page, w);
  // By name: Heated walk, Lot row, Main entry. No pile, no ski trail.
  expect(await page.locator('[data-walkrow]').evaluateAll((els) => els.map((e) => e.dataset.walkrow))).toEqual(['S1|Z2', 'S1|Z4', 'S1|Z1']);
  expect(await page.locator('[data-walkrow="S1|Z4"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['cleared', 'treated', 'problem']);
  await expect(page.locator('[data-walk^="S1|Z5"]')).toHaveCount(0);
});

// Part A (Matt, 10/4/26): tonight's posted Board decides what a phone offers;
// the server's live Board stays the authority.
const boardPost = (r1, r2) => ({ ...POST, shift: 'night-2026-10-02', routes: [
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: null, members: [], ...r2 },
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: null, members: [], ...r1 }] });

test('off the posted Board: the Storm tab is read-only and says why', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C01' }, {})]; // Jordan is not on it
  w.log = [logRow(2, 'S1', 'Z1', 'cleared', 'Alex Test')];
  await openStorm(page, w);
  await expect(page.locator('main')).toContainText("You're not on tonight's posted Board.");
  await page.click('#otherRoutes');
  await expect(page.locator('main')).toContainText('PAC');
  await expect(page.locator('[data-walk]')).toHaveCount(0);
  await expect(page.locator('[data-undo]')).toHaveCount(0);
  await expect(page.locator('[data-card]')).toHaveCount(0);
});

test('no post yet: the crew still get the walk buttons, and the server decides', async ({ page }) => {
  const w = stormWorld();
  w.posts = [];
  await openStorm(page, w);
  await page.click('#otherRoutes');
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
});

test('a Board lead who is crew on the roster gets the storm controls, in Matt\'s words', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C03' }, {})]; // Jordan (is_lead false) leads N1 tonight
  await openStorm(page, w);
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('[data-storm="stopped"]')).toHaveText('Snow stopped (melt + rock OK)');
  await expect(page.locator('[data-storm="end"]')).toHaveText('Close storm (cleanup done)');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await page.click('[data-storm="end"]');
  await expect(page.locator('#dlgIn h2')).toHaveText('Close the storm?');
  await expect(page.locator('#sc_yes')).toHaveText('Yes, close storm');
});

test('a roster lead who is not on the posted Board gets no storm controls', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ members: ['C03'] }, {})]; // Alex (is_lead true) is on no route tonight
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  await expect(page.locator('main')).toContainText("You're not on tonight's posted Board.");
});

// Review fix (10/4/26): Matt posts Jordan as N1's lead while Jordan has the Storm tab open.
// The 60 s post check redraws the tab, and the controls follow the new post, no reopen needed.
test('a new post that makes you lead brings the storm controls without reopening the tab', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ members: ['C03'] }, {})]; // Jordan rides N1
  await openStorm(page, w);
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  w.posts = [{ ...boardPost({ lead: 'C03' }, {}), id: 'P2', posted_at: '2026-10-03T15:30:00.000Z' }];
  await page.clock.runFor(60000); // three 20 s ticks: the third re-reads the post
  await expect(page.locator('#stormctl')).toBeVisible();
});


// ---- Clean again (Part B1, Matt 10/4/26) ----
// PAC (S1) on N1: Z1 cleared + Z2 checked by Alex (seq 1, 2: the fake numbers new rows by count). The fake stamps rows 7:50 AM.
const cleanedWorld = () => { const w = stormWorld(); w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')]; return w; };
const pressed = (page, key) => page.locator('[data-walk="' + key + '"][aria-pressed="true"]');

test('Matt cleans a site again: every walk starts over and the site shows pass 2', async ({ page }) => {
  const calls = await openStorm(page, cleanedWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
  await page.click('[data-again="S1"]');
  await expect(page.locator('#dlgIn h2')).toHaveText('Clean PAC again?');
  await expect(page.locator('#dlgIn')).toContainText('Every walk at PAC goes back to not done for pass 2. Pass 1 stays on the record.');
  await page.click('#ag_yes');
  await expect.poll(() => calls.filter((c) => c.body.action === 'cleanAgain').length).toBe(1);
  await expect(page.locator('[data-passline="S1"]')).toContainText('Pass 2 · Clean again 7:50 AM by Matthew');
  await expect(pressed(page, 'S1|Z1')).toHaveCount(0);
  await expect(pressed(page, 'S1|Z2')).toHaveCount(0);
});

test('Undo on the pass line puts pass 1 back', async ({ page }) => {
  await openStorm(page, cleanedWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await page.click('#ag_yes');
  await expect(page.locator('[data-passline="S1"]')).toBeVisible();
  await page.click('[data-passline="S1"] [data-undo]');
  await expect(page.locator('[data-passline="S1"]')).toHaveCount(0);
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
});

test('a member sees no Clean again; the posted lead does', async ({ page }) => {
  await openStorm(page, cleanedWorld()); // Jordan, a member of N1
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
  await expect(page.locator('[data-again]')).toHaveCount(0);
});

test('the posted lead gets Clean again; a refusal shows its reason', async ({ page }) => {
  const w = stormWorld(); // nothing done yet at PAC
  await openStorm(page, w, { token: 'tok-alex' }); // Alex leads N1 on the post
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await page.click('#ag_yes');
  await expect(page.locator('[data-shiftsite="S1"]')).toContainText('Nothing to clean again yet');
});

// B1 review minor (10/6/26): a refused Clean again stayed under the site for good, even after
// the site had work in its pass. It goes once a newer row AT THAT SITE comes in, and not before:
// a poll that brings only another site's row leaves it.
test('a refused Clean again stays until a newer row at that site comes in', async ({ page }) => {
  const w = stormWorld(); // nothing done yet at PAC
  await openStorm(page, w, { token: 'tok-alex' });
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await page.click('#ag_yes');
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(site).toContainText('Nothing to clean again yet');
  // Someone on N2 clears the other site: the phone has the row, the refusal stays.
  w.log.push(logRow(1, 'S2', 'whole', 'cleared', 'Jordan Demo', { by_key: 'C03' }));
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).log.length).toBe(1);
  await expect(site).toContainText('Nothing to clean again yet');
  // Jordan clears PAC's main entry on his own phone: the refusal is out of date and goes.
  w.log.push(logRow(2, 'S1', 'Z1', 'cleared', 'Jordan Demo', { by_key: 'C03' }));
  await pollNow(page);
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
  await expect(site).not.toContainText('Nothing to clean again yet');
  await expect(site.locator('[role="alert"]')).toHaveCount(0);
});

// A Clean again or New snow that never reached the server gets Retry, as a walk does
// (B2 review: it said "not saved" on the site line with no way to send it again).
test('no signal: a Clean again says not saved, and Retry sends it', async ({ page }) => {
  const net = { down: true }, w2 = cleanedWorld();
  const calls = await openStorm(page, w2, { token: 'tok-alex', abortIf: (b) => net.down && b.action === 'cleanAgain' });
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await page.click('#ag_yes');
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(site).toContainText('Not saved: no signal');
  // Unlike a refusal, a Clean again that never left the phone is still wanted after
  // someone else taps the site: it keeps its Retry.
  w2.log.push(logRow(3, 'S1', 'Z1', 'cleared', 'Jordan Demo', { by_key: 'C03' }));
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).log.length).toBe(3);
  await expect(site).toContainText('Not saved: no signal');
  net.down = false;
  await page.click('[data-retry="S1|*"]');
  await expect(page.locator('[data-passline="S1"]')).toContainText('Pass 2 · Clean again');
  await expect(site).not.toContainText('Not saved');
  expect(calls.filter((c) => c.body.action === 'cleanAgain').map((c) => c.body.site_id)).toEqual(['S1', 'S1']);
});

// Matt 10/4/26: an open Problem is carried into the next pass, marked with its pass,
// until someone taps that walk again. Clean again never hides it.
test('an open Problem stays in the Problems box after Clean again, marked (pass 1)', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice, needs chipper' }), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')];
  await openStorm(page, w, { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('[data-again="S1"]');
  await expect(page.locator('#dlgIn')).toContainText("Copy for BT first if pass 1 isn't posted yet.");
  await page.click('#ag_yes');
  await expect(page.locator('[data-passline="S1"]')).toBeVisible();
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toContainText('ice, needs chipper');
  await expect(page.locator('#problems')).toContainText('(pass 1)');
  await openRoute(page, 'R1');
  await page.click('[data-walk="S1|Z1"][data-state="cleared"]');
  await expect(pressed(page, 'S1|Z1')).toHaveCount(1);
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toHaveCount(0);
});

// Matt 10/4/26: short site codes ("PH", "PG") are unreadable, even to Matt. Every list shows the
// address beside the code; the name itself stays the code the crew know.
test('short site names show their address on the Routes tab, in the route editor and on the Storm tab', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => ({ ...s, address: s.id === 'S1' ? '4001 TUDOR CENTRE' : '3600 MLK' }));
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: [] }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.sitelist li').first()).toContainText('PAC');
  await expect(page.locator('.sitelist li').first()).toContainText('4001 TUDOR CENTRE');
  await page.click('[data-edit="route:R2"]');
  await expect(page.locator('#r_add option[value="S1"]')).toHaveText('PAC · 4001 TUDOR CENTRE');
  await page.click('#dlgClose');
  // Closing the editor pops its Back step with history.go(-1), which lands later; a goto
  // started before it lands is cancelled (net::ERR_ABORTED, 10/9/26). Wait for the stack to settle.
  await backSettled(page);
  await openStorm(page, w);
  await expect(page.locator('.shift-site').first()).toContainText('4001 TUDOR CENTRE');
});

// Matt 10/4/26: the Sites tab groups by customer so the hospital sites sit together. A site with
// no customer yet goes last, under its own heading; nothing is guessed.
test('the Sites tab groups sites by customer, and the site form edits it', async ({ page }) => {
  const w = world();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1, customer: 'ANTHC' }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 },
    { id: 'S3', name: 'APMB', rev: 1, customer: 'ANTHC' }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  expect(await page.locator('.site-group').allTextContents()).toEqual(['ANTHC', 'No customer yet']);
  expect(await page.locator('.site-card').evaluateAll((els) => els.map((e) => e.dataset.site))).toEqual(['S3', 'S1', 'S2']);
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#s_cust')).toHaveValue('');
  await page.fill('#s_cust', 'MOA');
  await page.click('#s_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  expect(calls.find((c) => c.body.action === 'saveSite').body.record.customer).toBe('MOA');
});

// Callouts and day ranking (Part B2, Matt 10/4/26): two numbers Matt decides per site, so they ship
// blank and blank is sent as null, never 0. PAC (S1) is a site saved before this work: it has no
// callout_in or day_rank key at all, and its boxes must read empty, never "undefined".
test('the site form sets a callout depth and a day rank, sent as numbers; blank sends null', async ({ page }) => {
  const w = world();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'CALLOUT-TEST', rev: 1, callout_in: 1.5, day_rank: 3 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  const saves = () => calls.filter((c) => c.body.action === 'saveSite');
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('label[for="s_callout"]')).toHaveText('Callout depth (inches), blank = no nudge');
  await expect(page.locator('label[for="s_rank"]')).toHaveText('Day rank (1 = first on day shift), blank = by choice');
  await expect(page.locator('#s_callout')).toHaveValue('');
  await expect(page.locator('#s_rank')).toHaveValue('');
  await page.fill('#s_callout', '1');
  await page.fill('#s_rank', '2');
  await page.click('#s_save');
  await expect.poll(() => saves().length).toBe(1);
  expect(saves()[0].body.record.callout_in).toBe(1);   // the number 1, never the text '1'
  expect(saves()[0].body.record.day_rank).toBe(2);
  // Reopened: the stored values are in the boxes. Cleared: both are sent as null (the key is there).
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_callout')).toHaveValue('1');
  await expect(page.locator('#s_rank')).toHaveValue('2');
  await page.fill('#s_callout', '');
  await page.fill('#s_rank', '');
  await page.click('#s_save');
  await expect.poll(() => saves().length).toBe(2);
  expect(saves()[1].body.record).toHaveProperty('callout_in', null);
  expect(saves()[1].body.record).toHaveProperty('day_rank', null);
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#s_callout')).toHaveValue('1.5');
  await expect(page.locator('#s_rank')).toHaveValue('3');
  // Something that is not a number is sent as typed: the server refuses it in its own words.
  await page.fill('#s_callout', 'abc');
  await page.fill('#s_rank', '2.5');
  await page.click('#s_save');
  await expect.poll(() => saves().length).toBe(3);
  expect(saves()[2].body.record.callout_in).toBe('abc');
  expect(saves()[2].body.record.day_rank).toBe(2.5);
  await expect(page.locator('#s_err')).toHaveText('Callout depth is inches, more than 0 and at most 24; Day rank is a whole number from 1 to 99');
});

test('crew see their own route\'s walks first and other routes behind a button', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  // Own route N1 only: PAC, with Heated walk before Main entry (by name).
  await expect(page.locator('.shift-site')).toHaveCount(1);
  await expect(page.locator('.shift-site')).toContainText('PAC');
  await expect(page.locator('[data-walkrow]')).toHaveCount(2);
  expect(await page.locator('[data-walkrow]').evaluateAll((els) => els.map((e) => e.dataset.walkrow))).toEqual(['S1|Z2', 'S1|Z1']);
  expect(await page.locator('[data-walkrow="S1|Z2"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['checked', 'problem']);
  expect(await page.locator('[data-walkrow="S1|Z1"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['cleared', 'treated', 'problem']);
  await expect(page.locator('[data-walk^="S1|Z3"]')).toHaveCount(0); // no_touch is never walked
  await expect(page.locator('[data-walk^="S2|"]')).toHaveCount(0);   // N2 is not Jordan's
  await expect(page.locator('main')).not.toContainText('TUDOR-TRANSIT');
  await page.click('#otherRoutes');
  await expect(page.locator('main')).toContainText('TUDOR-TRANSIT');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
});

test('a tap sends site, zone and state, and the walk shows who and when', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)).toHaveLength(1);
  const body = tapCalls(calls)[0].body;
  expect(body).toMatchObject({ action: 'tapZone', site_id: 'S1', zone_id: 'Z1', state: 'cleared', note: '' });
  // The server knows who and when and which shift: the phone sends none of it.
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'shift_id', 'storm_id', 'seq']) expect(body).not.toHaveProperty(k);
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toHaveAttribute('aria-pressed', 'true');
  await expect(walkRow(page, 'S1|Z2')).not.toContainText('Jordan Demo'); // the other walk is untouched
});

test('a problem needs a note before it can be sent', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await walkBtn(page, 'S1|Z1', 'problem').click();
  await expect(page.locator('[data-note="S1|Z1"]')).toBeVisible();
  await expect(page.locator('[data-send="S1|Z1"]')).toBeDisabled();
  expect(tapCalls(calls)).toHaveLength(0); // opening the box sent nothing
  await page.fill('[data-note="S1|Z1"]', '   ');
  await expect(page.locator('[data-send="S1|Z1"]')).toBeDisabled(); // spaces are blank
  await page.fill('[data-note="S1|Z1"]', 'ice under the mat');
  await expect(page.locator('[data-send="S1|Z1"]')).toBeEnabled();
  await page.click('[data-send="S1|Z1"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Problem · Jordan Demo · 7:50 AM');
  await expect(walkRow(page, 'S1|Z1')).toContainText('ice under the mat');
  expect(tapCalls(calls)).toHaveLength(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S1', zone_id: 'Z1', state: 'problem', note: 'ice under the mat' });
  await expect(page.locator('[data-note="S1|Z1"]')).toHaveCount(0); // the box closes once it is saved
});

test('a double tap sends one tap', async ({ page }) => {
  // Apps Script takes a second or two: the second tap must not add a second row.
  const calls = await openStorm(page, stormWorld(), { delay: { tapZone: 700 } });
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await page.evaluate(() => { const b = document.querySelector('[data-walk="S1|Z1"][data-state="cleared"]'); b.click(); b.click(); });
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  expect(tapCalls(calls)).toHaveLength(1);
  expect((await phoneState(page)).log).toHaveLength(1);
});

test('no signal: the walk says not saved and Retry sends it', async ({ page }) => {
  const net = { down: true };
  const calls = await openStorm(page, stormWorld(), { abortIf: (b) => net.down && b.action === 'tapZone' });
  await walkBtn(page, 'S1|Z1', 'treated').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Not saved');
  await expect(page.locator('[data-retry="S1|Z1"]')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).not.toContainText('Jordan Demo'); // nothing is shown as done
  net.down = false;
  await page.click('[data-retry="S1|Z1"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo · 7:50 AM');
  await expect(page.locator('[data-retry]')).toHaveCount(0);
  // The first try and the retry are the same tap.
  expect(tapCalls(calls)).toHaveLength(2);
  expect(tapCalls(calls)[1].body).toMatchObject({ site_id: 'S1', zone_id: 'Z1', state: 'treated', note: '' });
});

// Part A review minor (10/6/26): a tap refused because the person is not on tonight's Board was
// offered Retry, which can only be refused again. The reason shows; Retry does not.
test("a tap refused as not allowed shows why, with no Retry", async ({ page }) => {
  const fake = fakeSnow(stormWorld());
  const NOT_ON = "You're not on tonight's Board. Ask Matt to add you.";
  await open(page, { token: 'tok-jordan', clockAt: STORM_CLOCK,
    snow: (b) => b.action === 'tapZone' ? { ok: false, code: 'forbidden', reason: NOT_ON, version: 'handoff-1' } : fake(b) });
  await page.click('nav [data-tab="storm"]');
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Not saved: ' + NOT_ON);
  await expect(page.locator('[data-retry]')).toHaveCount(0);
});

test('with no storm open the tap is refused and says so', async ({ page }) => {
  // Matt ends the storm while Jordan's screen is open: the phone has not heard yet.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Not saved: No storm is open');
  await expect(walkRow(page, 'S1|Z1')).not.toContainText('Jordan Demo');
  expect(w.log || []).toHaveLength(0); // nothing was written
  // The refusal also makes the phone ask again, so the banner catches up.
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  expect(shiftCalls(calls).length).toBeGreaterThanOrEqual(2);
});

test('undo sends the seq and the walk goes back', async ({ page }) => {
  // Alex cleared Main entry (seq 1), then Jordan marked it treated (seq 2).
  // Undoing seq 2 restores what the row before it said: Cleared, by Alex.
  // The fake writes that as a NEW row (seq 3, by whoever undid it).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z1', 'treated', 'Jordan Demo')];
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo');
  await expect(page.locator('[data-undo]')).toHaveCount(1);       // only the newest row on the walk
  await expect(page.locator('[data-undo="2"]')).toBeVisible();
  await page.click('[data-undo="2"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  const undo = calls.filter((c) => c.body.action === 'undoTap');
  expect(undo).toHaveLength(1);
  expect(undo[0].body.seq).toBe(2);
  expect(w.log.map((r) => [r.seq, r.state, r.undoes])).toEqual([[1, 'cleared', null], [2, 'treated', null], [3, 'cleared', 'L-2']]);
  await expect(page.locator('[data-undo="3"]')).toBeVisible(); // the new newest row can be undone in turn
  await expect(page.locator('[data-undo="2"]')).toHaveCount(0);
});

test('a poll and a tap carrying the same row show it once', async ({ page }) => {
  // Jordan taps (the fake writes L-1, seq 1) before his phone's cursor moves, so
  // the next poll (cursor 0) carries L-1 again. Then Alex treats the same walk
  // (L-2, seq 2) and the next poll carries only that. Worked by hand:
  // rows after the tap [L-1]; after poll 2 still [L-1]; after poll 3 [L-1, L-2].
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // first poll answered
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(1); // poll 2 has been merged
  const s = await phoneState(page);
  expect(shiftCalls(calls)[1].body.cursor.log).toBe(0);      // it did ask from 0, so it was handed L-1 again
  expect(s.log.map((r) => r.id)).toEqual(['L-1']);          // once
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  w.log.push(logRow(2, 'S1', 'Z1', 'treated', 'Alex Test'));
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(2);
  expect((await phoneState(page)).log.map((r) => r.id)).toEqual(['L-1', 'L-2']);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Alex Test');
  expect(w.log).toHaveLength(2);
});

test('the phone asks only for rows after its cursor', async ({ page }) => {
  // The fake holds 2 log rows and 1 storm row, no visits. First ask: from zero.
  // The reply says how many rows each tab has (2, 1, 0); the second ask carries
  // that back, plus the seq of the last row it got per tab (2, 1, none).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')];
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Alex Test');
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  const [first, second] = shiftCalls(calls).map((c) => c.body);
  // Trucks and Sheets (route sheets) are two more tabs on the same cursor; this fake has none of either.
  // Posts ride the cursor too (Matt's only: Jordan's poll gets none, cursor 0); they have no seq, so no `last`.
  expect(first.cursor).toEqual({ log: 0, storms: 0, visits: 0, trucks: 0, sheets: 0, posts: 0 });
  expect(second.cursor).toEqual({ log: 2, storms: 1, visits: 0, trucks: 0, sheets: 0, posts: 0 });
  expect(second.last).toEqual({ log: 2, storms: 1, visits: null, trucks: null, sheets: null });
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(2);
  expect((await phoneState(page)).log.map((r) => r.id)).toEqual(['L-1', 'L-2']); // nothing came twice
});

test('rows kept out of seq order in the Sheet do not make every poll reset', async ({ page }) => {
  // Matt hand-sorted the Log tab: the sheet holds [L-2, L-1] in that physical
  // order. The server checks the row at the cursor POSITION (the 2nd row, L-1),
  // so after the first poll the phone must say last = 1 (the last row it was
  // handed, in the order it was handed), not 2 (the highest seq). Saying 2
  // would mismatch row 2's seq 1: reset:true with the whole tab, every 20 s.
  const w = stormWorld();
  w.log = [logRow(2, 'S1', 'Z1', 'treated', 'Alex Test'), logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test')];
  const replies = [];
  page.on('response', async (res) => {
    if (!isSnow(new URL(res.url()))) return;
    try { const j = await res.json(); if (j.reset) replies.push(j); } catch (e) { /* not ours */ }
  });
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Alex Test'); // seq 2 is the newest row, wherever it sits
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  expect(shiftCalls(calls)[1].body.cursor.log).toBe(2);
  expect(shiftCalls(calls)[1].body.last.log).toBe(1);
  await expect.poll(() => replies.length).toBe(2);
  expect(replies[1].reset.log).toBe(false);
  expect(replies[1].log).toEqual([]);
});

test('polling runs only on the Storm tab, and only while the page is visible', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(shiftCalls(calls)).toHaveLength(1);
  // Another tab: the timer is gone. Three ticks' worth of time asks nothing.
  await page.click('nav [data-tab="tonight"]');
  await page.clock.runFor(60000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(1);
  // Back on Storm: one poll at once, and the timer runs again (one tick = one more).
  await page.click('nav [data-tab="storm"]');
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  // Page hidden (phone locked): the timer ticks but asks nothing.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(60000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(2);
  // Visible again: exactly one poll, straight away.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => shiftCalls(calls).length).toBe(3);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(3);
});

test('polling stops on an expired session and shows sign-in', async ({ page }) => {
  const expired = { on: false };
  const calls = await openStorm(page, stormWorld(), { fake: { expired } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expired.on = true;
  await page.clock.runFor(20000); // the 20 s timer fires one poll; the server says the session is gone
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  const before = shiftCalls(calls).length; // the first poll plus the one that was refused: 2
  expect(before).toBe(2);
  await page.clock.runFor(60000);          // three more timer ticks' worth of time
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(before);
});

test('a reset reply replaces the phone\'s rows', async ({ page }) => {
  // The phone has seen 3 rows (cursor 3). Then rows are deleted by hand in the
  // Sheet: only L-1 is left. The cursor (3) is past the tab (1 row), so the
  // server answers every row with reset: true. Heated walk's "Checked" (L-2)
  // and the Whole site row (L-3) must go from the phone; Main entry stays.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test'), logRow(3, 'S2', 'whole', 'cleared', 'Alex Test')];
  await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z2')).toContainText('Checked · Alex Test');
  expect((await phoneState(page)).cursor.log).toBe(3);
  w.log = [w.log[0]];
  await pollNow(page);
  await expect(walkRow(page, 'S1|Z2')).not.toContainText('Alex Test');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Alex Test');
  const s = await phoneState(page);
  expect(s.log.map((r) => r.id)).toEqual(['L-1']);
  expect(s.cursor.log).toBe(1);
});

test('a site with no zones shows one Whole site walk', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await page.click('#otherRoutes');
  await expect(page.locator('[data-walkrow^="S2|"]')).toHaveCount(1);
  await expect(walkRow(page, 'S2|whole')).toContainText('Whole site');
  expect(await page.locator('[data-walkrow="S2|whole"] [data-walk]').evaluateAll((els) => els.map((e) => e.dataset.state))).toEqual(['cleared', 'treated', 'problem']);
  await walkBtn(page, 'S2|whole', 'treated').click();
  await expect(walkRow(page, 'S2|whole')).toContainText('Treated · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S2', zone_id: 'whole', state: 'treated' });
});

test('the banner says whether it is snowing, or that no storm is open', async ({ page }) => {
  const w = stormWorld();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'snowing', storm_id: 'ST-1', at: '2026-10-03T06:10:00.000-08:00', by_name: 'Matthew' });
  await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
});

test('with no storm row at all the banner says no storm is open', async ({ page }) => {
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
});

test('Matt lands on the live view, and opens any route to tap its walks', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  // The live view shows no walk buttons: a route opens on tap (Task 6).
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  await expect(page.locator('[data-walk]')).toHaveCount(0);
  await openRoute(page, 'R2');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toHaveCount(0); // that route only
  await expect(page.locator('#otherRoutes')).toHaveCount(0);
  await walkBtn(page, 'S2|whole', 'cleared').click();
  await expect(walkRow(page, 'S2|whole')).toContainText('Cleared · Matthew');
  expect(tapCalls(calls)).toHaveLength(1);
  // Back to the live view: the route now counts that site as done.
  await page.click('#liveBack');
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('1 of 1 sites done');
  await expect(page.locator('[data-walk]')).toHaveCount(0);
});

test('crew still land on Tonight, with a Storm tab beside it', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="storm"]')).toBeVisible();
});

// ---------------- the Storm tab: the site card ----------------
// Replaces the paper route sheet's per-site fields: depth, materials used,
// equipment minutes. Start and finish are never typed: they are the first and
// last tap at the site this shift (CrewShiftLog.siteTimes). Same 7:30 AM clock
// as above, so the shift is "night-2026-10-02" and the fake files cards there.
const EQUIP = ['blower', 'snowrator', 'bobcat', 'sweepster'];
const visitRow = (n, siteId, byKey, byName, extra = {}) => ({ id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02',
  site_id: siteId, by_key: byKey, by_name: byName, at: '2026-10-03T06:45:00.000-08:00', depth_in: '', materials_used: '',
  equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, ...extra });
const cardBtn = (page, id) => page.locator('[data-card="' + id + '"]');
const visitCalls = (calls) => calls.filter((c) => c.body.action === 'saveVisit');
const openCard = async (page, id) => { await cardBtn(page, id).click(); await expect(page.locator('#dlg')).toBeVisible(); };

// Copy for BT (Matt, 10/3/26): the lead copies the text and posts it in BuilderTrend
// as themselves. The app never talks to BT; this only fills the clipboard.
const stubClipboard = (page) => page.addInitScript(() => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
});
test('the lead copies a site\'s BT note and sees the times to type', async ({ page }) => {
  // PAC: Main entry cleared 6:30 AM, Heated walk checked 6:45 AM, both this shift (night of 10/2, clock 7:30 AM).
  // Walks in name order: "Cleared: Main entry. Checked: Heated walk." Time in 6:30 AM, out 6:45 AM.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: '2026-10-03T06:30:00.000-08:00' }),
    logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: '2026-10-03T06:45:00.000-08:00' })];
  await stubClipboard(page);
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await openRoute(page, 'R1');
  await page.locator('[data-bt="S1"]').click();
  await expect(page.locator('#bt_in')).toHaveText('6:30 AM');
  await expect(page.locator('#bt_out')).toHaveText('6:45 AM');
  await expect(page.locator('#bt_text')).toHaveValue('Cleared: Main entry. Checked: Heated walk.');
  await page.click('#bt_copy');
  await expect(page.locator('#toast')).toContainText('Copied');
  expect(await page.evaluate(() => window.__copied)).toEqual(['Cleared: Main entry. Checked: Heated walk.']);
  // Nothing is sent anywhere: copying makes no server call.
  expect(calls.filter((c) => !['bootstrap', 'getShiftLog', 'getPost', 'getZones'].includes(c.body.action))).toEqual([]);
});
test('crew have no Copy for BT button; Matt does', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('[data-walkrow="S1|Z1"]')).toBeVisible();
  await expect(page.locator('[data-bt]')).toHaveCount(0);
});
test('Matt sees Copy for BT on a route he opens', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await expect(page.locator('[data-bt="S1"]')).toBeVisible();
});

test('the site card sends depth, materials and ticked equipment minutes only', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  // Minutes cannot be typed until the machine is ticked.
  await expect(page.locator('[data-eqmin="blower"]')).toBeDisabled();
  await page.fill('#vc_depth', '3.5');
  await page.fill('#vc_mat', 'salt, 2 bags');
  await page.check('[data-eq="blower"]');
  await expect(page.locator('[data-eqmin="blower"]')).toBeEnabled();
  await page.fill('[data-eqmin="blower"]', '30');
  await page.check('[data-eq="bobcat"]');
  await page.fill('[data-eqmin="bobcat"]', '45');
  // Ticked, typed, then unticked: the minutes are not sent.
  await page.check('[data-eq="snowrator"]');
  await page.fill('[data-eqmin="snowrator"]', '99');
  await page.uncheck('[data-eq="snowrator"]');
  await expect(page.locator('[data-eqmin="snowrator"]')).toBeDisabled();
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  const body = visitCalls(calls)[0].body;
  // Worked out: 3.5 in; the text as typed; blower 30 and bobcat 45; snowrator and sweepster unticked = blank.
  expect(body).toMatchObject({ action: 'saveVisit', site_id: 'S1', depth_in: 3.5, materials_used: 'salt, 2 bags',
    equipment: { blower: 30, snowrator: '', bobcat: 45, sweepster: '' } });
  expect(Object.keys(body.equipment).sort()).toEqual([...EQUIP].sort());
  // The server knows who, when and which shift: the phone sends none of it, nor start/finish.
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'shift_id', 'storm_id', 'seq', 'start', 'finish']) expect(body).not.toHaveProperty(k);
  expect(w.visits).toHaveLength(1);
  expect((await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
});

test('blank fields are sent blank, never 0', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  // Nothing typed, nothing ticked: depth, materials and every machine go as ''.
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const first = visitCalls(calls)[0].body;
  expect(first.depth_in).toBe('');
  expect(first.materials_used).toBe('');
  expect(first.equipment).toEqual({ blower: '', snowrator: '', bobcat: '', sweepster: '' });
  // A typed zero is a real answer and is sent as 0.
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '0');
  await page.check('[data-eq="blower"]');
  await page.fill('[data-eqmin="blower"]', '0');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const second = visitCalls(calls)[1].body;
  expect(second.depth_in).toBe(0);
  expect(second.equipment).toEqual({ blower: 0, snowrator: '', bobcat: '', sweepster: '' });
  expect(second.materials_used).toBe('');
});

test('a ticked machine needs minutes before it saves', async ({ page }) => {
  // Ticking says "this machine was used"; saved blank, the tick would be lost on reopening.
  // Blower ticked with no minutes, Bobcat also ticked with none: the first (Blower, in card order) is named.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  await page.check('[data-eq="bobcat"]');
  await page.check('[data-eq="blower"]');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('Add minutes for Blower, or untick it');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(visitCalls(calls)).toHaveLength(0);
  expect(w.visits || []).toHaveLength(0);
  // Blower filled in: now Bobcat is the one named, still nothing sent.
  await page.fill('[data-eqmin="blower"]', '30');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toHaveText('Add minutes for Bobcat, or untick it');
  expect(visitCalls(calls)).toHaveLength(0);
  // Untick it (unticked machines go as ''), and Save sends the minutes typed.
  await page.uncheck('[data-eq="bobcat"]');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  expect(visitCalls(calls)[0].body.equipment).toEqual({ blower: 30, snowrator: '', bobcat: '', sweepster: '' });
});

test('materials needed is printed beside materials used', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, materials_needed: '4-5 bags <b>IceMelt</b>' } : s));
  await openStorm(page, w);
  await openCard(page, 'S1');
  // Same row as the input, shown as text (the markup is not run).
  await expect(page.locator('.vc-matrow #vc_mat')).toHaveCount(1);
  await expect(page.locator('.vc-matrow #vc_needed')).toHaveText('Needed: 4-5 bags <b>IceMelt</b>');
  await expect(page.locator('#vc_needed b')).toHaveCount(0);
  // The typed box starts empty: the needed list is a hint, not an answer.
  await expect(page.locator('#vc_mat')).toHaveValue('');
  await page.click('#dlgClose');
  // A site with none listed prints no "Needed".
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('#vc_needed')).toHaveCount(0);
});

test('start and finish come from the first and last tap, not typed', async ({ page }) => {
  // Seeded taps at S1 this shift: 6:30 AM (L-1) and 7:10 AM (L-2). Not counted: a tap at
  // S1 on another shift (L-3, 1:00 AM 10/1). S2 has none.
  // The fake stamps Jordan's own tap at 7:50:18 AM: finish moves to 7:50 AM, start stays 6:30 AM.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: '2026-10-03T06:30:00.000-08:00' }),
    logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: '2026-10-03T07:10:00.000-08:00' }),
    logRow(3, 'S1', 'Z1', 'treated', 'Alex Test', { storm_id: 'ST-0', shift_id: 'day-2026-10-01', at: '2026-10-01T01:00:00.000-08:00' })];
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  await expect(page.locator('#vc_start')).toHaveText('6:30 AM');
  await expect(page.locator('#vc_finish')).toHaveText('7:10 AM');
  // Read-only: not form fields.
  expect(await page.locator('#vc_start, #vc_finish').evaluateAll((els) => els.map((e) => e.tagName))).not.toContain('INPUT');
  await page.click('#dlgClose');
  await walkBtn(page, 'S1|Z1', 'treated').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo · 7:50 AM');
  await openCard(page, 'S1');
  await expect(page.locator('#vc_start')).toHaveText('6:30 AM');
  await expect(page.locator('#vc_finish')).toHaveText('7:50 AM');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  for (const k of ['start', 'finish']) expect(visitCalls(calls)[0].body).not.toHaveProperty(k);
  // A site nobody has tapped yet shows a dash, not a time.
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('#vc_start')).toHaveText('—');
  await expect(page.locator('#vc_finish')).toHaveText('—');
});

test('reopening the card shows your own last save, not someone else\'s', async ({ page }) => {
  // S1, this shift (night-2026-10-02). Jordan (C03) saved V-1; Alex (C01) saved V-2
  // and then V-5, so the newest card on the site is Alex's, and Jordan must still see V-1.
  // Not Jordan's: V-3 (S1 on an earlier shift) and V-4 (another site).
  const w = stormWorld();
  w.visits = [
    visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 2, materials_used: 'salt', equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: 0 } }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: 9, materials_used: 'sand', equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } }),
    visitRow(3, 'S1', 'C03', 'Jordan Demo', { storm_id: 'ST-0', shift_id: 'day-2026-10-01', depth_in: 7, materials_used: 'old shift' }),
    visitRow(4, 'S2', 'C03', 'Jordan Demo', { depth_in: 5, materials_used: 'other site' }),
    visitRow(5, 'S1', 'C01', 'Alex Test', { depth_in: 11, materials_used: 'alex again' })];
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('2');
  await expect(page.locator('#vc_mat')).toHaveValue('salt');
  await expect(page.locator('[data-eq="blower"]')).toBeChecked();
  await expect(page.locator('[data-eqmin="blower"]')).toHaveValue('20');
  await expect(page.locator('[data-eq="sweepster"]')).toBeChecked();   // a saved 0 is a real answer: ticked, shows 0
  await expect(page.locator('[data-eqmin="sweepster"]')).toHaveValue('0');
  await expect(page.locator('[data-eq="bobcat"]')).not.toBeChecked(); // Alex's 45 is not Jordan's
  await expect(page.locator('[data-eqmin="bobcat"]')).toHaveValue('');
  // Change the depth and save: that re-save is Jordan's newest card (V-6).
  await page.fill('#vc_depth', '4');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)[0].body).toMatchObject({ depth_in: 4, materials_used: 'salt', equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: 0 } });
  expect(w.visits).toHaveLength(6);
  expect(w.visits[5]).toMatchObject({ by_key: 'C03', depth_in: 4 });
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('4');
  await expect(page.locator('#vc_mat')).toHaveValue('salt');
});

test('Matt\'s card starts blank when only crew have saved one', async ({ page }) => {
  const w = stormWorld();
  w.visits = [visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 2, materials_used: 'salt', equipment: { blower: 20, snowrator: '', bobcat: '', sweepster: '' } })];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openRoute(page, 'R1'); // Matt lands on the live view; the card is on the route's page
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('');
  await expect(page.locator('#vc_mat')).toHaveValue('');
  await expect(page.locator('[data-eq="blower"]')).not.toBeChecked();
  await page.fill('#vc_depth', '1');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(w.visits[1]).toMatchObject({ by_key: 'admin', depth_in: 1 });
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('1'); // his own now
  expect(visitCalls(calls)).toHaveLength(1);
});

test('a card refused for no open storm says so and stays open; a double tap on Save sends one', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 600 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.evaluate(() => { const b = document.querySelector('#vc_save'); b.click(); b.click(); });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  expect(w.visits).toHaveLength(1);
  // Matt ends the storm while the card is open: the refusal shows on the card and nothing is saved.
  await openCard(page, 'S1');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toHaveText('No storm is open');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(w.visits).toHaveLength(1);
  await expect(page.locator('#vc_save')).toBeEnabled(); // can try again once the busy lock is released
});

// ---------------- the Storm tab: the live view and storm controls (Matt and leads) ----------------
// Matt and the leads land on the live view: Problems in red on top, then every
// route with how far along it is. Tapping a route opens it as the crew see it.
// Crew never get the live view or the controls (the server refuses them too).
const stormCalls = (calls) => calls.filter((c) => c.body.action === 'stormAction');
const at = (hhmm) => '2026-10-03T' + hhmm + ':00.000-08:00';
const ctl = (page, kind) => page.locator('[data-storm="' + kind + '"]');

test('problems show first, in red, with the note and who', async ({ page }) => {
  // Newest row per walk in storm ST-1, worked by hand:
  //   S1|Z1    L1 problem (Alex, 6:30, "ice under the mat")           -> a problem
  //   S1|Z2    L2 problem (Alex, 6:35), then L3 checked (Jordan, 6:40) -> checked: NOT a problem
  //   S2|whole L4 problem (Jordan, 6:50, "drain blocked")             -> a problem
  // Newest first by seq: L4 (TUDOR-TRANSIT, Whole site) then L1 (PAC, Main entry).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice under the mat', at: at('06:30') }),
    logRow(2, 'S1', 'Z2', 'problem', 'Alex Test', { note: 'heat cable dead', at: at('06:35') }),
    logRow(3, 'S1', 'Z2', 'checked', 'Jordan Demo', { by_key: 'C03', at: at('06:40') }),
    logRow(4, 'S2', 'whole', 'problem', 'Jordan Demo', { note: 'drain blocked', by_key: 'C03', at: at('06:50') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#problems')).toBeVisible();
  expect(await page.locator('[data-problem]').evaluateAll((els) => els.map((e) => e.dataset.problem))).toEqual(['S2|whole', 'S1|Z1']);
  const first = page.locator('[data-problem="S2|whole"]'), second = page.locator('[data-problem="S1|Z1"]');
  for (const t of ['TUDOR-TRANSIT', 'Whole site', 'drain blocked', 'Jordan Demo', '6:50 AM']) await expect(first).toContainText(t);
  for (const t of ['PAC', 'Main entry', 'ice under the mat', 'Alex Test', '6:30 AM']) await expect(second).toContainText(t);
  await expect(page.locator('#problems')).not.toContainText('heat cable dead'); // a problem since marked Checked is not one
  // Red (--warn, #b3261e in the light theme), and above every route.
  expect(await page.locator('#problems h2').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(179, 38, 30)');
  const problemsY = (await page.locator('#problems').boundingBox()).y, routeY = (await page.locator('[data-liveroute]').first().boundingBox()).y;
  expect(problemsY).toBeLessThan(routeY);
});

// Routes N1 (PAC, EXTRA), N10 (NEWSITE), N2 (TUDOR-TRANSIT), stored in that order.
const liveWorld = () => {
  const w = stormWorld();
  w.sites = [...w.sites, { id: 'S3', name: 'EXTRA', rev: 1 }, { id: 'S4', name: 'NEWSITE', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S3'] }, { id: 'R3', name: 'N10', rev: 1, site_ids: ['S4'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  return w;
};

// Matt, 10/3/26: with no current Post, his live view shows who the Board has on
// each route, marked as not posted. Leads never get the Board, so they keep
// seeing "Not posted" until he posts.
const boardMoves = () => [
  { id: 'M1', at: '2026-10-02T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' },
  { id: 'M2', at: '2026-10-02T17:01:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' },
];
test('with no current post, Matt sees the Board on each route, marked not posted', async ({ page }) => {
  // No post at all. The Board: Alex leads N1, Jordan on N1; N2 and N10 empty.
  const w = liveWorld(); w.posts = []; w.moves = boardMoves();
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toBeVisible();
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Board, not posted yet: Alex Test (lead), Jordan Demo');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Not posted'); // nobody on the Board either
});
test('a stale post gives way to the Board; a current post wins over it', async ({ page }) => {
  // The post is for night-2026-09-30: stale at the storm clock. The Board moved Jordan to N2 since.
  const w = liveWorld(); w.posts = [{ ...POST, shift: 'night-2026-09-30' }];
  w.moves = [...boardMoves(), { id: 'M3', at: '2026-10-02T18:00:00.000-08:00', worker: 'C03', to_route: 'R2', role: 'member' }];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Board, not posted yet: Alex Test (lead)');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Board, not posted yet: Jordan Demo');
});
test('a current post is shown even when the Board has changed since', async ({ page }) => {
  // stormWorld's post is for the current shift (Alex leads N1, Jordan on N1). The Board says Jordan moved to N2.
  const w = liveWorld();
  w.moves = [...boardMoves(), { id: 'M3', at: '2026-10-02T18:00:00.000-08:00', worker: 'C03', to_route: 'R2', role: 'member' }];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Alex Test (lead), Jordan Demo');
});
// Part A (Matt, 10/4/26, Q5): the live view and storm controls come from LEADING a route on
// tonight's posted Board, not the roster flag. With no post yet, a roster lead gets the crew
// view: the walk buttons (the server's live Board decides), no live view, no controls.
test('a roster lead with no current post gets the crew view, never the Board', async ({ page }) => {
  const w = liveWorld(); w.posts = []; w.moves = boardMoves();
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('#stormctl')).toHaveCount(0);
});

test('a route shows how many sites are done', async ({ page }) => {
  // N1 = PAC (Z1 sidewalk cleared 6:30, Z2 heated checked 6:40: both walks done -> done) + EXTRA (no zones,
  // its one Whole-site walk untapped -> not done): 1 of 2. Last tap 6:40.
  // N2 = TUDOR-TRANSIT untapped: 0 of 1, no taps yet. N10 = NEWSITE untapped: 0 of 1.
  // Numeric order is N1, N2, N10 (not N1, N10, N2). The post names Alex (lead) and Jordan on N1.
  const w = liveWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') }), logRow(2, 'S1', 'Z2', 'checked', 'Jordan Demo', { by_key: 'C03', at: at('06:40') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  expect(await page.locator('[data-liveroute]').evaluateAll((els) => els.map((e) => e.dataset.liveroute))).toEqual(['R1', 'R2', 'R3']);
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('1 of 2 sites done');
  await expect(page.locator('[data-liveroute="R1"] progress')).toHaveAttribute('value', '1');
  await expect(page.locator('[data-liveroute="R1"] progress')).toHaveAttribute('max', '2');
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Alex Test (lead), Jordan Demo');
  await expect(page.locator('[data-liveroute="R1"] .live-last')).toHaveText('Last tap 6:40 AM');
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('0 of 1 sites done');
  await expect(page.locator('[data-liveroute="R2"] progress')).toHaveAttribute('value', '0');
  await expect(page.locator('[data-liveroute="R2"] .live-last')).toHaveText('No taps yet');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Alex Test (lead)');
  await expect(page.locator('[data-liveroute="R3"] .live-count')).toHaveText('0 of 1 sites done');
  await expect(page.locator('[data-liveroute="R3"] .live-who')).toHaveText('Not posted'); // N10 is not on the post
  // Site totals under each site: Jordan's and Alex's cards at PAC, shift night-2026-10-02 (the fake's shift).
  w.visits = [visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 3.5, materials_used: 'salt', equipment: { blower: 30, snowrator: '', bobcat: '', sweepster: '' } }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: 2, materials_used: 'sand', equipment: { blower: 15, snowrator: '', bobcat: 45, sweepster: '' } })];
  await pollNow(page);
  // Worked out: blower 30 + 15 = 45, bobcat 45, nothing logged for the others; depth per person.
  const totals = page.locator('[data-livesite="S1"] .live-totals');
  await expect(totals).toContainText('Blower 45 min');
  await expect(totals).toContainText('Bobcat 45 min');
  await expect(totals).not.toContainText('Snowrator');
  await expect(totals).toContainText('Jordan Demo 3.5 in');
  await expect(totals).toContainText('Alex Test 2 in');
  await expect(page.locator('[data-livesite="S3"] .live-totals')).toHaveCount(0);
});

test('an off-route tap is marked in the live view', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') }),
    logRow(2, 'S2', 'whole', 'cleared', 'Jordan Demo', { by_key: 'C03', off_route: true, at: at('06:50') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-livesite="S2"] .offroute')).toBeVisible();
  await expect(page.locator('[data-livesite="S2"] .offroute')).toContainText('off-route');
  await expect(page.locator('[data-livesite="S2"]')).toContainText('Jordan Demo');
  await expect(page.locator('[data-livesite="S1"] .offroute')).toHaveCount(0); // Alex's tap was on his route
});

test('crew see no storm controls and no live view', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice under the mat', at: at('06:30') })];
  await openStorm(page, w); // Jordan
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible(); // the crew view is there
  await expect(page.locator('#stormctl')).toBeHidden();
  await expect(page.locator('#problems')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-storm]')).toHaveCount(0);
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('[data-openroute]')).toHaveCount(0);
  // Matt ends the storm: still no Start / Reopen for crew.
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('07:40'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('#stormctl')).toBeHidden();
  await expect(page.locator('[data-storm]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Start|End|Reopen) storm$/ })).toHaveCount(0);
});

test('a lead can start a storm; End asks first', async ({ page }) => {
  const w = stormWorld(); w.storms = [];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  // No storm yet: only Start. (Reopen needs a storm to reopen; the rest need one open.)
  await expect(ctl(page, 'start')).toHaveText('Start storm');
  for (const k of ['reopen', 'end', 'snowing', 'stopped', 'night_on']) await expect(ctl(page, k)).toHaveCount(0);
  // Start asks first; Cancel sends nothing.
  await ctl(page, 'start').click();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn')).toContainText('Are you sure?');
  expect(stormCalls(calls)).toHaveLength(0);
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(stormCalls(calls)).toHaveLength(0);
  await ctl(page, 'start').click();
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(stormCalls(calls)[0].body).toMatchObject({ action: 'stormAction', kind: 'start' });
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'storm_id', 'seq']) expect(stormCalls(calls)[0].body).not.toHaveProperty(k);
  expect(w.storms.map((r) => [r.kind, r.by_name])).toEqual([['start', 'Alex Test']]); // who comes from the token
  // Open: End, the Snowing|Stopped switch and Night shift on; no Start, no Reopen.
  for (const k of ['end', 'snowing', 'stopped', 'night_on']) await expect(ctl(page, k)).toBeVisible();
  for (const k of ['start', 'reopen']) await expect(ctl(page, k)).toHaveCount(0);
  await expect(ctl(page, 'stopped')).toHaveAttribute('aria-pressed', 'true');
  // End asks first.
  await ctl(page, 'end').click();
  await expect(page.locator('#dlgIn')).toContainText('Are you sure?');
  expect(stormCalls(calls)).toHaveLength(1);
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  expect(stormCalls(calls)).toHaveLength(2);
  expect(stormCalls(calls)[1].body).toMatchObject({ kind: 'end' });
  // Ended: Start and Reopen are on offer, End is gone.
  await expect(ctl(page, 'start')).toBeVisible();
  await expect(ctl(page, 'reopen')).toBeVisible();
  await expect(ctl(page, 'end')).toHaveCount(0);
  // Reopen and the switch do not ask.
  await ctl(page, 'reopen').click();
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#dlg')).toBeHidden();
  await ctl(page, 'snowing').click();
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  await expect(ctl(page, 'snowing')).toHaveAttribute('aria-pressed', 'true');
  expect(w.storms.map((r) => r.kind)).toEqual(['start', 'end', 'reopen', 'snowing']);
  expect(stormCalls(calls).map((c) => c.body.kind)).toEqual(['start', 'end', 'reopen', 'snowing']);
});

test('a refused storm control says why and the phone catches up', async ({ page }) => {
  // Another lead started a storm a moment ago: this phone has not heard yet. The
  // fake's reasons are the backend's ("End the storm first").
  const w = stormWorld(); w.storms = [];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(ctl(page, 'start')).toBeVisible();
  w.storms.push(START_ROW);
  await ctl(page, 'start').click();
  await page.click('#sc_yes');
  await expect(page.locator('#stormerr')).toHaveText('Not saved: End the storm first');
  expect(w.storms).toHaveLength(1); // nothing was written
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // caught up
  expect(stormCalls(calls)).toHaveLength(1);
});

test('a double tap on a storm control sends one', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt', delay: { stormAction: 600 } });
  await expect(ctl(page, 'snowing')).toBeVisible();
  await page.evaluate(() => { const b = document.querySelector('[data-storm="snowing"]'); b.click(); b.click(); });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(w.storms.filter((r) => r.kind === 'snowing')).toHaveLength(1);
});

test('night shift on is sent and shown', async ({ page }) => {
  // 7 PM on 10/3, no night_on yet: the day shift carries on (day-2026-10-03). The fake stamps the
  // night_on row 7 PM; at or after 9 AM the same date and already happened -> night-2026-10-03.
  const w = stormWorld(); w.clock = at('19:00');
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: at('19:00') });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(ctl(page, 'night_on')).toHaveText('Night shift on');
  await expect(ctl(page, 'night_on')).toHaveAttribute('aria-pressed', 'false');
  await ctl(page, 'night_on').click();
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(stormCalls(calls)[0].body).toMatchObject({ action: 'stormAction', kind: 'night_on' });
  expect(w.storms.at(-1)).toMatchObject({ kind: 'night_on', by_name: 'Matthew', at: at('19:00') });
  await expect(ctl(page, 'night_on')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // the weather is untouched
});

test('treated while snowing shows the yellow warning and still saves', async ({ page }) => {
  const w = stormWorld();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'snowing', storm_id: 'ST-1', at: at('06:10'), by_name: 'Matthew' });
  const calls = await openStorm(page, w, { delay: { tapZone: 500 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  const warn = page.locator('[data-warn="S1|Z1"]');
  await expect(warn).toBeHidden();
  await walkBtn(page, 'S1|Z1', 'treated').click();
  // The warning shows at once, while the tap is still on its way: the tap is not blocked.
  await expect(warn).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toHaveAttribute('aria-busy', 'true');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo · 7:50 AM');
  await expect(warn).toHaveText("It's still snowing: treated anyway");
  expect(tapCalls(calls)).toHaveLength(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S1', zone_id: 'Z1', state: 'treated' });
  expect(w.log).toHaveLength(1);
  expect(w.log[0]).toMatchObject({ state: 'treated', snowing_warned: true }); // saved, and flagged by the server
  // It stays after a poll (it comes from the saved row), and goes when the walk's newest row is not a Treated.
  await pollNow(page);
  await expect(warn).toBeVisible();
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo');
  await expect(warn).toBeHidden(); // Cleared while snowing is fine
  expect(w.log[1]).toMatchObject({ state: 'cleared', snowing_warned: false });
  // Another walk shows no warning of its own.
  await expect(page.locator('[data-warn="S1|Z2"]')).toBeHidden();
});

// Matt, 10/1/26: Back closed the whole app mid-job. A route opened from the live
// view is one more step on the Back stack, so Back returns to the live view.
const backSteps = (page) => page.evaluate(() => (history.state && history.state.snow) || []);
const problemWorld = () => {
  const w = stormWorld();
  w.log = [logRow(1, 'S2', 'whole', 'problem', 'Jordan Demo', { note: 'drain blocked', by_key: 'C03', at: at('06:50') })];
  return w;
};

test('Back on a route opened from the live view returns to the live view', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-matt' });
  await expect(page.locator('#problems')).toBeVisible();
  await openRoute(page, 'R2');
  await expect(page.locator('#problems')).toBeHidden(); // the route's own page
  await expect.poll(() => backSteps(page)).toEqual(['route']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  expect(page.url()).toContain('index.html'); // still in the app, not gone back past it
  expect(await backSteps(page)).toEqual([]);
});

test('the in-app ‹ Live view and the phone Back agree', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-alex' }); // a lead gets the same
  await openRoute(page, 'R2');
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toBeVisible();
  // Nothing left to undo: the in-app button takes its Back step with it.
  await expect.poll(() => backSteps(page)).toEqual([]);
  // Open again: one Back returns to the live view (a stale step would eat the first Back).
  await openRoute(page, 'R2');
  await page.goBack();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#liveBack')).toBeHidden();
  expect(page.url()).toContain('index.html');
});

test('Back with a site card open closes the card, then the next Back leaves the route', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await openCard(page, 'S1');
  await expect.poll(() => backSteps(page)).toEqual(['route', 'dlg']);
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeVisible(); // still on the route
  await page.goBack();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
});

test('a route left open on the Storm tab is not still open when you come back', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R2');
  await page.click('nav [data-tab="board"]');
  await expect.poll(() => backSteps(page)).toEqual([]); // the route's step went with it
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
});

test('treated while stopped shows no warning', async ({ page }) => {
  const w = stormWorld();
  await openStorm(page, w);
  await walkBtn(page, 'S1|Z1', 'treated').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Treated · Jordan Demo');
  await expect(page.locator('[data-warn]')).toHaveCount(0);
  expect(w.log[0].snowing_warned).toBe(false);
});

// ---------------- the Storm tab: forecast hint and walk marks on the map ----------------
// The hint is the National Weather Service's, and only a hint: the Snowing/Stopped
// switch is what counts. A made-up point: -149.5149, 61.3351 (lng, lat as the map
// saves it) goes out as /points/61.34,-149.51, rounded to two decimals (~1 km).
// Clock 7:30 AM Alaska. The fixture's hours start at 7 AM (the current hour):
// Light Snow, Snow, Snow Showers, then Mostly Cloudy. The run of snow ends at the
// 10 AM period: "Snow until 10 AM".
const NWS_POINT = [-149.5149, 61.3351];
const NWS_POINTS = 'https://api.weather.gov/points/61.34,-149.51';
const NWS_HOURLY = 'https://api.weather.gov/gridpoints/ZZZ/1,1/forecast/hourly';
const NWS_GRID = 'https://api.weather.gov/gridpoints/ZZZ/1,1';
const NWS_PERIODS = ['Light Snow', 'Snow', 'Snow Showers', ...Array(9).fill('Mostly Cloudy')].map((t, i) => ({
  startTime: '2026-10-03T' + String(7 + i).padStart(2, '0') + ':00:00-08:00', shortForecast: t }));
async function nws(page, o = {}) {
  const seen = [];
  const cors = { 'access-control-allow-origin': '*' };
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => {
    const u = route.request().url();
    seen.push(u);
    if (o.fail) return route.abort();
    if (u === NWS_POINTS) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { forecastHourly: NWS_HOURLY, forecastGridData: NWS_GRID } }) });
    if (u === NWS_GRID) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { snowfallAmount: { uom: 'wmoUnit:mm', values: o.grid || [] } } }) });
    if (u === NWS_HOURLY) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { periods: NWS_PERIODS } }) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return seen;
}
const withView = (w, id, center) => { w.sites = w.sites.map((s) => (s.id === id ? { ...s, map: { center, zoom: 18 } } : s)); return w; };

test('the forecast shows as a hint', async ({ page }) => {
  const seen = await nws(page);
  const calls = await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  await expect(page.locator('#stormhead + #stormhint')).toHaveCount(1); // right under the header, once
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);                       // the rounded point, never the saved one
  // Not on every poll: three more polls, and the tab left and re-entered inside 15 minutes.
  for (let i = 1; i <= 3; i++) { // one at a time: a poll already running swallows the next
    const before = shiftCalls(calls).length;
    await pollNow(page);
    await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
    await page.waitForTimeout(300); // let the reply land
  }
  await page.click('nav [data-tab="tonight"]');
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toHaveLength(2);
  // Once 15 minutes have gone by the next redraw asks again.
  await page.clock.fastForward('16:00');
  await expect.poll(() => seen.length).toBe(4);
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
});

test("the hint comes from the first site with a point (Matt's live view)", async ({ page }) => {
  // PAC (S1, N1) has no saved view and its zones have no outline: no point. TUDOR-TRANSIT
  // (S2, N2) has one: the live view's hint is from it.
  const seen = await nws(page);
  await openStorm(page, withView(stormWorld(), 'S2', NWS_POINT), { token: 'tok-matt' });
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);
  await expect(page.locator('#stormhead + #stormhint')).toHaveCount(1);
});

test('a crew member with no mapped site on their route gets no hint and no request', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, withView(stormWorld(), 'S2', NWS_POINT)); // Jordan's route is N1 (S1): no point
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveCount(0);
  expect(seen).toEqual([]);
});

test('a forecast failure shows no hint and taps still work', async ({ page }) => {
  const seen = await nws(page, { fail: true });
  const calls = await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect.poll(() => seen.length).toBeGreaterThanOrEqual(1); // it did try
  await expect(page.locator('#stormhint')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Snow until');
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)).toHaveLength(1);
  await pollNow(page);
  await expect(page.locator('#stormhint')).toHaveCount(0);
  expect(seen).toHaveLength(1); // no hammering a failing service
});

// ---------------- Callouts: new snow since the last cleaning (Part B2, Matt 10/4/26) ----------------
// Worked on paper. Clock 7:30 AM Alaska on 10/3: night shift (before the 9 AM cutover); the storm
// started 6:00 AM. Both sites have the same saved view, so the same rounded point and ONE fetch.
//   PAC (S1, N1): Main entry cleared 6:30 AM by Alex, so its new snow is counted from 6:30.
//   CALLOUT-TEST (S2, N2): nothing tapped, so from the storm's start, 6:00. (S2 is renamed to a
//   made-up name wherever a callout or rank sits on it: the repo is public, and TUDOR TRANSIT is a
//   real site. PAC is not a real site code.)
// The gridpoint has one period, 6:30-7:30 AM (14:30Z for 1 h), 30 mm. Both spans cover all of it:
// 30 / 25.4 = 1.18 -> shown 1.2, which meets a callout of 1 and not one of 2. CALLOUT-TEST's span
// starts 6:00 but the series only starts 6:30: its line says "since 6:30 AM", never the storm start.
const GRID_30MM = [{ validTime: '2026-10-03T14:30:00+00:00/PT1H', value: 30 }];
const gridHits = (seen) => seen.filter((u) => u === NWS_GRID).length;
const fakeS2 = (s) => (s.id === 'S2' ? { ...s, name: 'CALLOUT-TEST' } : s);
const calloutWorld = (callout = 1) => {
  const w = withView(withView(stormWorld(), 'S1', NWS_POINT), 'S2', NWS_POINT);
  w.sites = w.sites.map((s) => ({ ...fakeS2(s), callout_in: callout }));
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test')];
  return w;
};
const depthRow = (n, siteId, inches, at) => ({ ...logRow(n, siteId, '*', 'depth', 'Alex Test', { at }), depth_in: inches });

test('Callouts: the NWS estimate lists sites whose new snow meets the callout, with Clean again once the pass has a tap', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  await openStorm(page, calloutWorld(1), { token: 'tok-matt' });
  const box = page.locator('#callouts');
  await expect(box).toBeVisible();
  await expect(box.locator('h2')).toHaveText('Callouts (2)');
  await expect(box.locator('[data-callout="S1"]')).toContainText('PAC · ~1.2" since 6:30 AM (estimate) · callout 1"');
  await expect(box.locator('[data-callout="S2"]')).toContainText('CALLOUT-TEST · ~1.2" since 6:30 AM (estimate) · callout 1"');
  await expect(box.locator('[data-callout="S1"] [data-again="S1"]')).toBeVisible();
  await expect(box.locator('[data-again="S2"]')).toHaveCount(0); // nothing tapped at CALLOUT-TEST this pass
  expect(gridHits(seen)).toBe(1);                                 // one point, one fetch, two sites
  await box.locator('[data-again="S1"]').click();                 // the same Clean again as the site card's
  await expect(page.locator('#dlgIn h2')).toHaveText('Clean PAC again?');
});

test('Callouts: an estimate under the callout is not listed', async ({ page }) => {
  // 1.2 meets CALLOUT-TEST's 1 and not PAC's 2: one line, and PAC's is hidden.
  const seen = await nws(page, { grid: GRID_30MM });
  const w = calloutWorld(1);
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 2 } : s));
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-callout="S2"]')).toBeVisible();
  await expect(page.locator('#callouts h2')).toHaveText('Callouts (1)');
  await expect(page.locator('[data-callout="S1"]')).toBeHidden();
  expect(gridHits(seen)).toBe(1);
});

test('Callouts: with every callout above the estimate the box is hidden', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  await openStorm(page, calloutWorld(2), { token: 'tok-matt' });
  await expect.poll(() => gridHits(seen)).toBe(1);
  // A positive signal, never a fixed wait: the point's answer is in (one period), and the redraw that
  // follows it runs in the same step, so the box below is the box drawn from the estimate.
  await expect.poll(() => phoneState(page).then((s) => s.snowfall['61.34,-149.51'])).toEqual({ busy: false, periods: 1 });
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('#callouts')).toBeHidden();
});

test('Callouts: a lead measures new snow; the depth goes as a number and the line says measured', async ({ page }) => {
  // PAC has a callout but no saved view and no outline: no point, so no estimate and no fetch.
  // TUDOR-TRANSIT has no callout: no New snow button.
  const seen = await nws(page);
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test')];
  const calls = await openStorm(page, w, { token: 'tok-alex' }); // Alex leads N1 and N2 on the post
  const depthCalls = () => calls.filter((c) => c.body.action === 'depthNow');
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('#callouts')).toBeHidden();
  await openRoute(page, 'R2');
  await expect(page.locator('[data-shiftsite="S2"]')).toBeVisible();
  await expect(page.locator('[data-depth]')).toHaveCount(0);
  await page.click('#liveBack');
  await openRoute(page, 'R1');
  // A refusal shows its reason on the site, as Clean again's does.
  await page.click('[data-depth="S1"]');
  await expect(page.locator('#dlgIn h2')).toHaveText('New snow at PAC');
  await expect(page.locator('label[for="dn_in"]')).toHaveText('Inches since the last cleaning');
  await page.fill('#dn_in', '61');
  await page.click('#dn_save');
  await expect(page.locator('[data-shiftsite="S1"]')).toContainText('Not saved: Depth is 0 to 60 inches');
  await expect(page.locator('[data-depth="S1"]')).toHaveText('New snow');
  await page.click('[data-depth="S1"]');
  await page.fill('#dn_in', '2');
  await page.click('#dn_save');
  await expect.poll(() => depthCalls().length).toBe(2);
  expect(depthCalls()[1].body.site_id).toBe('S1');
  expect(depthCalls()[1].body.depth_in).toBe(2); // the number 2: the server refuses the text '2'
  await expect(page.locator('[data-shiftsite="S1"]')).not.toContainText('Not saved');
  await page.click('#liveBack');
  await expect(page.locator('#callouts')).toBeVisible();
  await expect(page.locator('#callouts [data-callout="S1"]')).toContainText('PAC · 2" measured 7:50 AM by Alex Test · callout 1"');
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: a crew member never sees the box or New snow, and never asks the NWS for snowfall', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  const w = calloutWorld(1);
  w.log.push(depthRow(2, 'S1', 3, '2026-10-03T07:00:00.000-08:00'));
  await openStorm(page, w); // Jordan, a member of N1
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM'); // the hint still comes: PAC has a point
  await expect(page.locator('[data-walk^="S1|"]').first()).toBeVisible();
  await page.click('#otherRoutes');
  await expect(page.locator('[data-shiftsite="S2"]')).toBeVisible();
  await pollNow(page);
  await page.waitForTimeout(500);
  await expect(page.locator('#callouts')).toHaveCount(0);
  await expect(page.locator('[data-depth]')).toHaveCount(0);
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: with the NWS down there is no estimate and no error; a measured depth still lists', async ({ page }) => {
  // CALLOUT-TEST: 1.5" measured at 7:05 AM, nothing tapped. A depth row is not a tap, so no Clean again.
  const seen = await nws(page, { fail: true });
  const w = calloutWorld(1);
  w.log.push(depthRow(2, 'S2', 1.5, '2026-10-03T07:05:00.000-08:00'));
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#callouts')).toBeVisible();
  await expect(page.locator('#callouts h2')).toHaveText('Callouts (1)');
  await expect(page.locator('[data-callout="S2"]')).toContainText('CALLOUT-TEST · 1.5" measured 7:05 AM by Alex Test · callout 1"');
  await expect(page.locator('[data-callout="S2"] [data-again]')).toHaveCount(0);
  await expect(page.locator('[data-callout="S1"]')).toHaveCount(0);
  await expect(page.locator('main .err')).toHaveCount(0);
  // Asked once (the hint and the snowfall each ask for the point), and a failure is kept: a poll asks nothing.
  await expect.poll(() => seen.filter((u) => u === NWS_POINTS).length).toBe(2);
  const before = shiftCalls(calls).length;
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
  await page.waitForTimeout(300);
  expect(seen.filter((u) => u === NWS_POINTS)).toHaveLength(2);
  await expect(page.locator('[data-callout="S2"]')).toBeVisible();
});

test('Callouts: Clean again from the box retires the old reading; a reading after it lists again', async ({ page }) => {
  // PAC: cleared 6:30, 3" measured at 7:00 (seq 2). No point, so no estimate. Clean again (seq 3,
  // stamped 7:50 by the fake) moves "since" past the reading: off the list. New snow 1" (seq 4) after it: back on.
  const seen = await nws(page);
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), depthRow(2, 'S1', 3, '2026-10-03T07:00:00.000-08:00')];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-callout="S1"]')).toContainText('PAC · 3" measured 7:00 AM by Alex Test · callout 1"');
  await page.click('[data-callout="S1"] [data-again="S1"]');
  await page.click('#ag_yes');
  await expect(page.locator('#callouts')).toBeHidden();
  await openRoute(page, 'R1');
  await expect(page.locator('[data-passline="S1"]')).toBeVisible();
  await page.click('[data-depth="S1"]');
  await page.fill('#dn_in', '1');
  await page.click('#dn_save');
  await page.click('#liveBack');
  await expect(page.locator('[data-callout="S1"]')).toContainText('PAC · 1" measured 7:50 AM by Matthew · callout 1"');
  await expect(page.locator('[data-callout="S1"] [data-again]')).toHaveCount(0); // a reading is not a tap: nothing to clean again yet
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: a site on two routes is listed once', async ({ page }) => {
  // On paper: the live view sorts routes by name, N1 then N2. N1 = [S2]; N2 = [S1, S2]. First
  // appearances: S2 (N1), then S1 (N2); the second S2 is dropped. So [S2, S1], unlike the Sites
  // list order [S1, S2]. Night shift (7:30 AM) and no ranks: no re-ordering.
  const seen = await nws(page);
  const w = stormWorld();
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S2'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S1', 'S2'] }];
  w.sites = w.sites.map((s) => ({ ...fakeS2(s), callout_in: 1 }));
  w.log = [depthRow(1, 'S1', 2, '2026-10-03T07:00:00.000-08:00'), depthRow(2, 'S2', 2, '2026-10-03T07:05:00.000-08:00')];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#callouts h2')).toHaveText('Callouts (2)');
  expect(await page.locator('[data-callout]').evaluateAll((els) => els.map((e) => e.dataset.callout))).toEqual(['S2', 'S1']);
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: polls inside 30 minutes fetch the snowfall once; after 30 minutes it is asked again', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  const calls = await openStorm(page, calloutWorld(1), { token: 'tok-matt' });
  await expect(page.locator('[data-callout="S1"]')).toBeVisible();
  for (let i = 1; i <= 2; i++) { // one at a time: a poll already running swallows the next
    const before = shiftCalls(calls).length;
    await pollNow(page);
    await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
    await page.waitForTimeout(300);
  }
  expect(gridHits(seen)).toBe(1);
  await page.clock.fastForward('16:00'); // the hint asks again after 15 minutes; the snowfall does not
  await expect.poll(() => seen.filter((u) => u === NWS_HOURLY).length).toBe(2);
  expect(gridHits(seen)).toBe(1);
  await page.clock.fastForward('15:00'); // 31 minutes
  await expect.poll(() => gridHits(seen)).toBe(2);
  await expect(page.locator('[data-callout="S1"]')).toBeVisible();
});

// ---- Day ranking (Part B2, Matt 10/4/26) ----
// Route N1 drives PAC (S1), RANK-TEST-2 (S2), RANK-TEST (S3). The ranked ones have made-up names: the
// repo is public, so no rank ever sits on a real site code. Ranks: RANK-TEST 1, RANK-TEST-2 2, PAC none
// (no key at all, as an old site). Day: RANK-TEST, RANK-TEST-2, PAC (ranked first by rank, then the
// unranked in route order). Night: route order, PAC, RANK-TEST-2, RANK-TEST.
const rankWorld = (shift) => {
  const w = stormWorld();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'RANK-TEST-2', rev: 1, day_rank: 2 }, { id: 'S3', name: 'RANK-TEST', rev: 1, day_rank: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2', 'S3'] }];
  w.posts = [{ ...POST, shift, routes: [{ id: 'R1', name: 'N1', lead: 'C01', members: ['C03'],
    sites: [{ id: 'S1', name: 'PAC' }, { id: 'S2', name: 'RANK-TEST-2' }, { id: 'S3', name: 'RANK-TEST' }] }] }];
  return w;
};
const idsOf = (page, attr) => page.locator('[' + attr + ']').evaluateAll((els, a) => els.map((e) => e.getAttribute(a)), attr);
const tonightIds = (page) => page.locator('.tonight-route [data-map]').evaluateAll((els) => els.map((e) => e.dataset.map));
const DAY_ORDER = ['S3', 'S2', 'S1'], ROUTE_ORDER = ['S1', 'S2', 'S3'];

test('day shift: ranked sites lead Tonight and the Storm tab', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(rankWorld('day-2026-10-03')), clockAt: '2026-10-03T10:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(1);
  expect(await tonightIds(page)).toEqual(DAY_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-shiftsite')).toEqual(DAY_ORDER);
});

test('night shift: Tonight and the Storm tab keep route order', async ({ page }) => {
  const w = rankWorld('night-2026-10-03');
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'night_on', storm_id: 'ST-1', at: '2026-10-03T18:00:00.000-08:00', by_name: 'Matthew' }];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-03T22:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(1);
  expect(await tonightIds(page)).toEqual(ROUTE_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-shiftsite')).toEqual(ROUTE_ORDER);
});

test("Tonight orders by the post's own shift: tonight's post read at 4 PM keeps route order", async ({ page }) => {
  // 4 PM is day by the clock (no night_on), so the Storm tab ranks; the post is for tonight, so Tonight does not.
  await open(page, { token: 'tok-jordan', snow: fakeSnow(rankWorld('night-2026-10-03')), clockAt: '2026-10-03T16:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(1);
  expect(await tonightIds(page)).toEqual(ROUTE_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-shiftsite')).toEqual(DAY_ORDER);
});

test("9 AM cutover: Matt's live view re-orders into day rank on the next draw, no reload", async ({ page }) => {
  await openStorm(page, rankWorld('night-2026-10-02'), { token: 'tok-matt', clockAt: '2026-10-03T08:58:00-08:00' });
  await expect(page.locator('[data-livesite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-livesite')).toEqual(ROUTE_ORDER);
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await page.clock.fastForward('03:00'); // 9:01 AM: the 20 s poll redraws
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  expect(await idsOf(page, 'data-livesite')).toEqual(DAY_ORDER);
  await openRoute(page, 'R1');
  expect(await idsOf(page, 'data-shiftsite')).toEqual(DAY_ORDER);
});

// A phone that gets the new index.html but not lib/callout.js (a cut-off load, an old cached copy
// missing) must still show every route: route order and no Callouts box, never a broken tab.
test('without lib/callout.js, Tonight and the Storm tab still show their routes, in route order', async ({ page }) => {
  await page.route((u) => u.href.endsWith('/lib/callout.js'), (r) => r.abort());
  await open(page, { token: 'tok-jordan', snow: fakeSnow(rankWorld('day-2026-10-03')), clockAt: '2026-10-03T10:00:00-08:00' });
  expect(await page.evaluate(() => typeof SnowCallout)).toBe('undefined'); // the block really held
  await expect(page.locator('.tonight-route')).toBeVisible();
  expect(await tonightIds(page)).toEqual(ROUTE_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
  expect(await idsOf(page, 'data-shiftsite')).toEqual(ROUTE_ORDER);
});

test("without lib/callout.js, Matt's live view still shows its routes, with no Callouts box", async ({ page }) => {
  await page.route((u) => u.href.endsWith('/lib/callout.js'), (r) => r.abort());
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), depthRow(2, 'S1', 3, '2026-10-03T07:00:00.000-08:00')];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(page.locator('[data-liveroute="R2"]')).toBeVisible();
  await expect(page.locator('#callouts')).toHaveCount(0);
});

test('"Last tap" counts walk taps only, never a Clean again or a depth row', async ({ page }) => {
  const t = (hhmm) => '2026-10-03T' + hhmm + ':00.000-08:00';
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: t('06:30') }), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: t('06:40') }),
    logRow(3, 'S1', '*', 'again', 'Matthew', { at: t('07:10') }), depthRow(4, 'S1', 1, t('07:20')), depthRow(5, 'S2', 2, t('07:25'))];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-last')).toHaveText('Last tap 6:40 AM');
  await expect(page.locator('[data-liveroute="R2"] .live-last')).toHaveText('No taps yet');
});

test('the map marks done and problem walks', async ({ page }) => {
  // Newest row per walk in storm ST-1, worked by hand:
  //   S1|Z1 (sidewalk, priority, so it carries a star) L1 problem  -> "!"
  //   S1|Z2 (heated)                                  L2 checked   -> tick
  //   S1|Z3 (no_touch)                                 never walked -> no mark
  //   S1|whole                                        L3 cleared: the site has drawn zones, so no
  //                                                    zone is "whole" and no mark is made for it
  // Then Jordan clears Z1 (L4) and a poll turns its "!" into a tick.
  const w = stormWorld();
  withView(w, 'S1', PAC);
  w.zones = mapWorld().zones;
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice under the mat', at: at('06:30') }),
    logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: at('06:35') }),
    logRow(3, 'S1', 'whole', 'cleared', 'Alex Test', { at: at('06:40') })];
  await tiles(page);
  await nws(page);
  await openStorm(page, w);
  await page.click('.shift-site [data-map="S1"]');
  await zoneSource(page);
  const mark = (z) => page.locator('.zone-mark[data-zone="' + z + '"]');
  await expect(page.locator('.zone-mark')).toHaveCount(2);
  await expect(mark('Z1')).toHaveText('!');
  await expect(mark('Z1')).toHaveClass(/\bbad\b/);
  await expect(mark('Z2')).toHaveText('✓');
  await expect(mark('Z2')).toHaveClass(/\bdone\b/);
  await expect(mark('Z3')).toHaveCount(0);
  // Bootprint's colours (Matt, 10/4/26), and a mark never sits on the priority star.
  expect(await page.evaluate(() => window.SnowMapView.getPaintProperty('zones-fill', 'fill-color')))
    .toEqual(['match', ['get', 'type'], 'sidewalk', '#1c6fb0', 'hand', '#d98c00', 'heated', '#d62828',
      'storage', '#7d5ba6', 'no_touch', '#e0218a', '#888888']);
  const star = await page.locator('.zone-star').boundingBox(), bang = await mark('Z1').boundingBox();
  expect(star.y + star.height <= bang.y + 1 || bang.y + bang.height <= star.y + 1 || star.x + star.width <= bang.x + 1 || bang.x + bang.width <= star.x + 1).toBe(true);
  // A new row while the map is open updates the marks.
  w.log.push(logRow(4, 'S1', 'Z1', 'cleared', 'Jordan Demo', { by_key: 'C03', at: at('07:00') }));
  await pollNow(page);
  await expect(mark('Z1')).toHaveText('✓');
  await expect(page.locator('.zone-mark')).toHaveCount(2);
  // Back lands on the Storm tab.
  await page.click('#mapback');
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('.zone-mark')).toHaveCount(0);
});

test('a map opened from the Sites tab carries no walk marks', async ({ page }) => {
  const w = stormWorld();
  withView(w, 'S1', PAC);
  w.zones = mapWorld().zones;
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice', at: at('06:30') })];
  await tiles(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await zoneSource(page);
  await expect(page.locator('.zone-star')).toHaveCount(1);
  await expect(page.locator('.zone-mark')).toHaveCount(0);
});

// ---------------- final review fixes (10/3/26) ----------------
// A post with Jordan (C03) as the member of one route only (Alex leads both, as in POST).
const postWith = (id, shift, jordanOn) => ({ ...POST, id, shift, posted_at: '2026-10-03T15:00:00.000Z',
  routes: POST.routes.map((r) => ({ ...r, members: r.id === jordanOn ? ['C03'] : [] })) });
const getPosts = (calls) => calls.filter((c) => c.body.action === 'getPost');

// F1: the Storm tab used to read the post only from bootstrap (or a visit to Tonight).
test('the Storm tab picks up a re-post: on entering the tab, every third poll, and back on screen', async ({ page }) => {
  // Bootstrap's post P1 has Jordan on N1 (PAC). Each re-post is read by a different trigger:
  //   P2 (Jordan on N2) lands while he is on Tonight   -> tapping Storm fetches it at once;
  //   P3 (Jordan on N1) lands on the Storm tab          -> ticks 1 and 2 (20 s, 40 s) do not fetch it,
  //                                                        tick 3 (60 s) does: one getPost more;
  //   P4 (Jordan on N2)                                 -> the app coming back on screen fetches it.
  // His own route is drawn open; the other one is behind "Other routes" (not opened here).
  const w = stormWorld();
  w.posts = [postWith('P1', 'night-2026-10-02', 'R1')];
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible();
  w.posts.push(postWith('P2', 'night-2026-10-02', 'R2'));
  await page.click('nav [data-tab="storm"]');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
  const before = getPosts(calls).length;
  w.posts.push(postWith('P3', 'night-2026-10-02', 'R1'));
  await page.clock.runFor(40000);
  await page.waitForTimeout(300);
  expect(getPosts(calls)).toHaveLength(before);
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible(); // still P2
  await page.clock.runFor(20000);
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S2|whole')).toHaveCount(0);
  expect(getPosts(calls)).toHaveLength(before + 1);
  w.posts.push(postWith('P4', 'night-2026-10-02', 'R2'));
  await pollNow(page);
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
});

test('after 9 AM a new day post shows the day route without visiting Tonight', async ({ page }) => {
  // 8:59:30 AM: the night post (night-2026-10-02) has Jordan on N1. Matt posts the day shift
  // (day-2026-10-03) with Jordan on N2. Ticks at about 8:59:50, 9:00:10, 9:00:30; the third reads the
  // post. From 9:00 the night post is stale, so without that read Jordan would be told he is on no
  // route until he happened to open Tonight. The 9 AM rule itself is unchanged.
  const w = stormWorld();
  w.posts = [postWith('P1', 'night-2026-10-02', 'R1')];
  await openStorm(page, w, { clockAt: '2026-10-03T08:59:30-08:00' });
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  w.posts.push(postWith('P2', 'day-2026-10-03', 'R2'));
  await page.clock.runFor(60000);
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  await expect(page.locator('h2.shift-route', { hasText: 'Your route' })).toContainText('N2');
  await expect(page.locator('main')).not.toContainText("You're not on a route this shift");
  await expect(page.locator('nav [data-tab="storm"][aria-current="page"]')).toBeVisible(); // never left Storm
});

// F2: a request that never answers used to hang the walk (and the polling) for good.
test('a tap the server never answers says not saved after 45 s, with Retry', async ({ page }) => {
  // Apps Script waits up to 25 s for its lock, so 45 s with no answer means it is not coming.
  const net = { hang: true };
  const calls = await openStorm(page, stormWorld(), { hangIf: (b) => net.hang && b.action === 'tapZone' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await walkBtn(page, 'S1|Z1', 'cleared').click();
  await expect(walkRow(page, 'S1|Z1')).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(44000);
  await page.waitForTimeout(300);
  await expect(walkRow(page, 'S1|Z1')).toHaveAttribute('aria-busy', 'true'); // 44 s: still waiting
  await expect(page.locator('[data-retry="S1|Z1"]')).toHaveCount(0);
  await page.clock.runFor(1000);
  const fail = page.locator('[data-walkrow="S1|Z1"] .walk-fail');
  await expect(fail).toBeVisible();
  await expect(fail).toContainText('Not saved: no signal');
  await expect(page.locator('[data-retry="S1|Z1"]')).toBeVisible();
  await expect(walkRow(page, 'S1|Z1')).not.toHaveAttribute('aria-busy', 'true');
  await expect(walkRow(page, 'S1|Z1')).not.toContainText('Jordan Demo'); // nothing shown as done
  net.hang = false;
  await page.click('[data-retry="S1|Z1"]');
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls)).toHaveLength(2);
});

test('a poll the server never answers does not stop the polls after it', async ({ page }) => {
  // Poll 1 answers (entering the tab). Poll 2 (the 20 s tick) never answers. The ticks at 40 s and
  // 60 s find it still running and ask nothing. Its 45 s timeout ends it at 65 s; the 80 s tick asks
  // again (poll 3) and brings Alex's tap.
  const net = { hang: false };
  const w = stormWorld();
  const calls = await openStorm(page, w, { hangIf: (b) => net.hang && b.action === 'getShiftLog' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(shiftCalls(calls)).toHaveLength(1);
  net.hang = true;
  await page.clock.runFor(20000);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  net.hang = false;
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test')];
  await page.clock.runFor(40000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(2);
  await page.clock.runFor(20000);
  await expect.poll(() => shiftCalls(calls).length).toBe(3);
  await expect(walkRow(page, 'S1|Z1')).toContainText('Cleared · Alex Test');
});

// F4: zones came only from bootstrap, so a site Matt drew mid-storm refused every Whole-site tap.
test('a zone Matt draws mid-storm replaces Whole site after the refused tap', async ({ page }) => {
  // TUDOR-TRANSIT (S2) had no zones at bootstrap: one Whole-site walk. Matt draws "Front walk" (Z9,
  // sidewalk) there. With a drawn zone the site has no whole walk, so the server refuses Jordan's
  // Whole-site tap ("That zone is not walked at this site") and writes nothing. The phone reloads the
  // zones once and shows Front walk instead, and says the tap was not saved.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await page.click('#otherRoutes');
  await expect(walkBtn(page, 'S2|whole', 'cleared')).toBeVisible();
  w.zones = [...w.zones, { id: 'Z9', site_id: 'S2', type: 'sidewalk', name: 'Front walk', rev: 1 }];
  await walkBtn(page, 'S2|whole', 'cleared').click();
  await expect(walkBtn(page, 'S2|Z9', 'cleared')).toBeVisible();
  await expect(walkRow(page, 'S2|whole')).toHaveCount(0);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('TUDOR-TRANSIT');
  await expect(page.locator('#toast')).toContainText('Not saved');
  expect(calls.filter((c) => c.body.action === 'getZones')).toHaveLength(1);
  expect(w.log || []).toHaveLength(0);
  await walkBtn(page, 'S2|Z9', 'cleared').click();
  await expect(walkRow(page, 'S2|Z9')).toContainText('Cleared · Jordan Demo · 7:50 AM');
  expect(tapCalls(calls).at(-1).body).toMatchObject({ site_id: 'S2', zone_id: 'Z9', state: 'cleared' });
});

test('coming back on screen reloads the zones', async ({ page }) => {
  // Matt archives Main entry (Z1) at PAC while Jordan's phone is in his pocket. Back on screen:
  // that walk is gone and Heated walk (Z2) is still there.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(walkRow(page, 'S1|Z1')).toBeVisible();
  w.zones = w.zones.map((z) => (z.id === 'Z1' ? { ...z, archived: true, rev: 2 } : z));
  await pollNow(page);
  await expect(walkRow(page, 'S1|Z1')).toHaveCount(0);
  await expect(walkRow(page, 'S1|Z2')).toBeVisible();
  expect(calls.filter((c) => c.body.action === 'getZones')).toHaveLength(1);
});

// F5: the card's save answered into whatever dialog was open by then.
test('a slow card save, cancelled, never closes or writes into the next card', async ({ page }) => {
  // Card A (PAC) saves slowly; Jordan cancels it, opens card B (TUDOR-TRANSIT), types, and taps Save
  // while A is still on its way: B says so and sends nothing. Then A lands: B stays open with its
  // typing and no word from A in it (a toast about A is fine only if it names PAC). Then B saves.
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await page.fill('#vc_mat', 'sand, 1 bag');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('Still saving the last card… try again in a moment');
  expect(visitCalls(calls)).toHaveLength(1);
  // A lands.
  await expect.poll(async () => (await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
  await page.waitForTimeout(300);
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn h2')).toHaveText('Site card: TUDOR-TRANSIT');
  await expect(page.locator('#vc_depth')).toHaveValue('7');
  await expect(page.locator('#vc_mat')).toHaveValue('sand, 1 bag');
  await expect(page.locator('#vc_err')).toHaveText(''); // the "still saving" note is gone, and A wrote nothing here
  if (await page.locator('#toast').isVisible()) await expect(page.locator('#toast')).toContainText('PAC');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(2);
  expect(visitCalls(calls)[1].body).toMatchObject({ site_id: 'S2', depth_in: 7, materials_used: 'sand, 1 bag' });
  expect(w.visits.map((v) => v.site_id)).toEqual(['S1', 'S2']);
});

test('a cancelled card whose save fails says so by name, not inside the next card', async ({ page }) => {
  // Same sequence, but Matt ends the storm before A lands: A is refused. B must not show A's
  // refusal; the toast names PAC.
  const w = stormWorld();
  await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await expect(page.locator('#toast')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#toast')).toContainText('PAC');
  await expect(page.locator('#toast')).toContainText('No storm is open');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('');
  await expect(page.locator('#vc_depth')).toHaveValue('7');
});

// ---------------- route sheets (sub-project 5, 10/3/26) ----------------
// A truck per route and shift (newest row wins), unit numbers on a site, the Print
// view (every sheet, one per page) and the Sheets status line.
// The storm clock above (7:30 AM on 10/3) is still the night of 10/2, and the fake
// files every row there, so a truck set in these tests belongs to this shift.
const SHIFT = 'night-2026-10-02';
const truckRow = (n, routeId, truck, by = 'Matthew', byKey = 'admin') => ({ id: 'T-' + n, seq: n, route_id: routeId, shift_id: SHIFT, truck, by_key: byKey, by_name: by, at: at('06:10') });
const truckCalls = (calls) => calls.filter((c) => c.body.action === 'setTruck');
// The post of this shift: N1 led by Alex (C01) with Jordan, N2 led by Alex. `o.R1` / `o.R2` override a route's fields.
const postOf = (o = {}) => ({ ...POST, shift: SHIFT, routes: [
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'], truck: null, ...(o.R1 || {}) },
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [], truck: null, ...(o.R2 || {}) }] });
// The window's print dialog is not opened in a test: count the asks instead.
const stubPrint = (page) => page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });

test("Matt sets a route's truck on the Board and it is sent", async ({ page }) => {
  // The storm clock (7:30 AM on 10/3) has the post for the night of 10/2 current, but the day and night of
  // 10/3 are on offer too, so the Board asks (10/4/26); Matt picks the night of 10/2, the post's own.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
  // Blank until someone sets it: never a made-up truck.
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('');
  await page.fill('[data-truckinput="R1"]', ' T-14 ');
  await page.click('[data-settruck="R1"]');
  await page.click('[data-shift="' + SHIFT + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/2');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  // The phone names the route, the truck and the shift (the current post's); the server stamps who and when.
  expect(Object.keys(truckCalls(calls)[0].body).sort()).toEqual(['action', 'route_id', 'shift', 'token', 'truck']);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: SHIFT }); // trimmed
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  // Any route: N2 too, and N1 keeps its own.
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: SHIFT });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('T-9');
});

// Final review C1. 4 PM on 10/3, no storm, no night_on: the shift running is the DAY of 10/3. Matt posted
// the night of 10/3 at 3:30 and sets N1's truck for it. Worked by hand: the Board sends shift
// night-2026-10-03 (the current post's), the server files it there, and every screen shows that
// shift's truck: the Board box keeps T-14 after the save, and Matt's live view says "Truck: T-14".
// (Shown for the running day shift instead, both would be blank: the bug.)
const NIGHT3 = 'night-2026-10-03';
const AT_4PM = '2026-10-03T16:00:00-08:00';
test('a truck set at 4 PM for the posted night is sent with that shift and shown after the save', async ({ page }) => {
  const w = stormWorld();
  w.storms = [];
  w.clock = '2026-10-03T16:00:30.000-08:00';
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: '2026-10-03T15:30:00.000-08:00' }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  await expect(page.locator('#dlg')).toBeHidden();                       // a current post: nothing to ask
  expect(w.trucks.map((t) => [t.route_id, t.shift_id, t.truck])).toEqual([['R1', NIGHT3, 'T-14']]);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-liveroute="R1"] [data-truckrow="R1"]')).toHaveText('Truck: T-14');
  await expect(page.locator('[data-liveroute="R2"] [data-truckrow="R2"]')).toHaveText('Truck: —');
});

test('with no current post, the Board asks once which shift its trucks are for', async ({ page }) => {
  // 4 PM on 10/3, nothing posted. The first Save asks (the shifts on offer at 4 PM: Day of 10/3, Night of
  // 10/3, none picked); Matt picks the night. The second route's Save does not ask again.
  const w = stormWorld();
  w.storms = []; w.posts = [];
  w.clock = '2026-10-03T16:00:30.000-08:00';
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: nothing is posted, so Save asks which shift');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('.shiftpick [data-shift]')).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);
  expect(truckCalls(calls)).toHaveLength(0);                             // nothing is sent before the pick
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('T-9');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
});

// Truck shift fix (10/4/26). In the afternoon the DAY post is still current, but Matt is planning TONIGHT:
// filing his trucks under the post's shift put them on the day sheet and left tonight's blank. So when a
// later shift is on offer, the Board asks Day or Night (from the post's shift on; none pre-picked), and
// Change re-opens the same question. The pick lasts until reload, never stored.
const DAY3 = 'day-2026-10-03';
const dayPostWorld = (clock) => {
  const w = stormWorld();
  w.storms = [];
  w.clock = clock;
  w.posts = [{ ...postOf(), shift: DAY3, posted_at: '2026-10-03T09:30:00.000-08:00' }];
  return w;
};
const pickerLabels = (page) => page.locator('.shiftpick [data-shift]');

test('a day post at 4 PM: Save asks Day or Night and Night files the truck under tonight', async ({ page }) => {
  // 4:00 PM on 10/3. Day post of 10/3 current. Shifts on offer: Day of 10/3, Night of 10/3 (both at or after
  // the post's day). Night is LATER than the post's shift, so Save must ask, offering exactly those two.
  const w = dayPostWorld('2026-10-03T16:00:30.000-08:00');
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);   // none pre-picked
  expect(truckCalls(calls)).toHaveLength(0);                                       // nothing sent before the pick
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  expect(w.trucks.map((t) => [t.route_id, t.shift_id, t.truck])).toEqual([['R1', NIGHT3, 'T-14']]);
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  // A second Save does not ask again.
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
  // The pick is never stored: after a reload the Board asks again.
  await page.reload();
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
});

test('a night post at 20:00 never asks', async ({ page }) => {
  // 8:00 PM on 10/3: shifts on offer are Day of 10/3 and Night of 10/3. The night post is the last shift
  // on offer, nothing is later, so its shift is sent with no picker.
  const w = stormWorld();
  w.storms = [];
  w.clock = at('20:00');
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: at('19:30') }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: at('20:00') });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
});

test("Change switches the Board's truck shift", async ({ page }) => {
  // 4 PM, day post current. Change opens the same Day/Night question; Day is picked, the label follows and
  // the next Save sends the day; Change again to Night and the label and the next Save follow that.
  const w = dayPostWorld('2026-10-03T16:00:30.000-08:00');
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await page.click('#truckchange');
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);
  await page.click('[data-shift="' + DAY3 + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Day of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  await expect(page.locator('#dlg')).toBeHidden();                                 // Change answered it: no second question
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: DAY3 });
  await page.click('#truckchange');
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
});

test("Change offers nothing earlier than the post's shift", async ({ page }) => {
  // 7:30 AM on 10/3 the shifts on offer are Night of 10/2, Day of 10/3, Night of 10/3. The post is the DAY
  // of 10/3, so the night of 10/2 (already over) is not offered.
  const w = dayPostWorld('2026-10-03T07:50:18.445-08:00');
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await page.click('#truckchange');
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
});

test('the Board loads the trucks a lead set', async ({ page }) => {
  // Alex set N1's truck from his phone this shift (the night of 10/2). Matt opens the app and goes straight
  // to the Board, never the Storm tab: the Board reads the trucks itself.
  const w = stormWorld();
  w.trucks = [truckRow(1, 'R1', 'T-22', 'Alex Test', 'C01')];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('');
  expect(shiftCalls(calls).length).toBeGreaterThanOrEqual(1);
});

test('Enter in a Board truck box saves it, before the Storm tab was ever opened', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.press('[data-truckinput="R1"]', 'Enter');
  // 7:30 AM: later shifts are on offer, so Enter asks (10/4/26). The same Enter must not pick for him:
  // the picker's first button takes focus, and the key's own keypress used to click it.
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(pickerLabels(page)).toHaveText(['Night of 10/2', 'Day of 10/3', 'Night of 10/3']);
  expect(truckCalls(calls)).toHaveLength(0);
  await page.click('[data-shift="' + SHIFT + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: SHIFT });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
});

test("a lead sees the posted night's truck read-only until that night is running", async ({ page }) => {
  // 4 PM on 10/3: the day shift is running, and the post (Alex leads N1) is for the night of 10/3, with
  // Matt's truck T-14 set for it. Alex's save would be filed under the DAY (a lead's truck is always the
  // shift running), so his screen shows the night's truck read-only: no box until the night is on.
  const w = stormWorld();
  w.storms = [];
  w.moves = boardMoves();
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: '2026-10-03T15:30:00.000-08:00' }];
  w.trucks = [{ ...truckRow(1, 'R1', 'T-14'), shift_id: NIGHT3 }];
  await openStorm(page, w, { token: 'tok-alex', clockAt: AT_4PM });
  await expect(page.locator('[data-truckrow="R1"]')).toHaveText('Truck: T-14');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
});

test("a lead changes their own route's truck from the Storm tab", async ({ page }) => {
  // The Board has Alex (C01) leading N1 only. The post says Alex leads N1 and Jordan (C03) leads N2.
  // Matt set N1's truck to T-9 at 6:10 AM; Alex changes it to T-22. N2 is not his: read-only.
  const w = stormWorld();
  w.moves = boardMoves();
  w.posts = [postOf({ R2: { lead: 'C03', members: [] } })];
  w.trucks = [truckRow(1, 'R1', 'T-9')];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-9');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveCount(0);
  await expect(page.locator('[data-truckrow="R2"]')).toHaveText('Truck: —');
  await expect(page.locator('[data-settruck="R2"]')).toHaveCount(0);
  await page.fill('[data-truckinput="R1"]', 'T-22');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-22' });
  expect(truckCalls(calls)[0].body.shift).toBeUndefined(); // a lead's truck is the shift running: the server's, never the phone's
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22'); // the newest row wins over Matt's T-9
  // The same control is on the route when it is opened.
  await openRoute(page, 'R1');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22');
});

test('a refused truck says why and keeps what was typed; a blank one is not sent', async ({ page }) => {
  // The post names Alex as N1's lead, but the Board does not: the server refuses and says so.
  const w = stormWorld();
  w.moves = [];
  w.posts = [postOf()];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('[data-truckrow="R1"] .err')).toHaveText('Type the truck first');
  expect(truckCalls(calls)).toHaveLength(0);
  await page.fill('[data-truckinput="R1"]', 'T-5');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('[data-truckrow="R1"] .err')).toContainText("Only Matt or that route's lead can set its truck.");
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-5');
  expect(truckCalls(calls)).toHaveLength(1);
});

test('crew see the truck but cannot change it', async ({ page }) => {
  // Jordan rides N1 as a MEMBER (Trucks row: T-9): no box, since only the route's lead on
  // tonight's Board sets its truck (Part A, 10/4/26). N2 has no Trucks row but the post carries T-4.
  const w = stormWorld();
  w.posts = [postOf({ R1: { lead: null, members: ['C03'] }, R2: { truck: 'T-4' } })];
  w.trucks = [truckRow(1, 'R1', 'T-9')];
  await openStorm(page, w); // Jordan, crew
  await expect(page.locator('[data-truckrow="R1"]')).toHaveText('Truck: T-9');
  await page.click('#otherRoutes');
  await expect(page.locator('[data-truckrow="R2"]')).toHaveText('Truck: T-4');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
  await expect(page.locator('[data-settruck]')).toHaveCount(0);
  // Crew print nothing and see no Sheets line.
  await expect(page.locator('#printSheets')).toHaveCount(0);
  await expect(page.locator('#sheetsstatus')).toHaveCount(0);
  // Tonight shows the same two trucks.
  await page.click('nav [data-tab="tonight"]');
  await expect(page.locator('.tonight-route.mine')).toContainText('Truck: T-9');
  await expect(page.locator('.tonight-route:not(.mine)')).toContainText('Truck: T-4');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
});

test('site units are typed in the site box and sent, blank by default', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const saves = () => calls.filter((c) => c.body.action === 'saveSite');
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_bobcat')).toHaveValue('');
  await expect(page.locator('#s_snowrator')).toHaveValue('');
  await page.click('#s_save'); // nothing typed: both fields still go, blank
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[0].body.record.units).toEqual({ bobcat: '', snowrator: '' });
  await page.click('[data-edit="site:S1"]');
  await page.fill('#s_bobcat', ' B-2 ');
  await page.fill('#s_snowrator', 'SR-1');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[1].body.record.units).toEqual({ bobcat: 'B-2', snowrator: 'SR-1' });
  // They come back; clearing one on purpose is sent as blank, and the other stays.
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_bobcat')).toHaveValue('B-2');
  await expect(page.locator('#s_snowrator')).toHaveValue('SR-1');
  await page.fill('#s_bobcat', '');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[2].body.record.units).toEqual({ bobcat: '', snowrator: 'SR-1' });
  // A new site sends both too.
  await page.click('[data-edit="site:"]');
  await page.fill('#s_name', 'New Lot');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[3].body.record.units).toEqual({ bobcat: '', snowrator: '' });
});

test('Print sheets shows one page per route and shift, with not-done sites', async ({ page }) => {
  // liveWorld: N1 = PAC + EXTRA, N10 = NEWSITE, N2 = TUDOR-TRANSIT. One tap this shift: Alex cleared Main entry (PAC).
  // The post puts Alex and Jordan on N1 and Alex on N2; it does not list N10.
  // Sheets (one per route with a tap or a posted crew), in route order: N1, N2. N10 has neither: no sheet.
  //   N1: PAC prints its tap and "Heated walk: Not done"; EXTRA has no tap at all: "Not done this shift".
  //   N2: nobody tapped, but a crew was posted: TUDOR-TRANSIT "Not done this shift".
  const w = liveWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') })];
  w.posts = [postOf()];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0)).toContainText('Route N1');
  await expect(sheets.nth(0)).toContainText('Night of 10/2');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'PAC' })).toContainText('Main entry: Cleared');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'PAC' })).toContainText('Heated walk: Not done');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'EXTRA' })).toContainText('Not done this shift');
  await expect(sheets.nth(1)).toContainText('Route N2');
  await expect(sheets.nth(1).locator('.site').filter({ hasText: 'TUDOR-TRANSIT' })).toContainText('Not done this shift');
  await expect(page.locator('#printsheets')).not.toContainText('NEWSITE');
  // One page each: a break after every sheet but the last.
  expect(await sheets.nth(0).evaluate((e) => getComputedStyle(e).breakAfter)).toBe('page');
  expect(await sheets.nth(1).evaluate((e) => getComputedStyle(e).breakAfter)).toBe('auto');
  // The print dialog is asked for once, and again from the Print button.
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  await page.click('#printNow');
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(2);
  // The sheet's own style does not leak into the app (its body rule would restyle the whole page).
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('header h1')).fontFamily)).not.toMatch(/Arial/);
});

test('Back closes the print view', async ({ page }) => {
  await stubPrint(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual(['print']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#printview')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2); // the live view, still in the app
  expect(page.url()).toContain('index.html');
  expect(await backSteps(page)).toEqual([]);
  // The in-app Back takes its step with it, so the next phone Back is not eaten by a stale one.
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await page.click('#printBack');
  await expect(page.locator('#printview')).toBeHidden();
  await expect.poll(() => backSteps(page)).toEqual([]);
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#printview')).toBeHidden();
  expect(page.url()).toContain('index.html');
});

test('the sheets status shows saved, failed with Retry, and making', async ({ page }) => {
  // Storm ST-1: Start (seq 1), End (2), Reopen (3), End again (4). The newest End is seq 4, so only
  // Sheets rows with end_seq 4 count, and the newest row per route and shift wins.
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' },
    { id: 'ST-3', seq: 3, kind: 'reopen', storm_id: 'ST-1', at: at('09:00'), by_name: 'Matthew' },
    { id: 'ST-4', seq: 4, kind: 'end', storm_id: 'ST-1', at: at('10:00'), by_name: 'Matthew' }];
  const sh = (n, route, endSeq, status) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', route_id: route, shift_id: SHIFT, end_seq: endSeq,
    file_id: status === 'saved' ? 'f' + n : '', url: status === 'saved' ? 'https://drive.example/f' + n : '', name: (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf',
    made_at: at('15:01'), status, error: status === 'failed' ? 'Drive said no' : '', updated: endSeq === 4, by_name: 'Sidewalk' });
  // The first End's set: one saved, one failed. They belong to End 2, which is no longer the newest.
  w.sheets = [sh(1, 'R1', 2, 'saved'), sh(2, 'R2', 2, 'failed')];
  const fake = {};
  // The clock is pinned at 10:05, five minutes after End 4 (10:00): too soon to offer Retry on "making".
  const calls = await openStorm(page, w, { token: 'tok-matt', fake, clockAt: at('10:05') });
  const status = page.locator('#sheetsstatus');
  const retries = () => calls.filter((c) => c.body.action === 'retrySheets');
  // The newest End (4) has no Sheets row yet: making. The old End's failed row is not counted.
  await expect(status).toBeVisible();
  await expect(status).toHaveText('Sheets: making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // End 4's files: N1 saved, N2 failed -> "1 not saved", with Retry.
  w.sheets.push(sh(3, 'R1', 4, 'saved'), sh(4, 'R2', 4, 'failed'));
  await pollNow(page);
  await expect(status).toHaveText('Sheets: 1 not saved · Retry');
  // Retry: a double tap sends one, naming the storm; the reply says it is scheduled.
  await page.evaluate(() => { const b = document.getElementById('retrySheets'); b.click(); b.click(); });
  await expect.poll(() => retries().length).toBe(1);
  expect(retries()[0].body).toMatchObject({ storm_id: 'ST-1', token: 'tok-matt' });
  await expect(page.locator('#sheetsmsg')).toContainText('Retrying');
  // A Retry while the job is already running is queued, and the phone says so.
  fake.retryReply = { ok: true, storm_id: 'ST-1', failed: 1, owed: 1, scheduled: false, running: true };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(2);
  await expect(page.locator('#sheetsmsg')).toHaveText('Sheets are being made now; your Retry is queued');
  // The job saves N2: its newest row (seq 5) is saved, so all is saved and Retry goes.
  w.sheets.push(sh(5, 'R2', 4, 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // Open again: no line while the storm is open.
  w.storms.push({ id: 'ST-5', seq: 5, kind: 'reopen', storm_id: 'ST-1', at: at('11:00'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(status).toHaveCount(0);
});

// Ten minutes after the newest End, a sheet that has still not appeared is not "being made": the job
// never ran (or died), and Matt can Retry. Before that, only the wait is shown. The clock is pinned at
// 8:09 AM, 9 minutes after an End at 8:00, then moved to 8:11 (11 minutes after).
const endedAt8 = () => {
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  w.sheets = [];
  return w;
};
const savedRow = (n, route) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', route_id: route, shift_id: SHIFT, end_seq: 2, file_id: 'f' + n,
  url: 'https://drive.example/f' + n, name: (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf', made_at: at('08:02'), status: 'saved', error: '', updated: false, by_name: 'Sidewalk' });

test('"making" offers Retry only ten minutes after the End, and Retry answers are said', async ({ page }) => {
  const w = endedAt8(), fake = {};
  const calls = await openStorm(page, w, { token: 'tok-matt', fake, clockAt: at('08:09') });
  const retries = () => calls.filter((c) => c.body.action === 'retrySheets');
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: making…'); // 9 minutes: still waiting
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000); // 8:11, 11 minutes after the End
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: making… · Retry');
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(1);
  expect(retries()[0].body).toMatchObject({ storm_id: 'ST-1' });
  await expect(page.locator('#sheetsmsg')).toContainText('Retrying');
  // Nothing owed (the sheets arrived in the meantime): the phone says so.
  fake.retryReply = { ok: true, storm_id: 'ST-1', failed: 0, owed: 0, scheduled: false };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(2);
  await expect(page.locator('#sheetsmsg')).toHaveText('Nothing to retry.');
  // A refusal is shown with its reason.
  fake.retryReply = { ok: false, code: 'invalid', reason: 'That storm is open: its sheets are made when it is ended' };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(3);
  await expect(page.locator('#sheetsmsg')).toHaveText('Retry not sent: That storm is open: its sheets are made when it is ended');
});

test('"N of M saved" offers Retry only ten minutes after the End', async ({ page }) => {
  // The post names Alex on N1 and N2: this phone expects two sheets (N1 and N2, night of 10/2).
  // Only N1's file has been made: 1 of 2. Nothing failed, so before 10 minutes it is "making", after it Retry.
  const w = endedAt8();
  w.sheets = [savedRow(1, 'R1')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000);
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · Retry');
  // The second file lands: all saved, no Retry.
  w.sheets.push(savedRow(2, 'R2'));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test("the Sheets status, Retry and Print sheets are Matt's alone", async ({ page, browser }) => {
  // Final review I2: Print is in "Matt's live view" (the spec). A lead's phone holds no Posts but the
  // newest, so its print could differ from the PDF in Drive: leads have no Print (they have Copy for BT).
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  w.sheets = [{ id: 'SH-1', seq: 1, storm_id: 'ST-1', route_id: 'R1', shift_id: SHIFT, end_seq: 2, status: 'failed', error: 'x', name: 'N1 Night of 10-2.pdf', updated: false }];
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('#stormctl')).toBeVisible();                 // the controls drew: Reopen is there
  await expect(page.locator('#sheetsstatus')).toHaveCount(0);
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await expect(page.locator('#printSheets')).toHaveCount(0);
  // Matt, same storm, his own phone: all three.
  const matt = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await matt.newPage();
    await openStorm(p2, w, { token: 'tok-matt' });
    await expect(p2.locator('#printSheets')).toBeVisible();
    await expect(p2.locator('#sheetsstatus')).toBeVisible();
    await expect(p2.locator('#retrySheets')).toBeVisible();
  } finally { await matt.close(); }
});

test('an ended storm with nothing logged says so, with no Retry', async ({ page }) => {
  // Final review M2. Started 6:00, ended 8:00, nobody tapped, carded or was posted: no sheet is owed
  // (the server makes none and writes no Sheets row). Twenty minutes later it must not still say
  // "making…" with a Retry that can only answer "Nothing to retry".
  const w = endedAt8();
  w.posts = [];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:20') });
  await expect(page.locator('#sheetsstatus')).toBeVisible();
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: none (nothing logged)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

// Final review I1. A storm from the day of 10/2 (start 10:00) into that night. Two Posts: the DAY's
// (Jordan leads N2, nobody on N1), then the night's, which is the newest (Alex leads N1 with Jordan; N2
// empty). The Board (moved at 5 PM on 10/2) has Alex and Jordan on N1, nobody on N2.
const DAY2 = 'day-2026-10-02';
const twoPostStorm = () => {
  const w = stormWorld();
  w.storms = [{ ...START_ROW, at: '2026-10-02T10:00:00.000-08:00' }];
  w.moves = boardMoves();
  w.posts = [
    { ...postOf({ R1: { lead: null, members: [] }, R2: { lead: 'C03', members: [] } }), id: 'P-day', shift: DAY2, posted_at: '2026-10-02T09:30:00.000-08:00' },
    { ...postOf({ R2: { lead: null, members: [] } }), id: 'P-night', posted_at: '2026-10-02T17:30:00.000-08:00' },
  ];
  return w;
};

test("Print of an earlier shift shows that shift's posted crew, not the Board", async ({ page }) => {
  // Taps: Jordan cleared TUDOR-TRANSIT (N2) at 11:00 on 10/2 (day of 10/2); Alex cleared Main entry (N1)
  // at 6:30 on 10/3 (night of 10/2). Sheets, worked by hand: N2 Day of 10/2 (its tap; crew from the DAY's
  // Post: Jordan leads), N1 Night of 10/2 (its tap; the night's Post: Alex, Jordan). N1 has no day sheet
  // (no tap, empty in the day Post); N2 none at night (no tap, empty in the night Post).
  // With only the newest Post, the day sheet's crew would come from the Board: "—", "not posted".
  const w = twoPostStorm();
  w.log = [logRow(1, 'S2', 'whole', 'cleared', 'Jordan Demo', { by_key: 'C03', shift_id: DAY2, at: '2026-10-02T11:00:00.000-08:00' }),
    logRow(2, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') })];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0).locator('h1')).toHaveText('Route N2Day of 10/2');
  await expect(sheets.nth(0).locator('.head')).toContainText('Lead: Jordan Demo');
  await expect(sheets.nth(0)).not.toContainText('not posted');
  await expect(sheets.nth(1).locator('h1')).toHaveText('Route N1Night of 10/2');
  await expect(sheets.nth(1).locator('.head')).toContainText('Lead: Alex Test');
  await expect(sheets.nth(1).locator('.head')).toContainText('Crew: Jordan Demo');
});

test("the Sheets count expects an earlier shift's posted crew that logged nothing", async ({ page }) => {
  // The same storm, ended at 8:00 on 10/3. One tap: Alex, Main entry (N1), 6:30, night of 10/2. Sheets owed,
  // worked by hand: N2 Day of 10/2 (the DAY's Post sent Jordan out on N2: a true "Not done") and N1 Night
  // of 10/2 (the tap). N1's night file is saved: "1 of 2 saved", not "1 saved". Nine minutes after the End.
  const w = twoPostStorm();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' });
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') })];
  w.sheets = [savedRow(1, 'R1')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toBeVisible();
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · making…');
});

test('the print rule hides the app only while Print sheets is open', async ({ page }) => {
  // Final review M6: the @media print rule hid everything but #printview on ANY print of the app (a
  // browser's own Print, a screenshot to PDF). It now applies only while the Print view is open.
  await stubPrint(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
  await page.click('#printSheets');
  await expect(page.locator('body')).toHaveClass(/(^|\s)printing(\s|$)/);
  await expect(page.locator('header')).toBeHidden();
  await expect(page.locator('#printsheets')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });                          // the bar (and its Back) is not printed
  await page.click('#printBack');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printview')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)printing(\s|$)/);
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
});

test('a note with <b> prints as text', async ({ page }) => {
  // The note, and the site's materials line, hold markup. Both must print as the characters typed.
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, materials_needed: '<script>window.__x = 1</script>' } : s));
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: '<b>ice</b> & "mud"', at: at('06:30') })];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printsheets .note')).toHaveText('<b>ice</b> & "mud"');
  await expect(page.locator('#printsheets .note b')).toHaveCount(0);
  await expect(page.locator('#printsheets')).toContainText('<script>window.__x = 1</script>');
  await expect(page.locator('#printsheets script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

// Final review minor 1: a map opened from a drilled-in route sits on top of the route.
test('Back from a site map opened on a route returns to the route, then the live view', async ({ page }) => {
  await tiles(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('.shift-site [data-map="S1"]');
  await expect(page.locator('#mapback')).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual(['route', 'map']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#mapback')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeVisible(); // the route, not the live view
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  expect(page.url()).toContain('index.html');
  expect(await backSteps(page)).toEqual([]);
});

// ---------------- the 8 AM handoff (handoff sheets, Matt 10/5/26) ----------------
// Night crews stop at 8 AM and the day crew starts at 9. The night of 10/2 is handed off at 8:00 AM on
// 10/3 by the 8 AM run (by_name 'Sidewalk'). Worked by hand:
//   Routes by name: D1 (R3: DAY-SITE), N1 (R1: PAC, LEFT-RANK-2, LEFT-RANK-1), N2 (R2: TUDOR-TRANSIT).
//   Night Post (night of 10/2): Alex leads N1 with Jordan, Alex leads N2, D1 empty. So night_routes = [R1, R2].
//   Day Post (day of 10/3, posted 8:30, the newest, so the one a crew phone holds): Alex leads D1 with
//   Jordan, Alex leads N2, N1 empty. Day routes, by name: D1 (Alex, Jordan), N2 (Alex).
//   Night's taps, seq 1-5 (the mark's log_seq is 5):
//     PAC: Main entry cleared 6:00, Heated walk checked 6:05: done, so not left by night.
//     LEFT-RANK-2 (day rank 2; Walk A-E): A cleared 6:10, B cleared 6:15, D Problem "ice at door" 6:20: 2 of 5 walks.
//     LEFT-RANK-1 (day rank 1; no zones: one Whole site walk) and TUDOR-TRANSIT (unranked): untouched.
//   Left by night, in day order: LEFT-RANK-1 (rank 1), LEFT-RANK-2 (rank 2), TUDOR-TRANSIT (unranked).
//   Route order would put LEFT-RANK-2 first.
// The repo is public: every site carrying a day rank or a callout has a made-up name.
const hoRoutes = (d1, n1, n2) => [
  { id: 'R3', name: 'D1', sites: [{ id: 'S5', name: 'DAY-SITE' }], lead: null, members: [], ...d1 },
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }, { id: 'S3', name: 'LEFT-RANK-2' }, { id: 'S4', name: 'LEFT-RANK-1' }], lead: null, members: [], ...n1 },
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: null, members: [], ...n2 }];
const HO_NIGHT_POST = { ...POST, id: 'P-night', shift: SHIFT, posted_at: '2026-10-02T17:30:00.000-08:00', routes: hoRoutes({}, { lead: 'C01', members: ['C03'] }, { lead: 'C01' }) };
const HO_DAY_POST = { ...POST, id: 'P-day', shift: DAY3, posted_at: '2026-10-03T08:30:00.000-08:00', routes: hoRoutes({ lead: 'C01', members: ['C03'] }, {}, { lead: 'C01' }) };
const HANDOFF_ROW = { id: 'ST-2', seq: 2, kind: 'handoff', storm_id: 'ST-1', shift_id: SHIFT, at: at('08:00'), by_name: 'Sidewalk', by_profile: '',
  log_seq: 5, visit_seq: 0, truck_seq: 0, night_routes: ['R1', 'R2'] };
const HO_DAY = '2026-10-03T09:30:00-08:00', HO_NIGHT = '2026-10-03T06:30:00-08:00';
const handoffWorld = () => {
  const w = stormWorld();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 }, { id: 'S3', name: 'LEFT-RANK-2', rev: 1, day_rank: 2 },
    { id: 'S4', name: 'LEFT-RANK-1', rev: 1, day_rank: 1 }, { id: 'S5', name: 'DAY-SITE', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S3', 'S4'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] },
    { id: 'R3', name: 'D1', rev: 1, site_ids: ['S5'] }];
  w.zones = w.zones.concat(['A', 'B', 'C', 'D', 'E'].map((x, i) => ({ id: 'Z3' + (i + 1), site_id: 'S3', type: 'sidewalk', name: 'Walk ' + x, rev: 1 })));
  w.posts = [HO_NIGHT_POST, HO_DAY_POST];
  w.storms = [START_ROW, HANDOFF_ROW];
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:00') }), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test', { at: at('06:05') }),
    logRow(3, 'S3', 'Z31', 'cleared', 'Alex Test', { at: at('06:10') }), logRow(4, 'S3', 'Z32', 'cleared', 'Alex Test', { at: at('06:15') }),
    logRow(5, 'S3', 'Z34', 'problem', 'Alex Test', { note: 'ice at door', at: at('06:20') })];
  return w;
};
// A tap after the mark, filed under the day of 10/3 as the server would.
const dayTap = (n, siteId, zoneId, state, by, byKey, hhmm) => logRow(n, siteId, zoneId, state, by, { by_key: byKey, shift_id: DAY3, at: at(hhmm) });
const card = (page) => page.locator('#handoff');
const leftIds = (page) => idsOf(page, 'data-leftover');

test('the handoff card at 9:30: the heading, your day route, and what night left in day order', async ({ page }) => {
  await openStorm(page, handoffWorld(), { clockAt: HO_DAY }); // Jordan, on D1 in the day Post
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 8:00 AM'); // the 8 AM run: no "· by"
  // Your route: Jordan's day-Post route only. N2 is crewed on the day Post too, but not with Jordan.
  await expect(card(page).locator('.handoff-part')).toHaveText(['Your route', 'Left by night (3)']);
  expect(await idsOf(page, 'data-handoffroute')).toEqual(['R3']);
  await expect(card(page).locator('[data-handoffroute="R3"] .handoff-route')).toHaveText('D1 · Lead: Alex Test · Crew: Jordan Demo');
  await expect(card(page).locator('[data-daysite="S5"]')).toHaveText('DAY-SITE · 0 of 1 walks');
  // Left by night: the three sites night did not finish, ranked ones first by day rank, with walks and the Problem.
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('LEFT-RANK-1 · Not started');
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · 2 of 5 walks · Problem: ice at door');
  await expect(page.locator('[data-leftover="S2"]')).toHaveText('TUDOR-TRANSIT · Not started');
  // Names only: the day Post carries phones, and none reaches the card.
  await expect(card(page)).not.toContainText('555-01');
  // At the top of the Storm tab, above Jordan's own route.
  expect((await card(page).boundingBox()).y).toBeLessThan((await page.locator('.shift-route').first().boundingBox()).y);
});

test("Matt's card lists every day route, above the storm controls; a tapped handoff says who", async ({ page }) => {
  const w = handoffWorld();
  w.storms = [START_ROW, { ...HANDOFF_ROW, at: at('07:10'), by_name: 'Alex Test' }];
  await openStorm(page, w, { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 7:10 AM · by Alex Test');
  await expect(card(page).locator('.handoff-part')).toHaveText(['Day routes', 'Left by night (3)']);
  expect(await idsOf(page, 'data-handoffroute')).toEqual(['R3', 'R2']); // D1, N2: by name
  await expect(card(page).locator('[data-handoffroute="R2"] .handoff-route')).toHaveText('N2 · Lead: Alex Test · Crew: —');
  await expect(card(page).locator('[data-daysite="S2"]')).toHaveText('TUDOR-TRANSIT · 0 of 1 walks');
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
  expect((await card(page).boundingBox()).y).toBeLessThan((await page.locator('#stormctl').boundingBox()).y);
});

test('with no day Post a crew card has no "Your route", and still lists what night left', async ({ page }) => {
  // Only the night Post: at 9:30 it is stale, so Jordan's phone has no day route to show (ruling 10/5/26).
  const w = handoffWorld(); w.posts = [HO_NIGHT_POST];
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.handoff-part')).toHaveText(['Left by night (3)']);
  await expect(page.locator('[data-handoffroute]')).toHaveCount(0);
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
});

test('the card is hidden at night: 10 PM, after night shift on', async ({ page }) => {
  // The same handoff, read at 10 PM on 10/3 with night shift on since 6 PM: the night of 10/3, not day.
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' });
  await openStorm(page, w, { clockAt: '2026-10-03T22:00:00-08:00' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // the poll has landed
  await expect(page.locator('[data-shiftsite="S5"]')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the card is up at 8:30, after the 8:00 run: the night handed off, before the day crew starts', async ({ page }) => {
  // 8:30 AM on 10/3 is still the night of 10/2 by the clock (9 AM cutover): the night the row hands off.
  await openStorm(page, handoffWorld(), { clockAt: at('08:30') });
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 8:00 AM');
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
});

test('after a quiet night the old card does not come back the next day', async ({ page }) => {
  // The night of 10/2 was handed off at 8:00 on 10/3. Night shift on at 6 PM on 10/3, nothing tapped that
  // night, so the 8 AM run on 10/4 handed off nothing. At 9:30 on 10/4 (the day of 10/4) the only handoff is
  // the night of 10/2's, whose day was 10/3: no card.
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' });
  await openStorm(page, w, { token: 'tok-matt', clockAt: '2026-10-04T09:30:00-08:00' });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the card is hidden with no handoff', async ({ page }) => {
  const w = handoffWorld(); w.storms = [START_ROW];
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('[data-shiftsite="S5"]')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the card goes at Close storm', async ({ page }) => {
  const w = handoffWorld();
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'end', storm_id: 'ST-1', at: at('09:35'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(card(page)).toBeHidden();
});

test("the next night's handoff replaces the card", async ({ page }) => {
  // The storm runs on: night shift on at 6 PM on 10/3, TUDOR-TRANSIT cleared that night at 11 PM (seq 6),
  // and the 8 AM run hands off the night of 10/3 at 8:00 on 10/4 (seq 4, log_seq 6). At 9:30 on 10/4 the
  // card is that handoff's, and night left the two ranked sites (PAC done on 10/2, TUDOR-TRANSIT on 10/3).
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' },
    { ...HANDOFF_ROW, id: 'ST-4', seq: 4, shift_id: 'night-2026-10-03', at: '2026-10-04T08:00:00.000-08:00', log_seq: 6 });
  w.log.push(logRow(6, 'S2', 'whole', 'cleared', 'Alex Test', { shift_id: 'night-2026-10-03', at: '2026-10-03T23:00:00.000-08:00' }));
  await openStorm(page, w, { token: 'tok-matt', clockAt: '2026-10-04T09:30:00-08:00' });
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/3 · 8:00 AM');
  expect(await leftIds(page)).toEqual(['S4', 'S3']);
});

test('a day tap on a leftover shows "Started by" on the next poll; a finished one moves last with Done', async ({ page }) => {
  const w = handoffWorld();
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · 2 of 5 walks · Problem: ice at door');
  await page.evaluate(() => { window.__sameLoad = true; });
  // 9:41: Jordan clears Walk C at LEFT-RANK-2 from another phone. This one hears it on its next poll.
  w.log.push(dayTap(6, 'S3', 'Z33', 'cleared', 'Jordan Demo', 'C03', '09:41'));
  await pollNow(page);
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · 3 of 5 walks · Problem: ice at door · Started by Jordan Demo 9:41');
  // 9:50: Alex clears LEFT-RANK-1's one walk. It is done, and goes to the end of the list.
  w.log.push(dayTap(7, 'S4', 'whole', 'cleared', 'Alex Test', 'C01', '09:50'));
  await pollNow(page);
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('LEFT-RANK-1 · 1 of 1 walks · Started by Alex Test 9:50 · Done 9:50');
  expect(await leftIds(page)).toEqual(['S3', 'S2', 'S4']);
  await expect(page.locator('[data-leftover="S4"]')).toHaveClass(/(^|\s)done(\s|$)/);
  await expect(page.locator('[data-leftover="S3"]')).not.toHaveClass(/(^|\s)done(\s|$)/);
  expect(await page.evaluate(() => window.__sameLoad)).toBe(true); // no reload
});

test("tapping a leftover opens that site's walks; Back returns to the card", async ({ page }) => {
  const w = handoffWorld(); w.clock = at('09:35'); // the fake stamps Jordan's tap 9:35
  const calls = await openStorm(page, w, { clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await page.click('[data-leftover="S3"]');
  await expect(page.locator('#siteBack')).toBeVisible();
  await expect(card(page)).toBeHidden();
  expect(await idsOf(page, 'data-walkrow')).toEqual(['S3|Z31', 'S3|Z32', 'S3|Z33', 'S3|Z34', 'S3|Z35']);
  await expect(walkRow(page, 'S3|Z34')).toContainText('Problem · Alex Test · 6:20 AM');
  await expect.poll(() => backSteps(page)).toEqual(['route']);
  await walkBtn(page, 'S3|Z33', 'cleared').click();
  await expect(walkRow(page, 'S3|Z33')).toContainText('Cleared · Jordan Demo · 9:35 AM');
  expect(tapCalls(calls).at(-1).body).toMatchObject({ site_id: 'S3', zone_id: 'Z33', state: 'cleared' });
  await page.goBack(); // the phone's Back
  await expect(page.locator('#siteBack')).toBeHidden();
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · 3 of 5 walks · Problem: ice at door · Started by Jordan Demo 9:35');
  expect(await backSteps(page)).toEqual([]);
  // The in-app ‹ Back does the same, and takes its step with it.
  await page.click('[data-leftover="S2"]');
  await expect(walkRow(page, 'S2|whole')).toBeVisible();
  await page.click('#siteBack');
  await expect(card(page)).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual([]);
});

// LEFT-RANK-2 (callout 2"): 2" measured by Alex at 9:20, after its last tap (6:20): at its callout.
// LEFT-RANK-1 (callout 1"): 0.5" measured at 9:25: under it. Neither site has a point: no estimate, no fetch.
const calloutLeftovers = () => {
  const w = handoffWorld();
  w.sites = w.sites.map((s) => (s.id === 'S3' ? { ...s, callout_in: 2 } : s.id === 'S4' ? { ...s, callout_in: 1 } : s));
  w.log.push({ ...depthRow(6, 'S3', 2, at('09:20')), shift_id: DAY3 }, { ...depthRow(7, 'S4', 0.5, at('09:25')), shift_id: DAY3 });
  return w;
};

test('a leftover whose measured new snow is at its callout shows the callout line; one under it shows none', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, calloutLeftovers(), { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page).locator('[data-leftsite="S3"] .handoff-callout')).toHaveText('LEFT-RANK-2 · 2" measured 9:20 AM by Alex Test · callout 2"');
  await expect(card(page).locator('[data-leftsite="S4"]')).toBeVisible();
  await expect(card(page).locator('[data-leftsite="S4"] .handoff-callout')).toHaveCount(0);
  await expect(card(page).locator('[data-leftsite="S2"] .handoff-callout')).toHaveCount(0); // no callout set
  // A depth reading is not a tap: neither line says "Started by".
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · 2 of 5 walks · Problem: ice at door');
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('LEFT-RANK-1 · Not started');
  expect(gridHits(seen)).toBe(0);
});

test('a crew card shows the same measured callout line, and the crew phone never asks the NWS for snowfall', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, calloutLeftovers(), { clockAt: HO_DAY }); // Jordan
  await expect(card(page).locator('[data-leftsite="S3"] .handoff-callout')).toHaveText('LEFT-RANK-2 · 2" measured 9:20 AM by Alex Test · callout 2"');
  await expect(card(page).locator('[data-leftsite="S4"] .handoff-callout')).toHaveCount(0);
  await expect(page.locator('#callouts')).toHaveCount(0); // the Callouts box stays Matt's and the leads'
  expect(gridHits(seen)).toBe(0);
});

// ---- Hand off now: the night of 10/2 at 6:30 AM, nothing handed off yet ----
// Only the night Post is up: Alex leads N1 and N2 (a posted night lead), Jordan rides N1 (a member).
const nightWorld = () => { const w = handoffWorld(); w.posts = [HO_NIGHT_POST]; w.storms = [START_ROW]; w.clock = at('06:30'); return w; };
const handOffCalls = (calls) => calls.filter((c) => c.body.action === 'handOff');

test('Hand off now is in the live view at 6:30 for Matt and for the posted night lead', async ({ page, browser }) => {
  await openStorm(page, nightWorld(), { token: 'tok-matt', clockAt: HO_NIGHT });
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(page.locator('#handOffNow')).toHaveText('Hand off now');
  const lead = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await lead.newPage();
    await openStorm(p2, nightWorld(), { token: 'tok-alex', clockAt: HO_NIGHT });
    await expect(p2.locator('#stormctl')).toBeVisible();
    await expect(p2.locator('#handOffNow')).toBeVisible();
  } finally { await lead.close(); }
});

test('a member never gets Hand off now', async ({ page }) => {
  await openStorm(page, nightWorld(), { clockAt: HO_NIGHT }); // Jordan, a member of N1
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(walkBtn(page, 'S1|Z1', 'cleared')).toBeVisible();
  await expect(page.locator('#handOffNow')).toBeHidden();
});

test('Hand off now is gone by day (10 AM)', async ({ page }) => {
  const w = nightWorld(); w.clock = at('10:00');
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('10:00') });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(ctl(page, 'end')).toBeVisible();
  await expect(page.locator('#handOffNow')).toBeHidden();
});

test("Hand off now asks first, in Matt's words; Yes sends handOff and the night shows as handed off", async ({ page }) => {
  const w = nightWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: HO_NIGHT });
  await page.click('#handOffNow');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn h2')).toHaveText('Hand off to day now?');
  await expect(page.locator('#dlgIn p')).toHaveText("The night's sheets are saved and the day crew sees what's left.");
  await expect(page.locator('#ho_yes')).toHaveText('Yes, hand off');
  await expect(page.locator('#dlgClose')).toHaveText('Cancel');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(handOffCalls(calls)).toHaveLength(0); // Cancel sends nothing
  await page.click('#handOffNow');
  await page.click('#ho_yes');
  await expect.poll(() => handOffCalls(calls).length).toBe(1);
  // The phone sends the action alone: the server stamps who, when, which night and the marks.
  expect(Object.keys(handOffCalls(calls)[0].body).sort()).toEqual(['action', 'token']);
  // On paper: the night of 10/2; the newest Log seq is 5; no Visits or Trucks rows (0); the night Post crews N1 and N2.
  expect(w.storms.at(-1)).toMatchObject({ kind: 'handoff', storm_id: 'ST-1', shift_id: SHIFT, at: at('06:30'), by_name: 'Matthew',
    log_seq: 5, visit_seq: 0, truck_seq: 0, night_routes: ['R1', 'R2'] });
  // Handed off: the button gives way to the handoff's line, and Matt's sheets line waits for its files.
  await expect(page.locator('#handoffdone')).toHaveText('Handoff from Night of 10/2 · 6:30 AM · by Matthew');
  await expect(page.locator('#handOffNow')).toHaveCount(0);
  await expect(page.locator('#sheetsstatus')).toHaveText('Handoff sheets: making…');
  // Still the night of 10/2, the night just handed off: the card is up from the handoff on (ruling, fix round 1).
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 6:30 AM · by Matthew');
});

test('a refused Hand off now shows its reason: nothing tapped tonight', async ({ page }) => {
  const w = nightWorld(); w.log = [];
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: HO_NIGHT });
  await page.click('#handOffNow');
  await page.click('#ho_yes');
  await expect(page.locator('#handofferr')).toHaveText('Not saved: Nothing to hand off yet');
  expect(handOffCalls(calls)).toHaveLength(1);
  expect(w.storms).toHaveLength(1); // nothing was written
  await expect(page.locator('#handOffNow')).toBeVisible(); // it can be tapped again once the crew have tapped
});

test('two phones: the second Hand off now is refused with the first one\'s time, and the phone catches up', async ({ page }) => {
  const w = nightWorld();
  await openStorm(page, w, { token: 'tok-alex', clockAt: HO_NIGHT });
  await expect(page.locator('#handOffNow')).toBeVisible();
  // Matt's phone handed off at 6:20; Alex's has not heard yet.
  w.storms.push({ ...HANDOFF_ROW, at: at('06:20'), by_name: 'Matthew' });
  await page.click('#handOffNow');
  await page.click('#ho_yes');
  await expect(page.locator('#handofferr')).toHaveText('Not saved: Already handed off at 6:20 AM');
  expect(w.storms.filter((r) => r.kind === 'handoff')).toHaveLength(1);
  // The refusal makes the phone ask again: the handoff arrives, and the button gives way to its line.
  await expect(page.locator('#handoffdone')).toHaveText('Handoff from Night of 10/2 · 6:20 AM · by Matthew');
  await expect(page.locator('#handOffNow')).toHaveCount(0);
});

test("the next night gets Hand off now again: last night's handoff is not tonight's", async ({ page }) => {
  // The night of 10/2 was handed off at 8:00 on 10/3. Night shift on at 6 PM on 10/3: at 10 PM it is the night
  // of 10/3, which has no handoff yet, so the button is back and no "handed off" line shows.
  const w = handoffWorld(); w.clock = at('22:00');
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' });
  await openStorm(page, w, { token: 'tok-matt', clockAt: '2026-10-03T22:00:00-08:00' });
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(page.locator('#handoffdone')).toBeHidden();
});

// The handoff's Sheets rows (snow-app-script Task 3): made_for 'handoff', for_seq = the handoff's seq (2), end_seq null.
const hoSheet = (n, kind, route, shift, name, status) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', made_for: 'handoff', for_seq: 2, kind,
  route_id: route, shift_id: shift, end_seq: null, file_id: status === 'saved' ? 'f' + n : '', url: '', name, made_at: at('08:01'), status,
  error: status === 'failed' ? 'Drive said no' : '', updated: false, by_name: 'Sidewalk' });

test("Matt's sheets line after a handoff: making, then the night's saved count; a failed one offers Retry", async ({ page }) => {
  const w = handoffWorld();
  w.sheets = [{ ...hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'failed'), storm_id: 'ST-0' }]; // another storm's: never counted
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:05') });
  const status = page.locator('#sheetsstatus');
  await expect(status).toHaveText('Handoff sheets: making…'); // 5 minutes after the handoff: no Retry yet
  await page.clock.fastForward(6 * 60 * 1000); // 8:11, 11 minutes after it
  await pollNow(page);
  await expect(status).toHaveText('Handoff sheets: making… · Retry');
  // The job's set: the night's two route sheets and its day sheet, all saved. The count is the night's (2).
  // The day sheet is the left-by-night one (route ''): at 8:00 the day had no plan (the day Post went up at 8:30,
  // and nobody was moved on the Board), so that is the one day sheet the server's set holds (final review M3: the
  // line now counts only sheets still in the set, and this test used to hold two day sheets the set never had).
  w.sheets.push(hoSheet(2, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(3, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'),
    hoSheet(4, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Night sheets saved at handoff 8:00 AM (2)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // The day sheet made again, and failed: the newest row per sheet stands, so 1 not saved, with Retry.
  w.sheets.push(hoSheet(6, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'failed'));
  await pollNow(page);
  await expect(status).toHaveText('Handoff sheets: 1 not saved · Retry');
  await page.click('#retrySheets');
  await expect.poll(() => calls.filter((c) => c.body.action === 'retrySheets').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'retrySheets')[0].body).toMatchObject({ storm_id: 'ST-1' });
});

test("Matt's line counts the handoff's night set: 1 of 2 saved is not \"saved\"", async ({ page }) => {
  // The handoff's night set, the server's rule (snow-app-script handoffJobs_): sheetsFor at the handoff moment
  // (Log, Visits, Trucks cut at the marks; Posts and Moves made by 8:00), that night's pairs on night_routes
  // [R1, R2]. On paper: N1 (its taps), N2 (Alex on the 5:30 PM night Post): 2. D1 is not a night route.
  const w = handoffWorld();
  w.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'saved'),
    hoSheet(3, 'day', 'R2', DAY3, 'N2 Day handoff 10-3.pdf', 'saved')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:05') });
  const status = page.locator('#sheetsstatus');
  await expect(status).toHaveText('Handoff sheets: 1 of 2 saved · making…'); // 5 minutes: still being made
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // 8:12. Meanwhile Matt re-posted the night at 8:10 with nobody on N2. The handoff's set is the 8:00 one, so
  // N2's night sheet is still owed (a count from the live Posts would drop it and say "(1)").
  w.posts.push({ ...HO_NIGHT_POST, id: 'P-night-2', posted_at: at('08:10'), routes: hoRoutes({}, { lead: 'C01', members: ['C03'] }, {}) });
  await page.clock.fastForward(7 * 60 * 1000); // its 20 s tick polls, and carries the re-post
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).posts.map((p) => p.id)).toContain('P-night-2'); // the phone holds it
  await expect(status).toHaveText('Handoff sheets: 1 of 2 saved · Retry');
  w.sheets.push(hoSheet(4, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Night sheets saved at handoff 8:00 AM (2)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

// Final review M3 (10/5/26): the server owes only the sheets still in a handoff's set (snow-app-script owedIn_), so a
// failed row for a sheet that has left the set is owed by nobody, and its Retry could only hear "That storm is open".
// Matt's line counts a failed row only while its sheet is in the set: the night sheets (CrewHandoff.nightSheets) and
// the day sheets of the handoff moment (one per crewed day route, else the left-by-night one).
test("Matt's handoff line leaves out a failed sheet the set no longer holds: no Retry the server would refuse", async ({ page, browser }) => {
  // (a) N2 archived after its night sheet failed. The set at the moment, by hand: sheetsFor on LIVE routes only, so
  //     N1 (its taps), and not N2 -> night set {N1}. Day: no plan at 8:00 (the day Post is 8:30's) -> {left by night}.
  //     Rows: N1 saved (in), N2 failed (out), left-by-night saved (in) -> nothing failed, 1 of 1 night: "(1)".
  const a = handoffWorld();
  a.routes = a.routes.map((r) => (r.id === 'R2' ? { ...r, archived: true } : r));
  a.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'failed'),
    hoSheet(3, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'saved')];
  await openStorm(page, a, { token: 'tok-matt', clockAt: at('08:05') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Night sheets saved at handoff 8:00 AM (1)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);

  // (b) A left-by-night row from a run that could not work out the day part (it failed, seq 3), and the day sheet a
  //     later run made once it could (seq 4). At 7:30 Matt put Alex on D1 as lead, after the 5:30 PM night Post: the
  //     Board is the day's plan at 8:00, so the set's day sheet is D1's, not the left-by-night one.
  //     Rows: N1, N2 saved (the night set {N1, N2}), left by night failed (out), D1 saved (in) -> "(2)", no Retry.
  const ctx = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await ctx.newPage();
    const b = handoffWorld();
    b.moves = [{ id: 'M1', rev: 1, at: at('07:30'), worker: 'C01', to_route: 'R3', role: 'lead' }];
    b.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'),
      { ...hoSheet(3, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'failed'), error: 'no day part' },
      hoSheet(4, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'saved')];
    await openStorm(p2, b, { token: 'tok-matt', clockAt: at('08:05') });
    const status = p2.locator('#sheetsstatus');
    await expect(status).toHaveText('Night sheets saved at handoff 8:00 AM (2)');
    await expect(p2.locator('#retrySheets')).toHaveCount(0);
    // A failed sheet that IS in the set still says so, with Retry: D1's day sheet made again, and failed.
    b.sheets.push(hoSheet(5, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'failed'));
    await pollNow(p2);
    await expect(status).toHaveText('Handoff sheets: 1 not saved · Retry');
  } finally { await ctx.close(); }
});

test('after Close storm, a night the handoff saved counts as saved: no false "of" and no Retry', async ({ page }) => {
  // Closed at 10:00 on 10/3; read 20 minutes later. The sheets this phone expects (CrewRouteSheet.sheetsFor), by hand:
  //   night of 10/2: N1 (its taps), N2 (Alex posted); day of 10/3: D1 (Jordan's 9:41 tap), N2 (Alex on the day Post).
  //   D1 has no night sheet (no tap, nobody on it in the night Post); N1 no day sheet (no tap, empty in the day Post). 4.
  // The End made only the two day sheets: both nights were saved at the handoff and did not change after it.
  // The handoff's first try at N2's night failed (seq 2); it is retried below.
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'end', storm_id: 'ST-1', at: at('10:00'), by_name: 'Matthew' });
  w.log.push(dayTap(6, 'S5', 'whole', 'cleared', 'Jordan Demo', 'C03', '09:41'));
  const endSheet = (n, route, name) => ({ ...hoSheet(n, 'route', route, DAY3, name, 'saved'), made_for: 'end', for_seq: 3, end_seq: 3 });
  w.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'failed'),
    hoSheet(3, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'saved'), hoSheet(4, 'day', 'R2', DAY3, 'N2 Day handoff 10-3.pdf', 'saved'),
    endSheet(5, 'R3', 'D1 Day of 10-3.pdf'), endSheet(6, 'R2', 'N2 Day of 10-3.pdf')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('10:20') });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  // N2's night stands on the handoff's failed row: that night has no saved record.
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 not saved · Retry');
  // Its Retry saves it: every expected sheet is now saved, the days by the End's rows and the nights by the handoff's.
  w.sheets.push(hoSheet(7, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 4 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test('Print sheets lists the day handoff sheets after the route sheets, each named as its PDF', async ({ page }) => {
  // On paper (Matt, 9:30, storm open): route sheets N1 and N2 for the night of 10/2 (the day Post's shift is past
  // the storm's latest logged shift, so it adds none yet), then one day handoff sheet per crewed day route, by
  // name: D1, N2. Four sheets.
  await stubPrint(page);
  await openStorm(page, handoffWorld(), { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printbar .muted')).toHaveText('4 sheets');
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(4);
  await expect(sheets.nth(0).locator('h1')).toHaveText('Route N1Night of 10/2');
  await expect(sheets.nth(1).locator('h1')).toHaveText('Route N2Night of 10/2');
  await expect(page.locator('#printsheets .printname')).toHaveText(['D1 Day handoff 10-3.pdf', 'N2 Day handoff 10-3.pdf']);
  await expect(sheets.nth(2).locator('h1')).toHaveText('Route D1Day of 10/3');
  await expect(sheets.nth(2)).toContainText('Handoff from Night of 10/2 · 8:00 AM');
  await expect(sheets.nth(2)).toContainText('Left by night (3)');
  await expect(sheets.nth(2).locator('.site').filter({ hasText: 'LEFT-RANK-2' })).toContainText('2 of 5 walks · Problem: ice at door');
  await expect(sheets.nth(3).locator('h1')).toHaveText('Route N2Day of 10/3');
  // The day sheet's own style came with it, kept inside the print view.
  expect(await sheets.nth(2).locator('h2.part').first().evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe('solid');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('header h1')).fontFamily)).not.toMatch(/Arial/);
  // The file name is for the screen; on paper the sheet's own heading says what it is.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printsheets .printname').first()).toBeHidden();
  await expect(sheets.nth(2)).toBeVisible();
});

test('without lib/handoff.js the Storm tab still works: no card, no throw, and Print makes the route sheets', async ({ page, browser }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => u.href.endsWith('/lib/handoff.js'), (r) => r.abort());
  await stubPrint(page);
  await openStorm(page, handoffWorld(), { token: 'tok-matt', clockAt: HO_DAY });
  expect(await page.evaluate(() => typeof CrewHandoff)).toBe('undefined'); // the block really held
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.click('#printSheets');
  await expect(page.locator('#printsheets .sheet')).toHaveCount(2);
  await expect(page.locator('#printsheets .printname')).toHaveCount(0);
  // A crew phone missing the file too.
  const crew = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await crew.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.route((u) => u.href.endsWith('/lib/handoff.js'), (r) => r.abort());
    await openStorm(p2, handoffWorld(), { clockAt: HO_DAY });
    await expect(p2.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
    await expect(walkBtn(p2, 'S5|whole', 'cleared')).toBeVisible();
    await expect(p2.locator('#handoff')).toHaveCount(0);
  } finally { await crew.close(); }
  expect(errors).toEqual([]);
});

test("without lib/handoff.js at night Matt's live view still draws, with Hand off now (the server decides)", async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => u.href.endsWith('/lib/handoff.js'), (r) => r.abort());
  await openStorm(page, nightWorld(), { token: 'tok-matt', clockAt: HO_NIGHT });
  expect(await page.evaluate(() => typeof CrewHandoff)).toBe('undefined');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a card that throws while it is drawn leaves the rest of the Storm tab drawn', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const w = handoffWorld();
  await openStorm(page, w, { clockAt: HO_DAY }); // Jordan
  await expect(card(page)).toBeVisible();
  // One of the card's words breaks (a bad copy of lib/handoff.js, say); the next redraw is a poll's.
  await page.evaluate(() => { CrewHandoff.leftoverParts = () => { throw new Error('broken leftover line'); }; });
  w.log.push(dayTap(6, 'S5', 'whole', 'cleared', 'Alex Test', 'C01', '09:40'));
  await pollNow(page);
  await expect(walkRow(page, 'S5|whole')).toContainText('Cleared · Alex Test · 9:40 AM'); // the poll landed and drew
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(walkBtn(page, 'S5|whole', 'treated')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a day handoff sheet whose page cannot be read is left out and said, not printed as a bare name', async ({ page }) => {
  // D1's page comes back with no <body>: only N2's day sheet prints after the two route sheets.
  await stubPrint(page);
  await openStorm(page, handoffWorld(), { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await page.evaluate(() => {
    const real = CrewHandoff.handoffHtml;
    CrewHandoff.handoffHtml = (data, id, madeAt) => (id === 'R3' ? '<p>no page here</p>' : real(data, id, madeAt));
  });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printbar .muted')).toHaveText('3 sheets');
  await expect(page.locator('#printsheets .printname')).toHaveText(['N2 Day handoff 10-3.pdf']);
  await expect(page.locator('#printsheets .sheet')).toHaveCount(3);
  await expect(page.locator('#printsheets .sheet').nth(2).locator('h1')).toHaveText('Route N2Day of 10/3');
  await expect(page.locator('#toast')).toHaveText("1 day handoff sheet couldn't be built on this phone.");
});

// ---------- Roster self-service (Matt, 10/6/26) ----------
// A person fills out their own card from their phone; Matt approves the Inventory request and
// taps Add to crew on the Roster tab; crew edit their own card from Tonight. The server keeps
// everything Matt owns: what leaves the phone is the self fields and nothing else.
const SELF_FIELDS = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
const pngOf = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400;
  const g = c.getContext('2d'); g.fillStyle = '#a73'; g.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; });
// Inventory with a live request list: Approve and Reject change it, as the real one does.
function invWithRequests(list) {
  return (p) => {
    if (p.action === 'getProfiles') return { profiles: list };
    if (p.action === 'approveProfile' || p.action === 'rejectProfile') {
      const hit = list.find((x) => String(x.id) === p.id);
      if (hit) hit.status = p.action === 'approveProfile' ? 'approved' : 'rejected';
      return { success: !!hit };
    }
    return {};
  };
}

test('self-service: not on the roster, the card is theirs to fill; Save sends only the self fields, the picture as a JPEG, never a name; then the pending screen', async ({ page }) => {
  const calls = await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await expect(page.locator('#notroster')).toContainText('Nina Nursery');
  await expect(page.locator('#signout')).toBeVisible();
  await page.click('#fillCard');
  await expect(page.locator('#s_title')).toHaveText('Nina Nursery');
  await expect(page.locator('#s_photo_cam')).toHaveAttribute('capture', 'user');   // the front camera on a phone
  await page.fill('#s_phone', ' 555-0199 ');
  await page.selectOption('#s_can_drive', 'yes');
  await page.selectOption('#s_valid_id', 'no');
  // roster-2: cold-rated is theirs to claim; Smokes is not asked; the emergency contact is theirs to fill.
  await expect(page.locator('#s_smokes')).toHaveCount(0);
  await page.selectOption('#s_cold_rated', 'yes');
  await page.fill('#s_emergency_name', ' Pat Nursery ');
  await page.fill('#s_emergency_phone', '555-0911');
  await page.check('input[data-sop][value="blower"]');
  await page.fill('#s_seasons', '2');
  await page.selectOption('#s_gear', 'needs_issued');
  const png = await pngOf(page);
  await page.locator('#s_photo_file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#s_photo_msg')).toContainText('Picture ready');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  await expect(page.locator('#pendingcard')).toContainText('Your card is in');
  await expect(page.locator('#pendingcard')).toContainText('555-0199');
  await expect(page.locator('#pendingcard')).toContainText('Pat Nursery · 555-0911');
  await expect(page.locator('#pendingcard')).not.toContainText('Smokes');
  await expect(page.locator('#pendingcard img.av')).toHaveAttribute('src', /^data:image\/jpeg/);
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect(Object.keys(c.body.card).sort()).toEqual(SELF_FIELDS.slice().sort());
  expect(c.body.card).toMatchObject({ phone: '555-0199', can_drive: true, valid_id: false, on_call: null, cold_rated: true, can_operate: ['blower'], seasons: 2, gear: 'needs_issued',
    emergency_name: 'Pat Nursery', emergency_phone: '555-0911' });
  expect('smokes' in c.body.card).toBe(false);
  expect(c.body.card.photo_thumb).toMatch(/^data:image\/jpeg;base64,/);
  expect(c.body.card.photo_thumb.length).toBeLessThan(30000);
  expect('name' in c.body.card).toBe(false);
  expect(c.body.token).toBe('tok-nina');
  expect(c.contentType).toContain('text/plain');
});

// Pictures (Matt, 10/7/26 field test: Gene's 160 px picture stretched over a 140+ px tile was blurry):
// stored at 240 px on the long side. The server caps the data URL at 30,000 characters, so a
// noisy picture is squeezed (lower quality, then smaller) until it fits, instead of being refused.
const noisyPngOf = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600;
  const g = c.getContext('2d'); const d = g.createImageData(600, 600); for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
  g.putImageData(d, 0, 0); return c.toDataURL('image/png').split(',')[1]; });
const sizeOf = (page, src) => page.evaluate((s) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = s; }), src);

test('self-service: pictures are stored at 240 px; a noisy one is squeezed under the server cap, never refused', async ({ page }) => {
  const calls = await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await page.click('#fillCard');
  await page.locator('#s_photo_file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(await pngOf(page), 'base64') });
  await expect(page.locator('#s_photo_msg')).toContainText('Picture ready');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  const flat = calls.find((x) => x.body && x.body.action === 'saveMyCard').body.card.photo_thumb;
  expect(await sizeOf(page, flat)).toEqual([240, 160]);                       // 600x400 scaled to the 240 px long side
  expect(flat.length).toBeLessThan(30000);
  await page.click('#editCard');
  await page.locator('#s_photo_file').setInputFiles({ name: 'noise.png', mimeType: 'image/png', buffer: Buffer.from(await noisyPngOf(page), 'base64') });
  await expect(page.locator('#s_photo_msg')).toContainText('Picture ready');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  const noisy = calls.filter((x) => x.body && x.body.action === 'saveMyCard').at(-1).body.card.photo_thumb;
  expect(noisy).toMatch(/^data:image\/jpeg;base64,/);
  expect(noisy.length).toBeLessThan(30000);                                   // squeezed, not refused
  const [nw] = await sizeOf(page, noisy);
  expect(nw).toBeLessThanOrEqual(240);
  expect(nw).toBeGreaterThanOrEqual(120);                                     // squeezed by quality first, size last
});

test('self-service: a pending sign-in sees its card and edits it; a picture not touched is left out of the save; Check again asks the server', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, phone: '555-0199', photo_thumb: 'data:image/jpeg;base64,QUJD', can_drive: true, seasons: 2 });
  const calls = await open(page, { token: 'tok-nina', snow: fakeSnow(w) });
  await expect(page.locator('#pendingcard')).toContainText('Your card is in');
  await expect(page.locator('#pendingcard img.av')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(page.locator('#signout')).toBeVisible();
  await expect(page.locator('#tabs')).toBeHidden();
  await page.click('#editCard');
  await expect(page.locator('#s_phone')).toHaveValue('555-0199');
  await expect(page.locator('#s_can_drive')).toHaveValue('yes');
  await expect(page.locator('#s_seasons')).toHaveValue('2');
  await expect(page.locator('#s_photo_msg')).toHaveText('Picture on file');
  await page.fill('#s_phone', '555-0000');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toContainText('555-0000');
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect('photo_thumb' in c.body.card).toBe(false);
  expect(c.body.card.phone).toBe('555-0000');
  await page.click('#checkAgain');
  await expect(page.locator('#pendingcard')).toBeVisible();
  expect(calls.filter((x) => x.body && x.body.action === 'bootstrap').length).toBe(2);
});

test('self-service: the server refuses a card in its own words; the form keeps what was typed; Cancel goes back', async ({ page }) => {
  await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await page.click('#fillCard');
  await page.fill('#s_seasons', 'two');
  await page.click('#s_save');
  await expect(page.locator('#s_err')).toHaveText('Seasons must be a whole number');
  await expect(page.locator('#s_seasons')).toHaveValue('two');
  await expect(page.locator('#pendingcard')).toHaveCount(0);
  await page.click('#s_cancel');
  await expect(page.locator('#notroster')).toBeVisible();
});

test('self-service: crew open Your card on Tonight, see their card from bootstrap, and save only the form', async ({ page }) => {
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('#yourCard')).toBeVisible();
  await page.click('#yourCard');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#s_title')).toHaveText('Jordan Demo');
  await expect(page.locator('#s_phone')).toHaveValue('555-0103');
  await page.fill('#s_phone', '555-0333');
  await page.check('input[data-sop][value="shovel"]');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Saved');
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect(c.body.card.phone).toBe('555-0333');
  expect(c.body.card.can_operate).toEqual(['shovel']);
  expect('name' in c.body.card).toBe(false);
  await page.click('#yourCard');
  await expect(page.locator('#s_phone')).toHaveValue('555-0333');   // the card follows the reply
});

test('self-service: Matt sees the pending Inventory request; Approve calls Inventory with his token and the row goes', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(PROFILES.map((p) => ({ ...p }))) });
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#waitapprove')).toContainText('Waiting for approval (1)');
  await expect(page.locator('#waitapprove')).toContainText('Pending Pat');
  await page.click('[data-approve="9"]');
  await expect(page.locator('#toast')).toHaveText('Pending Pat can sign in now');
  const a = calls.inv.find((x) => x.action === 'approveProfile');
  expect(a).toMatchObject({ action: 'approveProfile', id: '9', token: 'tok-matt' });
  await expect(page.locator('#waitapprove')).toHaveCount(0);
  await page.click('#addWorker');
  await expect(page.locator('#f_profile option[value="9"]')).toHaveCount(1);   // approved: a sign-in Matt can link
});

test('self-service: Reject takes a second tap, then calls Inventory; one tap alone sends nothing', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(PROFILES.map((p) => ({ ...p }))) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-reject="9"]');
  await expect(page.locator('[data-reject="9"]')).toHaveText('Really reject?');
  expect(calls.inv.some((x) => x.action === 'rejectProfile')).toBe(false);
  await page.click('[data-reject="9"]');
  await expect(page.locator('#toast')).toHaveText('Request rejected');
  expect(calls.inv.find((x) => x.action === 'rejectProfile')).toMatchObject({ id: '9', token: 'tok-matt' });
  await expect(page.locator('#waitapprove')).toHaveCount(0);
});

test('self-service: a pending card waits to be added, off the grid and off the Board; Add to crew saves it whole with pending false', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, phone: '555-0199', can_drive: true });
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C01"]')).toHaveCount(1);
  await expect(page.locator('.chip[data-worker="C04"]')).toHaveCount(0);
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#waitadd')).toContainText('Waiting to be added (1)');
  await expect(page.locator('#waitadd')).toContainText('Nina Nursery');
  await expect(page.locator('.grid [data-open="C04"]')).toHaveCount(0);
  await page.click('#waitadd .pname[data-open="C04"]');
  await expect(page.locator('#dlg')).toContainText('Waiting to be added');
  await page.click('#dlgClose');
  await page.click('#waitadd [data-addcrew="C04"]');
  await expect(page.locator('#toast')).toHaveText('Nina Nursery is on the crew');
  const c = calls.find((x) => x.body && x.body.action === 'saveCrew');
  expect(c.body.record).toMatchObject({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: false, rev: 1, phone: '555-0199', can_drive: true });
  await expect(page.locator('#waitadd')).toHaveCount(0);
  await expect(page.locator('.grid [data-open="C04"]')).toHaveCount(1);
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C04"]')).toHaveCount(1);
});

// ---- roster-2 (Matt, 10/6/26 bedtime): cold-rated theirs to claim, Smokes his alone, an emergency contact only he sees ----
test("roster-2: Matt's worker card shows the emergency contact (not set when blank); his editor keeps Smokes and saves the contact trimmed", async ({ page }) => {
  const w = world();
  Object.assign(w.crew[0], { emergency_name: 'Kim Test', emergency_phone: '555-0911', smokes: true, cold_rated: false });
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg tr:has-text("Emergency contact")')).toContainText('not set');
  await page.click('#dlgClose');
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg tr:has-text("Emergency contact")')).toContainText('Kim Test · 555-0911');
  await page.click('#w_edit');
  await expect(page.locator('#f_smokes')).toHaveValue('yes');            // Smokes stays Matt's to set
  await expect(page.locator('#f_cold_rated')).toHaveValue('no');         // and cold-rated his to correct
  await expect(page.locator('#f_emergency_name')).toHaveValue('Kim Test');
  await expect(page.locator('#f_emergency_phone')).toHaveValue('555-0911');
  await page.fill('#f_emergency_name', ' Kim Tester ');
  await page.fill('#f_emergency_phone', ' 555-0913 ');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const save = calls.find((c) => c.body.action === 'saveCrew');
  expect(save.body.record).toMatchObject({ id: 'C01', emergency_name: 'Kim Tester', emergency_phone: '555-0913', smokes: true, cold_rated: false });
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg tr:has-text("Emergency contact")')).toContainText('Kim Tester · 555-0913');
});

test('roster-2: Your card on Tonight shows the cold-rated question and the emergency contact from bootstrap, never Smokes; a save carries them', async ({ page }) => {
  const w = world();
  Object.assign(w.crew[1], { cold_rated: true, emergency_name: 'Dee Demo', emergency_phone: '555-0912', smokes: true });
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(w) });
  await page.click('#yourCard');
  await expect(page.locator('#s_cold_rated')).toHaveValue('yes');
  await expect(page.locator('#s_emergency_name')).toHaveValue('Dee Demo');
  await expect(page.locator('#s_emergency_phone')).toHaveValue('555-0912');
  await expect(page.locator('#s_smokes')).toHaveCount(0);
  await expect(page.locator('#dlg')).not.toContainText('smoke');
  await page.selectOption('#s_cold_rated', 'no');
  await page.fill('#s_emergency_phone', '555-0914');
  await page.click('#s_save');
  await expect(page.locator('#toast')).toHaveText('Saved');
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect(c.body.card).toMatchObject({ cold_rated: false, emergency_name: 'Dee Demo', emergency_phone: '555-0914' });
  expect('smokes' in c.body.card).toBe(false);
  // Every self field but the picture, which was not touched: left out, so the one on file is kept.
  expect(Object.keys(c.body.card).sort()).toEqual(SELF_FIELDS.filter((k) => k !== 'photo_thumb').sort());
});

test('self-service: with no requests and no cards waiting, the Roster tab has no waiting sections', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(PROFILES.filter((x) => x.status !== 'pending')) });
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('.grid')).toBeVisible();
  await expect(page.locator('#waitapprove')).toHaveCount(0);
  await expect(page.locator('#waitadd')).toHaveCount(0);
});

// ---------- Place from the roster (Matt, 10/6/26) ----------
// The Roster tab says where tonight's Board has each person, and the worker card places,
// promotes or pulls them: one Move each, planned as a Board tap is, through the Board's
// one-at-a-time write. Nothing is stored but the Move.
const MOVE = (worker, to_route, role) => ({ id: 'M-' + worker, at: '2026-10-06T17:00:00-08:00', worker, to_route, role });

test("place from the roster: tiles say where tonight's Board has each person", async ({ page }) => {
  const w = world();
  w.moves = [MOVE('C01', 'R1', 'lead')];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('[data-open="C01"] .where')).toHaveText('N1 · lead');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('Unplaced');
});

test('place from the roster: Place sends one Move as a member; the tile and the Board follow', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#w_where')).toHaveText('Unplaced');
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Jordan Demo placed on N1');
  const m = calls.filter((c) => c.body.action === 'addMove');
  expect(m.length).toBe(1);
  expect(m[0].body.record).toMatchObject({ worker: 'C03', to_route: 'R1', role: 'member' });
  expect(m[0].body.record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('N1');
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.board-route[data-route="R1"] .chip[data-worker="C03"]')).toHaveCount(1);
});

test('place from the roster: Make lead and Unassign are one Move each; nothing to change writes nothing', async ({ page }) => {
  const w = world();
  w.moves = [MOVE('C03', 'R1', 'member')];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#w_route')).toHaveValue('R1');
  await page.click('#w_place');   // already a member of N1
  await expect(page.locator('#toast')).toHaveText('Nothing to change');
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(0);
  await page.click('[data-open="C03"]');
  await page.click('#w_lead');
  await expect(page.locator('#toast')).toHaveText('Jordan Demo: lead on N1');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('N1 · lead');
  await page.click('[data-open="C03"]');
  await page.click('#w_unassign');
  await expect(page.locator('#toast')).toHaveText('Jordan Demo taken off the Board');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('Unplaced');
  const m = calls.filter((c) => c.body.action === 'addMove').map((c) => c.body.record);
  expect(m).toMatchObject([{ worker: 'C03', to_route: 'R1', role: 'lead' }, { worker: 'C03', to_route: null, role: null }]);
});

test("place from the roster: Place with no route picked asks for one and sends nothing; a lost save toasts and changes nothing", async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), abortIf: (b) => b.action === 'addMove' });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#w_unassign')).toHaveCount(0);   // not on the Board: nothing to pull
  await page.click('#w_place');
  await expect(page.locator('#w_err')).toHaveText('Pick a route');
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(0);
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('Unplaced');
});

test('place from the roster: a second place while one is saving sends nothing more', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), delay: { addMove: 1500 } });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await page.click('[data-open="C01"]');
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await expect(page.locator('#toast')).toContainText('Still saving');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('N1', { timeout: 5000 });
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(1);
});

test('place from the roster: a card still waiting to be added has no Place row', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C04"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#w_route')).toHaveCount(0);
  await expect(page.locator('#w_place')).toHaveCount(0);
});

// ---------- Live window (Matt, 10/6/26) ----------
// The live view's summary line, and the wide layout on a laptop or TV. The numbers below are
// worked by hand from stormWorld: R1 = [S1] (walks Z1 sidewalk + Z2 heated; Z3 is no_touch and
// never walked), R2 = [S2] (no zones: one "Whole site" walk).
test('live window: the summary line counts sites done, open Problems, the newest real tap and routes started, and follows the poll', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test'), logRow(2, 'S1', 'Z2', 'checked', 'Alex Test')];   // S1 done; S2 untouched
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#livesum')).toHaveText('1 of 2 sites done · 0 problems · last tap 6:30 AM · 1 of 2 routes started');
  // A Problem lands at S1 on the next poll: S1 is no longer done, one Problem is open, the tap is newer.
  w.log.push(logRow(3, 'S1', 'Z1', 'problem', 'Jordan Demo', { note: 'ice', at: '2026-10-03T06:45:00.000-08:00' }));
  await pollNow(page);
  await expect(page.locator('#livesum')).toHaveText('0 of 2 sites done · 1 problem · last tap 6:45 AM · 1 of 2 routes started');
  // An undo of that Problem is not a tap: the newest real tap is the 6:30 one again.
  w.log.push(logRow(4, 'S1', 'Z1', 'cleared', 'Jordan Demo', { undoes: 'L-3', at: '2026-10-03T06:50:00.000-08:00' }));
  await pollNow(page);
  await expect(page.locator('#livesum')).toHaveText('1 of 2 sites done · 0 problems · last tap 6:30 AM · 1 of 2 routes started');
});

test('live window: with no storm open the line says so and still counts the sites and routes', async ({ page }) => {
  const w = stormWorld();
  w.storms = [];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#livesum')).toHaveText('No storm open · 2 sites on 2 routes');
});

test('live window: crew get no summary line (they see their own route, not the live view)', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('h2.shift-route')).toHaveCount(1);
  await expect(page.locator('#livesum')).toHaveCount(0);
});

test('live window: on a wide screen the Storm tab opens out and the routes sit in a grid; on a phone, one column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await expect(page.locator('.live-grid .live-route')).toHaveCount(2);
  expect(await page.evaluate(() => document.body.dataset.tab)).toBe('storm');
  const wide = await page.evaluate(() => ({
    cols: getComputedStyle(document.querySelector('.live-grid')).gridTemplateColumns.split(' ').length,
    main: getComputedStyle(document.querySelector('main')).maxWidth,
  }));
  expect(wide.cols).toBeGreaterThanOrEqual(2);
  expect(wide.main).toBe('none');
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.evaluate(() => ({
    cols: getComputedStyle(document.querySelector('.live-grid')).gridTemplateColumns,
    main: getComputedStyle(document.querySelector('main')).maxWidth,
  }));
  expect(narrow.cols).toBe('none');
  expect(narrow.main).toBe('720px');
  // Another tab is not the live window, whatever the width.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('nav [data-tab="routes"]');
  expect(await page.evaluate(() => [document.body.dataset.tab, getComputedStyle(document.querySelector('main')).maxWidth])).toEqual(['routes', '720px']);
});

// ---------- Snow map (Matt, 10/6/26) ----------
// stormWorld with S1 given a saved view at NWS_POINT (so the NWS is asked about 61.34,-149.51) and
// S2 left with no view and no outline (not mapped). Clock 7:30 AM Alaska on 10/3 (15:30Z).
// The gridpoint has one 6-hour period from 7:00 AM (15:00Z), 50.8 mm: 5.5 of its 6 hours fall in
// the next 12 h, so 50.8 * 5.5 / 6 = 46.57 mm = 1.83" -> ~1.8", the 1-3" step.
const GRID_6H = [{ validTime: '2026-10-03T15:00:00+00:00/PT6H', value: 50.8 }];
const noTiles = (page) => page.route((u) => /arcgisonline\.com|ancgis\.com/.test(u.href), (route) => route.abort());
const snowWorld = () => withView(stormWorld(), 'S1', NWS_POINT);

test('snow map: Matt opens it from the live view; one dot per mapped site, coloured and labelled by the forecast; the rest counted; the NWS asked once', async ({ page }) => {
  await noTiles(page);
  const seen = await nws(page, { grid: GRID_6H });
  await openStorm(page, snowWorld(), { token: 'tok-matt' });
  await expect(page.locator('#snowmapcard')).toBeVisible();
  await expect(page.locator('#snowmaptoggle')).toHaveText('Snow map');   // closed on a phone
  await expect(page.locator('#snowmapslot')).toHaveCount(0);
  await page.click('#snowmaptoggle');
  await expect(page.locator('#snowmapbox')).toBeVisible();
  await expect(page.locator('.snowdot')).toHaveCount(1);
  await expect(page.locator('#snowmapmissing')).toHaveText('1 site not mapped yet');
  const dot = page.locator('.snowdot[data-site="S1"]');
  await expect(dot).toHaveClass(/\bmid\b/);
  await expect(dot.locator('.snowdot-label')).toHaveText('~1.8"');
  await dot.click();
  await expect(page.locator('#snowmapinfo')).toHaveText('PAC · Forecast ~1.8" next 12 h · No reading yet · Not started');
  expect(gridHits(seen)).toBe(1);
  await pollNow(page);
  await expect(page.locator('.snowdot')).toHaveCount(1);
  expect(gridHits(seen)).toBe(1);   // inside the 30-minute gate: not asked again
  await page.click('#snowmaptoggle');
  await expect(page.locator('#snowmapslot')).toHaveCount(0);
  await expect(page.locator('#snowmaptoggle')).toHaveText('Snow map');
});

test('snow map: open by default on a wide screen; a measured depth rings the dot and the label follows the crews, poll by poll', async ({ page }) => {
  await noTiles(page);
  await nws(page, { grid: GRID_6H });
  await page.setViewportSize({ width: 1280, height: 800 });
  const w = snowWorld();
  w.log = [logRow(1, 'S1', '*', 'depth', 'Alex Test', { depth_in: 3 })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#snowmaptoggle')).toHaveText('Hide map');
  const dot = page.locator('.snowdot[data-site="S1"]');
  await expect(dot).toHaveClass(/\bmeasured\b/);
  await expect(dot.locator('.snowdot-label')).toHaveText('3.0" 6:30 AM Alex Test');
  await dot.click();
  await expect(page.locator('#snowmapinfo')).toContainText('Measured 3.0" at 6:30 AM by Alex Test');
  // A site card with a newer depth lands on the next poll.
  w.visits = [{ id: 'V-1', seq: 1, storm_id: 'ST-1', shift_id: 'night-2026-10-02', site_id: 'S1', by_key: 'C03', by_name: 'Jordan Demo',
    at: '2026-10-03T07:00:00.000-08:00', depth_in: 4, materials_used: '', equipment: {} }];
  await pollNow(page);
  await expect(dot.locator('.snowdot-label')).toHaveText('4.0" 7:00 AM Jordan Demo');
  await expect(dot).toHaveClass(/\bmid\b/);   // the colour is still the forecast
});

test('snow map: a failing NWS leaves a grey dot with a question mark, and no error on the screen', async ({ page }) => {
  await noTiles(page);
  await nws(page, { fail: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openStorm(page, snowWorld(), { token: 'tok-matt' });
  const dot = page.locator('.snowdot[data-site="S1"]');
  await expect(dot).toHaveClass(/\bnofc\b/);
  await expect(dot.locator('.snowdot-label')).toHaveText('?');
  await dot.click();
  await expect(page.locator('#snowmapinfo')).toContainText('No forecast');
  await expect(page.locator('#stormerr')).toHaveCount(0);
});

test('snow map: crew get no map card', async ({ page }) => {
  await noTiles(page);
  await nws(page, { grid: GRID_6H });
  await openStorm(page, snowWorld());
  await expect(page.locator('h2.shift-route')).toHaveCount(1);
  await expect(page.locator('#snowmapcard')).toHaveCount(0);
});

// ---------- The bars fit a phone (Matt, 10/6/26 evening) ----------
// On Matt's phone, with its larger text, the six admin tabs overflowed the bottom bar and Roster sat
// off the right edge; the top bar squeezed his name to "M…" while "Snow Crew" kept its full width.
// 320 px is the narrowest phone in use; every tab must sit inside it, and the name must outrank the title.
test('bars: all six admin tabs sit inside a 320 px screen, and the name badge keeps room over the title', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('#tabs button')).toHaveCount(6);
  const tabs = await page.locator('#tabs button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; }));
  for (const t of tabs) { expect(t.l, t.t).toBeGreaterThanOrEqual(0); expect(t.r, t.t).toBeLessThanOrEqual(320); expect(t.w, t.t).toBeGreaterThan(30); }
  expect(tabs.map((t) => t.t)).toEqual(['Storm', 'Routes', 'Sites', 'Board', 'Log', 'Roster']);
  await page.click('#tabs [data-tab="roster"]');
  await expect(page.locator('#addWorker')).toBeVisible();
  // The top bar: the name badge is at least as wide as the words it holds minus the title's share; concretely, wider than a lone initial.
  const who = await page.locator('#who').evaluate((e) => ({ w: Math.round(e.getBoundingClientRect().width), text: e.textContent, scroll: e.scrollWidth, client: e.clientWidth }));
  expect(who.text).toBe('Matthew · admin');
  expect(who.w).toBeGreaterThanOrEqual(90);
  // Nothing in the header leaves the screen.
  const hdr = await page.locator('header > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  for (const r of hdr) expect(r).toBeLessThanOrEqual(320);
});

// ---- roster-3 (Matt, 10/8/26): where one lives, and a short night on the Board ----
// Valley or Anchorage is theirs to say (blank until chosen) and only Matt sees it. On a short night he will
// not call Valley people in for under 8 hours: the Board marks them (a V always; amber plus a line while it
// is a short night). Short = after 11:30 PM and before 8 AM (8 h work + the 30-minute lunch), or Matt's own
// switch for a night only he knows is short. Warn, never block; a blank never fires.
const homeWorld = () => { const w = world(); w.crew = w.crew.map((c) => (c.id === 'C03' ? { ...c, home_area: 'valley' } : c.id === 'C01' ? { ...c, home_area: 'anchorage' } : c)); return w; };
const JORDAN_ON_N1 = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];

test('roster-3: Your card asks where you live, blank until chosen; Valley is sent with the save and the card follows the reply', async ({ page }) => {
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#yourCard');
  await expect(page.locator('#s_home_area')).toHaveValue('');
  await expect(page.locator('#dlgIn')).toContainText('Only Matt sees where you live.');
  await page.selectOption('#s_home_area', 'valley');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const saves = () => calls.filter((x) => x.body && x.body.action === 'saveMyCard');
  expect(saves().at(-1).body.card.home_area).toBe('valley');
  await page.click('#yourCard');
  await expect(page.locator('#s_home_area')).toHaveValue('valley');
  // Saved again with nothing touched: still Valley, never cleared by the form.
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves().at(-1).body.card.home_area).toBe('valley');
  // Chosen back to not set: sent as null, the server clears it.
  await page.click('#yourCard');
  await page.selectOption('#s_home_area', '');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves().at(-1).body.card.home_area).toBe(null);
});

test("roster-3: Matt's worker card shows where they live (not set when blank) and his editor sets and clears it", async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const saved = () => calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlgIn tr', { hasText: 'Lives in' })).toContainText('not set');
  await page.click('#w_edit');
  await expect(page.locator('#f_home_area')).toHaveValue('');
  await page.selectOption('#f_home_area', 'valley');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saved().home_area).toBe('valley');
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlgIn tr', { hasText: 'Lives in' })).toContainText('Valley');
  await page.click('#w_edit');
  await page.selectOption('#f_home_area', '');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saved().home_area).toBe(null);
});

test('roster-3: a Valley chip carries a V all the time; Anchorage and not set carry nothing; a normal evening has no line and the switch is off', async ({ page }) => {
  const w = homeWorld(); w.moves = JORDAN_ON_N1;
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-02T18:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C03"] .home')).toHaveText('V');
  await expect(page.locator('.chip[data-worker="C01"] .home')).toHaveCount(0);
  await expect(page.locator('.chip[data-worker="C03"]')).not.toHaveClass(/valley-short/);
  await expect(page.locator('li[data-rule="valley-short"]')).toHaveCount(0);
  await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#shortnight')).toContainText('off');
});

// 8 working hours + the 30-minute lunch = 8.5 h before the 8 AM deadline: 11:30 PM is the last start that
// reaches 8 h. Exactly 11:30:00 PM is exactly 8 hours (not short): that second is pinned in warnings.test.js; the page clock
// keeps running after install, so a screen test at the exact second would drift to 23:30:01 under load. At 8:00 AM the night is over.
for (const [stamp, short] of [['2026-10-02T23:29:00', false], ['2026-10-02T23:29:30', false], ['2026-10-02T23:31:00', true],
  ['2026-10-03T00:00:00', true], ['2026-10-03T07:59:00', true], ['2026-10-03T08:00:00', false]]) {
  test('roster-3: at ' + stamp.slice(11, 19) + ' the clock says ' + (short ? 'a short night' : 'a normal night') + ': a Valley person on a route ' + (short ? 'warns and is amber' : 'is left alone'), async ({ page }) => {
    const w = homeWorld(); w.moves = JORDAN_ON_N1;
    await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: stamp + '-08:00' });
    await page.click('nav [data-tab="board"]');
    await expect(page.locator('[data-route="R1"]')).toBeVisible();
    await expect(page.locator('[data-route="R1"] .warns li[data-rule="valley-short"]')).toHaveCount(short ? 1 : 0);
    if (short) {
      await expect(page.locator('[data-route="R1"] .warns li[data-rule="valley-short"]')).toHaveText('Jordan Demo: Valley, short night (under 8 hours)');
      await expect(page.locator('.chip[data-worker="C03"]')).toHaveClass(/valley-short/);
      // The clock's own answer cannot be switched off: the button says so and is disabled.
      await expect(page.locator('#shortnight')).toBeDisabled();
      await expect(page.locator('#shortnight')).toContainText('after 11:30 PM');
    } else {
      await expect(page.locator('.chip[data-worker="C03"]')).not.toHaveClass(/valley-short/);
      await expect(page.locator('#shortnight')).toBeEnabled();
    }
    await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', short ? 'true' : 'false');
  });
}

test('roster-3: on a short night an unplaced Valley person is amber in Unassigned too, and an Anchorage person or a blank is not', async ({ page }) => {
  const w = homeWorld(); w.crew.push({ id: 'C04', name: 'Blank Person', rev: 1 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-03T01:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C03"]')).toHaveClass(/valley-short/);
  await expect(page.locator('.chip[data-worker="C01"]')).not.toHaveClass(/valley-short/);
  await expect(page.locator('.chip[data-worker="C04"]')).not.toHaveClass(/valley-short/);
  await expect(page.locator('.chip[data-worker="C04"] .home')).toHaveCount(0);
});

test("roster-3: the switch is Matt's own for a cleanup night: off at 8 PM, on until 9 AM when tapped, nothing sent, and off again when tapped back", async ({ page }) => {
  const w = homeWorld(); w.moves = JORDAN_ON_N1;
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-02T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#shortnight')).toContainText('off');
  await expect(page.locator('li[data-rule="valley-short"]')).toHaveCount(0);
  const before = calls.length;
  await page.click('#shortnight');
  await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#shortnight')).toContainText('until 9 AM');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="valley-short"]')).toHaveCount(1);
  await expect(page.locator('.chip[data-worker="C03"]')).toHaveClass(/valley-short/);
  // Phone-local: no write of any kind goes to the backend.
  expect(calls.slice(before).filter((c) => /^(save|add|post|handoff|archive)/.test(c.body.action))).toEqual([]);
  // It lasts until the next 9 AM after it was turned on: 8 PM on 10/2 -> 9 AM on 10/3.
  expect(await page.evaluate(() => Number(localStorage.getItem('snow-short-night-until')))).toBe(new Date('2026-10-03T09:00:00-08:00').getTime());
  await page.click('#shortnight');
  await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('li[data-rule="valley-short"]')).toHaveCount(0);
});

test('roster-3: the switch is remembered on this phone until 9 AM and is off again at 9:00 sharp', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } });
  const w = homeWorld(); w.moves = JORDAN_ON_N1;
  const visit = async (stamp, tap) => {
    const page = await ctx.newPage();
    await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: stamp });
    await page.click('nav [data-tab="board"]');
    await expect(page.locator('#shortnight')).toBeVisible();
    if (tap) await page.click('#shortnight');
    const on = await page.locator('#shortnight').getAttribute('aria-pressed');
    await page.close();
    return on;
  };
  expect(await visit('2026-10-02T20:00:00-08:00', true)).toBe('true');
  expect(await visit('2026-10-03T08:59:00-08:00', false)).toBe('true');   // the clock window ended at 8:00; only the switch keeps it on until 9:00
  expect(await visit('2026-10-03T09:00:00-08:00', false)).toBe('false');  // 9:00 sharp: the switch has expired, the night is over
  await ctx.close();
});

// ---------------- Touched + the curb roll-up (Matt, 10/8/26) ----------------
// A site is Touched once its sidewalks and heated walks are done; its "Curb ..." hand lines roll up
// into "Curbs" items (750 ft x 1.2 = 900 ft each, at most 5), one tap each. PAC's curbs here:
// Z6 1,200 sq ft = 300 ft, Z7 800 sq ft = 200 ft -> 500 ft, one item "Curbs (about 500 ft)".
const CURBS = [
  { id: 'Z6', site_id: 'S1', type: 'hand', name: 'Curb - lot', area_sqft: 1200, from: 'bootprint:J1:6', rev: 1 },
  { id: 'Z7', site_id: 'S1', type: 'hand', name: 'Curb - island', area_sqft: 800, from: 'bootprint:J1:7', rev: 1 },
];
test('the crew see one Curbs walk for the curb lines, after the others, and tapping it sends curbs-1', async ({ page }) => {
  const w = stormWorld(); w.zones.push(...CURBS);
  const calls = await openStorm(page, w);
  // By name: Heated walk, Main entry; then the curbs item. The two curb lines are not walks of their own.
  expect(await page.locator('[data-walkrow]').evaluateAll((els) => els.map((e) => e.dataset.walkrow))).toEqual(['S1|Z2', 'S1|Z1', 'S1|curbs-1']);
  await expect(walkRow(page, 'S1|curbs-1')).toContainText('Curbs (about 500 ft)');
  await walkBtn(page, 'S1|curbs-1', 'cleared').click();
  await expect.poll(() => tapCalls(calls).length).toBe(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ action: 'tapZone', site_id: 'S1', zone_id: 'curbs-1', state: 'cleared' });
});

test('Touched: sidewalks done and curbs left reads Touched in its own colour; the route and the summary count it', async ({ page }) => {
  // PAC: Main entry cleared 6:30, Heated walk checked 6:40, curbs untapped -> Touched, not done.
  // N1 = PAC + EXTRA (untapped): 0 of 2 sites done, 1 touched. Four sites in all on the live view.
  const w = liveWorld(); w.zones.push(...CURBS);
  w.log = [logRow(1, 'S1', 'Z1', 'cleared', 'Alex Test', { at: at('06:30') }), logRow(2, 'S1', 'Z2', 'checked', 'Jordan Demo', { by_key: 'C03', at: at('06:40') })];
  await openStorm(page, w, { token: 'tok-matt' });
  const status = page.locator('[data-livesite="S1"] .live-status');
  await expect(status).toHaveText('Touched');
  await expect(status).toHaveClass(/\btouched\b/);
  await expect(status).not.toHaveClass(/\bdone\b/);
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('0 of 2 sites done, 1 touched');
  await expect(page.locator('#livesum')).toContainText('0 of 4 sites done, 1 touched · 0 problems');
  // Its colour is not the Done green.
  const touchedColour = await status.evaluate((e) => getComputedStyle(e).color);
  w.log.push(logRow(3, 'S1', 'curbs-1', 'cleared', 'Alex Test', { at: at('06:50') }));
  await pollNow(page);
  await expect(status).toHaveText('Done');
  expect(await status.evaluate((e) => getComputedStyle(e).color)).not.toBe(touchedColour);
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('1 of 2 sites done');
});

test("Matt's Sites cards show each site's curbs and flag one over size; the crew's never do", async ({ page }) => {
  // PAC: 500 ft, one item. TUDOR-TRANSIT: 1,266 + 951 + 1,233 + 2,555 = 6,005 ft in 4 zones: ceil(6005 / 900) = 7,
  // the cap is 5, and never more items than zones makes it 4; 4 x 900 = 3,600 < 6,005, so over size.
  const w = world();
  w.zones = [...CURBS, ...[[1266, 14], [951, 15], [1233, 16], [2555, 17]].map(([ft, bp], i) =>
    ({ id: 'T' + bp, site_id: 'S2', type: 'hand', name: 'Curb - part ' + i, area_sqft: ft * 4, from: 'bootprint:J2:' + bp, rev: 1 }))];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  await expect(page.locator('[data-site="S1"] .curbline')).toHaveText('Curbs: 500 ft in 1 item');
  await expect(page.locator('[data-site="S2"] .curbline')).toHaveText('Curbs: 6,005 ft in 4 items · over 900 ft per item');
  await expect(page.locator('[data-site="S2"] .curbline')).toHaveClass(/\bwarn\b/);
  const crew = await page.context().newPage();
  await open(crew, { token: 'tok-jordan', snow: fakeSnow(w) });
  await crew.click('nav [data-tab="sites"]');
  await expect(crew.locator('[data-site="S1"]')).toBeVisible();
  await expect(crew.locator('.curbline')).toHaveCount(0);
});
