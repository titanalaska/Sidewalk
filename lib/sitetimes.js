(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowSiteTimes = factory(root.CrewShiftLog);
})(this, function (L) {
  'use strict';

  // The dates behind the dispatcher's Set times form (times, 11/11/26). The form asks for a shift and two clock
  // times; the server wants each time as YYYY-MM-DDTHH:MM on the shift's own date or the day after. A night shift
  // is named by its evening and runs to 9 AM, so a time at noon or later is on the shift's date and a time before
  // noon is on the day after; a day shift's times are on its own date. Phone only (the server takes the dates as
  // sent and checks them; it does not read this file).

  function parse(id) {
    var m = /^(night|day)-(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    return m ? { kind: m[1], y: Number(m[2]), mo: Number(m[3]), d: Number(m[4]) } : null;
  }
  function ymd(date) { return date.toISOString().slice(0, 10); }
  function addDays(p, n) { return ymd(new Date(Date.UTC(p.y, p.mo - 1, p.d + n))); }
  function own(p) { return ymd(new Date(Date.UTC(p.y, p.mo - 1, p.d))); }

  // 'HH:MM' (a time input's value) -> { h, m }, or null.
  function clockOf(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(hhmm == null ? '' : hhmm).trim());
    if (!m) return null;
    var h = Number(m[1]), mi = Number(m[2]);
    return h <= 23 && mi <= 59 ? { h: h, m: mi } : null;
  }

  // The calendar date a time on a shift is saved on, 'YYYY-MM-DD'; null for a shift or time that is not one.
  function dateFor(shiftId, hhmm) {
    var p = parse(shiftId), c = clockOf(hhmm);
    if (!p || !c) return null;
    return p.kind === 'night' && c.h < 12 ? addDays(p, 1) : own(p);
  }

  // What the phone sends: 'YYYY-MM-DDTHH:MM'; '' for a box left blank; null when the time or the shift is not valid.
  function stamp(shiftId, hhmm) {
    if (hhmm == null || String(hhmm).trim() === '') return '';
    var date = dateFor(shiftId, hhmm);
    return date === null ? null : date + 'T' + String(hhmm).trim();
  }

  // 'on 11/10' for 2026-11-10: the line printed under a box.
  function onLabel(date) {
    var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date || ''));
    return m ? 'on ' + Number(m[1]) + '/' + Number(m[2]) : '';
  }

  // A shift's place in time: a date's day (from 9 AM) comes before its night.
  function key(id) { var p = parse(id); return p ? own(p) + (p.kind === 'day' ? '1' : '2') : ''; }
  function shiftAfter(id) {
    var p = parse(id);
    return p.kind === 'day' ? 'night-' + own(p) : 'day-' + addDays(p, 1);
  }

  // The shifts the server takes typed times for: the storm's first shift through the one running now, newest first.
  function shiftsFor(firstShift, nowShift) {
    if (!parse(firstShift) || !parse(nowShift) || key(firstShift) > key(nowShift)) return [];
    var out = [], id = firstShift;
    while (key(id) <= key(nowShift) && out.length < 400) { out.unshift(id); id = shiftAfter(id); }
    return out;
  }

  // The shift before one: a day's is the night before it, a night's is its own day (the server's shiftBefore_).
  function shiftBefore(id) {
    var p = parse(id);
    if (!p) return null;
    return p.kind === 'night' ? 'day-' + own(p) : 'night-' + addDays(p, -1);
  }

  // The two dates a time on a shift may carry: the shift's own and the day after (the server takes either).
  function datesFor(shiftId) { var p = parse(shiftId); return p ? [own(p), addDays(p, 1)] : []; }
  function otherDate(shiftId, date) { var d = datesFor(shiftId); return d.length ? (date === d[0] ? d[1] : d[0]) : null; }

  // R27, the shown visit: the shift a site's line, Undo and Left are about. The current shift when it has ANY arrived / left /
  // typed row at the site (standing or undone); else the shift before when it has a STANDING tapped or typed mark there
  // (earlier: true); else the current shift. Never two back. Hand it ONE storm's rows (two storms can share a night).
  var MARKS = ['arrived', 'left', 'typed', 'arrived_undone', 'left_undone'];
  function visitShift(stormRows, siteId, current) {
    var rows = (stormRows || []).filter(function (r) { return r.site_id === siteId; });
    if (rows.some(function (r) { return r.shift_id === current && r.zone_id === '*' && MARKS.indexOf(r.state) !== -1; })) return { shift: current, earlier: false };
    var before = shiftBefore(current);
    if (before) {
      var c = L.siteClock(rows, siteId, before);
      if (c.startHow === 'typed' || c.startHow === 'tapped' || c.finishHow === 'typed' || c.finishHow === 'tapped') return { shift: before, earlier: true };
    }
    return { shift: current, earlier: false };
  }

  return { shiftBefore: shiftBefore, datesFor: datesFor, otherDate: otherDate, visitShift: visitShift, dateFor: dateFor, stamp: stamp, onLabel: onLabel, shiftsFor: shiftsFor };
});
