// Matt's and the dispatcher's Crew tab (bottom tabs, Matt 11/25/26). The admins' bar is Storm · Routes · Sites · Crew; the Crew
// button carries data-tab="board" because Crew opens on the Board every time, and a switch on top (#crewsw) reaches the rest.
// toScreen walks there the way Matt does: Crew first, then the switch. A helper module, never a spec file.
async function toScreen(page, screen) {
  await page.click('#tabs [data-tab="board"]');
  if (screen !== 'board') await page.click('#crewsw [data-tab="' + screen + '"]');
}

module.exports = { toScreen };
