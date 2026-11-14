// The fake backend's tapSite / undoSiteTap (Site done / Site treated, 11/13/26), shared by test/ui.spec.js and test/sitedone.spec.js.
// It answers the server's reply shapes (snow-app-script Code.js tapSite_ / undoSiteTap_) and calls the SAME shared functions the
// server calls (lib/shiftlog.js siteTapWalks / batchUndo / crewZones), so the phone and the fake never agree by accident.
//   tapSite { site_id, kind, batch }:
//     refusals invalid: 'Pick Site done or Site treated', 'Bad batch id', 'No storm is open', 'Unknown site' (in that order)
//     a batch whose tap rows are already in this storm's Log: { ok, records: those rows, written: 0, already: true }, nothing written
//     nothing to write: { ok, records: [], written: 0, already: false }
//     else one row per walk, { ok, records, written: n, already: false }
//   undoSiteTap { batch }: conflict 'That tap is not in this storm' when no tap row carries the batch; else one undo row per
//     batchUndo target (no batch on it), { ok, records, undone, kept, before }
// state: { log, storms, sites, zones }; c: { storm (stormState), me, stamp, view(row) }. The caller adds `version` and `action`.
const SL = require('../lib/shiftlog.js');

module.exports = function siteTapFake(state, body, c) {
  const refuse = (code, reason) => ({ ok: false, code, reason });
  const storm = c.storm;
  const nextRow = (extra) => {
    const n = state.log.length + 1;
    const row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: 'night-2026-10-02', note: '', by_key: c.me.crew_id || 'admin', by_name: c.me.name,
      at: c.stamp, off_route: false, snowing_warned: false, undoes: null, batch: null, ...extra };
    state.log.push(row);
    return row;
  };
  if (body.action === 'tapSite') {
    if (body.kind !== 'done' && body.kind !== 'treated') return refuse('invalid', 'Pick Site done or Site treated');
    if (!SL.isBatchId(body.batch)) return refuse('invalid', 'Bad batch id');
    if (!storm.open) return refuse('invalid', 'No storm is open');
    if (!state.sites.find((s) => s.id === body.site_id && !s.archived)) return refuse('invalid', 'Unknown site');
    const had = state.log.filter((r) => r.storm_id === storm.storm_id && r.batch === body.batch && r.undoes == null);
    if (had.length) return { ok: true, records: had.map(c.view), written: 0, already: true };
    const walks = SL.siteTapWalks(state.log, storm.storm_id, body.site_id, SL.crewZones(state.zones || [], state.sites), body.kind);
    if (!walks.length) return { ok: true, records: [], written: 0, already: false };
    const rows = walks.map((w) => nextRow({ site_id: body.site_id, zone_id: w.zone_id, state: w.state, snowing_warned: w.state === 'treated' && storm.snowing === true, batch: body.batch }));
    return { ok: true, records: rows.map(c.view), written: rows.length, already: false };
  }
  // undoSiteTap
  if (!SL.isBatchId(body.batch)) return refuse('invalid', 'Bad batch id');
  if (!storm.open) return refuse('invalid', 'No storm is open');
  if (!state.log.some((r) => r.storm_id === storm.storm_id && r.batch === body.batch && r.undoes == null)) return refuse('conflict', 'That tap is not in this storm');
  const u = SL.batchUndo(state.log, storm.storm_id, body.batch);
  const rows = u.targets.map((t) => nextRow({ site_id: t.row.site_id, zone_id: t.row.zone_id, state: t.state, note: t.note, undoes: t.row.id }));
  return { ok: true, records: rows.map(c.view), undone: rows.length, kept: u.kept, before: u.before };
};
