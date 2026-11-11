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

  // Wall-clock minutes from the first 16 characters (YYYY-MM-DDTHH:MM), both read as the same zone.
  function wall(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000;
  }

  function minutes(start, end) {
    var a = wall(start), b = wall(end);
    if (a === null || b === null || b < a) return null;
    return b - a;
  }

  function hhmm(mins) {
    if (typeof mins !== 'number' || !isFinite(mins)) return '';
    var h = Math.floor(mins / 60), m = Math.floor(mins % 60);
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
    personShift: personShift, tapRows: tapRows, undoable: undoable,
    minutes: minutes, hhmm: hhmm, nightRows: nightRows
  };
});
