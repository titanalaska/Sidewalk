# Place from the roster: design

**Owner:** Matt Walsh. **Status:** designed by Claude alone on 10/6/26 (evening) on Matt's instruction
("Try to get all of that done"). **Not yet reviewed by Matt.** A bounded change to the Board and Roster
screens that already exist; phone only, no backend change.

## Why

Matt (10/6): "being able to use the roster directly to place workers on routes." Today placing is a
Board-tab job: tap a chip, then tap a route. The Roster tab shows the people but says nothing about
where they are, and offers no way to put them anywhere. Matt goes through the roster person by person
(adding, checking cards), so placement belongs there too.

**Success:** from any roster tile Matt sees where that person is tonight and can place, promote or
pull them in two taps, and the Board tab shows the same board afterwards.

## What changes

- **Roster tiles** (Matt's grid) carry a placement line under the name: the route name (`N1`), `N1 · lead`,
  or `Unplaced`, from the Board replayed from Moves exactly as the Board tab does. Nothing is stored.
- **The worker card** (opened from a tile) gains a **Place** row above Edit: a route picker (live routes,
  in the Board's order) and the buttons that make sense now:
  - `Place` (as a member) when a route is picked that differs from where they are;
  - `Make lead` when they are on a route and not its lead (or a route is picked: lead there);
  - `Unassign` when they are on a route.
  Each is one `addMove`, planned by `CrewBoard.planMove` like the Board's own taps (a tap that changes
  nothing writes nothing). The write goes through the Board's one-at-a-time path (`SnowBoardUI`), so a
  slow Apps Script call cannot be doubled from the roster while the Board is busy.
- **After a move:** the card closes, the roster redraws, and a toast says `Placed on N1`, `Lead on N1`
  or `Taken off the Board`. A refusal toasts the server's words and changes nothing.
- A **pending card** (roster self-service) has no Place row: they are not crew yet.
- The Board tab's `Changed since post` badge already follows Moves, so a roster placement shows there too.

## Tests

- Node: `placement(board, id, routes)` → `{route, role}` or null, and its label (`N1`, `N1 · lead`, `Unplaced`).
- Playwright (Matt): the tile under Jordan says `Unplaced`; the card's Place row lists `N1`; Place sends
  `addMove {worker: 'C03', to_route: 'R1', role: 'member', at}`; the tile then says `N1` and the Board tab shows
  Jordan's chip on N1; Make lead sends `role: 'lead'`; Unassign sends `to_route: null`; a pending card has no
  Place row; a refused move toasts and the tile is unchanged; a second tap while busy sends nothing.

## Assumptions for Matt

| # | Call made | If wrong |
|---|---|---|
| B1 | Placement lives on the worker card (tap tile → Place), not as buttons on every tile | put a Place picker on the tile itself |
| B2 | Tiles show tonight's Board, not the last Post | show both lines |
