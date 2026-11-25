(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crewstats'));
  else root.SnowCrewCards = factory(root.CrewStats);
})(this, function (S) {
  'use strict';

  // Crew cards (Matt, 11/24/26): the pure words and rules of the Crew tab. The server's getCrewCards reply is
  // { ok, season, counted_at, cards: [{ id, name, seasons, card_line, nights_worked, team_sqft }] }; no pictures ride in it,
  // build() joins them from the phone's own crew list.
  var FIELD_SQFT = 57600;   // one football field

  function seasonsWord(n) {
    if (n === null || n === undefined) return null;
    return n >= 2 ? n + ' seasons' : 'Rookie';
  }
  function fieldsWord(sqft) {
    var n = Math.round(Number(sqft) / FIELD_SQFT);
    if (!(n >= 1)) return null;
    return 'about ' + n + (n === 1 ? ' football field' : ' football fields');
  }
  // '2026-27' -> 'Winter 2026\u201327' (an en dash)
  function winterWord(season) { return 'Winter ' + String(season).replace('-', '\u2013'); }

  // Own card first, then A-Z. A reply id the crew list lacks gets photo_thumb null (the card draws initials).
  function build(reply, crewList, myCrewId) {
    var cards = (reply && reply.cards) || [], thumbs = {};
    (crewList || []).forEach(function (p) { thumbs[p.id] = p.photo_thumb || null; });
    var out = cards.map(function (c) {
      var line = typeof c.card_line === 'string' ? c.card_line.trim() : '';
      return {
        id: c.id, name: c.name,
        photo_thumb: Object.prototype.hasOwnProperty.call(thumbs, c.id) ? thumbs[c.id] : null,
        seasons_word: seasonsWord(c.seasons),
        line: line || null,
        nights: c.nights_worked,
        sqft_word: S.sqftWords(c.team_sqft),
        fields_word: fieldsWord(c.team_sqft),
        mine: !!myCrewId && c.id === myCrewId
      };
    });
    out.sort(function (a, b) {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    return out;
  }

  return { seasonsWord: seasonsWord, fieldsWord: fieldsWord, winterWord: winterWord, build: build };
});
