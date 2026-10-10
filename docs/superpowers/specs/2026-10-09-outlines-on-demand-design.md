# Outlines on demand: design

**Status:** design approved section by section by Matt, 10/9/26. Spec awaiting his read.
**Repos:** both halves. Backend `snow-app-script`, phone `Snow-App-repo` (this file; the repo is
PUBLIC, so this spec carries counts and sizes only, never site names or addresses).

## Why

Matt, 10/9/26: Sidewalk is getting slower as the map file grows, and **he feels it when the app
opens**. That is the sign-in call (`bootstrap`).

Measured on the live app, 10/9/26 evening, from Matt's signed-in session (backend @16 `curbs-1`):

| | Time | Size |
|---|---|---|
| Bare round trip (GET, no sign-in, no reads) | 1.0-1.5 s | tiny |
| `bootstrap` | 4.2-5.3 s | 341 KB |
| of which `zones` | | 324 KB (95%) |
| of which the outlines (`ring`) alone | | 225 KB (66%) |

480 zones, 13 corners on average. Only 1 of 55 live sites has a saved view, so 54 sites take their
forecast point and snow-map dot from an outline today.

Two fixes, two different costs:
1. **Server time** (whole-tab reads on every call): the script cache, `snow-app-script` 7d00203,
   shipped first on its own (Matt, 10/9/26).
2. **Download size** (every outline to every phone at every sign-in, and again on every Storm-tab
   refresh): **this spec.** Outlines grow with every site mapped; nothing else in the reply does.

## Matt's decisions (10/9/26)

1. The slowness that matters is opening the app.
2. Ship the server cache now, alone, then build this.
3. Tapping Map draws a **kept copy at once**, then checks quietly. The first-ever open of a site
   waits for signal. (Rejected: prefetching tonight's route at sign-in; always fetching with no copy.)
4. **Approach 1, slim on request**: new phones ask for the slim reply, phones that have not
   updated get today's reply and keep working. (Rejected: slim for everyone, which crashes an
   un-updated phone's map; rounding coordinates only, about 80 KB and still growing.)
5. Server, phone, and testing + ship order sections, each approved as presented.

## Server (`snow-app-script`)

- `bootstrap` with `slim: true`: the reply is today's, except
  - every zone **omits `ring`** (every other zone field unchanged, `area_sqft` included: the curb
    roll-up reads it, never the ring);
  - a new top-level `points`: `{ <site_id>: [lng, lat] }` for every site in the reply's `sites`
    that has a point by **today's phone rule**: the site's saved view centre (`site.map.center`,
    both finite numbers), else the centroid of the **first** zone of that site, in Zones-tab order,
    with `archived !== true` and a ring of 3+ corners. A site with neither has no entry.
    Unrounded (the phone rounds to 2 dp as it does today).
- `getZones` with `slim: true`: zones without `ring` (the Storm tab's refresh). `slim` strips
  rings whether or not `site_id` is sent; the phone never sends both.
- `getZones` with `site_id` and no `slim`: **unchanged**, rings included. This is where maps get
  their outlines.
- No `slim`: **byte-for-byte today's reply.** This is what keeps an un-updated phone working.
- `centroid(ring)` moves from `lib/mapview.js` into a **new shared `points.js`** (byte-identical on
  both halves, added to `test/geo-identity.test.js`), with the site-point rule itself
  (`sitePoint`, `pointsFor`) and the ring stripping (`slim`). `SnowMapView.centroid` stays exported
  and delegates to it, so no caller changes. *(Amended while planning, 10/9/26: the first draft put
  it in `geo.js`, but that file is copied verbatim from Bootprint and is never edited here.)*
- Nothing new is stored: points are computed per call from the cached Zones rows. No new tab, no
  new Google service, **no editor step** (no backfill run).
- `VERSION = 'outlines-1'`; the version-label mutation re-pointed in the same commit.

`points` is a separate map, never a field on each site: a site saved from Matt's form sends the
site record back, and a computed point must never be written into the Sheet as if it were data.

## Phone (`Snow-App-repo`)

- Both `bootstrap` calls (`lib/app.js`, sign-in and resume) send `slim: true` and keep
  `S.points = r.points || {}`. The Storm tab's `refreshZones` (`lib/shiftlogui.js`) sends
  `slim: true` too.
- **New `lib/outlines.js`** (`SnowOutlines`, UMD header like the other lib files, in `index.html`
  and the `sw.js` SHELL list): the kept copies.
  - localStorage key **`snow-outlines`**, named once, never renamed:
    `{ v: 1, sites: { <site_id>: { at: <iso>, rings: { <zone_id>: [[lng, lat], ...] } } } }`.
  - `keep(siteId, zones)`: replaces that site's entry with the rings of the given zones.
  - `keepOne(siteId, zone)`: one zone (an editor save).
  - `withRings(siteId, zones)`: the zones that have a kept ring, each a copy with `ring` attached.
  - `changed(siteId, zones)`: true when the fresh zones' rings differ from the kept ones (any zone
    added, gone, or with different corners).
  - `forget()`: removes the key.
  - Every read and write is in try/catch: unreadable JSON is an empty store; a full or refused
    store is a no-op. The map then draws from the download and nothing throws.
- **Outlines live only in `SnowOutlines`, never in `S.zones`.** The Storm tab's refresh replaces
  `S.zones` wholesale with slim records; anything stored inside them would be wiped.
- **Tapping Map** (`openMap` in `lib/app.js`):
  - The site's live zones (`siteZones(id)`) joined with their kept rings. If any zone has one, or
    the site has no zones, the map opens **now** with what is kept.
  - Then `getZones({ site_id })` in the background. On a reply, its zones with `archived !== true`
    (Matt's admin replies include archived ones): `keep`, and if `changed`, redraw through
    `SnowMap.setZones`. A zone with no kept ring appears when the reply lands.
  - The site has zones and none is kept: the map shows **"Loading map…"** until the reply, then
    opens.
  - No reply and nothing kept: **"This map hasn't been opened on this phone yet. It needs signal
    the first time."**
  - No reply but a copy is showing: quiet. The copy stays.
- **Matt's editor** (`lib/mapedit.js`): Edit map stays disabled until this open's `getZones`
  reply has landed (it already renders disabled until zones load), so he never edits a stale
  outline. Every save goes through `keepOne`.
- **Forecast point and snow-map dot** (`SnowWeather.point`, `SnowMapOverview.pointsFor`, phone
  only): saved view, then `S.points[site.id]`, then a kept ring's centroid. Rounded to 2 dp as
  today.
- **Sign-out** calls `SnowOutlines.forget()` beside the other sign-out clears (Matt's 9/30 rule:
  every read needs sign-in, so customer outlines do not outlive the person's session on a phone).
- `EXPECTED_BACKEND: 'outlines-1'`; `sw.js` shell bumped above whatever is live when this ships.
- Spanish ships before this, so the two new crew-facing lines get rows in the `lib/es.js`
  dictionary.

## Testing

Expected values are worked out on paper in the test comments. Each new test is seen failing
first (or its mutation caught).

**Backend:**
- slim `bootstrap`: no zone carries `ring`; every other zone field is present.
- `points` worked on a paper square: a site with a saved view gets the view centre; a site whose
  first zone is archived gets the next live zone's centroid; a site whose zones have under 3
  corners or none at all gets no entry.
- non-slim `bootstrap` deep-equals the reply built before this change (the un-updated-phone guard).
- `getZones` slim vs `site_id`.
- `verify-tests` mutations: slim flag ignored; view-before-outline swapped; archived zones
  counted; last zone instead of first; rings left in a slim reply.

**Phone node (`test/outlines.test.js`):** keep / withRings / changed / forget on paper fixtures;
a store that throws on write; unreadable JSON; the weather point order.

**Playwright (`test/outlines.spec.js`, its own small fake backend):**
- The fake answers slim only when asked, and never sends more than the real backend would.
- With a kept copy, the map draws **while the `getZones` reply is held back on purpose**.
- A changed outline in the reply redraws.
- First open shows "Loading map…", then draws.
- No signal and no copy shows the message.
- Sign-out clears `snow-outlines`.
- Full storage does not break a map open.
- The Storm tab, walk lists and curb items work with zero outlines in `S.zones`.
- Edit map stays disabled until the reply lands.

**After the deploy:** re-time `bootstrap` in the pane the same way as 10/9 (target about 115 KB
instead of 341 KB) and record it here.

## Ship order

One deploy at a time, between storms:
1. Server cache (backend only, `curbs-1` unchanged).
2. Map bug fixes (phone only).
3. Spanish (phone only, after a crew member reads the Storm tab in Spanish).
4. **Outlines** (both halves, `outlines-1`).
5. Crew cards (both halves; takes the next label on top of `outlines-1`; Matt runs `setup` for
   its Stats tab).

The outlines phone branch is built on top of the finished Spanish and map-fix branches, because
they edit the same map files (`lib/mapview.js`, `lib/mapedit.js`).

## Assumptions (decided without asking; Matt can overrule any)

| # | What | Chosen | Why |
|---|---|---|---|
| A1 | Request flag name | `slim: true` | Plain, and absent means today's reply. |
| A2 | Storage | localStorage `snow-outlines` | About 225 KB for every map; the origin's ~5 MB is shared with Inventory and Groundwork, so writes are guarded. IndexedDB is not needed at this size. |
| A3 | A partly kept site | draws what it has; the rest arrives with the reply | Better than a blank map. |
| A4 | Failed background check while a copy shows | silent | Outlines rarely change; a banner would cry wolf. |
| A5 | Wording | "Loading map…" / "This map hasn't been opened on this phone yet. It needs signal the first time." | Matt edits the words freely. |
| A6 | `points` precision | unrounded from the server | The phone already rounds to 2 dp for the NWS. |

## Out of scope

Rounding coordinates (approach 3, offered, not chosen; can be folded in later). Prefetching a
route's outlines at sign-in. Trimming other zone fields (about 99 KB of names, notes and ids).
Dropping the non-slim reply (only once no phone needs it).
