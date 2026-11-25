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

  function drawNone(ctx, why) {
    var $ = ctx.$;
    $('main').innerHTML = '<section class="cc-head"><h2>Crew</h2><div class="row"><button class="small" id="cc_refresh">Refresh</button></div></section>' +
      '<p class="muted" id="cc_none">' + (why ? ctx.esc(why) : 'No signal. Your crew\'s cards come back when you do.') + '</p>';
    $('cc_refresh').onclick = function () { ask(ctx); };
  }

  async function ask(ctx) {
    var mine = ++asks, epoch = ctx.sessionSeq();
    var r;
    try { r = await ctx.call('getCrewCards', {}); } catch (e) { r = { ok: false, code: 'network' }; }
    // Gone: another ask came after this one, the person left the tab, or the session changed (a sign-out). Nothing drawn, nothing kept.
    if (mine !== asks || epoch !== ctx.sessionSeq() || ctx.S.tab !== 'crew' || !ctx.S.me) return;
    if (r && r.code === 'signin') return ctx.signedOut(r.reason);
    if (r && r.ok && Array.isArray(r.cards)) { writeCopy(r); draw(ctx, r, ''); prebuild(ctx, r); return; }
    // The no-signal words are for a network failure only; a server that answered says why in its own words.
    var why = r && r.code !== 'network' && r.reason ? String(r.reason) : '';
    var copy = readCopy();
    if (copy) { draw(ctx, copy, why || 'No signal. Showing the last copy.'); prebuild(ctx, copy); } else drawNone(ctx, why);
  }

  // Share my card (Task 8): a PNG of one's own card, drawn on a canvas. Never the phone number (it is not even read here).
  // The face is the card's own data: URL (the canvas stays clean) or, with none, the initials on a circle.
  function fitText(g, text, max, size, weight) {
    var px = size;
    g.font = weight + ' ' + px + 'px system-ui, -apple-system, sans-serif';
    while (px > 12 && g.measureText(text).width > max) { px -= 2; g.font = weight + ' ' + px + 'px system-ui, -apple-system, sans-serif'; }
  }
  function loadFace(url) {
    return new Promise(function (resolve) {
      if (!url || !/^data:image\//.test(url)) return resolve(null);
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = url;
    });
  }
  // The picture's own words follow the phone's language (canvas text the Spanish overlay never sees): SnowEs.translateString on the
  // labels only; the name and the person's line stay as typed. No SnowEs (a node test) or English: the words as they are.
  function say(t) { return typeof SnowEs !== 'undefined' && SnowEs.lang() === 'es' ? SnowEs.translateString(t) : t; }
  async function pngOf(card, winterWord, initialsOf) {
    var W = 720, H = 420, cv = document.createElement('canvas'), g;
    cv.width = W; cv.height = H; g = cv.getContext('2d');
    g.fillStyle = '#16365c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(16, 16, W - 32, H - 32);
    var face = await loadFace(card.photo_thumb), cx = 100, cy = 100, r = 56;
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath(); g.clip();
    if (face) {   // cover: the centre square of the picture, never stretched (pictures keep their own shape)
      var iw = face.naturalWidth || face.width, ih = face.naturalHeight || face.height, sq = Math.min(iw, ih);
      g.drawImage(face, (iw - sq) / 2, (ih - sq) / 2, sq, sq, cx - r, cy - r, r * 2, r * 2);
    }
    else { g.fillStyle = '#4a6a8f'; g.fillRect(cx - r, cy - r, r * 2, r * 2); }
    g.restore();
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    if (!face) { g.fillStyle = '#ffffff'; g.font = '700 44px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(initialsOf(card.name), cx, cy + 15); g.textAlign = 'left'; }
    g.fillStyle = '#16365c'; fitText(g, card.name, W - 200 - 40, 40, '700'); g.fillText(card.name, 180, 92);
    if (card.seasons_word) { g.fillStyle = '#4a6a8f'; fitText(g, say(card.seasons_word), W - 220, 26, '400'); g.fillText(say(card.seasons_word), 180, 128); }
    var y = 190;
    if (card.line) { g.fillStyle = '#222222'; fitText(g, card.line, W - 80, 30, '400'); g.fillText(card.line, 40, y); y += 20; }
    y += 50;
    g.fillStyle = '#4a6a8f'; g.font = '400 24px system-ui, sans-serif'; g.fillText(say('Nights worked'), 40, y); g.fillText(say('Team sq ft'), 380, y);
    g.fillStyle = '#16365c'; y += 50;
    fitText(g, String(card.nights), 300, 46, '700'); g.fillText(String(card.nights), 40, y);
    fitText(g, String(card.sqft_word), 300, 46, '700'); g.fillText(String(card.sqft_word), 380, y);
    if (card.fields_word) { g.fillStyle = '#4a6a8f'; fitText(g, say(card.fields_word), W - 80, 24, '400'); g.fillText(say(card.fields_word), 40, y + 40); }
    g.fillStyle = '#4a6a8f'; g.font = '400 22px system-ui, sans-serif'; g.fillText('Shovel Command \u00b7 ' + say(winterWord), 40, H - 36);
    return new Promise(function (resolve, reject) { cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('no picture')); }, 'image/png'); });
  }
  // The share ladder: a file to the phone's share sheet when it takes files, else a download. A cancelled share is not an error.
  // navigator.share is called before anything is awaited (the phone counts the tap's own turn); a share the phone calls expired
  // (NotAllowedError) is the download, as when the phone cannot share files.
  async function shareCard(nav, blob) {
    var file = new File([blob], 'crew-card.png', { type: 'image/png' });
    if (nav && nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: 'My crew card' }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; if (!(e && e.name === 'NotAllowedError')) throw e; }
    }
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = 'crew-card.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
    return 'downloaded';
  }
  // The picture is built ahead of the tap (when the own card is drawn), so the tap can hand the finished file to the share sheet in the
  // same turn: iOS refuses a share that comes after a wait. ready = { key, blob } once built; a tap before that builds it then.
  // The key is everything the picture shows, so a changed card, season or language builds again.
  var ready = null, sharing = false;
  function keyOf(card, copy) {
    var lang = typeof SnowEs !== 'undefined' ? SnowEs.lang() : 'en';
    return JSON.stringify([card.name, card.photo_thumb || '', card.seasons_word, card.line, card.nights, card.sqft_word, card.fields_word, copy.season, lang]);
  }
  function prebuild(ctx, copy) {
    try {
      if (!ctx.initials) return;
      var mine = CC.build(copy, ctx.S.crew, ctx.S.me && ctx.S.me.crew_id).filter(function (c) { return c.mine; })[0];
      if (!mine) return;
      var key = keyOf(mine, copy);
      if (ready && ready.key === key) return;
      var slot = ready = { key: key, blob: null };
      pngOf(mine, CC.winterWord(copy.season), ctx.initials).then(function (b) { slot.blob = b; }, function () { if (ready === slot) ready = null; });
    } catch (e) { /* the tap builds it */ }
  }
  // One tap: share the ready picture, or build it then. A second tap while one share is open does nothing. initialsOf is the app's own
  // initials rule; toast says a failure in words.
  async function shareMine(card, copy, initialsOf, toast) {
    if (!card || !card.mine || !copy || sharing) return;
    sharing = true;
    try {
      var key = keyOf(card, copy), blob = ready && ready.key === key ? ready.blob : null;
      if (!blob) blob = await pngOf(card, CC.winterWord(copy.season), initialsOf);
      await shareCard(navigator, blob);
    } catch (e) { if (toast) toast('Could not share the card. Try again.'); }
    finally { sharing = false; }
  }

  // ctx = { $, esc, avatar, call, S, sessionSeq (a function), signedOut, openSelfForm(done), shareCard(card, copy), initials }
  function render(ctx) {
    var copy = readCopy();
    if (copy) draw(ctx, copy, ''); else ctx.$('main').innerHTML = '<h2>Crew</h2><p class="muted" id="cc_loading">Loading…</p>';
    ask(ctx);
  }

  return { render: render, forget: forget, KEY: KEY, pngOf: pngOf, shareCard: shareCard, shareMine: shareMine };
});
