(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowBtNote = factory(root.CrewShiftLog);
})(this, function (L) {
  'use strict';

  // The "Copy for BT" text for one site and shift (Matt, 10/3/26). The app only
  // writes the text: the lead pastes it into BuilderTrend and posts as
  // themselves, photos and all. Nothing here, or anywhere, talks to BT.
  //
  // Walk states are the storm's current ones (what the site really looks like
  // now); times, depth, materials and minutes are this shift's.

  var STATES = [['cleared', 'Cleared'], ['treated', 'Treated'], ['checked', 'Checked'], ['none', 'Not done']];
  var MACHINES = [['blower', 'Blower'], ['snowrator', 'Snowrator'], ['bobcat', 'Bobcat'], ['sweepster', 'Sweepster']];

  // "2026-12-04T23:55:00.000-09:00" -> "11:55 PM", read off the string itself so
  // the answer never depends on the phone's time zone.
  function clock(iso) {
    if (!iso) return '';
    var h = Number(iso.slice(11, 13)), m = iso.slice(14, 16);
    return (h % 12 === 0 ? 12 : h % 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }

  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }

  // o: {site, zones, storm_id, log, visits}
  function btNote(o, shiftId) {
    var site = o.site, stormLog = (o.log || []).filter(function (r) { return r.storm_id === o.storm_id; });
    var newest = {};
    stormLog.filter(function (r) { return r.site_id === site.id; })
      .sort(function (a, b) { return Number(a.seq) - Number(b.seq); })
      .forEach(function (r) { newest[r.zone_id] = r; });

    var groups = {}, problems = [];
    L.walksFor(site.id, o.zones).forEach(function (w) {
      var r = newest[w.zone_id], state = r ? r.state : 'none';
      if (state === 'problem') problems.push(w.name + (blank(r.note) ? '' : ' (' + String(r.note).trim() + ')'));
      else (groups[state] = groups[state] || []).push(w.name);
    });
    var walks = STATES.filter(function (s) { return groups[s[0]]; })
      .map(function (s) { return s[1] + ': ' + groups[s[0]].join(', ') + '.'; });
    if (problems.length) walks.push('Problem: ' + problems.join('; ') + '.');

    var lines = [walks.join(' ')];
    var thisShift = stormLog.filter(function (r) { return r.site_id === site.id && r.shift_id === shiftId; });
    if (thisShift.some(function (r) { return r.snowing_warned === true; })) lines.push('Treated while still snowing.');

    var cards = L.visitTotals((o.visits || []).filter(function (v) { return v.storm_id === o.storm_id; }), site.id, shiftId);
    var depths = cards.cards.map(function (c) { return c.depth_in; }).filter(function (d) { return !blank(d); }).map(Number)
      .sort(function (a, b) { return a - b; });
    if (depths.length) lines.push('Depth: ' + (depths[0] === depths[depths.length - 1] ? depths[0] : depths[0] + '-' + depths[depths.length - 1]) + '"');
    var mats = cards.cards.map(function (c) { return c.materials_used; }).filter(function (m) { return !blank(m); })
      .map(function (m) { return String(m).trim(); });
    if (mats.length) lines.push('Materials: ' + mats.join('; '));
    var units = site.units || {};
    var used = MACHINES.filter(function (m) { return cards.minutes[m[0]] !== null; }).map(function (m) {
      return m[1] + (blank(units[m[0]]) ? '' : ' ' + String(units[m[0]]).trim()) + ' ' + cards.minutes[m[0]] + ' min';
    });
    if (used.length) lines.push('Equipment: ' + used.join(', '));

    var t = L.siteTimes(thisShift, site.id, shiftId);
    return { text: lines.join('\n'), timeIn: clock(t.start), timeOut: clock(t.finish) };
  }

  return { btNote: btNote, clock: clock };
});
