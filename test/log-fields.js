// The Log fields a crew or lead phone receives: the server's allow-list (snow-app-script roster.js PUBLIC_LOG_FIELDS, through
// publicRow: a field the row lacks arrives as null). The fake backend in ui.spec.js sends crew and leads exactly these (Matt gets the
// whole row). log-fields.test.js checks this list against the backend's own. Field names only: no data.
module.exports = ['id', 'seq', 'storm_id', 'shift_id', 'site_id', 'zone_id', 'state', 'note', 'by_key', 'by_name', 'at', 'off_route', 'snowing_warned', 'undoes', 'depth_in', 'time_in', 'time_out', 'batch'];
