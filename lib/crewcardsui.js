(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crewcards'));
  else root.SnowCrewCardsUI = factory(root.SnowCrewCards);
})(this, function (CC) {
  'use strict';

  // Crew cards (Matt, 11/24/26): the Crew tab. One read per opening (and per Refresh): getCrewCards, whose numbers the server keeps
  // 10 minutes. The last reply is kept on this phone under 'snow-crew-cards' (named once, never renamed; wiped at sign-out) and
  // drawn first, so the tab opens at once and works with no signal. Faces come from the phone's own crew list (CC.build).
  // A reply counts only if the person is still on the Crew tab in the same session when it lands.
  var KEY = 'snow-crew-cards';
  var asks = 0;          // the newest ask wins
  var flipped = {};      // card id -> true while its back is showing (kept across a redraw)

  function readCopy() {
    try {
      var j = JSON.parse(localStorage.getItem(KEY));
      if (j && j.v === 1 && Array.isArray(j.cards) && j.season) return j;
    } catch (e) { /* unreadable or blocked: no copy */ }
    return null;
  }
  function writeCopy(r) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, season: r.season, counted_at: r.counted_at, cards: r.cards })); } catch (e) { /* refused: no copy */ }
  }
  function forget() { try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ } }

  // "6:14 AM", the way the Board prints a time.
  function clockWord(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function headWord(copy) {
    var at = clockWord(copy.counted_at);
    return CC.winterWord(copy.season) + (at ? ' \u00b7 counted at ' + at : '');
  }

  function phoneOf(ctx, id) {
    var p = (ctx.S.crew || []).filter(function (w) { return w.id === id; })[0];
    return p && p.phone ? String(p.phone) : '';
  }

  function cardHtml(ctx, c) {
    var esc = ctx.esc;
    var share = c.mine ? '<button class="small" data-ccshare="' + esc(c.id) + '">Share my card</button>' : '';
    var front = '<div class="cc-front">' +
      '<div class="cc-top">' + ctx.avatar({ name: c.name, photo_thumb: c.photo_thumb }) +
      '<div class="cc-who"><b class="cc-name" data-no-es>' + esc(c.name) + '</b>' + (c.seasons_word ? '<span class="cc-seasons">' + esc(c.seasons_word) + '</span>' : '') + '</div></div>' +
      (c.line ? '<p class="cc-line" data-no-es>' + esc(c.line) + '</p>' : '') +
      '<table class="cc-nums"><tr><th>Nights worked</th><td>' + esc(c.nights) + '</td></tr><tr><th>Team sq ft</th><td>' + esc(c.sqft_word) + '</td></tr></table>' +
      (c.fields_word ? '<p class="cc-fields">' + esc(c.fields_word) + '</p>' : '') + share + '</div>';
    var phone = phoneOf(ctx, c.id), digits = phone.replace(/[^\d+]/g, '');
    var back = '<div class="cc-back"><b class="cc-name" data-no-es>' + esc(c.name) + '</b>' +
      (phone ? '<p><a class="cc-tel" href="tel:' + esc(digits) + '" data-no-es>' + esc(phone) + '</a></p>' : '<p class="muted">No phone on file.</p>') +
      (c.mine ? '<div class="row">' + share.replace('data-ccshare', 'data-ccshare2') + '<button class="small" data-ccedit="' + esc(c.id) + '">Edit your card</button></div>' : '') + '</div>';
    var on = !!flipped[c.id];
    return '<article class="ccard' + (c.mine ? ' mine' : '') + (on ? ' flipped' : '') + '" data-card="' + esc(c.id) + '">' +
      '<div' + (on ? ' hidden' : '') + ' class="cc-side">' + front + '</div><div' + (on ? '' : ' hidden') + ' class="cc-side">' + back + '</div></article>';
  }

  function draw(ctx, copy, note) {
    var esc = ctx.esc, $ = ctx.$;
    var cards = CC.build(copy, ctx.S.crew, ctx.S.me && ctx.S.me.crew_id);
    $('main').innerHTML = '<section class="cc-head"><h2>Crew</h2><div class="row"><span class="muted" id="cc_when">' + esc(headWord(copy)) + '</span>' +
      '<button class="small" id="cc_refresh">Refresh</button></div>' + (note ? '<p class="muted" id="cc_note">' + esc(note) + '</p>' : '') + '</section>' +
      '<div id="cc_list">' + cards.map(function (c) { return cardHtml(ctx, c); }).join('') + '</div>';
    var list = $('cc_list');
    list.onclick = function (ev) {
      var t = ev.target, el;
      if ((el = t.closest('[data-ccshare],[data-ccshare2]'))) {
        if (ctx.shareCard) ctx.shareCard(cards.filter(function (c) { return c.id === (el.dataset.ccshare || el.dataset.ccshare2); })[0], copy);
        return;
      }
      if ((el = t.closest('[data-ccedit]'))) { if (ctx.openSelfForm) ctx.openSelfForm(function () { ask(ctx); }); return; }
      if (t.closest('a')) return;   // the phone link is a link, not a flip
      var art = t.closest('[data-card]');
      if (!art) return;
      var id = art.dataset.card, sides = art.querySelectorAll('.cc-side');
      flipped[id] = !flipped[id];
      art.classList.toggle('flipped', !!flipped[id]);
      sides[0].hidden = !!flipped[id]; sides[1].hidden = !flipped[id];
    };
    $('cc_refresh').onclick = function () { ask(ctx); };
  }

  function drawNone(ctx) {
    var $ = ctx.$;
    $('main').innerHTML = '<section class="cc-head"><h2>Crew</h2><div class="row"><button class="small" id="cc_refresh">Refresh</button></div></section>' +
      '<p class="muted" id="cc_none">No signal. Your crew\'s cards come back when you do.</p>';
    $('cc_refresh').onclick = function () { ask(ctx); };
  }

  async function ask(ctx) {
    var mine = ++asks, epoch = ctx.sessionSeq();
    var r;
    try { r = await ctx.call('getCrewCards', {}); } catch (e) { r = { ok: false, code: 'network' }; }
    // Gone: another ask came after this one, the person left the tab, or the session changed (a sign-out). Nothing drawn, nothing kept.
    if (mine !== asks || epoch !== ctx.sessionSeq() || ctx.S.tab !== 'crew' || !ctx.S.me) return;
    if (r && r.code === 'signin') return ctx.signedOut(r.reason);
    if (r && r.ok && Array.isArray(r.cards)) { writeCopy(r); draw(ctx, r, ''); return; }
    var copy = readCopy();
    if (copy) draw(ctx, copy, 'No signal. Showing the last copy.'); else drawNone(ctx);
  }

  // ctx = { $, esc, avatar, call, S, sessionSeq (a function), signedOut, openSelfForm(done), shareCard(card, copy) }
  function render(ctx) {
    var copy = readCopy();
    if (copy) draw(ctx, copy, ''); else ctx.$('main').innerHTML = '<h2>Crew</h2><p class="muted" id="cc_loading">Loading…</p>';
    ask(ctx);
  }

  return { render: render, forget: forget, KEY: KEY };
});
