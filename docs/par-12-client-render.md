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

Guard tests: `server/src/constants/default-layers/transit.test.ts` (template
shape) and `web/src/lib/map.utils.test.ts` (degradation).
