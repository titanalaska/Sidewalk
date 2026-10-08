(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gear'), require('./time'));
  else root.CrewWarnings = factory(root.CrewGear, root.CrewTime);
})(this, function (G, T) {
  'use strict';

  // A short night (Matt, 10/8/26): the work cannot reach 8 hours before the 8 AM deadline. 8 working
  // hours plus the mandatory 30-minute lunch is 8.5 hours on the clock, so the latest start that
  // still gets there is 8:00 AM minus 8.5 h = 11:30 PM (84,600 s into the day). Matt's three numbers
  // sit here and the cutoff is worked out from them, never typed in. After the cutoff and before the
  // deadline is short; exactly the cutoff is exactly 8 hours, so it is not.
  var SHORT_NIGHT = { workHours: 8, lunchMinutes: 30, deadlineHour: 8 };
  SHORT_NIGHT.cutoffSeconds = 24 * 3600 + SHORT_NIGHT.deadlineHour * 3600 - (SHORT_NIGHT.workHours * 3600 + SHORT_NIGHT.lunchMinutes * 60);

  // nowIso: the phone's local time as CrewTime.localIso writes it. manualOn: Matt's own switch, for a
  // night only he knows is short (a cleanup night starts around 8 PM with little work). A time that
  // cannot be read is not a short night; only the switch can make it one.
  function isShortNight(nowIso, manualOn) {
    if (manualOn === true) return true;
    var m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})/.exec(typeof nowIso === 'string' ? nowIso : '');
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59) return false;
    var sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return sec > SHORT_NIGHT.cutoffSeconds || sec < SHORT_NIGHT.deadlineHour * 3600;
  }

  // Worked out at draw time, never stored. `null` means "not set" and never
  // fires or clears a warning: only an explicit false does. Warn, never block.
  // opts.shortNight (true on a short night): a Valley person gets a line. Anchorage and not set never do.
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
      if (opts && opts.shortNight === true && m.home_area === 'valley') add('valley-short', [m.id], name(m.id) + ': Valley, short night (under 8 hours)');
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
    // The lead drives the truck (Matt, 10/7/26 field test): a lead who can't is allowed,
    // and named, even with a driving member aboard. "Not set" stays with driver-unknown.
    var leadRec = crew.lead ? workersById[crew.lead] : null;
    if (leadRec && leadRec.can_drive === false) add('lead-no-licence', [crew.lead], name(crew.lead) + " leads but can't drive");
    if (!people.some(function (m) { return m.can_drive === true; })) {
      var unset = people.filter(function (m) { return m.can_drive == null; }).length;
      if (unset) add('driver-unknown', [], 'No confirmed driver (' + unset + ' not set)');
      else add('no-driver', [], 'Nobody on this route can drive');
    }
    return out;
  }

  return { warningsFor: warningsFor, isShortNight: isShortNight, SHORT_NIGHT: SHORT_NIGHT };
});
