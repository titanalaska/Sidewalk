(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'), require('./clock'), require('./shiftlog'), require('./history'));
  else root.CrewStats = factory(root.CrewTime, root.CrewClock, root.CrewShiftLog, root.CrewHistory);
})(this, function (T, K, L, H) {
  'use strict';

  // Crew stats (Matt, 11/19/26): "the back of a baseball card" for one crew member, this winter. Read by an admin only
  // (getCrewStats); the rules are the spec's "Sidewalk crew stats spec 2026-11-19 (approved by Matt)". Shared byte-identical
  // with the phone, which draws cardLines().

  var MACHINES = ['blower', 'snowrator', 'bobcat', 'sweepster'];   // the Site card's boxes, in the card's order
  var WALKED = ['sidewalk', 'hand'];                               // the walks a crew clears by area (curbs are cut below)

  // A winter runs July 1 to June 30: '2026-27'.
  function seasonOf(ymd) {
    var y = Number(String(ymd).slice(0, 4)), m = Number(String(ymd).slice(5, 7));
    var from = m >= 7 ? y : y - 1;
    return from + '-' + String(from + 1).slice(2);
  }
  function inSeason(shiftId, season) {
    var s = T.parseShift(shiftId);
    return !!s && seasonOf(s.date) === season;
  }
  function lists(slot, id) {
    return !!slot && (slot.lead === id || (slot.members || []).indexOf(id) !== -1);
  }
  function slotIds(slot) {
    if (!slot) return [];
    return (slot.lead ? [slot.lead] : []).concat(slot.members || []);
  }

  // Every person's shift this winter, from the Clock: their window (start, end) and the route they worked. A start TAP names
  // its route; a typed start carries route_id '' (typeClock_), so then that shift's callout, then the Board (CrewHistory.routeOn).
  function windows(clock, season, callouts, moves) {
    var out = {}, seen = {};
    (clock || []).forEach(function (r) {
      if (!r || !inSeason(r.shift_id, season)) return;
      var key = r.crew_id + '|' + r.shift_id;
      if (seen[key]) return;
      seen[key] = true;
      var p = K.personShift(clock, r.crew_id, r.shift_id);
      if (p.start === null) return;
      var route = '';
      if (p.startHow === 'tapped') {
        var tap = clock.filter(function (x) { return x.crew_id === r.crew_id && x.shift_id === r.shift_id && x.kind === 'start' && x.at === p.start; })[0];
        route = (tap && tap.route_id) || '';
      }
      if (!route) route = H.routeOn(callouts, moves, r.crew_id, r.shift_id) || '';
      (out[r.shift_id] = out[r.shift_id] || []).push({ crew_id: r.crew_id, start: p.start, end: p.end, route: route });
    });
    return out;
  }

  // On shift at moment t: started by then, and not yet ended (an open start counts for 18 hours, CrewClock's rule).
  function openAt(w, t) {
    var since = K.minutes(w.start, t);
    if (since === null) return false;
    if (w.end) return K.minutes(t, w.end) !== null;
    return since <= K.OPEN_LIMIT_MIN;
  }

  function forPerson(o) {
    var id = o.crewId, season = seasonOf(String(o.now).slice(0, 10));
    var callouts = (o.callouts || []).filter(function (c) { return c && inSeason(c.shift, season); });
    var routeName = {};
    (o.routes || []).forEach(function (r) { routeName[r.id] = r.name || ''; });
    var zones = {};
    (o.zones || []).forEach(function (z) { zones[z.id] = z; });
    var win = windows(o.clock, season, callouts, o.moves || []);
    var nights = {};
    function night(shiftId) {
      return nights[shiftId] || (nights[shiftId] = { shift_id: shiftId, route_id: '', route_name: '', called_out: false, worked: false,
        no_show: false, minutes: null, open: false, sqft: 0, machines: {} });
    }
    function mine(shiftId) { return (win[shiftId] || []).filter(function (w) { return w.crew_id === id; })[0]; }
    function started(shiftId, who) { return (win[shiftId] || []).some(function (w) { return w.crew_id === who; }); }

    // Called out, worked, no-show.
    var calloutOf = {};
    callouts.forEach(function (c) {
      calloutOf[c.shift] = c;
      var roster = c.roster || {};
      var onRoute = Object.keys(roster).filter(function (r) { return lists(roster[r], id); })[0];
      var tapped = (c.no_shows || []).indexOf(id) !== -1;
      if (!onRoute && !tapped) return;
      var n = night(c.shift);
      n.called_out = true;
      if (onRoute) n.route_id = onRoute;
      if (mine(c.shift)) return;   // a start means they worked: it wins over everything below
      // Matt's own no-show tap, or (his rule, 11/19/26) someone else on their route that shift started.
      if (tapped || (onRoute && slotIds(roster[onRoute]).some(function (who) { return who !== id && started(c.shift, who); }))) n.no_show = true;
    });
    Object.keys(win).forEach(function (shiftId) {
      var w = mine(shiftId);
      if (!w) return;
      var n = night(shiftId);
      n.worked = true;
      n.route_id = w.route;
      if (w.end) n.minutes = K.minutes(w.start, w.end);
      else n.open = true;
    });

    // Square feet: each cleared walk shared by its route's crew on shift at that moment; else that shift's callout on the route.
    var seasonLog = (o.log || []).filter(function (r) { return r && inSeason(r.shift_id, season); });
    L.realTaps(seasonLog).forEach(function (t) {
      if (t.state !== 'cleared') return;
      var z = zones[t.zone_id];
      if (!z || WALKED.indexOf(z.type) === -1 || L.isCurbZone(z)) return;
      var area = Number(z.area_sqft);
      if (!isFinite(area) || area <= 0) return;
      var holding = (o.routes || []).filter(function (r) { return (r.site_ids || []).indexOf(t.site_id) !== -1; }).map(function (r) { return r.id; });
      var sharers = [];
      (win[t.shift_id] || []).forEach(function (w) {
        if (holding.indexOf(w.route) !== -1 && openAt(w, t.at) && sharers.indexOf(w.crew_id) === -1) sharers.push(w.crew_id);
      });
      // A tap before anyone started or after everyone ended (a late tap): those on a holding route who started that shift, never
      // the callout (which can name a no-show). The callout only when nobody on a holding route started at all.
      if (!sharers.length) {
        (win[t.shift_id] || []).forEach(function (w) {
          if (holding.indexOf(w.route) !== -1 && sharers.indexOf(w.crew_id) === -1) sharers.push(w.crew_id);
        });
      }
      if (!sharers.length && calloutOf[t.shift_id]) {
        var roster = calloutOf[t.shift_id].roster || {};
        holding.forEach(function (r) { slotIds(roster[r]).forEach(function (who) { if (sharers.indexOf(who) === -1) sharers.push(who); }); });
      }
      if (sharers.indexOf(id) !== -1) night(t.shift_id).sqft += area / sharers.length;
    });

    // Machines: their own Site cards, the newest per site per shift (CrewShiftLog.visitTotals); a blank adds nothing.
    var cards = (o.visits || []).filter(function (v) { return v && v.by_key === id && inSeason(v.shift_id, season); });
    var groups = {};
    cards.forEach(function (v) { groups[v.site_id + '|' + v.shift_id] = v; });
    Object.keys(groups).forEach(function (k) {
      var v = groups[k], m = L.visitTotals(cards, v.site_id, v.shift_id).minutes;
      MACHINES.forEach(function (e) {
        if (m[e] === null || m[e] === undefined) return;
        var n = night(v.shift_id);
        n.machines[e] = (n.machines[e] || 0) + m[e];
      });
    });

    // Help visits: their own Arrived marks off their route, not taken back, once per site per shift.
    var undone = {};
    seasonLog.forEach(function (r) { if (r.undoes) undone[r.undoes] = true; });
    var helped = {};
    seasonLog.forEach(function (r) {
      if (r.zone_id === '*' && r.state === 'arrived' && r.off_route === true && r.by_key === id && !undone[r.id]) helped[r.site_id + '|' + r.shift_id] = true;
    });

    var list = Object.keys(nights).map(function (k) { return nights[k]; }).filter(function (n) { return n.called_out || n.worked || Object.keys(n.machines).length; });
    list.sort(function (a, b) { var x = T.shiftKey(a.shift_id), y = T.shiftKey(b.shift_id); return x < y ? 1 : x > y ? -1 : 0; });
    var totals = { called_out: 0, worked: 0, no_show: 0, minutes: 0, open_nights: 0, sqft: 0, machines: {}, help_visits: Object.keys(helped).length };
    list.forEach(function (n) {
      n.route_name = n.route_id ? (routeName[n.route_id] || '') : '';
      if (n.called_out) totals.called_out++;
      if (n.worked) totals.worked++;
      if (n.no_show) totals.no_show++;
      if (n.minutes !== null) totals.minutes += n.minutes;
      if (n.open) totals.open_nights++;
      totals.sqft += n.sqft;
      MACHINES.forEach(function (e) { if (n.machines[e] !== undefined) totals.machines[e] = (totals.machines[e] || 0) + n.machines[e]; });
    });
    return { crew_id: id, season: season, totals: totals, nights: list };
  }

  // ---------- the words on the card ----------
  function sqftWords(x) {
    var n = Math.round((Number(x) || 0) / 100) * 100;
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function machineLabel(e) { return e.charAt(0).toUpperCase() + e.slice(1); }
  function machineWords(m, unit) {
    return MACHINES.filter(function (e) { return m && m[e] !== undefined; }).map(function (e) { return machineLabel(e) + ' ' + m[e] + unit; }).join(' · ');
  }

  function cardLines(st) {
    var t = st.totals;
    var hours = K.hhmm(t.minutes);
    if (t.open_nights) hours += ' (' + t.open_nights + ' night' + (t.open_nights === 1 ? '' : 's') + ' with no End shift)';
    var rows = [['Nights worked', t.worked + ' (called out ' + t.called_out + ', no-show ' + t.no_show + ')'], ['Hours', hours],
      ['Sq ft cleared', sqftWords(t.sqft)], ['Machines', machineWords(t.machines, ' min') || 'none'], ['Help visits', String(t.help_visits)]];
    var nights = (st.nights || []).map(function (n) {
      var h = n.worked ? (n.minutes !== null ? K.hhmm(n.minutes) : n.open ? 'no End' : '') : n.no_show ? 'no-show' : 'called out';
      var sq = sqftWords(n.sqft);
      return { when: T.shiftLabel(n.shift_id), route: n.route_name, hours: h, sqft: sq === '0' ? '' : sq + ' sq ft', machines: machineWords(n.machines, '') };
    });
    return { season: 'Winter ' + st.season, rows: rows, nights: nights };
  }

  return { seasonOf: seasonOf, forPerson: forPerson, cardLines: cardLines };
});
