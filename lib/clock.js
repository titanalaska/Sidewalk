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

  // R44 (final fix round C, the manager's ruling): a shift's NAME does not decide whether somebody is on the clock; TIME does. A person is ON THE
  // CLOCK in a shift when personShift gives them a start (tapped or typed) and no end there, and the start is within OPEN_LIMIT_MIN (18 hours) of
  // `now`, or later than now. (A Start tapped at 8 PM before Night shift was switched on is filed under the DAY; at 9:20 AM the clock's shift is
  // the next day and a name-based look-back lost it.) One place for the server, the phone and the fake. `current`, `before`, `before2` and `now`
  // are given by the CALLER: this file never computes a shift. A start that does not parse is not on the clock.
  var OPEN_LIMIT_MIN = 1080;
  function withinLimit(at, now) {
    if (stamp(at) === null || stamp(now) === null) return false;
    var m = minutes(at, now);
    return m === null || m <= OPEN_LIMIT_MIN;         // null with both parsed: the stamp is later than now
  }
  function shiftsOf(rows, crewId) {
    var seen = {}, out = [];
    (rows || []).forEach(function (r) {
      if (r && r.shift_id && !seen[r.shift_id]) { seen[r.shift_id] = true; if (forPerson(rows, crewId, r.shift_id).length > 0) out.push(r.shift_id); }
    });
    return out;
  }
  // The seq of the row that gives a person's start in a shift (the newest typed time_in, else the first standing tapped start).
  function startSeq(rows, crewId, shiftId) {
    var mine = forPerson(rows, crewId, shiftId);
    var ts = newestTyped(mine.filter(function (r) { return r.kind === 'typed'; }), 'time_in');
    if (ts) return Number(ts.seq);
    var starts = standing(mine, 'start');
    return starts.length ? Number(starts[0].seq) : 0;
  }
  // The shift a person is on the clock in, or null. Looks at every shift they have rows in. Two open at once: the later start; a tie goes to
  // `current`, else to the shift whose start row has the higher seq.
  function openShift(rows, crewId, current, now) {
    var best = null;
    shiftsOf(rows, crewId).forEach(function (sh) {
      var p = personShift(rows, crewId, sh);
      if (p.start === null || p.end !== null || !withinLimit(p.start, now)) return;
      if (best === null) { best = { shift: sh, start: p.start }; return; }
      var d = minutes(best.start, p.start);            // > 0: this one started later; 0: same minute; null: earlier
      var later = d === null ? false : d > 0;
      var tie = d === 0;
      if (!later && !tie) return;
      if (tie) {
        if (best.shift === current) return;
        if (sh !== current && startSeq(rows, crewId, sh) <= startSeq(rows, crewId, best.shift)) return;
      }
      best = { shift: sh, start: p.start };
    });
    return best === null ? null : best.shift;
  }
  // Who a Start or End reaches and in WHICH shift. Returns { crewId: shiftId } for exactly the people who get a row:
  //   start: nobody with a start in `current` (as tapRows) and nobody on the clock anywhere (R34: already on the clock) -> current
  //   end:   the shift they are on the clock in (R13), whatever its name; nobody else.
  function tapShifts(rows, crewIds, current, now, kind) {
    var out = {};
    uniq(crewIds).forEach(function (id) {
      var open = openShift(rows, id, current, now);
      if (kind === 'start') {
        if (personShift(rows, id, current).start !== null) return;
        if (open !== null) return;
        out[id] = current;
      } else if (kind === 'end') {
        if (open !== null) out[id] = open;
      }
    });
    return out;
  }
  // The shift a person's card shows (R33, amended): (1) the shift they are on the clock in; (2) else `current` when they have ANY row there; (3) else
  // `before` when they have a start or an end there; (4) else `before2` when they have one there AND its latest side (the end, else the start) is
  // within the limit of now; (5) else `current`. `earlier` = shift !== current.
  function shownShift(rows, crewId, current, before, before2, now) {
    var open = openShift(rows, crewId, current, now);
    if (open !== null) return { shift: open, earlier: open !== current };
    if (forPerson(rows, crewId, current).length > 0) return { shift: current, earlier: false };
    if (before) {
      var pb = personShift(rows, crewId, before);
      if (pb.start !== null || pb.end !== null) return { shift: before, earlier: true };
    }
    if (before2) {
      var p2 = personShift(rows, crewId, before2);
      if ((p2.start !== null || p2.end !== null) && withinLimit(p2.end !== null ? p2.end : p2.start, now)) return { shift: before2, earlier: true };
    }
    return { shift: current, earlier: false };
  }

  // R35 (amended): ids of the standing tapped rows an Undo takes back, PER PERSON: in the shift their card shows (shownShift), built only from
  // undoable(). So an Undo never reaches a night the person has moved on from: not on a replay (R14), and not when a teammate's Undo end runs
  // over someone who ended the night and has started the day.
  function undoTargets(rows, crewIds, current, before, before2, now, kind) {
    var out = [];
    if (kind !== 'start' && kind !== 'end') return out;
    uniq(crewIds).forEach(function (id) {
      undoable(rows, [id], shownShift(rows, id, current, before, before2, now).shift, kind).forEach(function (x) { out.push(x); });
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
    openShift: openShift, shownShift: shownShift, OPEN_LIMIT_MIN: OPEN_LIMIT_MIN,
    minutes: minutes, hhmm: hhmm, nightRows: nightRows
  };
});
