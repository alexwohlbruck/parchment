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

/** The version of barrelman's heights the tiles are asked for, so a tile cached before they changed is not drawn with them. */
export const ELEVATION_FORMAT = 7

/** A tile url asking for the current heights. */
export function withElevationFormat(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}elevation=${ELEVATION_FORMAT}`
}

/** The heights barrelman gives a line, or none: a line without them lies on the terrain. */
export const ELEVATION_PROFILE = ['coalesce', ['get', 'elevation'], '']

/** The cycling ways barrelman states heights for. */
const CYCLING_SOURCE_LAYER = 'bicycle_ways'
/** The transit ribbons it does, tiled or copied out into GeoJSON, which keeps their heights. */
const RIBBON_SOURCE_LAYER = 'ribbons'
const RIBBON_SOURCE_PREFIX = 'portolan-build-'

/** The transit stations, stop marks and route bullets, which barrelman gives the height of their routes' ribbons. */
const STATION_SOURCE = 'portolan-stations'

const pointElevation = ['coalesce', ['get', 'elevation'], '']
const overTerrain = ['==', ['slice', pointElevation, 0, 1], '~']

/** A station's height: metres in the terrain's datum, or over the terrain after `~`; none stands on the ground. */
export const STATION_HEIGHT = ['to-number', ['case', overTerrain, ['slice', pointElevation, 1], pointElevation], 0]
export const STATION_ANCHOR = ['case', ['==', pointElevation, ''], 'ground', overTerrain, 'ground', 'absolute']

export const HEIGHT_PROPERTY = 'symbol-height-offset'
export const ANCHOR_PROPERTY = 'symbol-height-anchor'

export function raisesSymbol(layer: LineLayer): boolean {
  return layer.type === 'symbol' && layer.source === STATION_SOURCE
}

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
