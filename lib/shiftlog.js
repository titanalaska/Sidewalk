(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'));
  else root.CrewShiftLog = factory(root.CrewTime);
})(this, function (T) {
  'use strict';

  // The shift log is append-only: a tap, an undo, a storm control and a site
  // card are all new rows, never edits. So every answer here is a replay of the
  // rows, in the server's `seq` order. Never the phone's clock (it can be
  // wrong, and two taps can land in one millisecond), never array position
  // (the phone merges rows from a poll and from its own taps).

  var DONE = ['cleared', 'treated', 'checked'];
  var EQUIPMENT = ['blower', 'snowrator', 'bobcat', 'sweepster'];

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }
  function inStorm(rows, stormId) {
    return (rows || []).filter(function (r) { return r.storm_id === stormId; });
  }

  function walkKey(siteId, zoneId) { return siteId + '|' + zoneId; }

  function byName(a, b) {
    var x = String(a.name).toLowerCase(), y = String(b.name).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // ---- Curb roll-up (Matt, 10/8/26) ----
  // A site's "Curb ..." hand lines are many short walks; tapping each one is too many taps. They
  // roll up into 1 to 5 items sized by length, one tap each (a virtual walk 'curbs-<k>').
  // Matt's settings, in one place (change here and deploy): feetPerItem is the most curb feet one
  // crew can hand-clear at a site in the time left after the sidewalks; an item may run
  // `allowance` over it before the site gets another item; a site gets at most maxItems; a curb
  // zone is a widthFt strip, so its length is its area / widthFt.
  var CURB_ROLLUP = { feetPerItem: 750, allowance: 0.2, maxItems: 5, widthFt: 4 };

  // A hand zone whose name starts with the word Curb: "Curb - north", "Curb 3"; never "Curbside".
  function isCurbZone(z) { return !!z && z.type === 'hand' && /^curb\b/i.test(String(z.name || '')); }

  function curbFeet(z) {
    var a = Number(z.area_sqft);
    return isFinite(a) && a > 0 ? a / CURB_ROLLUP.widthFt : 0;
  }

  // Trace order: the Bootprint zone id the import carried in `from` ('bootprint:<job>:<zone>');
  // two halves of one island ring share it and go by name; zones drawn in Sidewalk come after.
  function traceKey(z) {
    var m = /^bootprint:[^:]*:(\d+)$/.exec(String(z.from || ''));
    return m ? Number(m[1]) : Infinity;
  }

  function curbZonesOf(siteId, zones) {
    return (zones || []).filter(function (z) { return z.site_id === siteId && z.archived !== true && isCurbZone(z); })
      .sort(function (a, b) { var x = traceKey(a), y = traceKey(b); return x !== y ? (x < y ? -1 : 1) : byName(a, b); });
  }

  function itemFeet() { return Math.round(CURB_ROLLUP.feetPerItem * (1 + CURB_ROLLUP.allowance) * 1e6) / 1e6; }

  function itemCount(n, feet) {
    if (!n) return 0;
    return Math.min(CURB_ROLLUP.maxItems, n, Math.max(1, Math.ceil(feet / itemFeet())));
  }

  // Cut `lens` (in order) into k groups: the smallest largest group, then the most equal groups
  // (least sum of squares: the total is fixed), then the earliest cuts. Every set of cut points
  // is tried in order, so a tie keeps the first: at most C(n-1, 4) sets, a few thousand for a big site.
  function cutPoints(lens, k) {
    var n = lens.length, best = null, cuts = [];
    function score() {
      var max = 0, sq = 0, from = 0;
      cuts.concat([n]).forEach(function (to) {
        var s = 0;
        for (var i = from; i < to; i++) s += lens[i];
        if (s > max) max = s;
        sq += s * s;
        from = to;
      });
      return { max: max, sq: sq };
    }
    function pick(start, left) {
      if (!left) {
        var s = score();
        if (!best || s.max < best.max - 1e-6 || (Math.abs(s.max - best.max) <= 1e-6 && s.sq < best.sq - 1e-6)) best = { max: s.max, sq: s.sq, cuts: cuts.slice() };
        return;
      }
      for (var c = start; c <= n - left; c++) { cuts.push(c); pick(c + 1, left - 1); cuts.pop(); }
    }
    pick(1, k - 1);
    return best.cuts;
  }

  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var curbMemo = {}, curbMemoSize = 0;
  // A site's curb items, in order: [{ zone_id: 'curbs-1', type: 'hand', name, feet, zone_ids }].
  function curbItems(siteId, zones) {
    var curbs = curbZonesOf(siteId, zones);
    if (!curbs.length) return [];
    var lens = curbs.map(curbFeet);
    var key = siteId + '\u0001' + curbs.map(function (z, i) { return z.id + ':' + lens[i]; }).join(',');
    if (!curbMemo[key]) {
      if (curbMemoSize > 500) { curbMemo = {}; curbMemoSize = 0; }
      var total = lens.reduce(function (s, l) { return s + l; }, 0), k = itemCount(curbs.length, total);
      var bounds = [0].concat(cutPoints(lens, k), [curbs.length]), items = [];
      for (var g = 0; g < k; g++) {
        var feet = 0, ids = [];
        for (var i = bounds[g]; i < bounds[g + 1]; i++) { feet += lens[i]; ids.push(curbs[i].id); }
        var about = feet > 0 ? 'about ' + commas(Math.round(feet / 10) * 10) + ' ft' : '';
        var name = k === 1 ? 'Curbs' + (about ? ', ' + about : '') : 'Curbs ' + (g + 1) + ' of ' + k + (about ? ', ' + about : '');
        items.push({ zone_id: 'curbs-' + (g + 1), type: 'hand', name: name, feet: Math.round(feet), zone_ids: ids });
      }
      curbMemo[key] = items;
      curbMemoSize++;
    }
    return curbMemo[key].map(function (it) { return Object.assign({}, it, { zone_ids: it.zone_ids.slice() }); });
  }

  // For Matt's Sites tab: a site's curb feet, its item count, and whether its items run over
  // feetPerItem + allowance each (more curb than maxItems items can hold).
  function curbSummary(siteId, zones) {
    var curbs = curbZonesOf(siteId, zones);
    var total = curbs.reduce(function (s, z) { return s + curbFeet(z); }, 0), k = itemCount(curbs.length, total);
    return { feet: Math.round(total), items: k, overSize: k > 0 && total > k * itemFeet() + 1e-6 };
  }

  // The walk a zone is tapped under: a curb zone's item, anything else itself.
  function zoneWalkId(siteId, zoneId, zones) {
    var item = curbItems(siteId, zones).filter(function (it) { return it.zone_ids.indexOf(zoneId) !== -1; })[0];
    return item ? item.zone_id : zoneId;
  }

  // What a crew member walks at a site: its live sidewalk, hand and heated zones,
  // by name, then its curb items (they are done last, after the ease-up). A site
  // with none drawn gets one whole-site walk, so a site Matt has not mapped yet
  // can still be logged.
  function walksFor(siteId, zones) {
    var walks = (zones || []).filter(function (z) {
      return z.site_id === siteId && z.archived !== true && !isCurbZone(z) && (z.type === 'sidewalk' || z.type === 'hand' || z.type === 'heated');
    }).map(function (z) {
      return { zone_id: z.id, type: z.type, name: z.name };
    });
    walks.sort(byName);
    walks = walks.concat(curbItems(siteId, zones));
    if (!walks.length) return [{ zone_id: 'whole', type: 'sidewalk', name: 'Whole site' }];
    return walks;
  }

  // Heated ground is checked, never treated; hand work is walked like a
  // sidewalk; storage and no_touch are never walked.
  function statesFor(type) {
    if (type === 'sidewalk' || type === 'hand') return ['cleared', 'treated', 'problem'];
    if (type === 'heated') return ['checked', 'problem'];
    return [];
  }

  // '' when the tap is allowed, otherwise the reason it is not.
  function checkTap(o) {
    var walk = (o && o.walk) || {};
    var allowed = statesFor(walk.type);
    if (!allowed.length) return 'This zone is not walked';
    if (allowed.indexOf(o.state) === -1) return 'That is not a state for this zone';
    if (o.state === 'problem' && !String(o.note || '').trim()) return 'Say what the problem is';
    return '';
  }

  // The newest start row names the current storm; end / reopen / snowing /
  // stopped move that storm only. A late row about an older storm is ignored.
  // night_on changes neither (it only affects filing: see shiftFor).
  function stormState(stormRows) {
    var s = { storm_id: null, open: false, snowing: false };
    (stormRows || []).slice().sort(bySeq).forEach(function (r) {
      if (r.kind === 'start') { s = { storm_id: r.storm_id, open: true, snowing: false }; return; }
      if (r.storm_id !== s.storm_id) return;
      if (r.kind === 'end') s.open = false;
      else if (r.kind === 'reopen') s.open = true;
      else if (r.kind === 'snowing') s.snowing = true;
      else if (r.kind === 'stopped') s.snowing = false;
    });
    return s;
  }

  function hourOf(iso) { return Number(String(iso).slice(11, 13)); }

  // Which shift a tap belongs to, decided on the server from its own clock.
  // Before 9 AM it is still the night that began the evening before. After 9
  // it is day, unless a night_on was logged that same local evening and has
  // already happened.
  function shiftFor(iso, stormRows) {
    if (hourOf(iso) < T.SHIFT_CUTOVER_HOUR) return T.shiftId('night', T.shiftDate(iso));
    var date = String(iso).slice(0, 10);
    var now = Date.parse(iso);
    var night = (stormRows || []).some(function (r) {
      return r.kind === 'night_on' &&
        String(r.at).slice(0, 10) === date &&
        hourOf(r.at) >= T.SHIFT_CUTOVER_HOUR &&
        Date.parse(r.at) <= now;
    });
    return T.shiftId(night ? 'night' : 'day', date);
  }

  // Newest row per walk for one storm. A 'none' row is an undo back to not
  // done; it stays in the map so siteDone can see it is not done.
  // ---- Clean again: passes (Part B1, Matt 10/4/26) ----
  // A Clean again row { zone_id: '*', state: 'again' } starts every walk at its
  // site over; the earlier pass stays in the Log. An 'again_undone' row (undoes:
  // the again row's id) puts the earlier pass back. '*' rows are never walks.
  function standingAgains(rows) {
    var undone = {};
    rows.forEach(function (r) { if (r.zone_id === '*' && r.state === 'again_undone' && r.undoes != null) undone[r.undoes] = true; });
    return rows.filter(function (r) { return r.zone_id === '*' && r.state === 'again' && !undone[r.id]; }).sort(bySeq);
  }

  // The site's current pass: its number, the again row that started it, and the
  // seq it starts after (0 for pass 1).
  function passInfo(logRows, stormId, siteId) {
    var ag = standingAgains(inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId; }));
    var again = ag.length ? ag[ag.length - 1] : null;
    return { n: ag.length + 1, again: again, sinceSeq: again ? Number(again.seq) : 0 };
  }

  function walkStates(logRows, stormId) {
    var out = {}, rows = inStorm(logRows, stormId), since = {};
    standingAgains(rows).forEach(function (a) { since[a.site_id] = Number(a.seq); });
    rows.sort(bySeq).forEach(function (r) {
      if (r.zone_id === '*' || Number(r.seq) <= (since[r.site_id] || 0)) return;
      out[walkKey(r.site_id, r.zone_id)] = r;
    });
    return out;
  }

  // Real taps among one site's rows: never a '*' row, never an undo row, never a
  // tap whose undo still stands (an undo that is itself undone gives it back).
  function realTaps(rows) {
    var undoneBy = {};
    rows.forEach(function (r) { if (r.zone_id !== '*' && r.undoes != null) (undoneBy[r.undoes] = undoneBy[r.undoes] || []).push(r); });
    function stands(r, depth) {
      return depth > 50 || !(undoneBy[r.id] || []).some(function (u) { return stands(u, depth + 1); });
    }
    return rows.filter(function (r) { return r.zone_id !== '*' && r.undoes == null && stands(r, 0); });
  }

  // Clean again needs something done in the current pass first, so two quick
  // taps (two phones) never skip a pass.
  function checkAgain(logRows, stormId, siteId) {
    var since = passInfo(logRows, stormId, siteId).sinceSeq;
    var rows = inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId && Number(r.seq) > since; });
    return realTaps(rows).length ? null : 'Nothing to clean again yet';
  }

  // One site's rows in one shift, split at Clean again, numbered by the storm's
  // passes. A pass that began in an earlier shift still carries its again row.
  function passSegments(logRows, stormId, siteId, shiftId) {
    var rows = inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId; }).sort(bySeq);
    var ag = standingAgains(rows), byN = {};
    function nAt(seq) { return 1 + ag.filter(function (a) { return Number(a.seq) < seq; }).length; }
    function seg(n) { return (byN[n] = byN[n] || { n: n, again: null, rows: [] }); }
    rows.forEach(function (r) {
      if (r.shift_id !== shiftId || r.zone_id === '*') return;
      seg(nAt(Number(r.seq))).rows.push(r);
    });
    ag.forEach(function (a) { if (a.shift_id === shiftId) seg(nAt(Number(a.seq)) + 1); });
    return Object.keys(byN).map(function (k) { var p = byN[k]; if (p.n > 1) p.again = ag[p.n - 2]; return p; })
      .sort(function (a, b) { return a.n - b.n; });
  }

  // What a walk goes back to if `seq` is undone. Only the newest row on its
  // walk can be undone; the state is whatever the row before it said, and so is the
  // note (a walk undone back to 'problem' must keep what the problem was).
  function undoTarget(logRows, stormId, seq) {
    var rows = inStorm(logRows, stormId).sort(bySeq);
    var row = rows.filter(function (r) { return Number(r.seq) === Number(seq); })[0];
    if (!row) return { ok: false, reason: 'That tap is not in this storm' };
    if (row.zone_id === '*') {
      if (row.state !== 'again') return { ok: false, reason: 'That cannot be undone' };
      // A depth row is a measuring-stick reading, not work: it never blocks the undo.
      var atSite = rows.filter(function (r) { return r.site_id === row.site_id && r.state !== 'depth'; });
      if (atSite[atSite.length - 1] !== row) return { ok: false, reason: 'Someone has tapped this site since' };
      return { ok: true, row: row, state: 'again_undone', note: '' };
    }
    var since = passInfo(rows, stormId, row.site_id).sinceSeq;
    if (Number(row.seq) <= since) return { ok: false, reason: 'That tap is from an earlier pass' };
    var key = walkKey(row.site_id, row.zone_id);
    var same = rows.filter(function (r) { return walkKey(r.site_id, r.zone_id) === key && Number(r.seq) > since; });
    var at = same.indexOf(row);
    if (at !== same.length - 1) return { ok: false, reason: 'Someone has tapped this walk since' };
    var prev = at === 0 ? null : same[at - 1];
    return { ok: true, row: row, state: prev ? prev.state : 'none', note: prev ? String(prev.note || '') : '' };
  }

  // ---- New snow since (callouts, Matt 10/4/26) ----
  // Where "new snow since the last cleaning" starts at one site, and the newest
  // depth reading after that point. The clock is, in order: the newest real tap
  // of the site's current pass (an undo is not work); else that pass's Clean
  // again row; else the storm's start row (a Storms-tab row, so fromSeq is 0:
  // Log seqs and Storms seqs are separate counters). A depth row
  // { zone_id: '*', state: 'depth', depth_in } is never a tap, so it never moves
  // the clock; it only counts while it is newer than the clock, so a tap or a
  // Clean again after a reading means the reading no longer applies.
  function snowSince(logRows, stormRows, stormId, siteId) {
    var rows = inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId; });
    var pass = passInfo(rows, stormId, siteId);
    var taps = realTaps(rows).filter(function (r) { return Number(r.seq) > pass.sinceSeq; }).sort(bySeq);
    var from = null, fromSeq = 0;
    if (taps.length) { var t = taps[taps.length - 1]; from = t.at; fromSeq = Number(t.seq); }
    else if (pass.again) { from = pass.again.at; fromSeq = Number(pass.again.seq); }
    else {
      var starts = (stormRows || []).filter(function (r) { return r.kind === 'start' && r.storm_id === stormId; }).sort(bySeq);
      if (starts.length) from = starts[starts.length - 1].at;
    }
    var depths = rows.filter(function (r) { return r.zone_id === '*' && r.state === 'depth' && Number(r.seq) > fromSeq; }).sort(bySeq);
    return { from: from, fromSeq: fromSeq, measured: depths.length ? depths[depths.length - 1] : null };
  }

  // ---- Open Problems (Matt, 10/4/26; one rule for the Problems box and the handoff) ----
  // A site's open Problems: a walk of the current pass whose newest row is a
  // Problem (pass null), and a walk whose newest row before the current pass is
  // a Problem while the current pass has not tapped that walk: carried, with the
  // pass it was found in (Clean again never hides a Problem). Newest first.
  // states: walkStates(logRows, stormId). Each: { row, pass }.
  function openProblems(logRows, stormId, siteId, states) {
    var rows = inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId; }).sort(bySeq);
    var info = passInfo(rows, stormId, siteId), now = states || {}, found = [], seen = {}, before = {};
    rows.forEach(function (r) {
      if (r.zone_id === '*' || seen[r.zone_id]) return;
      seen[r.zone_id] = true;
      var cur = now[walkKey(siteId, r.zone_id)];
      if (cur && cur.state === 'problem') found.push({ row: cur, pass: null });
    });
    if (info.n >= 2) {
      rows.forEach(function (r) { if (r.zone_id !== '*' && Number(r.seq) <= info.sinceSeq) before[r.zone_id] = r; });
      Object.keys(before).forEach(function (z) {
        var r = before[z];
        if (r.state !== 'problem' || now[walkKey(siteId, z)]) return;
        found.push({ row: r, pass: passInfo(rows.filter(function (x) { return Number(x.seq) <= Number(r.seq); }), stormId, siteId).n });
      });
    }
    return found.sort(function (a, b) { return bySeq(b.row, a.row); });
  }

  // A zone's name on a line: its walk's name, else its zone record (archived
  // since), else 'Whole site' (a tap from before zones were drawn), else its id.
  function zoneName(siteId, zoneId, zones) {
    var w = walksFor(siteId, zones).filter(function (x) { return x.zone_id === zoneId; })[0];
    if (w) return String(w.name);
    var z = (zones || []).filter(function (x) { return x.id === zoneId; })[0];
    return z ? String(z.name) : zoneId === 'whole' ? 'Whole site' : String(zoneId);
  }

  function walkDone(siteId, w, states) {
    var r = (states || {})[walkKey(siteId, w.zone_id)];
    return !!r && DONE.indexOf(r.state) !== -1;
  }

  function siteDone(siteId, zones, states) {
    return walksFor(siteId, zones).every(function (w) { return walkDone(siteId, w, states); });
  }

  // How many of a site's walks are done, of how many: a handoff's "2 of 5 walks".
  function walkCount(siteId, zones, states) {
    var walks = walksFor(siteId, zones);
    return { done: walks.filter(function (w) { return walkDone(siteId, w, states); }).length, total: walks.length };
  }

  // ---- Day order (Part B2, Matt 10/4/26; shared here for the handoff 10/5/26) ----
  // Day shift lists ranked sites first (day_rank ascending, ties by their place
  // in the list), then the unranked in list order. A rank is a number; a blank,
  // a string, or a site the lookup does not know is unranked. Always a new
  // array: the input is never changed.
  function dayOrder(siteIds, siteById) {
    var items = (siteIds || []).map(function (id, i) {
      var site = (siteById || {})[id], r = site ? site.day_rank : null;
      return { id: id, i: i, rank: typeof r === 'number' && isFinite(r) ? r : null };
    });
    items.sort(function (a, b) {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.i - b.i;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.i - b.i;
    });
    return items.map(function (x) { return x.id; });
  }

  function routeProgress(siteIds, zones, states) {
    var done = (siteIds || []).filter(function (id) { return siteDone(id, zones, states); }).length;
    return { done: done, total: (siteIds || []).length };
  }

  // First and last tap at a site in one shift, by seq.
  // Start/Finish count real taps only (Matt, 10/4/26: "a new guy mis-taps; an
  // undo is a correction, not work"): never an undo row, never a tap whose undo
  // still stands. An undo that is itself undone gives its tap back.
  // sinceSeq (optional): only taps after it -- one pass's times.
  function siteTimes(logRows, siteId, shiftId, sinceSeq) {
    var all = (logRows || []).filter(function (r) { return r.site_id === siteId && r.shift_id === shiftId; });
    var rows = realTaps(all).filter(function (r) { return Number(r.seq) > (sinceSeq || 0); }).sort(bySeq);
    return { start: rows.length ? rows[0].at : null, finish: rows.length ? rows[rows.length - 1].at : null };
  }

  function typedMinutes(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // The site cards for one site and shift. Each person has one card (a
  // re-save replaces their own, nobody else's); minutes are summed over those
  // cards. A blank adds nothing, and a piece of equipment nobody logged stays
  // null: blank is "not recorded", not "zero minutes".
  function visitTotals(visits, siteId, shiftId) {
    var rows = (visits || []).filter(function (v) { return v.site_id === siteId && v.shift_id === shiftId; }).sort(bySeq);
    var newest = {};
    rows.forEach(function (v) { newest[String(v.by_key || 'admin')] = v; });
    var cards = Object.keys(newest).map(function (k) { return newest[k]; });
    var minutes = {};
    EQUIPMENT.forEach(function (e) {
      var sum = null;
      cards.forEach(function (c) {
        var m = typedMinutes((c.equipment || {})[e]);
        if (m !== null) sum = (sum || 0) + m;
      });
      minutes[e] = sum;
    });
    return { cards: cards, minutes: minutes };
  }

  return { walkKey: walkKey, walksFor: walksFor, statesFor: statesFor, checkTap: checkTap, stormState: stormState,
    shiftFor: shiftFor, walkStates: walkStates, undoTarget: undoTarget, siteDone: siteDone,
    routeProgress: routeProgress, siteTimes: siteTimes, passInfo: passInfo, checkAgain: checkAgain, passSegments: passSegments, visitTotals: visitTotals, snowSince: snowSince,
    realTaps: realTaps, walkCount: walkCount, dayOrder: dayOrder, openProblems: openProblems, zoneName: zoneName,
    CURB_ROLLUP: CURB_ROLLUP, isCurbZone: isCurbZone, curbItems: curbItems, curbSummary: curbSummary, zoneWalkId: zoneWalkId };
});
