// Roster self-service (Matt, 10/6/26): a person fills out their OWN card from their
// phone, picture included; Matt approves the Inventory request and taps Add to crew on
// the Roster tab; crew edit their own card from Tonight. The server keeps everything
// Matt owns: a self save carries the self fields and nothing else.
//
// ctx (built by app.js on every call): {S, $, esc, call, toast, render, avatar, showDialog,
// closeDialog, signedOut(why), load(), profiles(), approve(id), reject(id),
// saveRecord(action, rec, list, done)}.
var SnowRosterUI = (function () {
  'use strict';
  // The fields a person sets on their own record: the backend's SNOW_ROSTER.SELF_FIELDS,
  // word for word (test/rosterui.test.js compares the two). Anything else is Matt's.
  // roster-2 (Matt, 10/6/26 bedtime): cold-rated is theirs to claim and his to correct; Smokes
  // left this form (his alone); the emergency contact is theirs to fill and only Matt sees it.
  var SELF_FIELDS = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear',
    'emergency_name', 'emergency_phone'];
  var OPERATE = ['blower', 'sweepster', 'bobcat', 'snowrator', 'shovel'];
  var TRIS = [['can_drive', 'Can you drive a truck?'], ['valid_id', 'Do you have valid ID?'],
    ['on_call', 'Can we call you out at 3 AM?'], ['cold_rated', 'Can you work a full shift out in deep cold?']];
  var GEAR = [['', 'not set'], ['own', 'I have my own'], ['needs_issued', 'I need it issued']];
  var busy = false, armed = null, loadingProfiles = false;

  function tri(v) { return v === 'yes' ? true : v === 'no' ? false : null; }
  function triText(v) { return v === true ? 'yes' : v === false ? 'no' : ''; }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }
  function option(esc, v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  // Only the self fields present in `card`: what a save may send; never a name, never a field Matt owns.
  function selfFieldsOf(card) {
    var out = {};
    SELF_FIELDS.forEach(function (k) { if (card && card[k] !== undefined) out[k] = card[k]; });
    return out;
  }

  // The form's values -> the card to send. Blank seasons is null (never 0); a seasons that is
  // not a whole number goes as typed, so the server refuses it in its own words. A picture not
  // touched (undefined) is left out, so the one on file is kept.
  function cardFromForm(v) {
    var seasons = String(v.seasons == null ? '' : v.seasons).trim();
    var card = { phone: String(v.phone || '').trim(), can_drive: tri(v.can_drive), valid_id: tri(v.valid_id), on_call: tri(v.on_call),
      cold_rated: tri(v.cold_rated), can_operate: (v.can_operate || []).slice(), gear: v.gear || null,
      seasons: seasons === '' ? null : /^\d+$/.test(seasons) ? Number(seasons) : seasons,
      emergency_name: String(v.emergency_name || '').trim(), emergency_phone: String(v.emergency_phone || '').trim() };
    if (v.photo_thumb !== undefined) card.photo_thumb = v.photo_thumb;
    return selfFieldsOf(card);
  }

  // The emergency contact as one line: "name · phone", or whichever is set, or '' (escaped by the caller).
  function contactText(c) {
    return [c && c.emergency_name, c && c.emergency_phone].filter(Boolean).join(' · ');
  }

  // Pictures live inside the record as a ~160 px JPEG data URL (moved from app.js).
  async function thumb(file) {
    var bmp = await createImageBitmap(file);
    var scale = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  // ---------- the form ----------
  function formHtml(ctx, card) {
    var esc = ctx.esc, c = card || {};
    function triSel(key, label) {
      var v = triText(c[key]);
      return '<label>' + label + '</label><select id="s_' + key + '">' + option(esc, '', 'not set', v === '') +
        option(esc, 'yes', 'yes', v === 'yes') + option(esc, 'no', 'no', v === 'no') + '</select>';
    }
    return '<h2 id="s_title">' + (c.name ? esc(c.name) : 'Your card') + '</h2>' +
      '<p class="muted">Your name comes from your Titan Inventory sign-in. The rest is yours to fill in.</p>' +
      '<div class="who-head" id="s_pic">' + ctx.avatar({ name: c.name, photo_thumb: c.photo_thumb }) +
        '<span class="muted" id="s_photo_msg">' + (c.photo_thumb ? 'Picture on file' : 'No picture yet') + '</span></div>' +
      '<div class="row"><label class="filebtn">Take a picture<input id="s_photo_cam" type="file" accept="image/*" capture="user"></label>' +
        '<label class="filebtn">Choose a photo<input id="s_photo_file" type="file" accept="image/*"></label></div>' +
      '<label>Phone</label><input id="s_phone" type="tel" value="' + esc(c.phone) + '" maxlength="30">' +
      TRIS.map(function (t) { return triSel(t[0], t[1]); }).join('') +
      '<label>What can you run?</label>' + OPERATE.map(function (o) {
        return '<label class="inline"><input type="checkbox" data-sop value="' + o + '"' + ((c.can_operate || []).indexOf(o) !== -1 ? ' checked' : '') + '>' + o + '</label>';
      }).join('') +
      '<label>Seasons with Titan</label><input id="s_seasons" inputmode="numeric" value="' + (c.seasons == null ? '' : esc(c.seasons)) + '">' +
      '<label>Cold-weather gear</label><select id="s_gear">' + GEAR.map(function (g) { return option(esc, g[0], g[1], (c.gear || '') === g[0]); }).join('') + '</select>' +
      '<label>Emergency contact: name</label><input id="s_emergency_name" value="' + esc(c.emergency_name) + '" maxlength="60">' +
      '<label>Emergency contact: phone</label><input id="s_emergency_phone" type="tel" value="' + esc(c.emergency_phone) + '" maxlength="30">' +
      '<p class="muted">Only Matt sees your emergency contact.</p>' +
      '<div id="s_err" class="err"></div><div class="row"><button id="s_save" class="primary">Save</button><button id="s_cancel">Cancel</button></div>';
  }

  function readForm($, photo) {
    return { phone: $('s_phone').value, can_drive: $('s_can_drive').value, valid_id: $('s_valid_id').value, on_call: $('s_on_call').value,
      cold_rated: $('s_cold_rated').value, seasons: $('s_seasons').value, gear: $('s_gear').value, photo_thumb: photo,
      emergency_name: $('s_emergency_name').value, emergency_phone: $('s_emergency_phone').value,
      can_operate: Array.prototype.map.call(document.querySelectorAll('[data-sop]:checked'), function (i) { return i.value; }) };
  }

  // where: 'main' (not on the roster yet, or a pending card) or 'dlg' (Your card from Tonight).
  // onSaved(reply) after a confirmed save; onSaved(null) on Cancel.
  function selfForm(ctx, card, where, onSaved) {
    var $ = ctx.$, photo; // undefined until a picture is picked: the one on file stays
    var host = where === 'dlg' ? $('dlgIn') : $('main');
    host.innerHTML = formHtml(ctx, card);
    if (where === 'dlg') ctx.showDialog();
    function picked(input) {
      return async function () {
        var file = input.files && input.files[0];
        if (!file) return;
        try {
          photo = await thumb(file);
          $('s_pic').innerHTML = ctx.avatar({ name: card && card.name, photo_thumb: photo }) + '<span class="muted" id="s_photo_msg">Picture ready. Save to keep it.</span>';
        } catch (e) { $('s_photo_msg').textContent = "That file isn't a picture this phone can read."; }
      };
    }
    $('s_photo_cam').onchange = picked($('s_photo_cam'));
    $('s_photo_file').onchange = picked($('s_photo_file'));
    // One save at a time: a second tap on a slow Apps Script call must not make two cards.
    $('s_save').onclick = async function () {
      if (busy) return;
      busy = true;
      $('s_save').disabled = true;
      try {
        var r = await ctx.call('saveMyCard', { card: cardFromForm(readForm($, photo)) });
        if (!r.ok) {
          if (r.code === 'signin') { if (where === 'dlg') ctx.closeDialog(); ctx.signedOut(r.reason); return; }
          if ($('s_err')) $('s_err').textContent = r.reason || 'Not saved.';
          return;
        }
        if (where === 'dlg') ctx.closeDialog();
        ctx.toast('Saved');
        onSaved(r);
      } finally { busy = false; if ($('s_save')) $('s_save').disabled = false; }
    };
    $('s_cancel').onclick = function () { if (where === 'dlg') ctx.closeDialog(); else onSaved(null); };
  }

  // ---------- the screens before Matt adds them ----------
  function notOnRosterScreen(ctx, name) {
    ctx.$('main').innerHTML = '<section class="card" id="notroster"><h2>Hi ' + ctx.esc(name || '') + '</h2>' +
      "<p>You're signed in, but not on the snow crew yet. Fill out your card and Matt will add you.</p>" +
      '<div class="row"><button id="fillCard" class="primary">Fill out your card</button></div></section>';
  }

  function cardTable(ctx, c) {
    var esc = ctx.esc;
    function yn(v) { return v === true ? 'yes' : v === false ? 'no' : '<span class="muted">not set</span>'; }
    var rows = [['Phone', esc(c.phone) || '<span class="muted">none</span>']].concat(TRIS.map(function (t) { return [t[1], yn(c[t[0]])]; }))
      .concat([['Can run', esc((c.can_operate || []).join(', ')) || '<span class="muted">none</span>'],
        ['Seasons', c.seasons == null ? '<span class="muted">not set</span>' : esc(c.seasons)],
        ['Gear', c.gear === 'own' ? 'own' : c.gear === 'needs_issued' ? 'needs issued' : '<span class="muted">not set</span>'],
        ['Emergency contact', esc(contactText(c)) || '<span class="muted">not set</span>']]);
    return '<table>' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>';
  }

  function pendingScreen(ctx, card) {
    ctx.S.card = card;
    ctx.$('main').innerHTML = '<section class="card" id="pendingcard"><div class="who-head">' + ctx.avatar(card) + '<h2>Hi ' + ctx.esc(card.name || '') + '</h2></div>' +
      '<p>Your card is in. Matt will add you to the crew.</p>' + cardTable(ctx, card) +
      '<div class="row"><button id="editCard" class="primary">Edit your card</button><button id="checkAgain">Check again</button></div></section>';
  }

  // ---------- Matt's Roster tab: the two waiting lists ----------
  // The sign-in names are fetched once per sign-in (the editor needs them too). Fetch in
  // flight or failed: no list, no second fetch until the tab is drawn again.
  function ensureProfiles(ctx) {
    if (ctx.S.profiles || loadingProfiles) return;
    loadingProfiles = true;
    ctx.profiles().then(function (list) {
      loadingProfiles = false;
      if (!list) return;
      ctx.S.profiles = list;
      if (ctx.S.tab === 'roster') ctx.render();
    });
  }

  function waitingHtml(ctx) {
    var S = ctx.S, esc = ctx.esc, html = '';
    var pend = (S.profiles || []).filter(function (p) { return p.status === 'pending'; });
    if (pend.length) {
      html += '<section class="card" id="waitapprove"><h2>Waiting for approval (' + pend.length + ')</h2>' +
        '<p class="muted">Requests from the sign-in screen. Approve lets them sign in and fill out their card.</p>' +
        pend.map(function (p) {
          var arm = armed === String(p.id);
          return '<div class="person" data-profile="' + esc(p.id) + '"><span class="pname">' + esc(p.name) + '</span>' +
            '<button class="small primary" data-approve="' + esc(p.id) + '">Approve</button>' +
            '<button class="small" data-reject="' + esc(p.id) + '" aria-pressed="' + arm + '">' + (arm ? 'Really reject?' : 'Reject') + '</button></div>';
        }).join('') + '</section>';
    }
    var cards = S.crew.filter(function (w) { return w.pending === true && !w.archived; }).sort(byName);
    if (cards.length) {
      html += '<section class="card" id="waitadd"><h2>Waiting to be added (' + cards.length + ')</h2>' +
        '<p class="muted">They filled out their own card. Add to crew puts them on the roster; tap the name to see the card.</p>' +
        cards.map(function (w) {
          return '<div class="person"><span data-open="' + esc(w.id) + '" role="button" tabindex="0">' + ctx.avatar(w) + '</span>' +
            '<span class="pname" data-open="' + esc(w.id) + '" role="button" tabindex="0">' + esc(w.name) + (w.phone ? ' <span class="muted">' + esc(w.phone) + '</span>' : '') + '</span>' +
            '<button class="small primary" data-addcrew="' + esc(w.id) + '">Add to crew</button></div>';
        }).join('') + '</section>';
    }
    return html;
  }

  async function decide(ctx, id, what) {
    var p = (ctx.S.profiles || []).filter(function (x) { return String(x.id) === String(id); })[0];
    var r = await (what === 'approve' ? ctx.approve(id) : ctx.reject(id));
    if (!r.ok) { ctx.toast((what === 'approve' ? 'Not approved: ' : 'Not rejected: ') + (r.reason || 'try again')); return; }
    ctx.toast(what === 'approve' ? (p ? p.name : 'They') + ' can sign in now' : 'Request rejected');
    ctx.S.profiles = null;
    ctx.render();
  }

  function addToCrew(ctx, id) {
    var w = ctx.S.crew.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    ctx.saveRecord('saveCrew', Object.assign({}, w, { pending: false }), 'crew', w.name + ' is on the crew');
  }

  // Returns true when handled.
  function onClick(ev, ctx) {
    var t = ev.target, el, S = ctx.S;
    if (t.id === 'fillCard') {
      selfForm(ctx, { name: S.pendingName }, 'main', function (r) {
        if (!r) return notOnRosterScreen(ctx, S.pendingName);
        if (r.pending) pendingScreen(ctx, r.card); else ctx.load(); // Matt added them meanwhile
      });
      return true;
    }
    if (t.id === 'editCard') {
      selfForm(ctx, S.card, 'main', function (r) {
        if (!r) return pendingScreen(ctx, S.card);
        if (r.pending) pendingScreen(ctx, r.card); else ctx.load();
      });
      return true;
    }
    if (t.id === 'checkAgain') { ctx.load(); return true; }
    if (t.id === 'yourCard') {
      selfForm(ctx, S.card || { name: S.me && S.me.name }, 'dlg', function (r) { if (r) S.card = r.card; });
      return true;
    }
    if ((el = t.closest('[data-approve]'))) { armed = null; decide(ctx, el.dataset.approve, 'approve'); return true; }
    if ((el = t.closest('[data-reject]'))) {
      // Rejecting throws the request away and signs that phone out of Inventory: two taps.
      if (armed !== el.dataset.reject) { armed = el.dataset.reject; ctx.render(); }
      else { armed = null; decide(ctx, el.dataset.reject, 'reject'); }
      return true;
    }
    if ((el = t.closest('[data-addcrew]'))) { addToCrew(ctx, el.dataset.addcrew); return true; }
    return false;
  }

  return { SELF_FIELDS: SELF_FIELDS, OPERATE: OPERATE, selfFieldsOf: selfFieldsOf, cardFromForm: cardFromForm, contactText: contactText, thumb: thumb,
    selfForm: selfForm, notOnRosterScreen: notOnRosterScreen, pendingScreen: pendingScreen, waitingHtml: waitingHtml,
    ensureProfiles: ensureProfiles, onClick: onClick };
})();
if (typeof window !== 'undefined') window.SnowRosterUI = SnowRosterUI;
if (typeof module !== 'undefined') module.exports = SnowRosterUI;
