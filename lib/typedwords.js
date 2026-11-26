// The words people type (Spanish everywhere, Ship 2, Matt 11/25/26): site notes, materials needed, zone names and
// notes, and Problem notes. The server translates them through Google into the Translations tab; the phone shows the
// Spanish beside the English it keeps. This file is the one place that decides
//   - the key a text is filed under (in the Translations tab and in the phone's copy, `snow-es-typed`),
//   - what may ever be sent to Google (never Matt's two-language names, never a line with no letter),
//   - the word list that moves Google's Spanish onto the app's own words (acera -> banqueta).
//
// The phone app and the Apps Script backend use this SAME file, byte for byte
// (snow-app-script/test/geo-identity.test.js fails if they differ). No requires: Apps Script
// loads it as a plain file, so it must not depend on any other file. Pure: nothing it is
// given is changed. Accented letters are written as \u escapes so every loader reads the same text.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewTyped = factory();
})(this, function () {
  'use strict';

  var MAX_LEN = 1000;  // a longer line is never sent (a pasted page, not a note)
  var BATCH = 50;      // lines in one translate call

  // The key a text is filed under: trimmed, every line break \n (a laptop's \r\n, a lone \r from an old file), and
  // every run of spaces and tabs one space. Line breaks are kept: a two-line note stays two lines.
  function key(text) {
    if (typeof text !== 'string') return '';
    return text.trim().replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');
  }

  var LETTER = /\p{L}/u;

  // May this text ever reach Google? Not when it is empty, has no letter ("3", "12 - 4"), holds " / " (Matt's
  // two-language names, "Door / Puerta 5"), or is longer than MAX_LEN once keyed.
  function sendable(text) {
    if (typeof text !== 'string') return false;
    var k = key(text);
    if (!k || k.length > MAX_LEN) return false;
    if (k.indexOf(' / ') >= 0) return false;
    return LETTER.test(k);
  }

  // Google's word -> the app's word (lib/es.js says banqueta and cuadrilla). Both pairs are feminine to feminine, so
  // the article in front stays right. Not listed on purpose: "equipo" (team, or equipment), "deshielo" (thaw, or ice
  // melt), and words that already match the app (bordillo, ruta).
  var TO = {
    'aceras': 'banquetas',
    'acera': 'banqueta',
    'tripulaciones': 'cuadrillas',
    'tripulaci\u00f3n': 'cuadrilla'
  };
  // A word counts only with no letter either side, by Unicode (an ASCII \b would see a word edge before the n with a
  // tilde in "acera\u00f1o"). The letter in front is matched by a group, never a lookbehind: a lookbehind is a
  // SyntaxError on older iPhones, and that would stop this whole file loading.
  var VOCAB_RE = /(^|[^\p{L}])(aceras|acera|tripulaciones|tripulaci\u00f3n)(?!\p{L})/giu;

  // The app's word in the shape Google's had: ALL CAPS, a capital first letter, or lower case.
  function shaped(found, to) {
    if (found === found.toUpperCase() && found !== found.toLowerCase()) return to.toUpperCase();
    if (found.charAt(0) !== found.charAt(0).toLowerCase()) return to.charAt(0).toUpperCase() + to.slice(1);
    return to;
  }

  function vocab(es) {
    if (typeof es !== 'string') return '';
    return es.replace(VOCAB_RE, function (all, before, word) {
      return before + shaped(word, TO[word.toLowerCase()]);
    });
  }

  return { key: key, sendable: sendable, vocab: vocab, MAX_LEN: MAX_LEN, BATCH: BATCH };
});
