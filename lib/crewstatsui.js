(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crewstats'));
  else root.SnowCrewStatsUI = factory(root.CrewStats);
})(this, function (CS) {
  'use strict';

  // Crew stats (Matt, 11/19/26): the Stats section of a person's card on the Roster tab (admins only: only an admin ever gets this
  // card, and the server refuses everyone else). Nothing is asked until Stats is tapped; the words are CrewStats.cardLines.

  function html(stats, esc) {
    var c = CS.cardLines(stats);
    var out = '<h3>Stats · ' + esc(c.season) + '</h3><table class="stats-tot">' + c.rows.map(function (r) {
      return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
    }).join('') + '</table>';
    if (!c.nights.length) return out + '<p class="muted">No nights yet this winter.</p>';
    // Two lines a night (five columns were three words wide at 320 px): the night and its route, then hours · sq ft · machines,
    // each part left out when it has nothing to say.
    function part(cls, text) { return text ? '<span class="' + cls + '">' + esc(text) + '</span>' : ''; }
    return out + '<h4>Night by night</h4><ul class="stats-nights">' + c.nights.map(function (n) {
      var what = [part('sn-hours', n.hours), part('sn-sqft', n.sqft), part('sn-mach', n.machines)].filter(Boolean).join(' · ');
      return '<li><div><b class="sn-when">' + esc(n.when) + '</b>' + (n.route ? ' · ' + part('sn-route', n.route) : '') + '</div>' +
        (what ? '<div class="sn-what">' + what + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  // One read per tap. A reply that lands after this card was closed (or another card opened over it) finds its box gone from the
  // page and draws nothing. A failed read says so with a Retry; it is a read, so never "Not saved".
  async function load(ctx, crewId, box, btn) {
    if (btn) btn.hidden = true;
    box.innerHTML = '<p class="muted">Loading stats…</p>';
    var r;
    try { r = await ctx.call('getCrewStats', { crew_id: crewId }); } catch (e) { r = { ok: false, code: 'network' }; }
    if (!box.isConnected) return;
    if (r && r.code === 'signin') return ctx.signedOut(r.reason);
    if (r && r.ok) { box.innerHTML = html(r, ctx.esc); return; }
    box.innerHTML = '<p class="err" role="alert">Could not load the stats.</p><button id="w_statsretry">Retry</button>';
    box.querySelector('#w_statsretry').onclick = function () { load(ctx, crewId, box, null); };
  }

  return { html: html, load: load };
});
