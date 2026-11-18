// The fake backend's boardBatch (Board bulk place, 11/18/26), shared by test/ui.spec.js and test/boardbulk.spec.js.
// It answers the server's reply shapes (snow-app-script Code.js boardBatch_ / batchAt_) and applies the SAME shared rules the
// server applies (lib/boardbatch.js CrewBoardBatch, lib/board.js boardFrom), so the phone and the fake never agree by accident.
//   boardBatch { kind: 'add' | 'clear' | 'undo', batch, route_id?, workers?, lead?, clear? }
//   refusals, in the server's order: forbidden 'Only Matt can do that.' (not admin), invalid 'Pick add, clear or undo',
//     'Bad batch id' (the batch; for undo the clear id too), then a batch id already in Moves = { ok, written: 0, skipped: 0,
//     left: 0, already: true, lead_kept: false, records: those rows, moves } and nothing written, then the plan's own error
//     (invalid), then conflict 'That clear is not on the Board' (undo of an unknown clear)
//   else { ok, written, skipped, left, already: false, lead_kept, records, moves } with every row stamped with ONE local ISO
//     time later than every move already there (now, or newest + 1 ms), the batch id, id 'M' + n, rev 1
// state: { moves, routes, crew }; c: { role, now? } (now: a Date, the tests' clock). The caller adds `version` and `action`.
const B = require('../lib/board.js');
const BB = require('../lib/boardbatch.js');
const SL = require('../lib/shiftlog.js');
const T = require('../lib/time.js');

module.exports = function boardBatchFake(state, body, c) {
  if (body.action !== 'boardBatch') return undefined;
  const refuse = (code, reason) => ({ ok: false, code, reason });
  if (c.role !== 'admin') return refuse('forbidden', 'Only Matt can do that.');
  const kind = String(body.kind || '');
  if (kind !== 'add' && kind !== 'clear' && kind !== 'undo') return refuse('invalid', 'Pick add, clear or undo');
  if (!SL.isBatchId(body.batch)) return refuse('invalid', 'Bad batch id');
  if (kind === 'undo' && !SL.isBatchId(body.clear)) return refuse('invalid', 'Bad batch id');
  state.moves = state.moves || [];
  const had = state.moves.filter((m) => m.batch === body.batch);
  if (had.length) return { ok: true, written: 0, skipped: 0, left: 0, already: true, lead_kept: false, records: had, moves: state.moves.slice() };
  const pool = (state.crew || []).filter((p) => p.pending !== true);
  const live = (state.routes || []).filter((r) => !r.archived);
  const board = B.boardFrom(state.moves, live, Object.fromEntries(pool.map((p) => [p.id, p])));
  let plan, skipped = 0, left = 0, leadKept = false;
  if (kind === 'add') {
    plan = BB.planAdd(board, String(body.route_id || ''), body.workers, body.lead || null);
    skipped = plan.skipped; leadKept = plan.lead_kept;
  } else if (kind === 'clear') {
    plan = BB.planClear(board, body.route_id == null ? null : String(body.route_id));
  } else {
    plan = BB.planUndo(state.moves, board, body.clear);
    if (!plan.known) return refuse('conflict', 'That clear is not on the Board');
    left = plan.left;
  }
  if (plan.error) return refuse('invalid', plan.error);
  const now = c.now || new Date();
  let newest = -Infinity;
  state.moves.forEach((m) => { const t = Date.parse(m.at); if (!isNaN(t) && t > newest) newest = t; });
  const at = T.localIso(now.getTime() > newest ? now : new Date(newest + 1));
  const base = state.moves.length;
  const records = plan.rows.map((row, i) => Object.assign({ at, batch: body.batch, id: 'M' + (base + 1 + i), rev: 1 }, row));
  records.forEach((r) => state.moves.push(r));
  return { ok: true, written: records.length, skipped, left, already: false, lead_kept: leadKept, records, moves: state.moves.slice() };
};
