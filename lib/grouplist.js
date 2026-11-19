// Breaking up the long site lists (Matt, 11/15/26): the Sites tab and the route editor's "Add
// sites" view both group sites under customer headings, add letter rows inside a big group, and
// narrow by a typed search or a customer button. This file is the one place that is decided, so
// the two screens cannot disagree and the rules can be tested without a browser.
//
// Pure: no DOM, no storage, nothing it is given is changed (every list it answers is new; the
// site objects inside `items` are the caller's own). No requires.
//
// The rules (the spec's, and Matt's):
//   - Archived sites are never listed or counted. A site's customer is trimmed; none = ''.
//   - Customers run A to Z by localeCompare, and the sites with no customer come last under
//     "No customer yet". Sites run by name, localeCompare, with the names that do not start with
//     a letter (a digit, a bracket, nothing) in a "#" bucket first.
//   - Letter rows appear inside a customer's group only when MORE THAN letterMin (12) of its
//     sites are showing.
//   - The search matches a site's name or address, case-insensitive, trimmed, as PLAIN TEXT
//     (never a pattern); spaces only is no search.
//   - A customer button counts the sites not yet excluded (on the route) whatever the search
//     and the customer filter say; there is no button at 0.
//
// The people rules (Roster search, 11/19/26; Matt's Roster tab, the same letter-row idea):
//   - Archived and pending cards are never listed or counted.
//   - Names are FOLDED before they are compared: accents and case dropped (an e with an accent finds a plain e,
//     N with a tilde files under N). A letter that does not fold (O with a stroke) is its own letter.
//   - The search is words split on spaces; EVERY word must match the same person, as PLAIN TEXT
//     (never a pattern), in the name or in the place words the caller supplies (route, lead).
//     A word made only of digits and - . ( ) + with 3 or more digits also matches inside the
//     phone's digits; one or two digits never match a phone.
//   - Order: the "#" bucket first, then by letter, then by name, then the caller's order. Sorting
//     by letter BEFORE name is what keeps each letter row to one appearance.
//   - Letter rows appear only when MORE THAN letterMin (12) people are showing.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowGroupList = factory();
})(this, function () {
  'use strict';

  var NO_CUSTOMER = 'No customer yet';
  var LETTER_MIN = 12;
  var FIRST_LETTER = /^\p{L}/u;

  function text(v) { return v == null ? '' : String(v); }
  function customerOf(site) { return text(site.customer).trim(); }

  // The letter row a name sits under: its first character, upper case, when that is a letter;
  // anything else (a digit, a bracket, no name at all) is '#'.
  function letterOf(name) {
    var m = FIRST_LETTER.exec(name);
    return m ? m[0].toUpperCase() : '#';
  }

  // A set of ids, as a plain lookup (the ids are text in the app; a prefix keeps 'constructor' and
  // the like from meeting Object's own names).
  function setOf(ids) {
    var set = {};
    (ids || []).forEach(function (id) { set['i:' + id] = true; });
    return set;
  }
  function has(set, id) { return set['i:' + id] === true; }

  function byCustomer(a, b) {
    if (a === b) return 0;
    if (a === '') return 1;     // no customer last
    if (b === '') return -1;
    return a.localeCompare(b);
  }

  // '#' bucket first, then by name; the caller's own order settles an exact tie, so the answer
  // does not depend on how the engine breaks ties.
  function bySite(a, b) {
    var ah = a.letter === '#' ? 0 : 1, bh = b.letter === '#' ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return a.name.localeCompare(b.name) || a.at - b.at;
  }

  // group(sites, { query, customer, exclude, letterMin }) -> { groups, chips, total, matched }
  //   customer: null / undefined = every customer; '' = the sites with no customer (key '').
  //   exclude:  ids to leave out (the sites already on the route).
  //   groups:   [{ key, label, showing, lettered, items }], one per customer with a site showing;
  //             items are { letter } (only when lettered) or { site }.
  //   chips:    [{ key, label, count }], one per customer with a site left, counted whatever the
  //             query and the customer filter say.
  //   total:    sites not excluded (any query, any filter). matched: sites showing now.
  function group(sites, opts) {
    opts = opts || {};
    var q = text(opts.query).trim().toLowerCase();
    var only = opts.customer == null ? null : String(opts.customer);
    var letterMin = typeof opts.letterMin === 'number' ? opts.letterMin : LETTER_MIN;
    var out = setOf(opts.exclude);

    var counts = {};          // customer key -> sites left (not archived, not excluded)
    var showing = {};         // customer key -> [{ site, name, letter, at }]
    var total = 0, matched = 0;
    (sites || []).forEach(function (s, at) {
      if (s.archived || has(out, s.id)) return;
      total++;
      var c = customerOf(s);
      counts['c:' + c] = (counts['c:' + c] || 0) + 1;
      if (only !== null && c !== only) return;
      if (q && (text(s.name).toLowerCase().indexOf(q) < 0 && text(s.address).toLowerCase().indexOf(q) < 0)) return;
      var name = text(s.name).trim();
      (showing['c:' + c] = showing['c:' + c] || []).push({ site: s, name: name, letter: letterOf(name), at: at });
      matched++;
    });

    var keys = Object.keys(counts).map(function (k) { return k.slice(2); }).sort(byCustomer);
    var chips = keys.map(function (k) { return { key: k, label: k || NO_CUSTOMER, count: counts['c:' + k] }; });
    var groups = [];
    keys.forEach(function (k) {
      var list = showing['c:' + k];
      if (!list) return;
      list.sort(bySite);
      var lettered = list.length > letterMin;
      var items = [], last = null;
      list.forEach(function (e) {
        if (lettered && e.letter !== last) { items.push({ letter: e.letter }); last = e.letter; }
        items.push({ site: e.site });
      });
      groups.push({ key: k, label: k || NO_CUSTOMER, showing: list.length, lettered: lettered, items: items });
    });
    return { groups: groups, chips: chips, total: total, matched: matched };
  }

  // Accents and case dropped: N-tilde + "ico" -> "nico", "Pe" + accented e + "rez" -> "perez".
  function fold(v) { return text(v).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }

  var PHONE_WORD = /^[\d\-.()+]+$/;
  function phoneDigits(v) { return text(v).replace(/\D/g, ''); }

  // byPerson: '#' bucket first, then letter, then name, then the caller's order.
  function byPerson(a, b) {
    var ah = a.letter === '#' ? 0 : 1, bh = b.letter === '#' ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return a.letter.localeCompare(b.letter) || a.name.localeCompare(b.name) || a.at - b.at;
  }

  // people(crew, { query, placeOf, letterMin }) -> { total, matched, lettered, items }
  //   placeOf: function(person) -> text searched like the name (absent = no place words).
  //   total: people listed (not archived, not pending). matched: people showing now.
  //   items: { letter } (only when lettered) or { person }, the caller's own object.
  function people(crew, opts) {
    opts = opts || {};
    var words = fold(opts.query).split(/\s+/).filter(function (w) { return w; });
    var letterMin = typeof opts.letterMin === 'number' ? opts.letterMin : LETTER_MIN;
    var placeOf = typeof opts.placeOf === 'function' ? opts.placeOf : null;

    var total = 0, list = [];
    (crew || []).forEach(function (p, at) {
      if (p.archived || p.pending === true) return;
      total++;
      var name = fold(p.name);
      var place = placeOf ? fold(placeOf(p)) : '';
      var digits = phoneDigits(p.phone);
      var every = words.every(function (w) {
        if (name.indexOf(w) >= 0 || place.indexOf(w) >= 0) return true;
        if (!PHONE_WORD.test(w)) return false;
        var d = phoneDigits(w);
        return d.length >= 3 && digits.indexOf(d) >= 0;
      });
      if (!every) return;
      var shown = name.trim();
      var m = FIRST_LETTER.exec(shown);
      list.push({ person: p, name: shown, letter: m ? m[0].toUpperCase() : '#', at: at });
    });
    list.sort(byPerson);
    var lettered = list.length > letterMin;
    var items = [], last = null;
    list.forEach(function (e) {
      if (lettered && e.letter !== last) { items.push({ letter: e.letter }); last = e.letter; }
      items.push({ person: e.person });
    });
    return { total: total, matched: list.length, lettered: lettered, items: items };
  }

  // The route editor's ticks, kept in the order they were made.
  // tick: the ids not already ticked, added at the end in the order given.
  function tick(ticks, ids) {
    var out = (ticks || []).slice(), seen = setOf(out);
    (ids || []).forEach(function (id) {
      if (has(seen, id)) return;
      seen['i:' + id] = true;
      out.push(id);
    });
    return out;
  }
  // untick: the ticks without those ids, the rest in the same order.
  function untick(ticks, ids) {
    var gone = setOf(ids);
    return (ticks || []).filter(function (id) { return !has(gone, id); });
  }
  // hidden: how many ticks are not among the ids on screen now.
  function hidden(ticks, shownIds) {
    var shown = setOf(shownIds);
    return (ticks || []).filter(function (id) { return !has(shown, id); }).length;
  }

  return { group: group, people: people, tick: tick, untick: untick, hidden: hidden, NO_CUSTOMER: NO_CUSTOMER, LETTER_MIN: LETTER_MIN };
});
