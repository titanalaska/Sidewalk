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

  // What a crew member walks at a site: its live sidewalk and heated zones,
  // by name. A site with none drawn gets one whole-site walk, so a site Matt
  // has not mapped yet can still be logged.
  function walksFor(siteId, zones) {
    var walks = (zones || []).filter(function (z) {
      return z.site_id === siteId && z.archived !== true && (z.type === 'sidewalk' || z.type === 'heated');
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

  // Heated ground is checked, never treated; no_touch is never walked.
  function statesFor(type) {
    if (type === 'sidewalk') return ['cleared', 'treated', 'problem'];
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
  function walkStates(logRows, stormId) {
    var out = {};
    inStorm(logRows, stormId).sort(bySeq).forEach(function (r) {
      out[walkKey(r.site_id, r.zone_id)] = r;
    });
    return out;
  }

  // What a walk goes back to if `seq` is undone. Only the newest row on its
  // walk can be undone; the state is whatever the row before it said, and so is the
  // note (a walk undone back to 'problem' must keep what the problem was).
  function undoTarget(logRows, stormId, seq) {
    var rows = inStorm(logRows, stormId).sort(bySeq);
    var row = rows.filter(function (r) { return Number(r.seq) === Number(seq); })[0];
    if (!row) return { ok: false, reason: 'That tap is not in this storm' };
    var key = walkKey(row.site_id, row.zone_id);
    var same = rows.filter(function (r) { return walkKey(r.site_id, r.zone_id) === key; });
    var at = same.indexOf(row);
    if (at !== same.length - 1) return { ok: false, reason: 'Someone has tapped this walk since' };
    var prev = at === 0 ? null : same[at - 1];
    return { ok: true, row: row, state: prev ? prev.state : 'none', note: prev ? String(prev.note || '') : '' };
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
  function siteTimes(logRows, siteId, shiftId) {
    var rows = (logRows || []).filter(function (r) { return r.site_id === siteId && r.shift_id === shiftId; }).sort(bySeq);
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
    routeProgress: routeProgress, siteTimes: siteTimes, visitTotals: visitTotals };
});
