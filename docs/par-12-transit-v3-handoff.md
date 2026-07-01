# PAR-12 Transit layer — v3 handoff (fresh start)

You are picking up Parchment's transit map (Linear **PAR-12 "Transit layer"**) after
two prior attempts. This document is the complete handoff: what the goal is, what
was built and proven, exactly why the last attempt was rejected, and the design
constraints a correct solution must satisfy. The prior branches are kept for
reference — **do not delete them, do not continue on them.** Work on this branch
(`par-12-transit-v3`, from `main`) and a fresh barrelman branch.

---

## 0. Read these before writing any code

1. **Linear PAR-12** (`get_issue PAR-12` via the Linear MCP) — the requirements,
   Apple/Google/Transit case studies at the Chicago Loop, and the key constraint:
   *"In a perfect world we can cut out holes where the junctions are and connect
   the lines back with smooth curves… Then no matter the zoom level the lines stay
   equidistant and uniform."* Also: *"It is crucial that the solution … not only
   works on web, but on Mapbox/Maplibre mobile client sdks as well."* (Parchment is
   Vue + Vite + **Tauri v2** — the same JS bundle IS the mobile map engine, so a
   maplibre-gl-js solution covers mobile. There is no native SDK in play today.)
2. **Transit app blog** — the method to emulate:
   - https://blog.transitapp.com/how-we-built-the-worlds-prettiest-auto-generated-transit-maps-12d0c6fa502f/
     Pixel skeletonization to find shared segments; **ILP line ordering** (penalize
     crossings globally, ~0.2 s after optimization); junctions rounded with
     **circular arcs** ("any line parallel to a circle arc is itself a circle
     arc"), **minimum radius ≥ total width of the parallel lines**, so lines "fall
     sharply into circular arc segments" and link up across segments.
   - https://blog.transitapp.com/transit-maps-apple-vs-google-vs-us-cb3d7cd2c362/
3. **`../barrelman/docs/transit-pipeline-v2-prompt.md`** — the from-scratch
   geometry-pipeline plan (raster-skeleton replacement for LOOM/pfaedle), written
   after LOOM's Tower 18 over-merge. Its §7 "hard lessons" all still apply.
4. **This document**, especially §3 (why v2 was rejected) and §4 (design
   constraints).

---

## 1. The goal, in the user's own acceptance language

- Interlined routes render as **parallel ribbons with a constant on-screen gap at
  every zoom** (no breathing between tile zoom levels — LOOM's demo "off by one
  zoom" bug was a 256px-vs-512px constant; correct is `78271.51696/2^z` m/px).
- **"The line offset transition should only happen at junctions where the routes
  join or leave the centerline."** (User, verbatim, rejecting v2.) On a steady
  corridor the ribbons are perfectly parallel — no pinching, no drifting.
- At a junction where a route joins/leaves, ribbons transition smoothly (Apple:
  curve radii "smooth and continuous"; Transit: circular-arc fillets).
- Line order within a bundle is **stable along the corridor** (no braiding) and
  chosen to minimize crossings at junctions.
- **Mode separation:** rail merges with rail (subway + elevated share centerlines
  when tracks run parallel close enough), but rail / bus / ferry are separate
  systems. (User, verbatim: "dont separate subway vs elevated, they are the same
  transit type… we SHOULD separate rail from busses from ferries.")
- Station route attribution reflects **regular weekday-daytime service** (the 2
  never shows at Christopher St; Kingston Av shows 2/3/4, not the lone AM-rush 5).
- Routes/stops clickable; mode filter; dark mode; works on Mapbox (graceful
  degradation OK) and MapLibre (full fidelity).
- **The Chicago Loop is the exam** (feed 29, CTA L): clean rectangle, 5–6-line
  bundles per leg, Blue (Dearborn) and Red (State) subways running through the
  interior WITHOUT merging into the elevated at Tower 18, and junction
  transitions only where lines actually enter/leave the Loop.

---

## 2. What exists and is PROVEN — reuse these assets

### 2a. MapLibre fork with variable line-offset (the big one)
`/Users/alexwohlbruck/Documents/code/maplibre-gl-js`, branch
`transit/variable-line-offset` (from v4.7.1). `line-offset` accepts a
`["line-progress"]` expression, evaluated **per vertex** at tile-build time and fed
to the shader via a new `a_line_offset` ext-buffer attribute. Verified end-to-end:
standalone test page AND live in Parchment on real MVT tiles.

- Implementation: `line_attributes_ext.ts` (3rd ext component),
  `line_bucket.ts` (detects progress-driven offset, evaluates
  `expr.evaluate({zoom, lineProgress: uvX}, feature)` per half-vertex — note:
  **feature properties ARE available** in the expression, so `['get', …]` works),
  `line_variable_offset.vertex.glsl`, program variant `lineVariableOffset`.
- **Gotchas (each cost real time):**
  - Shader attrs must be declared `in float a_line_offset` — **never `highp`**;
    the shaders.ts codegen regex captures 2 words and would register the attr as
    "float", silently unbound → renders straight. There's a regression test.
  - After editing `.glsl`: `npm run generate-shaders && npm run
    generate-struct-arrays && npm run build-dist`. (`npm install
    --ignore-scripts`; the `canvas` dep is render-test-only.)
  - The style-spec patch (allow `line-progress` in `line-offset`) lives only in
    the fork's `node_modules/@maplibre/maplibre-gl-style-spec` (src + dist) —
    **lost on reinstall**. Durability TODO: patch-package or fork the spec repo.
  - GeoJSON test sources need `tolerance: 0` or geojson-vt simplification deletes
    collinear vertices and hides the effect.
- Parchment consumes it via a Vite alias in `web/vite.config.ts` (`MAPLIBRE_FORK`
  env-gated), `optimizeDeps.exclude`. See parchment branch `par-12-offset-baked`,
  commit `c1944e25`.
- `line-progress` on MVT requires `mapbox_clip_start` / `mapbox_clip_end` feature
  properties (numbers 0..1). We proved you can compute them **in the Martin tile
  function** with `ST_LineLocatePoint(parent_line, ST_StartPoint/EndPoint(part))`
  — continuous across tile seams. Normalize direction (`ST_Reverse` +
  LEAST/GREATEST) since `ST_Intersection` doesn't guarantee orientation. See
  `../barrelman/import/create-transit-lines-runtime.sql` on barrelman branch
  `par-12-offset-baked`.

### 2b. Runtime constant-pixel offsets work on BOTH engines
`line-offset` is in screen px, so `(slot - (line_count-1)/2) * GAP_PX` on a shared
centerline gives a constant on-screen gap at every zoom with zero per-zoom baking,
on stock Mapbox AND MapLibre. This part of v2 looked correct and is the right
baseline. (4.4 px gap felt right at CTA/NYC densities.)

### 2c. Zoom-baked offset tiles (fallback path)
`../barrelman/import/create-transit-lines-offset-zoom.sql` +
Martin function `transit_lines_zoom(z,x,y)`: per-integer-zoom `ST_OffsetCurve`
at `(slot-(line_count-1)/2) * 4.4px * (78271.51696/2^z)`, Chaikin-smoothed
(`ST_ChaikinSmoothing(geom, 2, true)` — endpoints preserved). Fully portable
(plain MVT, native SDKs someday); gap breathes between integer zooms. Keep as the
Mapbox/degraded fallback and for the along-line **route bullets** (symbol layers
cannot be perpendicular-offset — they must ride pre-offset geometry).

### 2d. Everything around the lines (done, keep)
- Custom HTML station markers + screen-space declutter
  (`web/src/components/map/layers/TransitStationMarker.vue`,
  `transit-stations-layer.ts`), entrance/elevator/stair SDF glyphs, salmon station
  areas, `top` slot on Mapbox.
- Service-based station route attribution (`gtfs_stop_routes.weekday_trips ≥ 2`,
  weekday-daytime filter, `route_id` fallback for CTA's blank short names;
  streaming derivation in `../barrelman/import/derive-rail-stop-routes.ts`).
- Dev tile freshness: Martin `cache_size_mb: 0`, parchment proxy returns
  `no-store` in dev. Chicago region + CTA feeds configured; LOOM build script
  `../barrelman/scripts/build-transit-graph.sh` (topo `-d 20`).
- Dev conveniences: `localStorage['dev-force-maplibre']='1'` pins the MapLibre
  engine past the Mapbox premium gate (`web/src/services/map.service.ts`);
  `window.__map` debug hook in both strategies; sign-in via OTP from server logs.

---

## 3. Why v2 was REJECTED (this is the heart of the handoff)

v2 rendered the runtime offset from shared centerlines and multiplied it by a
`line-progress` taper: `['interpolate',['linear'],['line-progress'],
0,0, 0.15,1, 0.85,1, 1,0]`. On screen, ribbons **collapsed to the centerline and
fanned back out at seemingly random mid-route spots** — nowhere near actual
junctions. User: "not really sure what's going on here… you can see them all
joining into the center and back out at random spots on the route."

Three compounding root causes — all data-model, none rendering:

1. **Run boundaries ≠ junctions.** Features were built by merging LOOM edges
   grouped by `(build_key, color_key, slot, line_count)` and dumping
   `ST_LineMerge` parts. But **LOOM assigns slots per edge** (its crossing
   minimization reorders lines edge-to-edge), so a line's slot flips between
   adjacent edges mid-corridor. Every flip ends a merged run. Measured on the
   built data: Chicago's Pink (`f9461c`) occupied **4 different slots across 10
   separate runs** within the same 5-line bundle; runs as short as **21 m**.
   Each run's progress-0 and progress-1 fell at those arbitrary cut points → the
   taper pinched there. `ST_LineMerge` also splits at any degree-3 node of the
   group, adding more arbitrary endpoints.
2. **Fraction-based taper zones scale with run length.** 15% of a 5 km run is a
   750 m drift; 15% of a 100 m run means it never reaches full offset. Transition
   zones must be **fixed ground distance** (or fixed px at the target zoom),
   never a fraction of an arbitrary-length feature.
3. **Taper-to-zero is semantically wrong.** Where the bundle *continues*
   (composition unchanged across a boundary), the correct transition is **no
   transition**. Where composition changes, a continuing line moves **from its
   old slot offset to its new slot offset** (often a shift of half a gap), not to
   0. Collapse-to-centerline is only right where a line genuinely leaves the
   bundle or at a terminus.

A useful corollary discovered while debugging: taper-per-connected-part is fine
*only if* part boundaries are semantic (real joins/leaves). The SQL grouping gave
no such guarantee. **Fix the data model, not the expression.**

---

## 4. Design constraints for v3 (and a recommended shape)

Hard constraints any design must satisfy:

- **C1.** Offsets transition **only** at nodes where bundle membership or slot
  assignment changes. Steady corridors are perfectly parallel.
- **C2.** Slot assignment is **stable along a corridor**: propagate each line's
  slot through nodes; permit changes only at composition-change junctions, chosen
  to minimize crossings (Transit does this with a global ILP; LOOM's per-edge
  output must be post-smoothed or replaced — see pipeline-v2 doc).
- **C3.** Transition zones have **fixed ground length** (start ~40–80 m, tunable;
  Transit's minimum-radius rule: fillet radius ≥ total bundle width) centered on
  the junction node, and each transitioning line knows its **from-offset and
  to-offset** in pixels.
- **C4.** Constant on-screen gap across zoom (runtime px offset — §2b) on the
  steady segments; both engines.
- **C5.** Mapbox (no fork) degrades gracefully: constant offsets everywhere
  (steady value on steady segments; from- or to-offset on transition segments) or
  falls back to the baked tiles. MapLibre + fork gets the smooth junctions.

Recommended shape (validated primitives, not yet assembled — you have design
freedom here, but every piece below was individually proven this session):

1. **Segment the graph** per mode into *steady segments* (junction→junction,
   composition constant, slots constant) and *transition segments* (short,
   fixed-length, straddling a junction node). Do this in the pipeline (walk the
   LOOM graph — `transit_graph_edges`/`edge_lines` — or the pipeline-v2
   replacement), NOT with SQL GROUP BY over styling attributes.
2. **Emit per-line features** with properties:
   - steady: `offset_px` (or slot + line_count; constant),
   - transition: `off_from_px`, `off_to_px`.
3. **Local line-progress trick:** for transition features, emit
   `mapbox_clip_start`/`end` as the *local* fraction of the FEATURE (0..1 across
   the whole feature; per-tile parts get their sub-range via `ST_LineLocatePoint`
   against the feature — the machinery in `create-transit-lines-runtime.sql`
   already does exactly this, just pointed at run geometry instead of feature
   geometry). Then the offset expression is simply:
   `['interpolate', ['cubic-bezier', .4, 0, .6, 1], ['line-progress'],
      0, ['get','off_from_px'], 1, ['get','off_to_px']]`
   — the fork evaluates this per vertex **with feature context**, so `get` works.
   Densify transition geometry (`ST_Segmentize` ~5–10 m) so the curve has
   vertices to bend through.
4. **Steady segments** use plain constant `line-offset` (both engines, no fork
   needed). This confines fork-dependence to the short junction pieces.
5. Junction interior geometry: Chaikin or arc-fillet the centerline at the node
   (min radius ≥ bundle width) so the offset ribbons inherit smooth curvature.

Alternative worth keeping in mind if per-feature segmentation gets gnarly: bake
the junction transitions **into geometry** per zoom (extend the zoom-baked
pipeline with arc fillets and per-line junction paths) and keep runtime offsets
only for steady segments. More SQL, zero fork-dependence at junctions.

---

## 5. Practical setup (environment, branches, workflow)

- **Repos/branches to reference (do not delete, do not extend):**
  - parchment `par-12-offset-baked` — all client work (layer templates, markers,
    taper attempt in `maplibre.strategy.ts` `applyTransitOffsetTaper` — the part
    that was rejected), Vite fork alias, dev-force-maplibre.
  - barrelman `par-12-offset-baked` — `create-transit-lines-runtime.sql`
    (runtime source + clip fractions), `create-transit-lines-offset-zoom.sql`
    (baked), stations SQL, martin-config, region/feed setup.
    (`par-12-transit-pipeline` is an earlier pipeline branch.)
  - maplibre-gl-js `transit/variable-line-offset` — the fork; committed clean
    through `2d2fa4b` (highp fix + regression tests). `PORT-variable-line-offset.md`
    in its root documents the port.
- **Sacred workflow rules:** do NOT start dev servers (user runs 5173/5000;
  barrelman 5001, Martin 5002, docker). `bun`, not npm, in parchment/barrelman
  (the fork uses npm). Feature branches; never merge to main. Short commit
  messages (5–20 words), distinct logical commits. No uppercase tracking-wider UI
  text.
- **DB:** barrelman-db in docker, `psql -U barrelman -d barrelman` via
  `docker exec -i barrelman-db …` (host port 5434). Transit graph tables:
  `transit_graph_nodes/edges/edge_lines` (LOOM load), `gtfs_*` (importer).
  Martin function sources registered in `../barrelman/martin-config.yaml`
  (`docker restart barrelman-martin` after config edits; SQL function
  replacement is picked up live).
- **Tile freshness in dev** is already solved (no-store proxy + cache_size 0);
  if the client shows stale sources, clear
  `localStorage['parchment-default-templates']` — but note the layer/group
  **visibility** keys are separate; don't wipe `parchment-layer-visibility`
  (that resets the user's toggles — learned the hard way).
- Verify visually at the Loop: `window.__map.jumpTo({center:[-87.6305,41.8845],
  zoom:15.2})`; query tiles with `querySourceFeatures`; the fork accepts
  `setPaintProperty` with line-progress expressions for live experiments.

## 6. Suggested milestones

1. **Slot stability:** post-process (or replace) LOOM output so each line's slot
   is constant along corridors, changing only at composition-change nodes.
   Measure: zero (color, line_count) groups with >1 slot on a steady corridor.
2. **Graph segmentation:** steady vs transition segments with from/to offsets;
   load into PostGIS; unit-check the Loop's junction list matches reality (lines
   enter/leave the Loop at Tower 18, Tower 12, State/Lake area, etc.).
3. **Tiles:** Martin function emitting per-line features + local clip fractions.
4. **Render:** constant offsets (both engines) + fork-powered junction
   interpolation on MapLibre. A/B screenshot the Loop against Apple.
5. **NYC regression** (Broadway trunk, DeKalb junction), then labels/bullets on
   the new geometry, then the Loop exam sign-off.

Good luck. The fork was the hard unlock and it works — v3 is a data-model
problem, not a renderer problem.
