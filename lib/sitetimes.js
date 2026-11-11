(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'), require('./clock'));
  else root.SnowSiteTimes = factory(root.CrewShiftLog, root.CrewClock);
})(this, function (L, K) {
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

  // ---- a person's shift times (times, 11/11/26): which shift their line is about, and which buttons the Clock rules allow ----
  // R33, the shown shift: the current shift when that person has ANY Clock row in it (standing, undone or typed); else the shift
  // before when they have a STANDING tapped or typed time there (earlier: true, and the line is prefixed with that shift's label);
  // else the current shift. Never two back. Hand it the rows the phone holds (a crew phone holds only its own).
  function shiftShown(rows, crewId, current) {
    var mine = (rows || []).filter(function (r) { return r && String(r.crew_id) === String(crewId); });
    if (mine.some(function (r) { return r.shift_id === current; })) return { shift: current, earlier: false };
    var before = shiftBefore(current);
    if (before) {
      var p = K.personShift(mine, crewId, before);
      if (p.start !== null || p.end !== null) return { shift: before, earlier: true };
    }
    return { shift: current, earlier: false };
  }

  // The buttons on one person's card, from the shared Clock rules (CrewClock) over the shown shift, and never one the server would
  // refuse (Code.js clockTap_ / clockUndo_):
  //  - start: a Start is always written in the CURRENT shift, and only for someone with no start there; it is not offered while the
  //    shown earlier shift is still open (a start, no end): that person ends it first;
  //  - end: an End closes the shown shift (the current one, else the one before: R13), only for someone started and not ended there;
  //  - undo: 'end' when a tapped End stands there, else 'start' when a tapped Start stands and no End is over it (R2); a typed time has none.
  function shiftOffers(rows, crewId, current) {
    var v = shiftShown(rows, crewId, current), ids = [crewId];
    var open = false;
    if (v.earlier) { var p = K.personShift(rows, crewId, v.shift); open = p.start !== null && p.end === null; }
    return {
      shift: v.shift, earlier: v.earlier,
      start: !open && K.tapRows(rows, ids, current, 'start').length > 0,
      end: K.tapRows(rows, ids, v.shift, 'end').length > 0,
      undo: K.undoable(rows, ids, v.shift, 'end').length > 0 ? 'end' : K.undoable(rows, ids, v.shift, 'start').length > 0 ? 'start' : null
    };
  }

  // How many people a route's Start or End would cover right now, counted as the server counts them: a Start in the current shift
  // for everyone with no start there; an End in the current shift for everyone open there, and for the rest, in the shift before.
  function routeTaps(rows, ids, current) {
    var start = K.tapRows(rows, ids, current, 'start').length;
    var now = K.tapRows(rows, ids, current, 'end'), end = now.length, before = shiftBefore(current);
    if (before) {
      var rest = (ids || []).filter(function (id) { return now.indexOf(id) === -1; });
      end += K.tapRows(rows, rest, before, 'end').length;
    }
    return { start: start, end: end };
  }

  return { shiftShown: shiftShown, shiftOffers: shiftOffers, routeTaps: routeTaps, shiftBefore: shiftBefore, datesFor: datesFor, otherDate: otherDate, visitShift: visitShift, dateFor: dateFor, stamp: stamp, onLabel: onLabel, shiftsFor: shiftsFor };
});
