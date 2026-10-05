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

  // What a crew member walks at a site: its live sidewalk, hand and heated zones,
  // by name. A site with none drawn gets one whole-site walk, so a site Matt
  // has not mapped yet can still be logged.
  function walksFor(siteId, zones) {
    var walks = (zones || []).filter(function (z) {
      return z.site_id === siteId && z.archived !== true && (z.type === 'sidewalk' || z.type === 'hand' || z.type === 'heated');
    }).map(function (z) {
      return { zone_id: z.id, type: z.type, name: z.name };
    });
    walks.sort(function (a, b) {
      var x = String(a.name).toLowerCase(), y = String(b.name).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
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

  function siteDone(siteId, zones, states) {
    return walksFor(siteId, zones).every(function (w) {
      var r = (states || {})[walkKey(siteId, w.zone_id)];
      return !!r && DONE.indexOf(r.state) !== -1;
    });
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
    routeProgress: routeProgress, siteTimes: siteTimes, passInfo: passInfo, checkAgain: checkAgain, passSegments: passSegments, visitTotals: visitTotals, snowSince: snowSince };
});
