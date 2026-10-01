(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gear'), require('./time'));
  else root.CrewWarnings = factory(root.CrewGear, root.CrewTime);
})(this, function (G, T) {
  'use strict';

  // Worked out at draw time, never stored. `null` means "not set" and never
  // fires or clears a warning: only an explicit false does. Warn, never block.
  function warningsFor(route, crew, workersById, gearLog, today, opts) {
    var soonDays = (opts && typeof opts.soonDays === 'number') ? opts.soonDays : null;
    var ids = [crew.lead].concat(crew.members || []).filter(Boolean);
    var people = ids.map(function (id) { return workersById[id] || { id: id, name: id }; });
    if (!people.length) return [];

    var out = [];
    function name(id) { return (workersById[id] && workersById[id].name) || id; }
    function add(rule, who, text) { out.push({ rule: rule, workers: who, text: text }); }

    var needs = [];
    (route.sites || []).forEach(function (s) {
      if (s.needs_clearance && needs.indexOf(s.needs_clearance) === -1) needs.push(s.needs_clearance);
    });

    people.forEach(function (m) {
      needs.forEach(function (x) {
        var mine = (m.clearances || []).filter(function (c) { return c.site === x && c.cleared === true; });
        var valid = mine.filter(function (c) { return c.expires == null || c.expires >= today; });
        if (!valid.length && (m.clearances || []).some(function (c) { return c.site === x && c.cleared == null; })) {
          add('clearance-unknown', [m.id], name(m.id) + ': ' + x + ' clearance not set');
          return;
        }
        if (!valid.length) {
          var lapsed = mine.map(function (c) { return c.expires; }).filter(Boolean).sort().pop();
          add('clearance', [m.id], lapsed ? name(m.id) + ': ' + x + ' clearance expired ' + lapsed
                                          : name(m.id) + ': no ' + x + ' clearance');
          return;
        }
        if (soonDays !== null) {
          var soon = valid.filter(function (c) { return c.expires != null && T.daysBetween(today, c.expires) <= soonDays; });
          if (soon.length === valid.length) {
            var last = soon.map(function (c) { return c.expires; }).sort().pop();
            add('clearance-soon', [m.id], name(m.id) + ': ' + x + ' clearance expires ' + last);
          }
        }
      });
      if (m.rides_with && ids.indexOf(m.rides_with) === -1) {
        add('ride', [m.id], name(m.id) + ' rides with ' + name(m.rides_with) + ", who isn't on this route");
      }
      if (m.cold_rated === false) add('cold', [m.id], name(m.id) + ': not cold-rated');
      if (m.gear === 'needs_issued' && G.gearOnHand(gearLog, m.id).length === 0) {
        add('gear', [m.id], name(m.id) + ': gear needs issuing');
      }
      if (needs.length && m.valid_id === false) add('id', [m.id], name(m.id) + ': no valid ID for a cleared site');
      if (m.on_call === false) add('not-on-call', [m.id], name(m.id) + ': placed but not on call');
    });

    for (var i = 0; i < people.length; i++) {
      for (var j = i + 1; j < people.length; j++) {
        var a = people[i], b = people[j];
        if ((a.keep_apart_from || []).indexOf(b.id) !== -1 || (b.keep_apart_from || []).indexOf(a.id) !== -1) {
          add('keep-apart', [a.id, b.id], name(a.id) + ' and ' + name(b.id) + ': keep apart');
        }
      }
    }

    if (!crew.lead) add('no-lead', [], 'No lead on this route');
    if (!people.some(function (m) { return m.can_drive === true; })) {
      var unset = people.filter(function (m) { return m.can_drive == null; }).length;
      if (unset) add('driver-unknown', [], 'No confirmed driver (' + unset + ' not set)');
      else add('no-driver', [], 'Nobody on this route can drive');
    }
    return out;
  }

  return { warningsFor: warningsFor };
});
