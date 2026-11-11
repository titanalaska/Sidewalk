(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewClock = factory();
})(this, function () {
  'use strict';

  // A person's shift start and stop. Rows are append-only (the Clock tab); one row is for ONE person.
  //   start / end            a tap (at = the server's local ISO with an offset)
  //   start_undone / end_undone   takes back the row named in `undoes`
  //   typed                  a dispatcher typed time_in / time_out ('' or a local minute YYYY-MM-DDTHH:MM)
  // The shift is whatever the row's shift_id says; this module never recomputes it and never looks at storms.

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }

  function forPerson(rows, crewId, shiftId) {
    return (rows || []).filter(function (r) {
      return r && r.shift_id === shiftId && String(r.crew_id) === String(crewId);
    });
  }

  // Standing tapped rows of one kind among one person's rows (same chain rule as shiftlog's standingMarks:
  // an undo that was itself undone gives its row back). Oldest first.
  function standing(mine, kind) {
    var undoKind = kind + '_undone', undoneBy = {};
    mine.forEach(function (r) {
      if (r.kind === undoKind && r.undoes != null) (undoneBy[r.undoes] = undoneBy[r.undoes] || []).push(r);
    });
    function stands(r, depth) {
      return depth > 50 || !(undoneBy[r.id] || []).some(function (u) { return stands(u, depth + 1); });
    }
    return mine.filter(function (r) { return r.kind === kind && stands(r, 0); }).sort(bySeq);
  }

  function blank(v) { return typeof v !== 'string' || v.replace(/\s/g, '') === ''; }

  function newestTyped(typedRows, field) {
    var best = null;
    typedRows.forEach(function (r) {
      if (blank(r[field])) return;
      if (best === null || Number(r.seq) > Number(best.seq)) best = r;
    });
    return best;
  }

  function personShift(rows, crewId, shiftId) {
    var mine = forPerson(rows, crewId, shiftId);
    var typedRows = mine.filter(function (r) { return r.kind === 'typed'; });
    var out = { start: null, end: null, startHow: null, endHow: null, startBy: null, endBy: null };

    var ts = newestTyped(typedRows, 'time_in');
    var te = newestTyped(typedRows, 'time_out');
    if (ts) { out.start = ts.time_in; out.startHow = 'typed'; out.startBy = ts.by_name; }
    else {
      var starts = standing(mine, 'start');
      if (starts.length) { out.start = starts[0].at; out.startHow = 'tapped'; out.startBy = starts[0].by_name; }
    }
    if (te) { out.end = te.time_out; out.endHow = 'typed'; out.endBy = te.by_name; }
    else {
      var ends = standing(mine, 'end');
      if (ends.length) { var last = ends[ends.length - 1]; out.end = last.at; out.endHow = 'tapped'; out.endBy = last.by_name; }
    }
    return out;
  }

  function uniq(ids) {
    var seen = {}, out = [];
    (ids || []).forEach(function (id) {
      var k = String(id);
      if (seen[k]) return;
      seen[k] = true;
      out.push(id);
    });
    return out;
  }

  // Who gets a new row when someone on a route taps Start or End.
  function tapRows(rows, crewIds, shiftId, kind) {
    return uniq(crewIds).filter(function (id) {
      var p = personShift(rows, id, shiftId);
      if (kind === 'start') return p.start === null;
      if (kind === 'end') return p.start !== null && p.end === null;
      return false;
    });
  }

  // Ids of the standing TAPPED rows of that kind for those people. A typed time is never undoable, and a
  // start stays while that person has any end (an end must never be left without a start).
  function undoable(rows, crewIds, shiftId, kind) {
    var out = [];
    if (kind !== 'start' && kind !== 'end') return out;
    uniq(crewIds).forEach(function (id) {
      if (kind === 'start' && personShift(rows, id, shiftId).end !== null) return;
      standing(forPerson(rows, id, shiftId), kind).forEach(function (r) { out.push(r.id); });
    });
    return out;
  }

  // R34 / R13 / R36 (times, 11/11/26): who a Start or End reaches and in WHICH shift, one place for the server, the phone and the fake. `current` and
  // `before` are shift ids the CALLER works out (this file never computes a shift). A person is OPEN in a shift when personShift gives them a
  // start (tapped or typed) and no end. Returns { crewId: shiftId } for exactly the people who get a row:
  //   start: nobody with a start in `current` (as tapRows), and nobody OPEN in `before` (they are already on the clock) -> current
  //   end:   open in `current` -> current; of the rest, open in `before` -> before. `before` may be null or '' (no look-back).
  function isOpen(rows, id, shiftId) {
    var p = personShift(rows, id, shiftId);
    return !(p.start === null || p.end !== null);
  }
  function tapShifts(rows, crewIds, current, before, kind) {
    var out = {};
    uniq(crewIds).forEach(function (id) {
      if (kind === 'start') {
        if (personShift(rows, id, current).start !== null) return;
        if (before && isOpen(rows, id, before)) return;
        out[id] = current;
      } else if (kind === 'end') {
        if (isOpen(rows, id, current)) out[id] = current;
        else if (before && isOpen(rows, id, before)) out[id] = before;
      }
    });
    return out;
  }

  // R35: ids of the standing tapped rows an Undo takes back, PER PERSON: that person's `current` shift, and only when they have NO row there
  // at all (of any kind: tapped, taken back or typed) the shift `before`. This is the shift their card shows (R33), so an Undo never reaches
  // a night the person has moved on from: not on a replay (R14), and not when a teammate's Undo end runs over someone who ended the night
  // and has started the day. Built only from undoable().
  function undoTargets(rows, crewIds, current, before, kind) {
    var out = [];
    if (kind !== 'start' && kind !== 'end') return out;
    uniq(crewIds).forEach(function (id) {
      var t = undoable(rows, [id], current, kind);
      if (!t.length && before) {
        var here = forPerson(rows, id, current).length > 0;
        if (!here) t = undoable(rows, [id], before, kind);
      }
      t.forEach(function (x) { out.push(x); });
    });
    return out;
  }

  // A stamp is read by hand (never new Date on a zone-less string): its wall minute (YYYY-MM-DDTHH:MM) as
  // minutes since the epoch, and its UTC offset in minutes when it carries one (Z, +HH:MM, -HH:MM), else null.
  function stamp(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?/.exec(s);
    if (!m) return null;
    var off = null;
    if (m[6] === 'Z') off = 0;
    else if (m[6]) off = (m[6].charAt(0) === '-' ? -1 : 1) * (Number(m[6].substr(1, 2)) * 60 + Number(m[6].substr(4, 2)));
    return { wall: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000, off: off };
  }

  // Both stamps carry an offset (two taps): the real elapsed minutes between the instants. Either one without
  // (a typed time): wall-clock subtraction, a known limit on the two clock-change nights. Seconds are dropped.
  function minutes(start, end) {
    var A = stamp(start), B = stamp(end);
    if (A === null || B === null) return null;
    var a = A.wall, b = B.wall;
    if (A.off !== null && B.off !== null) { a -= A.off; b -= B.off; }
    if (b < a) return null;
    return b - a;
  }

  function hhmm(mins) {
    if (typeof mins !== 'number' || !isFinite(mins)) return '';
    mins = Math.floor(mins);
    if (mins < 0) return '';
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  function nightRows(rows, shiftId, crew) {
    var inShift = (rows || []).filter(function (r) { return r && r.shift_id === shiftId; });
    var ids = [], seen = {};
    inShift.forEach(function (r) {
      var k = String(r.crew_id);
      if (!seen[k]) { seen[k] = true; ids.push(r.crew_id); }
    });
    var lines = [];
    ids.forEach(function (id) {
      var p = personShift(inShift, id, shiftId);
      if (p.start === null && p.end === null) return;
      var card = (crew || []).filter(function (c) { return String(c.id) === String(id); })[0];
      var name;
      if (card) name = card.name;
      else {
        var mine = forPerson(inShift, id, shiftId).sort(bySeq);
        name = mine.length ? mine[mine.length - 1].name : '';
      }
      if (name === undefined || name === null) name = '';
      lines.push({
        crew_id: id, name: name, start: p.start, end: p.end, startHow: p.startHow, endHow: p.endHow,
        startBy: p.startBy, endBy: p.endBy, minutes: minutes(p.start, p.end)
      });
    });
    lines.sort(function (a, b) {
      var x = String(a.name).toLowerCase(), y = String(b.name).toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
      return String(a.crew_id) < String(b.crew_id) ? -1 : String(a.crew_id) > String(b.crew_id) ? 1 : 0;
    });
    return lines;
  }

  return {
    personShift: personShift, tapRows: tapRows, undoable: undoable, tapShifts: tapShifts, undoTargets: undoTargets,
    minutes: minutes, hhmm: hhmm, nightRows: nightRows
  };
});
