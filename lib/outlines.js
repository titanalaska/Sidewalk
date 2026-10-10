(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowOutlines = factory();
})(this, function () {
  'use strict';

  // The phone's kept copy of each site's zone outlines. S.zones holds zone
  // records WITHOUT rings; the rings live only here, one entry per site, so
  // the next time a map opens it draws at once and works with no signal.
  //
  //   localStorage['snow-outlines'] =
  //     { v: 1, sites: { <siteId>: { at: <iso>, rings: { <zoneId>: [[lng, lat], ...] } } } }
  //
  // localStorage is per origin and titanalaska.github.io also carries two other
  // apps, so the ~5 MB is shared: a write can be refused (quota, private mode)
  // and the accessor itself can throw. Every read and write is in try/catch,
  // unreadable or other-version JSON reads as an empty store, and a refused
  // write is a no-op. NOTHING here throws. The map then draws from the download.

  var KEY = 'snow-outlines'; // named once, never renamed: a rename abandons every kept copy
  var has = Object.prototype.hasOwnProperty;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // Maps keyed by site or zone id have no prototype, so an id such as
  // "constructor" or "__proto__" is an ordinary key.
  function bare() { return Object.create(null); }
  function usable(z) { return isObj(z) && z.id != null && Array.isArray(z.ring) && z.ring.length > 0; }

  // { zoneId: ring } for the zones that have a ring. keep and changed both go
  // through this, so a zone with no ring is never kept and never counts.
  function ringsOf(zones) {
    var out = bare();
    (Array.isArray(zones) ? zones : []).forEach(function (z) { if (usable(z)) out[z.id] = z.ring; });
    return out;
  }

  // `storage` is localStorage-like (getItem/setItem/removeItem) or a function
  // returning one. The function is called on every use, never when the store is
  // made, and may throw: it is how SnowOutlines.local stays loadable in node.
  function store(storage) {
    function area() {
      try { return (typeof storage === 'function' ? storage() : storage) || null; } catch (err) { return null; }
    }

    // The kept sites, as a fresh object nothing else holds: { siteId: { at, rings } }.
    function read() {
      try {
        var s = area();
        if (!s) return bare();
        var data = JSON.parse(s.getItem(KEY));
        if (!isObj(data) || data.v !== 1 || !isObj(data.sites)) return bare();
        var out = bare();
        Object.keys(data.sites).forEach(function (id) {
          var e = data.sites[id];
          if (!isObj(e) || !isObj(e.rings)) return;
          var rings = bare();
          Object.keys(e.rings).forEach(function (zid) {
            if (Array.isArray(e.rings[zid]) && e.rings[zid].length > 0) rings[zid] = e.rings[zid];
          });
          out[id] = { at: typeof e.at === 'string' ? e.at : '', rings: rings };
        });
        return out;
      } catch (err) { return bare(); }
    }

    // True when the sites were stored. A refused write is false, not an error.
    function write(sites) {
      try {
        var s = area();
        if (!s) return false;
        s.setItem(KEY, JSON.stringify({ v: 1, sites: sites }));
        return true;
      } catch (err) { return false; }
    }

    function entry(sites, siteId) { return has.call(sites, siteId) ? sites[siteId] : null; }

    // This site's entry becomes the rings of these zones: replaced, not merged,
    // so a zone dropped from the list is gone. Other sites are untouched.
    function keep(siteId, zones) {
      try {
        var sites = read();
        sites[siteId] = { at: new Date().toISOString(), rings: ringsOf(zones) };
        return write(sites);
      } catch (err) { return false; }
    }

    // One zone's ring into this site's entry (an editor save), creating the
    // entry if the site was never kept. An existing entry keeps its `at`: that
    // is when the site's list was last fetched, and one save does not refresh it.
    function keepOne(siteId, zone) {
      try {
        if (!usable(zone)) return false;
        var sites = read();
        var e = entry(sites, siteId);
        if (!e) { e = { at: new Date().toISOString(), rings: bare() }; sites[siteId] = e; }
        e.rings[zone.id] = zone.ring;
        return write(sites);
      } catch (err) { return false; }
    }

    // Copies of the zones that have a kept ring, `ring` attached, in the order
    // given. The zones passed in are not touched; a zone never kept is dropped.
    function withRings(siteId, zones) {
      try {
        var e = entry(read(), siteId);
        if (!e) return [];
        var out = [];
        (Array.isArray(zones) ? zones : []).forEach(function (z) {
          if (!isObj(z) || !has.call(e.rings, z.id)) return;
          var c = {};
          Object.keys(z).forEach(function (k) { c[k] = z[k]; });
          c.ring = e.rings[z.id];
          out.push(c);
        });
        return out;
      } catch (err) { return []; }
    }

    // True when these zones' rings differ from the kept ones: the id sets
    // differ (one added, one gone) or any ring does (compared as JSON). A site
    // never kept with any zones is a change; with none it is not. Read only.
    // If the store cannot be read, say yes: the reply is news.
    function changed(siteId, zones) {
      try {
        var e = entry(read(), siteId);
        var kept = e ? e.rings : bare();
        var fresh = ringsOf(zones);
        var ids = Object.keys(fresh);
        if (Object.keys(kept).length !== ids.length) return true;
        for (var i = 0; i < ids.length; i++) {
          if (!has.call(kept, ids[i])) return true;
          if (JSON.stringify(kept[ids[i]]) !== JSON.stringify(fresh[ids[i]])) return true;
        }
        return false;
      } catch (err) { return true; }
    }

    // Sign-out: customer outlines do not outlive the person's session.
    function forget() {
      try {
        var s = area();
        if (s) s.removeItem(KEY);
      } catch (err) { /* nothing to do */ }
    }

    return { keep: keep, keepOne: keepOne, withRings: withRings, changed: changed, forget: forget };
  }

  return {
    KEY: KEY,
    store: store,
    // Looked up on use, not at load: node has no window, and the accessor can throw.
    local: store(function () { return window.localStorage; })
  };
});
