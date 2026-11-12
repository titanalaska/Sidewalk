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
  // R45 (round C) + R46: the shift before THAT is shown only while its latest standing mark (an Arrived: open; a Left: just closed) is within the 18 h
  // limit of `now` (the phone's clock): the server files a Left there (shiftlog.js leftShift), so the line and the buttons must show it.
  function arrivedWithin(at, now) { var m = K.minutes(at, now); return m === null || m <= K.OPEN_LIMIT_MIN; }
  function visitShift(stormRows, siteId, current, now) {
    var rows = (stormRows || []).filter(function (r) { return r.site_id === siteId; });
    if (rows.some(function (r) { return r.shift_id === current && r.zone_id === '*' && MARKS.indexOf(r.state) !== -1; })) return { shift: current, earlier: false };
    var before = shiftBefore(current);
    if (before) {
      var c = L.siteClock(rows, siteId, before);
      if (c.startHow === 'typed' || c.startHow === 'tapped' || c.finishHow === 'typed' || c.finishHow === 'tapped') return { shift: before, earlier: true };
      var before2 = shiftBefore(before), last2 = before2 && now ? L.latestMark(rows, rows.length ? rows[0].storm_id : '', siteId, before2) : null;
      // R46: its latest standing mark, of either kind, within the limit. An Arrived: the visit is open. A Left: the visit was just closed, and the crew
      // still sees the Out they tapped and can take it back (the server's R41 window reaches this shift).
      if (last2 && arrivedWithin(last2.at, now)) return { shift: before2, earlier: true };
    }
    return { shift: current, earlier: false };
  }

  // ---- a person's shift times (times, 11/11/26): which shift their line is about, and which buttons the Clock rules allow ----
  // R33, the shown shift (amended by R44, round C): CrewClock.shownShift is the one rule (the server's Undo uses it too). In order: the shift they are
  // on the clock in (a start within 18 h and no end, whatever the shift's name); else the current shift when they have ANY row there; else the shift
  // before when they have a start or an end there; else the one before that when its latest side is within 18 h of now; else the current shift.
  // `now` is the phone's clock, as an ISO stamp with an offset. Hand it the rows the phone holds (a crew phone holds only its own).
  function shiftShown(rows, crewId, current, now) {
    var before = shiftBefore(current), before2 = before ? shiftBefore(before) : null;
    return K.shownShift(rows || [], crewId, current, before, before2, now);
  }

  // The buttons on one person's card, from the shared Clock rules (CrewClock.tapShifts / undoable) and never one the server would refuse
  // (Code.js clockTap_ / clockUndo_, which call the same functions):
  //  - start: this person gets a key from tapShifts('start'): a Start is written in the CURRENT shift for someone with no start there, and
  //    never for someone still open in the shift before (R34: they end that one first);
  //  - end: a key from tapShifts('end'): open in the current shift, else open in the shift before (R13);
  //  - undo: 'end' when a tapped End stands in the shown shift, else 'start' when a tapped Start stands and no End is over it (R2); a typed time has none.
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function shiftOffers(rows, crewId, current, now) {
    var v = shiftShown(rows, crewId, current, now), ids = [crewId];
    return {
      shift: v.shift, earlier: v.earlier,
      start: has(K.tapShifts(rows, ids, current, now, 'start'), crewId),
      end: has(K.tapShifts(rows, ids, current, now, 'end'), crewId),
      undo: K.undoable(rows, ids, v.shift, 'end').length > 0 ? 'end' : K.undoable(rows, ids, v.shift, 'start').length > 0 ? 'start' : null
    };
  }

  // How many people a route's Start or End would cover right now: the number of people tapShifts gives a row to (the server's own count).
  function routeTaps(rows, ids, current, now) {
    return { start: Object.keys(K.tapShifts(rows, ids, current, now, 'start')).length, end: Object.keys(K.tapShifts(rows, ids, current, now, 'end')).length };
  }

  return { shiftShown: shiftShown, shiftOffers: shiftOffers, routeTaps: routeTaps, shiftBefore: shiftBefore, datesFor: datesFor, otherDate: otherDate, visitShift: visitShift, arrivedWithin: arrivedWithin, dateFor: dateFor, stamp: stamp, onLabel: onLabel, shiftsFor: shiftsFor };
});
