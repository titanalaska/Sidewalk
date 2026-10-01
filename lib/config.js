// Where the app talks to. SNOW_URL is set after Matt deploys the backend
// (plan Task 8); until then it points at a URL that does not exist.
// EXPECTED_BACKEND must match the backend's VERSION, or the app warns.
var SNOW_CONFIG = {
  SNOW_URL: 'https://script.google.com/macros/s/SNOW-NOT-DEPLOYED/exec',
  INV_URL: 'https://script.google.com/macros/s/AKfycbyudFaJ0dsSYMo_uO8KF5WTvJrB-l3eppbTHenmbcPRO19qhcVg8_YJR5boDIsCU1QC/exec',
  EXPECTED_BACKEND: 'foundation-1',
};
