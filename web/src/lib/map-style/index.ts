/**
 * Parchment's basemap style system.
 *
 * `flavors.ts` holds colour tokens, `layers.ts` the single OpenMapTiles layer
 * spec that reads them, and `build.ts` assembles a MapLibre style from the
 * two. Adding a theme means adding a flavor and nothing else.
 */
export { buildMapStyle, buildSatelliteStyle } from './build'
export type { BasemapStyleOptions } from './build'
export { flavors, getFlavor, LIGHT, DARK } from './flavors'
export type { Flavor } from './flavors'
export { buildLayers, layerGroups, SOURCE } from './layers'
export type { Detail } from './layers'

/** OpenMapTiles property names for building extrusion height. */
export const BUILDING_HEIGHT_PROPERTY = 'render_height'
export const BUILDING_MIN_HEIGHT_PROPERTY = 'render_min_height'
