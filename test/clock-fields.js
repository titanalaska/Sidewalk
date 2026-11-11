// The Clock fields a crew or lead phone receives: the server's allow-list (snow-app-script roster.js
// PUBLIC_CLOCK_FIELDS, through publicRow: a field the row lacks arrives as null). The fake backend in
// ui.spec.js sends crew and leads exactly these (Matt gets the whole row). Field names only: no data.
// Export shape: a plain array of strings, in the backend's order (like storm-fields.js).
module.exports = ['id', 'seq', 'shift_id', 'kind', 'crew_id', 'name', 'route_id', 'storm_id', 'at', 'time_in', 'time_out', 'undoes', 'by_key', 'by_name'];
