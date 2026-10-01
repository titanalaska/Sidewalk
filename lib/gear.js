(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewGear = factory();
})(this, function () {
  'use strict';

  function key(item) { return String(item || '').trim().toLowerCase(); }

  // What a worker holds now: every `issued` item not later `returned`.
  // Replayed by night, then by the moment it was logged (`at`), because db
  // ids come back in random order. Entries without `at` keep log order.
  function gearOnHand(gearLog, workerId) {
    var held = [];
    (gearLog || [])
      .filter(function (e) { return e.worker === workerId; })
      .map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) {
        if (a.e.date !== b.e.date) return a.e.date < b.e.date ? -1 : 1;
        var t = (a.e.at && b.e.at) ? Date.parse(a.e.at) - Date.parse(b.e.at) : 0;
        return t !== 0 ? t : a.i - b.i;
      })
      .forEach(function (x) {
        var e = x.e;
        if (e.type === 'issued') held.push(String(e.item).trim());
        if (e.type === 'returned') {
          var at = held.map(key).indexOf(key(e.item));
          if (at !== -1) held.splice(at, 1);
        }
      });
    return held;
  }

  return { gearOnHand: gearOnHand };
});
