(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewForms = factory();
})(this, function () {
  'use strict';

  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function cell(s) { s = String(s == null ? '' : s).trim(); return s === '' ? null : s; }

  // Past the HIGHEST number, never the count: ids have gaps once anyone is
  // archived. (Inventory learned this one the hard way.)
  function nextWorkerId(ids) {
    var max = 0;
    (ids || []).forEach(function (id) {
      var m = /^C(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'C' + pad2(max + 1);
  }

  // One per line: SITE | yes/no | cleared date | expires
  function parseClearances(text) {
    var list = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var p = line.split('|').map(cell);
      var site = p[0], cleared = p[1] || null, date = p[2] || null, expires = p[3] || null;
      var where = 'line ' + (i + 1) + ': ';
      if (!site) { errors.push(where + 'site is missing'); return; }
      if (cleared !== null && ['yes', 'no'].indexOf(cleared.toLowerCase()) === -1) { errors.push(where + 'cleared must be yes or no'); return; }
      if ((date && !DATE.test(date)) || (expires && !DATE.test(expires))) { errors.push(where + 'dates must be YYYY-MM-DD'); return; }
      list.push({ site: site, cleared: cleared === null ? null : cleared.toLowerCase() === 'yes', date: date, expires: expires });
    });
    return { list: list, errors: errors };
  }

  function formatClearances(list) {
    return (list || []).map(function (c) {
      return [c.site, formatTri(c.cleared), c.date || '', c.expires || ''].join(' | ');
    }).join('\n');
  }

  function parseSites(text) {
    return String(text || '').split(/\r?\n/)
      .map(function (line) { return line.split('|').map(cell); })
      .filter(function (p) { return p[0]; })
      .map(function (p) { return { name: p[0], needs_clearance: p[1] || null }; });
  }

  function formatSites(sites) {
    return (sites || []).map(function (s) { return s.needs_clearance ? s.name + ' | ' + s.needs_clearance : s.name; }).join('\n');
  }

  function parseTri(v) { return v === 'yes' ? true : v === 'no' ? false : null; }
  function formatTri(v) { return v === true ? 'yes' : v === false ? 'no' : ''; }
  function parseList(text) { return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

  return { nextWorkerId: nextWorkerId, parseClearances: parseClearances, formatClearances: formatClearances,
    parseSites: parseSites, formatSites: formatSites, parseTri: parseTri, formatTri: formatTri, parseList: parseList };
});
