// Where the app talks to. SNOW_URL is set after Matt deploys the backend
// (deployment @1 "foundation-1", 9/30/26; @2 "maps-1", 10/1/26; @4 "pairings-1", 10/1/26; "shiftlog-1" and "sheets-1" next; "handoff-1" 10/5/26;
// "roster-1" 10/6/26; "roster-2" = cold-rated + emergency contact on the self card, and bootstrap carries one's own card; "roster-3" 10/8/26 = where one lives, Valley or Anchorage, on the self card; "curbs-1" 10/8/26 = the curb roll-up: a site's
// "Curb ..." lines are tapped as 1-5 "Curbs" items, so phone and server must agree on the walks; "outlines-1" 10/9/26 = outlines on
// demand: bootstrap and getZones answer `slim: true` with zones that have no ring and one point per site; "dispatch-1" 11/9/26 = the dispatcher
// mark, a yes/no on a roster card that makes that sign-in an admin, sent to admin phones only; "times-1" 11/11/26 = times: a site's
// Arrived / Left and each person's shift Start / End, tapped or typed by the dispatcher, with the Clock rows on every shift-log read
// and a Crew times sheet beside the route sheets); "concrete-1" 11/12/26 = new concrete: a zone flag `new_concrete` kept by the server; "crewcurbs-1" 11/13/26 = Curbs for the crew: a site flag `crew_curbs` kept by the server; "sitedone-1" 11/13/26 = Site done + Site treated: whole-site taps kept by the server; "boardbulk-1" 11/18/26 = Board bulk: `boardBatch`, one admin action that clears the Board or a route, adds several people and undoes a clear; "crewstats-1" 11/19/26 = Crew stats: `getCrewStats`, one admin read of a person's winter.  "cards-1" 11/24/26 = Crew cards: `getCrewCards`, one read of every crew card. "checknight-1" 11/24/26 = Check night: a start may carry `check`, Make it a storm (`to_storm`) writes a `stormed` Log row, and the shared walk rules, route sheets and handoff read both. "machines-1" 11/24/26 = Site card machine lines: a card may carry `machines` (one line per Bobcat / Snowrator: unit, attachment, operator, minutes) and bootstrap names the admin (`admin_name`). "nightsheet-1" 11/25/26 = the end-of-night sheet: a Site card may carry `shoveled`, `ice_melt_bags` and `sand_buckets` (a left-out one keeps the saver's own answer), and the route sheet prints them in a table. "spanish-1" 11/25/26 = typed words in the reader's language: `translate`, one call open to everyone signed in, answers the Spanish (or English) of typed notes and zone names from the Translations tab and Google. A new backend version is a new
// deployment VERSION on the same id, so this URL does not change on updates.
// EXPECTED_BACKEND must match the backend's VERSION, or the app warns.
var SNOW_CONFIG = {
  SNOW_URL: 'https://script.google.com/macros/s/AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn-s6fjBAkLULyWTQ/exec',
  INV_URL: 'https://script.google.com/macros/s/AKfycbyudFaJ0dsSYMo_uO8KF5WTvJrB-l3eppbTHenmbcPRO19qhcVg8_YJR5boDIsCU1QC/exec',
  EXPECTED_BACKEND: 'spanish-1',
};
