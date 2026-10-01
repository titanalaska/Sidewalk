(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewTime = factory();
})(this, function () {
  'use strict';

  // Matt, 10/1/26: day shift starts 9 AM. Anything before belongs to the night
  // before. Nights start when the weather says (6 PM to 3 AM), so there is no
  // night-start hour, and nights are named by their evening's date.
  var SHIFT_CUTOVER_HOUR = 9;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Local wall clock plus offset, e.g. 2026-01-14T03:10:05.123-09:00. The
  // first ten characters are the local date, which a UTC string is not.
  // Milliseconds matter: two taps in one second must replay in order.
  function localIso(d) {
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var ms = d.getMilliseconds();
    off = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      '.' + (ms < 100 ? '0' : '') + pad(ms) +
      sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
  }

  function addDays(ymd, n) {
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  // Reads the wall clock straight out of the string, so the answer never
  // depends on the time zone of whatever is running it.
  function shiftDate(iso) {
    var day = iso.slice(0, 10);
    return Number(iso.slice(11, 13)) >= SHIFT_CUTOVER_HOUR ? day : addDays(day, -1);
  }

  function dayNumber(ymd) {
    var p = ymd.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000;
  }
  function daysBetween(fromYmd, toYmd) { return dayNumber(toYmd) - dayNumber(fromYmd); }

  // Shifts: "night-2026-10-01" (named by its evening) or "day-2026-10-02".
  function shiftId(kind, date) { return kind + '-' + date; }
  function parseShift(id) {
    var m = /^(night|day)-(\d{4}-\d{2}-\d{2})$/.exec(String(id || ''));
    return m ? { kind: m[1], date: m[2] } : null;
  }
  function shiftLabel(id) {
    var s = parseShift(id);
    if (!s) return '';
    return (s.kind === 'night' ? 'Night of ' : 'Day of ') + Number(s.date.slice(5, 7)) + '/' + Number(s.date.slice(8, 10));
  }
  // The shifts around now, none pre-picked: the weather sets when a night starts.
  function shiftChoices(iso) {
    var today = iso.slice(0, 10);
    if (Number(iso.slice(11, 13)) < SHIFT_CUTOVER_HOUR) {
      return [shiftId('night', addDays(today, -1)), shiftId('day', today), shiftId('night', today)];
    }
    return [shiftId('day', today), shiftId('night', today)];
  }
  // Sorts shifts in time order: a date's day comes before its night.
  function shiftKey(id) {
    var s = parseShift(id);
    return s ? s.date + (s.kind === 'day' ? '1' : '2') : '';
  }
  // A post is stale when it is older than every shift on offer now.
  function isStale(postShiftId, iso) {
    return !parseShift(postShiftId) || shiftKey(postShiftId) < shiftKey(shiftChoices(iso)[0]);
  }

  return { SHIFT_CUTOVER_HOUR: SHIFT_CUTOVER_HOUR, localIso: localIso, shiftDate: shiftDate, daysBetween: daysBetween,
    shiftId: shiftId, parseShift: parseShift, shiftLabel: shiftLabel, shiftChoices: shiftChoices,
    shiftKey: shiftKey, isStale: isStale };
});
