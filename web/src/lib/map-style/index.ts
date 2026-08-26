/**
 * Parchment's basemap style.
 *
 * `spec.json` is MapTiler Streets v2's layer spec — same filters, ramps and
 * draw order — with colours lifted into `"@token"` references.
 * `tokens.light.json` and `tokens.dark.json` resolve them, both taken from
 * MapTiler's own Streets and Streets Dark. `build.ts` assembles the two into a
 * MapLibre style. Regenerate all three with `bun run build:style`.
 */
export {
  buildMapStyle,
  buildSatelliteStyle,
  buildLayers,
  layerGroups,
  SOURCE,
  BUILDING_HEIGHT_PROPERTY,
  BUILDING_HEIGHT_EXPRESSION,
  BUILDING_BASE_EXPRESSION,
  BUILDING_MIN_HEIGHT_PROPERTY,
} from './build'
export type {
  BasemapStyleOptions,
  FlavorId,
  PlaceCategoryId,
} from './build'
