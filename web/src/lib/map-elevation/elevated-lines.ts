/**
 * Barrelman's overlay lines, raised onto the bridge decks and sunk into the
 * tunnels they run on while the map is drawn in 3D. Barrelman states each
 * line's heights over the terrain in its tiles; MapLibre draws a line with a
 * profile off the ground rather than draped over it.
 */

/** The MapLibre fork's properties, which the style spec's types do not list. */
export const PROFILE_PROPERTY = 'line-elevation-profile'
export const OCCLUSION_PROPERTY = 'line-depth-occlusion-factor'

/** The heights barrelman gives a line, or none: a line without them lies on the terrain. */
export const ELEVATION_PROFILE = ['coalesce', ['get', 'elevation'], '']

/** The source layers barrelman states heights for: cycling ways and transit ribbons. */
const ELEVATED_SOURCE_LAYERS = new Set(['bicycle_ways', 'ribbons'])

/** Ribbons copied out of the transit tiles into GeoJSON keep their heights. */
const ELEVATED_SOURCE_PREFIX = 'portolan-build-'

/** The dimmed copy a ribbon draws over whatever hides it: it must not be hidden itself. */
const SEE_THROUGH_SUFFIX = '-ghost'

interface LineLayer {
  id: string
  type: string
  source?: string
  sourceLayer?: string
}

export function elevatesLine(layer: LineLayer): boolean {
  return layer.type === 'line' && (ELEVATED_SOURCE_LAYERS.has(layer.sourceLayer ?? '') || !!layer.source?.startsWith(ELEVATED_SOURCE_PREFIX))
}

export function seesThrough(layer: LineLayer): boolean {
  return layer.id.endsWith(SEE_THROUGH_SUFFIX)
}
