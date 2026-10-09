/**
 * Lane-level roads at street zoom, from barrelman's road geometry: carriageways
 * at their real width with rounded kerb corners, lane and edge lines, stop
 * lines, crosswalks, and turn arrows and bike symbols from the sprite.
 *
 * The basemap's own roads fade to the same asphalt underneath, so against a
 * barrelman without this geometry a street still draws, only unpainted.
 */
import type { FlavorId } from './build'
import { DETAIL_SOURCE } from './detail-layers'

export const ROAD_SURFACE_TILES = 'road_surfaces'
export const ROAD_MARKING_TILES = 'road_markings'
export const ROAD_GLYPH_TILES = 'road_glyphs'

/** Where the basemap hands roads over to the lane geometry. */
const FROM = 16
const TO = 17

const COLORS: Record<FlavorId, { asphalt: string; white: string; yellow: string; green: string; red: string }> = {
  light: { asphalt: 'hsl(36, 4%, 70%)', white: 'hsl(40, 30%, 98%)', yellow: 'hsl(43, 72%, 60%)', green: 'hsl(148, 26%, 60%)', red: 'hsl(9, 42%, 62%)' },
  dark: { asphalt: 'hsl(222, 5%, 25%)', white: 'hsla(40, 10%, 80%, 0.7)', yellow: 'hsla(43, 50%, 52%, 0.75)', green: 'hsl(148, 20%, 33%)', red: 'hsl(9, 26%, 33%)' },
}

/** Pixels for a length in metres, at mid-US latitudes, exact enough for paint. */
export function metres(m: number, minimum = 0): any {
  const at = (z: number) => Math.max(minimum, (m * 2 ** z) / 63330)
  return ['interpolate', ['exponential', 2], ['zoom'], FROM, at(FROM), 22, at(22)]
}

const fadeIn = (from: number) => ['interpolate', ['linear'], ['zoom'], from, 0, from + 0.6, 1]

/** The basemap's at-grade and bridge road fills and casings. */
const ROAD_FILLS = ['Minor road', 'Major road', 'Highway', 'Minor road bridge', 'Major road bridge', 'Highway bridge']
const ROAD_CASINGS = ['Minor road outline', 'Major road outline', 'Highway outline', 'Minor road outline bridge', 'Major road outline bridge', 'Highway outline bridge']

/**
 * Turn the basemap's roads to asphalt and drop their casings over the hand-off,
 * so the true-width carriageways read as the same road.
 */
export function asphaltRoads(layers: any[], flavor: FlavorId): any[] {
  const asphalt = COLORS[flavor].asphalt
  return layers.map(layer => {
    if (ROAD_FILLS.includes(layer.id) && typeof layer.paint?.['line-color'] !== 'object') {
      const color = layer.paint['line-color']
      return { ...layer, paint: { ...layer.paint, 'line-color': ['interpolate', ['linear'], ['zoom'], FROM, color, TO, asphalt] } }
    }
    if (ROAD_CASINGS.includes(layer.id) && typeof (layer.paint?.['line-opacity'] ?? 1) === 'number') {
      const opacity = layer.paint?.['line-opacity'] ?? 1
      return { ...layer, paint: { ...layer.paint, 'line-opacity': ['interpolate', ['linear'], ['zoom'], FROM, opacity, TO, 0] } }
    }
    return layer
  })
}

/** One band of lane geometry: at grade, or on bridges. */
export function roadMarkingLayers(flavor: FlavorId, bridge: boolean): any[] {
  const c = COLORS[flavor]
  const band = ['==', ['coalesce', ['get', 'bridge'], false], bridge]
  const suffix = bridge ? ' bridge' : ''
  const paint = ['match', ['get', 'color'], 'yellow', c.yellow, c.white]
  const line = (id: string, filter: any[], width: number, extra: Record<string, any> = {}, layout: Record<string, any> = {}) => ({
    id: `${id}${suffix}`,
    type: 'line',
    source: DETAIL_SOURCE,
    'source-layer': ROAD_MARKING_TILES,
    minzoom: TO,
    filter: ['all', band, ...filter],
    layout: { 'line-cap': 'butt', 'line-join': 'round', ...layout },
    paint: { 'line-color': paint, 'line-width': metres(width, 0.6), 'line-opacity': fadeIn(TO), ...extra },
  })
  const kind = (k: string) => ['==', ['get', 'kind'], k]
  const pattern = (p: string) => ['==', ['get', 'pattern'], p]
  const style = (...s: string[]) => ['in', ['get', 'style'], ['literal', s]]
  const glyphScale = ['match', ['get', 'glyph'], ['road-bike', 'road-sharrow'], 0.55, 1]
  return [
    {
      id: `Road surface${suffix}`,
      type: 'fill',
      source: DETAIL_SOURCE,
      'source-layer': ROAD_SURFACE_TILES,
      minzoom: FROM,
      filter: band,
      paint: { 'fill-color': c.asphalt, 'fill-opacity': fadeIn(FROM) },
    },
    {
      id: `Road lane fill${suffix}`,
      type: 'fill',
      source: DETAIL_SOURCE,
      'source-layer': ROAD_MARKING_TILES,
      minzoom: FROM,
      filter: ['all', band, pattern('fill'), ['!=', ['get', 'color'], 'white']],
      paint: { 'fill-color': ['match', ['get', 'color'], 'red', c.red, c.green], 'fill-opacity': fadeIn(FROM) },
    },
    {
      id: `Road paint fill${suffix}`,
      type: 'fill',
      source: DETAIL_SOURCE,
      'source-layer': ROAD_MARKING_TILES,
      minzoom: TO,
      filter: ['all', band, pattern('fill'), ['==', ['get', 'color'], 'white']],
      paint: { 'fill-color': c.white, 'fill-opacity': fadeIn(TO) },
    },
    line('Road line', [['!=', ['get', 'kind'], 'crosswalk'], ['!=', ['get', 'kind'], 'stop'], pattern('solid')], 0.15),
    // Dashes are measured in line widths: on streets 3 m of paint and 6 m of
    // gap, on motorways the highway's 3 m and 9 m.
    line('Road line dashed', [pattern('dashed')], 0.12, { 'line-dasharray': [25, 50] }),
    line('Road line dashed long', [pattern('dashed_long')], 0.12, { 'line-dasharray': [25, 75] }),
    line('Road line double', [pattern('double')], 0.12, { 'line-gap-width': metres(0.15, 0.6) }),
    line('Stop line', [kind('stop'), pattern('solid')], 0.45),
    // A zebra is one wide line, dashed into bars that run with the traffic.
    line('Crosswalk zebra', [kind('crosswalk'), pattern('solid'), style('zebra', 'ladder')], 3, { 'line-dasharray': [0.2, 0.2], 'line-color': c.white }),
    line('Crosswalk lines', [kind('crosswalk'), pattern('solid'), style('lines', 'ladder')], 0.25, { 'line-gap-width': metres(3), 'line-color': c.white }),
    {
      id: `Road glyph${suffix}`,
      type: 'symbol',
      source: DETAIL_SOURCE,
      'source-layer': ROAD_GLYPH_TILES,
      minzoom: TO + 0.5,
      filter: band,
      layout: {
        'icon-image': ['get', 'glyph'],
        'icon-rotate': ['get', 'direction'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // A glyph is 40 px tall in the sprite and about 6 m on the road.
        // Bike symbols are drawn at a rider's scale, to fit inside a 1.5 m lane.
        'icon-size': ['interpolate', ['exponential', 2], ['zoom'],
          TO, ['*', glyphScale, (6 * 2 ** TO) / 63330 / 40], 22, ['*', glyphScale, (6 * 2 ** 22) / 63330 / 40]],
      },
      paint: { 'icon-color': c.white, 'icon-opacity': fadeIn(TO + 0.5) },
    },
  ]
}
