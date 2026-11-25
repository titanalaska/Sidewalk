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

  // The shift just before: night-X <- day-X <- night-(X-1).
  function prevShift(id) {
    var s = T.parseShift(id);
    if (!s) return '';
    if (s.kind === 'night') return 'day-' + s.date;
    var p = s.date.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] - 1));
    return 'night-' + d.toISOString().slice(0, 10);
  }
  // A tap's shift and the two before it: Matt's 18-hour rule (R44) can reach two names back, so TIME decides who was on shift.
  function nearShifts(id) { var a = prevShift(id), b = prevShift(a); return [id, a, b]; }

  // Every person's shift this winter, from the Clock: their window (start, end) and the route they worked. The route is the newest
  // standing (not taken back) start TAP's route_id, even when a typed time corrects that start; a typed start alone carries
  // route_id '' (typeClock_), so then that shift's callout, then the Board (CrewHistory.routeOn). The Clock is grouped by person
  // and shift once, so personShift reads only that person's rows.
  function windows(clock, season, callouts, moves) {
    var out = {}, groups = {}, order = [];
    (clock || []).forEach(function (r) {
      if (!r || !inSeason(r.shift_id, season)) return;
      var key = r.crew_id + '|' + r.shift_id;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    order.forEach(function (key) {
      var rows = groups[key], crewId = rows[0].crew_id, shiftId = rows[0].shift_id;
      var p = K.personShift(rows, crewId, shiftId);
      if (p.start === null) return;
      var undone = {};
      rows.forEach(function (x) { if (x.undoes) undone[x.undoes] = true; });
      var route = '', top = -Infinity;
      rows.forEach(function (x) {
        if (x.kind === 'start' && !undone[x.id] && x.route_id && Number(x.seq) > top) { top = Number(x.seq); route = x.route_id; }
      });
      if (!route) route = H.routeOn(callouts, moves, crewId, shiftId) || '';
      (out[shiftId] = out[shiftId] || []).push({ crew_id: crewId, shift_id: shiftId, start: p.start, end: p.end, route: route });
    });
    return out;
  }

  // A walk is cleared once per pass: a second Cleared on it in the same pass (a double tap, a second phone, a Retry, or Cleared ->
  // Problem -> Cleared) is the same work. The pass is 1 + the standing Clean again rows at that site in that storm before the tap.
  function onePerPass(taps, log) {
    var undone = {}, agains = {};
    log.forEach(function (r) { if (r.zone_id === '*' && r.state === 'again_undone' && r.undoes != null) undone[r.undoes] = true; });
    log.forEach(function (r) {
      if (r.zone_id === '*' && r.state === 'again' && !undone[r.id]) (agains[r.storm_id + '|' + r.site_id] = agains[r.storm_id + '|' + r.site_id] || []).push(Number(r.seq));
    });
    var seen = {};
    return taps.slice().sort(function (a, b) { return Number(a.seq) - Number(b.seq); }).filter(function (t) {
      var pass = (agains[t.storm_id + '|' + t.site_id] || []).filter(function (s) { return s < Number(t.seq); }).length;
      var key = t.storm_id + '|' + t.site_id + '|' + t.zone_id + '|' + pass;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // On shift at moment t: started by then, and not yet ended (an open start counts for 18 hours, CrewClock's rule).
  function openAt(w, t) {
    var since = K.minutes(w.start, t);
    if (since === null) return false;
    if (w.end) return K.minutes(t, w.end) !== null;
    return since <= K.OPEN_LIMIT_MIN;
  }

  // A walk's sharers, once per cleared tap: its route's crew on shift at that moment, whatever shift name their start is filed under
  // (each is a window: crew_id + the shift their start is filed under). Else those who started on the route within 18 hours; else the
  // callout. ctx = { win: windows(), routesOf: site -> route ids, calloutOf: shift -> callout }. forPerson divides the walk among them;
  // cards gives each the whole walk.
  function sharersOf(t, ctx) {
    var holding = ctx.routesOf[t.site_id] || [];
    var near = [];
    nearShifts(t.shift_id).forEach(function (s) { (ctx.win[s] || []).forEach(function (w) { if (holding.indexOf(w.route) !== -1) near.push(w); }); });
    function add(list, w) { if (!list.some(function (x) { return x.crew_id === w.crew_id; })) list.push(w); }
    var sharers = [];
    near.forEach(function (w) { if (openAt(w, t.at)) add(sharers, w); });
    // A tap before anyone started or after everyone ended (a late tap): those on a holding route who started within 18 hours
    // before it, never the callout (which can name a no-show). The callout only when nobody on a holding route started at all.
    if (!sharers.length) {
      near.forEach(function (w) { var m = K.minutes(w.start, t.at); if (m !== null && m <= K.OPEN_LIMIT_MIN) add(sharers, w); });
    }
    if (!sharers.length && ctx.calloutOf[t.shift_id]) {
      var roster = ctx.calloutOf[t.shift_id].roster || {};
      holding.forEach(function (r) { slotIds(roster[r]).forEach(function (who) { add(sharers, { crew_id: who, shift_id: t.shift_id }); }); });
    }
    return sharers;
  }
  function routesHolding(routes) {
    var routesOf = {};
    (routes || []).forEach(function (r) { (r.site_ids || []).forEach(function (s) { (routesOf[s] = routesOf[s] || []).push(r.id); }); });
    return routesOf;
  }
  // The walks that count: each cleared walk once per pass, a sidewalk or hand walk by area (never a curb), with its area.
  function countedWalks(o, season, zones) {
    var seasonLog = (o.log || []).filter(function (r) { return r && inSeason(r.shift_id, season); });
    var cleared = L.realTaps(seasonLog).filter(function (t) { return t.state === 'cleared'; });
    return onePerPass(cleared, seasonLog).map(function (t) {
      var z = zones[t.zone_id];
      if (!z || WALKED.indexOf(z.type) === -1 || L.isCurbZone(z)) return null;
      var area = Number(z.area_sqft);
      return !isFinite(area) || area <= 0 ? null : { tap: t, area: area };
    }).filter(Boolean);
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
    // Started for a callout's shift: a start filed under that shift, or under the one just before it (a Start tapped before Night
    // was switched on is filed under the day).
    function started(shiftId, who) {
      return [shiftId, prevShift(shiftId)].some(function (s) { return (win[s] || []).some(function (w) { return w.crew_id === who; }); });
    }

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
      if (started(c.shift, id)) return;   // a start means they worked: it wins over everything below
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

    // Square feet: each cleared walk (once per pass) shared by its route's crew on shift at that moment, whatever shift name their
    // start is filed under; a share lands on the sharer's own shift line. Else those who started on the route; else the callout.
    var seasonLog = (o.log || []).filter(function (r) { return r && inSeason(r.shift_id, season); });
    var routesOf = routesHolding(o.routes);
    countedWalks(o, season, zones).forEach(function (cw) {
      var sharers = sharersOf(cw.tap, { win: win, routesOf: routesOf, calloutOf: calloutOf });
      var me = sharers.filter(function (w) { return w.crew_id === id; })[0];
      if (me) night(me.shift_id).sqft += cw.area / sharers.length;
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

  // Crew cards (Matt: a card for everyone on the crew): for each id, the nights they worked this winter and the TEAM's square feet,
  // every walk credited WHOLE to each of its sharers (the same sharers forPerson divides it between). One pass for everyone.
  // o = forPerson's input without crewId, plus crewIds. team_sqft is unrounded.
  function cards(o) {
    var season = seasonOf(String(o.now).slice(0, 10));
    var callouts = (o.callouts || []).filter(function (c) { return c && inSeason(c.shift, season); });
    var zones = {};
    (o.zones || []).forEach(function (z) { zones[z.id] = z; });
    var win = windows(o.clock, season, callouts, o.moves || []);
    var calloutOf = {};
    callouts.forEach(function (c) { calloutOf[c.shift] = c; });
    var people = {};
    (o.crewIds || []).forEach(function (id) { people[id] = { nights_worked: 0, team_sqft: 0 }; });
    Object.keys(win).forEach(function (shiftId) {
      win[shiftId].forEach(function (w) { if (people[w.crew_id]) people[w.crew_id].nights_worked++; });
    });
    var routesOf = routesHolding(o.routes);
    countedWalks(o, season, zones).forEach(function (cw) {
      sharersOf(cw.tap, { win: win, routesOf: routesOf, calloutOf: calloutOf }).forEach(function (w) { if (people[w.crew_id]) people[w.crew_id].team_sqft += cw.area; });
    });
    return { season: season, people: people };
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

  return { seasonOf: seasonOf, forPerson: forPerson, cards: cards, cardLines: cardLines, sqftWords: sqftWords };
});
