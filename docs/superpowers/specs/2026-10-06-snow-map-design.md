# Snow map: design

**Owner:** Matt Walsh. **Status:** designed by Claude alone on 10/6/26 (evening) on Matt's instruction
("Try to get all of that done"). **Not yet reviewed by Matt.** Phone only, no backend change.
Builds on the Storm tab's live view, the NWS hint and the B2 callouts (forecast snowfall and measured depths).

## Why

Matt (10/6): "a map of Anchorage that has weather guesses for snowfall, followed by actual inputs from
sites as they come in." The pieces exist one site at a time: the NWS snowfall estimate behind the Callouts
box, the New snow readings and site-card depths the crews type. Nobody can see them together, across town.

**Success:** on the Storm tab, Matt (and the Board leads) open one map of Anchorage with a dot per site:
the dot's colour is the forecast new snow for the next 12 hours, and as crews measure, the dot gains the
measured depth, who and when. Tapping a dot says where that site stands.

## What changes

- **A Snow map card** on the live view (Matt and leads only), under the summary and above the routes, with
  a `Snow map` button that opens or closes it. Closed by default on a phone; open by default on a wide
  screen (1000 px and up). Nothing is stored.
- **The map:** MapLibre (already in the shell) over Esri's light-grey basemap (`Canvas/World_Light_Gray_Base`,
  the same host as the aerial), fitted to the sites' points. The MOA aerial is not used: a city at a glance
  wants a plain base.
- **A dot per site** that has a point (`SnowWeather.point`: the saved view's centre, else the first zone's
  centroid; a site with neither is left off and counted in the card's footer, `3 sites not mapped yet`).
  - **Colour = forecast** new snow in the next 12 h: the NWS gridpoint snowfall series summed over
    `[now, now + 12 h]` by the fraction of each period inside it (the Callouts' arithmetic). Steps:
    grey = no forecast, white = 0, light blue under 1", blue 1 to 3", dark blue 3 to 6", purple 6" and over.
    Label `~2.4"`.
  - **Measured** (an `*`-row depth reading or a site card's `depth_in` in the current storm, the newest
    wins): the label becomes `3.0" 7:12 PM Alex` in bold and the dot gets a ring. Readings arrive with
    the Storm tab's 20 s poll, so the map follows the crews.
  - **Tap a dot:** the site's name and address, `Forecast ~2.4" next 12 h`, `Measured 3.0" at 7:12 PM by Alex`
    (or `No reading yet`), and its status as the live view words it (`Done`, `Problem`, `2 of 5 walks`, `Not started`).
- **Fetching:** one NWS request per point (rounded to two decimals, so neighbours share one), at most once
  per 30 minutes, started 150 ms apart; the grid download is shared per gridpoint URL (weather.js). A failed
  answer is a grey dot, never an error on screen. Nothing leaves the phone but the rounded points.

## Tests

- Node (`lib/snowmap.js` is pure but for `open`): `pointsFor(sites, zones)`; `forecastInches(series, nowMs, 12)`
  on worked examples (a 6-hour period of 25.4 mm with 3 hours inside the window → 0.5"; no overlap → null);
  `measuredDepths(log, visits, stormId)` (newest of a Log depth row and a Visit, by seq order within each and by `at`
  across; another storm's rows ignored); `dotStep(inches)` edges (0.99 → under 1, 1 → 1 to 3, 6 → 6 and over).
- Playwright: Matt's Storm tab has the Snow map card and crew do not; opening it makes one dot per site with a
  point and footers the rest; a depth row from the fake marks its dot measured; the NWS is asked once per point and
  not again inside 30 min; a failed NWS answer leaves grey dots and nothing in `#stormerr`.

## Assumptions for Matt

| # | Call made | If wrong |
|---|---|---|
| D1 | The "guess" is the next 12 hours of forecast snowfall, one number per site | add a 6 h / 24 h switch |
| D2 | The map lives on the Storm tab, Matt and leads only | a crew copy would show only their own route's dots |
| D3 | A plain grey basemap, not the aerial | one line to swap the tile source |
| D4 | Measured depth = the newest reading in the current storm, from New snow or a site card | show both |
