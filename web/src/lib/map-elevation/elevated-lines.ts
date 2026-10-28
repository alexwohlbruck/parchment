/**
 * Barrelman's overlay lines, raised onto the bridge decks and sunk into the
 * tunnels they run on while the map is drawn in 3D. Barrelman states each
 * line's heights over the terrain in its tiles; MapLibre draws a line with a
 * profile off the ground rather than draped over it.
 */

/** The MapLibre fork's properties, which the style spec's types do not list. */
export const PROFILE_PROPERTY = 'line-elevation-profile'
export const OCCLUSION_PROPERTY = 'line-depth-occlusion-factor'
export const PITCH_PROPERTY = 'line-pitch-alignment'

/** The heights barrelman gives a line, or none: a line without them lies on the terrain. */
export const ELEVATION_PROFILE = ['coalesce', ['get', 'elevation'], '']

/** The cycling ways barrelman states heights for. */
const CYCLING_SOURCE_LAYER = 'bicycle_ways'
/** The transit ribbons it does, tiled or copied out into GeoJSON, which keeps their heights. */
const RIBBON_SOURCE_LAYER = 'ribbons'
const RIBBON_SOURCE_PREFIX = 'portolan-build-'

/** The dimmed copy a ribbon draws over whatever hides it: it must not be hidden itself. */
const SEE_THROUGH_SUFFIX = '-ghost'

interface LineLayer {
  id: string
  type: string
  source?: string
  sourceLayer?: string
}

const isRibbon = (layer: LineLayer) => layer.sourceLayer === RIBBON_SOURCE_LAYER || !!layer.source?.startsWith(RIBBON_SOURCE_PREFIX)

export function elevatesLine(layer: LineLayer): boolean {
  return layer.type === 'line' && (layer.sourceLayer === CYCLING_SOURCE_LAYER || isRibbon(layer))
}

/** A ribbon keeps its width and its place beside the others however far the map tilts; a cycling mark narrows with the road it paints. */
export function holdsWidth(layer: LineLayer): boolean {
  return layer.type === 'line' && isRibbon(layer)
}

export function seesThrough(layer: LineLayer): boolean {
  return layer.id.endsWith(SEE_THROUGH_SUFFIX)
}
