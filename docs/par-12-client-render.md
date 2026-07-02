# PAR-12 v3 — client render model for bundled transit ribbons

Companion to `par-12-transit-v3-handoff.md` (§4). Covers the client half:
how the `transit_lines_rt2` features become layers, and how the two engines
diverge. Pipeline half: `../barrelman/docs/transit-pipeline-v3.md` stages 6–7.

## Source

`transit-lines` vector source → Martin function `transit_lines_rt2`
(layer name `transit_lines`, PostGIS `transit_line_segments`). Two feature
kinds:

- `kind='steady'` — junction→junction corridor pieces with a constant signed
  `offset_px` (screen px) baked per ribbon by the pipeline.
- `kind='transition'` — short (~60 m ground length) junction pieces carrying
  `off_from_px` / `off_to_px`, densified and arc-filleted. Their
  `mapbox_clip_start`/`mapbox_clip_end` are LOCAL fractions of the feature
  (continuous across tile seams), so `['line-progress']` runs 0→1 along the
  whole transition regardless of tiling.

**Sign convention:** offsets are signed in each feature's OWN travel frame
(adjacency already verified in the pipeline with a tangent-dot rule). Use the
properties raw — never recompute, flip, or re-center them client-side.

## Two-layer model

Each ribbon pass (casing + colour) is split by `kind`
(`server/src/constants/default-layers/transit.ts`):

| layer | filter | line-offset |
|---|---|---|
| `transit-lines-casing-steady`, `transit-lines-steady` | `['==',['get','kind'],'steady']` | `['get','offset_px']` |
| `transit-lines-casing-transition`, `transit-lines-transition` | `['==',['get','kind'],'transition']` | `['interpolate',['cubic-bezier',0.4,0,0.6,1],['line-progress'],0,['get','off_from_px'],1,['get','off_to_px']]` |

Colours, widths, emissive, slot, group and `metadata.transitRole` are
identical across the steady/transition pair of each pass. `line-offset` is in
screen px, so the on-screen gap is constant at every zoom on both kinds.

## Engine degradation

The transition expression (line-progress inside line-offset) is valid ONLY on
the local MapLibre fork (`transit/variable-line-offset` — per-vertex offsets
via an ext buffer attribute). Degradation rule:

- **MapLibre fork** — full fidelity; the template expression reaches the
  engine untouched.
- **Stock MapLibre** — `mapboxLayerToMaplibreLayer` (web/src/lib/map.utils.ts)
  substitutes the constant `['get','off_from_px']` when
  `MAPLIBRE_SUPPORTS_PROGRESS_OFFSET` is false. That flag is the compile-time
  `__MAPLIBRE_FORK__` Vite define — set from the same check that installs the
  fork alias in `web/vite.config.ts`, so the alias IS the capability signal.
- **Mapbox GL** — always substituted (`degradeProgressLineOffset` in the
  Mapbox strategy's `addLayer`).

The substitution is the approved "step" effect: each transition piece holds
its from-offset, steady corridors stay perfectly parallel; junctions just
step instead of easing. It is NOT the rejected v2 taper (no collapse to the
centreline, no fraction-of-feature zones) — that code was never ported.

## Route bullets

`transit-lines-bullets` still rides the LOOM-baked `transit_lines_zoom`
tiles, which are geometrically inconsistent with the v3 ribbons. The template
is kept but disabled (`visible: false` plus a never-matching
`['boolean', false]` filter, since bulk transit toggles re-enable visibility).
A v3 bullet carrier is a follow-up.

## Interactions (phases A–C)

**Hover/click wiring (A).** One map-level listener set per map instance
(`addTransitLineInteractions`,
web/src/services/layers/features/transit-layers.service.ts), not per-layer
delegates. Hit layers are discovered from the live style by
`metadata.transitRole` (`routes`/`hover` line layers, `stops` circle layers);
mousemove stashes the cursor and a rAF-throttled `queryRenderedFeatures`
resolves hover — feature-state `{hover:true}` drives a width bump on the
bundled ribbons and the `transit-routes-hover`/`transit-routes-ferry-hover`
halo on the rest. `metadata.hitMinZoom` keeps opacity-ramped layers (buses)
out of hit testing while invisible. Clicks yield to basemap POIs, street
imagery dots and DOM markers.

**Click-through (B).** Clicks land on Parchment's own GTFS id space
(Barrelman) — never the transitland place provider. Feature→candidate logic
is pure and unit-tested (web/src/lib/transit-route-candidates.ts,
transit-stop-candidates.ts); bundled ribbons expand their comma-separated
`route_ids` into one candidate per route. Destinations:
`/transit/route/:feedId/:routeId`, `/transit/stop/:feedId/:stopId`, and
`/transit/station/:lat/:lng` for the clustered station markers. Exactly one
candidate navigates directly; several open `TransitLinePopover`
(ResponsivePopover anchored at the click — popover on desktop, bottom sheet
on mobile) listing stops above routes (RouteBullet + name).

**Mode filter (C).** Every transit display layer carries
`metadata.transitMode: 'rail'|'bus'|'ferry'` (one mode per layer — the
templates split the old not-bus filter, giving ferries their own
casing/line/hover/label layers over `transit_routes`). Rail/bus/ferry chips
in LayersSelector show while the transit group is on; a chip flips visibility
of just its mode's layers through the standard per-layer override map
(`parchment-layer-visibility`), so mode choices persist with no extra
storage and default to all-on. Chip state is derived (mode on ⇔ any of its
layers visible); the group master toggle keeps working and re-enables every
mode. The DOM station markers follow the rail chip via the
`transit-stations-query` layer: a `styledata`-debounced refresh in
TransitStationsLayer re-runs the query, which returns nothing while the
layer is hidden. Basemap fade + native transit label suppression track
"any transit layer still visible", so switching the last mode off behaves
like switching transit off.

Guard tests: `server/src/constants/default-layers/transit.test.ts` (template
shape + mode partition), `web/src/lib/map.utils.test.ts` (degradation),
`web/src/lib/transit.utils.test.ts` (mode→layers mapping) and
`web/src/lib/transit-route-candidates.test.ts` /
`transit-stop-candidates.test.ts` (click candidates).
