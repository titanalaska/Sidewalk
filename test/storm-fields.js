// The Storms fields a crew or lead phone receives: the server's allow-list (snow-app-script roster.js
// PUBLIC_STORM_FIELDS, through publicRow: a field the row lacks arrives as null). The fake backend in
// ui.spec.js sends crew and leads exactly these; storm-fields.test.js checks this list against the
// backend's own whenever the backend checkout sits beside this repo. Field names only: no data.
module.exports = ['id', 'seq', 'kind', 'storm_id', 'at', 'by_name', 'shift_id', 'log_seq', 'visit_seq', 'night_routes'];
