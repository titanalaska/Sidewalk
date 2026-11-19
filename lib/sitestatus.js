(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowSiteStatus = factory(root.CrewShiftLog);
})(this, function (L) {
  'use strict';

  // The colour of a Storm-tab site card's name bar (Matt, 11/19/26: "add some different colors"; he picked site status).
  // First match wins:
  //   problem  any walk the crew sees, curb items included, at Problem               "1 problem" / "N problems"
  //   done     every non-curb walk Cleared, Treated (Sanded) or Checked               "Done"
  //            (curbs never count: Not done there is normal time-allowance work; a curbs-only site is never green)
  //   working  a standing Arrived or Left (the visit's latest mark), or any walk done  "Arrived" while no non-curb walk is done
  //                                                                                    and the crew is there, else "K of N walks done"
  //   none     nothing yet                                                             no words (the navy bar of the phone look)
  // walks: CrewShiftLog.walksFor; states: CrewShiftLog.walkStates (the current pass: Clean again starts over); mark: the
  // shown visit's CrewShiftLog.latestMark row, or null. Phone only; the words are rows lib/es.js already has.
  var DONE = ['cleared', 'treated', 'checked'];

  function of(walks, states, siteId, mark) {
    function stateOf(w) { var r = (states || {})[L.walkKey(siteId, w.zone_id)]; return r ? r.state : 'none'; }
    var all = walks || [], main = all.filter(function (w) { return !L.isCurbItem(w); });
    var problems = all.filter(function (w) { return stateOf(w) === 'problem'; }).length;
    if (problems) return { kind: 'problem', text: problems + (problems === 1 ? ' problem' : ' problems') };
    var done = main.filter(function (w) { return DONE.indexOf(stateOf(w)) !== -1; }).length;
    if (main.length && done === main.length) return { kind: 'done', text: 'Done' };
    var anyDone = all.some(function (w) { return DONE.indexOf(stateOf(w)) !== -1; });
    if (!mark && !anyDone) return { kind: 'none', text: '' };
    if (!done && mark && mark.state === 'arrived') return { kind: 'working', text: 'Arrived' };
    return { kind: 'working', text: main.length ? done + ' of ' + main.length + ' walks done' : '' };
  }

  return { of: of };
});
