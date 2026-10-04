// Where the app talks to. SNOW_URL is set after Matt deploys the backend
// (deployment @1 "foundation-1", 9/30/26; @2 "maps-1", 10/1/26; @4 "pairings-1", 10/1/26; "shiftlog-1" and "sheets-1" next). A new backend version is a new
// deployment VERSION on the same id, so this URL does not change on updates.
// EXPECTED_BACKEND must match the backend's VERSION, or the app warns.
var SNOW_CONFIG = {
  SNOW_URL: 'https://script.google.com/macros/s/AKfycbwc7dcfmJFa1TAspzBZVprJRwBNvCP6q2bqOH5uoS_hU6ScZOnr9Kn-s6fjBAkLULyWTQ/exec',
  INV_URL: 'https://script.google.com/macros/s/AKfycbyudFaJ0dsSYMo_uO8KF5WTvJrB-l3eppbTHenmbcPRO19qhcVg8_YJR5boDIsCU1QC/exec',
  EXPECTED_BACKEND: 'sheets-1',
};
