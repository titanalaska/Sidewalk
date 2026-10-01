# Sidewalk Snow App: Site Maps (sub-project 2 of 5)

**Owner:** Matt Walsh, Nursery & Field Operations Manager, Titan Alaska
**Date:** 2026-09-30
**Status:** design approved in conversation; this written spec awaits Matt's review
**Builds on:** `2026-09-30-foundation-design.md` (live at titanalaska.github.io/Sidewalk/)

## Purpose

This replaces the shared three-ring binder. Every site's map goes onto every
crew phone, showing which walks to clear, which are heated, which must never
be touched, and what goes first. The zones drawn here are what crews tap in
sub-project 3 (the shift log) to mark Cleared / Treated / Problem.

## What exists today (found 9/30/26)

Trello board **Snow Sidewalk Operations** has one "Route Sheet & Maps" PDF per
route. Local copies are in `C:\Users\skull\Downloads`.

- **11 routes:** Day Route 1–2 (fire stations, 2-man), ANTHC Sidewalk 1–2,
  JBER Sidewalk, and Night Routes 1–6.
- **56 map pages, about 54 sites.** Page 1 of each PDF is the paper route sheet.
  Every later page is one site: an aerial photo with zones drawn on it, plus
  the site name and address.
- **Colour legend (Matt, 9/30/26):**
  - **orange** = sidewalk
  - **green** = parking lot
  - **red** = heated sidewalk (mostly ANTHC)
  - **blue** = do not touch (e.g. the ANTHC skiing trail: "DO NOT REMOVE ANY
    SNOW OR INSTALL ANY GRAVEL ON SKIING TRAIL")
  - Arrows and the snow-pile circle are plow-crew instructions.
- **Known gaps:**
  - The JBER pages are images with no text layer, so their site names come
    from OCR or from Matt.
  - Night Routes 3–5 are the **2023-24** sheets. Matt confirms whether they
    are still current.
  - ANTHC 1's "DO NOT TOUCH" page is a second view of HCB & COB, not a new site.

## Decisions (Matt, 9/30/26)

| Question | Decision |
|---|---|
| Green parking lots on the sidewalk crew's map | **Hidden.** Not drawn at all; they are the plow crew's. |
| Red heated walks | **Check only, never melt.** Crew log Checked / Problem, and the app never offers Treated on a heated zone. |
| Map base | **Both:** live aerial imagery is the real map, with the old PDF page shown beside it as a tracing reference. |
| Who draws | **Only Matt** (admin). Leads and crew view. |
| Priority | **A flag** on a zone: priority (do first) or normal. No numbered order. |

## Approach: move Bootprint's map pieces in

Bootprint (`Yard-Measure-repo`) already does this job: MapLibre, Anchorage
aerial tiles, drawing a shape by tapping its corners with pin lock and undo,
and area maths verified by 32 tests that feed real bids. Those pieces move into
the snow app. A snow-specific zone editor is built on top.

- **MapLibre GL:** vendored, the same version as Bootprint, loaded from the
  repo with no CDN.
- **Imagery:**
  - **Primary:** the Municipality of Anchorage aerial tiles. Latest year
    (2024); covers the Bowl, Eagle River and Girdwood; cached to z21.
  - **Fallback:** Esri World Imagery, for anything MOA doesn't cover.
  - The stacking is the same as Bootprint's (MOA's 404 tiles fall through to
    Esri). Source: memory `reference_alaska_aerial_imagery_services`.
- **Geometry:** `lib/geo.js`, with Bootprint's `polyArea` / `calcAreaSqm`
  family moved over as-is, along with their tests.
- **Rejected:**
  - Drawing in Bootprint and importing the export: two apps for one job, and
    Bootprint's library is phone-only.
  - A generic off-the-shelf drawing library: it throws away the field-tested
    pin handling and the verified area maths.

## Data

### New `Zones` tab: one row per zone, the same record shape as the other tabs

`ID | Name | Rev | Archived | UpdatedAt | Json`. The Json holds:

| Field | Notes |
|---|---|
| `site_id` | Must be an existing site |
| `type` | **Allow-list:** `sidewalk` (orange), `heated` (red), `no_touch` (blue). Anything else is refused. |
| `name` | e.g. "Main entry", "East walk". Required. |
| `priority` | `true` / `false`. Ships `false`, and Matt sets it. |
| `note` | Optional. Shown to the crew in full. |
| `ring` | Outline corners as `[[lng, lat], …]`, at least 3 points. Closed implicitly. |
| `area_sqft` | Computed on save with `geo.js`. Display only; never typed. |

The cell limit is 50,000 characters. A 40-corner zone is about 1,600 characters.

### Site gains

- `map`: `{center: [lng, lat], zoom}`, set by Matt in the editor.
- `materials_needed`: text from the route sheet (e.g. "1 bag IceMelt", "Gravel
  as needed"), shown to the crew. **Planned** material only; what was actually
  used is logged in sub-project 3.

### Backend actions (admin-only writes, every read signed in)

| Action | Who |
|---|---|
| `getZones` (optionally per `site_id`) | any role |
| `saveZone`, `archiveZone` | admin |

`bootstrap` also returns `zones`. Zones carry nothing private, so every
signed-in role gets the same zone fields.

## Screens

### Matt's map editor (admin; laptop or phone)

1. Open a site and choose **Map**. The aerial view opens at the site's saved
   view, or at its address on first open: the backend geocodes nothing, so
   Matt pans there once and taps **Save view**.
2. **Reference picture:** the "Show old map" button picks an image file from
   this device, such as the matching PDF page. It shows beside the map on a
   laptop and as a swipe-up panel on a phone.
   - **The picture is never uploaded or stored.** It exists only on Matt's
     screen while he traces.
   - Claude pre-renders every route PDF's map pages to PNG files named
     `<Route> - <Site>.png` in one folder, so they're easy to pick.
3. **Draw a zone:**
   - Tap the corners. Pin lock and undo work as in Bootprint.
   - Choose **Sidewalk / Heated / Do not touch** (orange / red / blue).
   - Tick **Priority** if needed, type a name and an optional note, then **Save**.
4. **Edit a zone:** tap it, then move corners, change any field, or Archive it.

### Crew and lead map view

- From a route or site, open **Map**.
- Zones are drawn in their colours, with a ★ on priority zones. A legend sits
  in the corner (orange sidewalk, red heated: check only, blue do not touch).
- The site card shows materials needed and site notes.
- **Tapping a zone shows its name, type, priority, note and area.** Logging
  progress on it is sub-project 3. That screen will offer **Checked / Problem
  only on heated zones**, and **nothing on no_touch zones**.
- The map opens on the saved view, and pinch-zoom works as in Bootprint.

## Importing the 11 routes (no typing)

- Claude extracts each route's sites, **in order**, with names and addresses,
  from the PDFs. JBER uses OCR, and Matt fixes anything that comes out wrong.
- **Matt reviews the list before anything is written.** Then it ships as a
  one-time `seedRoutes()` function in the backend. Matt runs it once from the
  editor, the same as `setup`.
- **Idempotent:** a site or route whose name already exists is skipped, never
  duplicated. Running it twice does nothing the second time.
- Site names are cleaned up as they're extracted: the PDFs' en dashes and
  broken ligatures ("JusƟn" → "Justin") are fixed.
- Maps are **not** imported. Every site's zones are drawn once by Matt.

## Error handling

- **Imagery tiles fail** (signal, MOA down): the map shows the zones on a plain
  background with "Aerial photo unavailable". Zones never depend on the
  imagery loading.
- **A zone with fewer than 3 corners, or that crosses itself:** refused on
  save, with the reason. Bootprint's existing self-intersection check moves
  over.
- **A site with no zones yet:** the crew see "Map not drawn yet", never an
  empty map that looks complete.
- Saves use the existing revision, conflict and double-tap rules from the
  Foundation.

## Testing

- **`geo.js`:** Bootprint's area and geometry tests move over unchanged.
  Expected values stay as Bootprint worked them out by hand.
- **Backend:**
  - the zone type allow-list (a planted `parking_lot` is refused);
  - `site_id` must exist;
  - fewer than 3 corners is refused;
  - only admin writes;
  - `area_sqft` is computed by the server, so a client-sent value is ignored;
  - `seedRoutes` is idempotent: run it twice and the row counts are unchanged.
- **Phone:**
  - the crew map draws each type in its colour, shows the ★, and shows the
    legend;
  - a site with no zones says so;
  - the editor saves a drawn zone with its corners;
  - the reference picture is never sent to the backend (asserted on every
    request body);
  - imagery failure still shows the zones.
- `verify-tests` mutations:
  - widen the zone type list;
  - accept a 2-corner zone;
  - trust a client-sent area;
  - make `seedRoutes` append duplicates.

## Out of scope

- Zone logging (Cleared / Treated / Problem), equipment hours, materials used,
  and snow depth. **Sub-project 3**, which takes over the paper route sheet's
  fields.
- Parking lots, plow arrows and snow-pile markers.
- GPS "you are here". The zones are GPS-ready, but this sub-project doesn't
  show position.
- Storing the old PDF pictures anywhere.

## Open items

- Whether Night Routes 3–5 (2023-24 sheets) are current.
- JBER site names, if OCR can't read them.
- `materials_needed` per site: extracted from the route sheets' page 1 where
  it's readable (text layer on 7 of 11), typed by Matt otherwise.
