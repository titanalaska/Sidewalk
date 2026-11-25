(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowMachinePick = factory();
})(this, function () {
  'use strict';

  // The Site card's unit and operator picks (Matt, 11/24/26). Data only: the card
  // draws the picks, adds "Not sure", and owns the labels for screen readers.

  // A site's unit text may hold several units: "BC5, BT13, BC7".
  function key(s) { return String(s).replace(/\s+/g, '').toLowerCase(); }

  // Split on commas, trim, drop empties, drop repeats ignoring case and spaces
  // (first spelling kept).
  function splitUnits(text) {
    if (text === null || text === undefined) return [];
    var out = [], seen = {};
    String(text).split(',').forEach(function (p) {
      var u = p.trim(), k = key(u);
      if (u === '' || seen[k]) return;
      seen[k] = true; out.push(u);
    });
    return out;
  }

  function byName(a, b) {
    var x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  }

  // This site's units first (typed order), then every other live site's, A to Z.
  function unitChoices(sites, siteId, type) {
    var out = [], seen = {}, others = [];
    (sites || []).forEach(function (s) {
      if (s.id !== siteId) return;
      splitUnits(s.units && s.units[type]).forEach(function (u) {
        if (seen[key(u)]) return;
        seen[key(u)] = true;
        out.push({ value: u, label: u + ' (this site)', here: true });
      });
    });
    (sites || []).forEach(function (s) {
      if (s.id === siteId || s.archived === true) return;
      splitUnits(s.units && s.units[type]).forEach(function (u) {
        if (seen[key(u)]) return;
        seen[key(u)] = true; others.push(u);
      });
    });
    others.sort(byName).forEach(function (u) { out.push({ value: u, label: u, here: false }); });
    return out;
  }

  // Tonight's people first (firstIds order), then every other live, added card and
  // the admin, A to Z. A crew phone's cards carry no archived/pending: those are live.
  function operatorChoices(crew, firstIds, adminName) {
    var live = {}, rest = [], out = [], used = {};
    (crew || []).forEach(function (c) {
      // A card with no id can never be a pick; a card with no name is read as "" (never a throw that breaks the card).
      if (!c || c.id === undefined || c.id === null || c.id === '' || c.archived === true || c.pending === true) return;
      live[c.id] = { key: c.id, name: String(c.name == null ? '' : c.name) };
    });
    if (adminName !== null && adminName !== undefined && String(adminName).trim() !== '') {
      live.admin = { key: 'admin', name: adminName };
    }
    (firstIds || []).forEach(function (id) {
      if (!live[id] || used[id]) return;
      used[id] = true; out.push(live[id]);
    });
    Object.keys(live).forEach(function (id) { if (!used[id]) rest.push(live[id]); });
    rest.sort(function (a, b) { return byName(a.name, b.name); });
    return out.concat(rest);
  }

  return { splitUnits: splitUnits, unitChoices: unitChoices, operatorChoices: operatorChoices };
});
