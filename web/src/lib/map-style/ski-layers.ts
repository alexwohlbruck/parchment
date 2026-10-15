/**
 * Ski areas: barrelman's `ski_features` (resort outlines, pistes, lift pylons)
 * and the basemap's own aerialways, which OpenMapTiles carries in
 * `transportation` as `class=aerialway`.
 */
import type { FlavorId } from './build'
import type { GolfLabelStyle } from './detail-layers'
import { DETAIL_SOURCE } from './detail-layers'
import { pxPerMetre } from './road-markings'

export const SKI_TILES = 'ski_features'

export const SKI_AREA_LAYER = 'Ski area'
export const PISTE_AREA_LAYER = 'Piste area'
export const PISTE_TRAIL_LAYER = 'Piste trail'
export const PISTE_LAYER = 'Piste'
export const PISTE_DASHED_LAYER = 'Piste ungroomed'
export const PISTE_DOTTED_LAYER = 'Piste dotted'
export const LIFT_LAYER = 'Lift'
export const LIFT_HALO_LAYER = 'Lift halo'
export const DRAG_LIFT_LAYER = 'Drag lift'
export const LIFT_PYLON_LAYER = 'Lift pylon'
export const PISTE_SYMBOL_LAYER = 'Piste difficulty'
export const PISTE_LABEL_LAYER = 'Piste name'
export const LIFT_LABEL_LAYER = 'Lift name'

/** The basemap layers these replace: grey dashed aerialways and the gondola-only labels. */
export const BASEMAP_AERIALWAY_LAYERS = ['Cablecar', 'Cablecar dash', 'Gondola']

const COLORS: Record<FlavorId, Record<string, string>> = {
  light: {
    green: 'hsl(145, 63%, 32%)',
    blue: 'hsl(212, 85%, 45%)',
    red: 'hsl(356, 76%, 49%)',
    black: 'hsl(222, 22%, 14%)',
    orange: 'hsl(26, 92%, 50%)',
    unknown: 'hsl(222, 8%, 56%)',
    snow: 'hsl(205, 45%, 98.5%)',
    area: 'hsl(205, 36%, 97%)',
    areaEdge: 'hsl(205, 30%, 86%)',
    lift: 'hsl(222, 12%, 42%)',
    liftHalo: 'hsla(0, 0%, 100%, 0.8)',
  },
  // Black runs turn light here: a black line disappears into a night map.
  dark: {
    green: 'hsl(145, 48%, 52%)',
    blue: 'hsl(212, 85%, 68%)',
    red: 'hsl(356, 74%, 66%)',
    black: 'hsl(0, 0%, 97%)',
    orange: 'hsl(28, 88%, 60%)',
    unknown: 'hsl(222, 8%, 62%)',
    snow: 'hsl(214, 26%, 31%)',
    area: 'hsl(214, 30%, 27%)',
    areaEdge: 'hsl(214, 22%, 34%)',
    lift: 'hsl(222, 10%, 64%)',
    liftHalo: 'hsla(216, 30%, 12%, 0.7)',
  },
}

const kind = ['get', 'kind']
const piste = ['get', 'piste']
const difficulty = ['get', 'difficulty']
const scheme = ['get', 'scheme']

const DOWNHILL = ['downhill', 'snow_park']
const DOTTED = ['sled', 'skitour', 'hike', 'snowshoe', 'sleigh', 'fatbike']
const UNGROOMED = ['backcountry', 'mogul']

/**
 * A piste's colour under the signage of where it lies: an easy run is a green
 * circle in North America and blue in Europe, an intermediate one blue there and
 * red here and in Japan. Terrain parks are orange everywhere.
 */
export function pisteColor(flavor: FlavorId): any {
  const c = COLORS[flavor]
  return [
    'case',
    ['==', piste, 'snow_park'], c.orange,
    ['match', difficulty,
      'novice', c.green,
      'easy', ['match', scheme, 'eu', c.blue, c.green],
      'intermediate', ['match', scheme, 'na', c.blue, c.red],
      ['advanced', 'expert'], c.black,
      ['freeride', 'extreme'], c.orange,
      c.unknown,
    ],
  ]
}

/** North America signs its runs by shape as well as colour; elsewhere a disc carries the colour. */
const PISTE_ICON = [
  'case',
  ['==', piste, 'snow_park'], 'piste-park',
  ['!=', scheme, 'na'], 'piste-circle',
  ['match', difficulty,
    ['novice', 'easy'], 'piste-circle',
    'intermediate', 'piste-square',
    'advanced', 'piste-diamond',
    'expert', 'piste-double-diamond',
    'piste-circle',
  ],
]

const isLine = ['==', kind, 'piste']
const ofType = (types: string[]) => ['match', piste, types, true, false]

/** A line's width ramp, scaled by a number or a per-feature expression. */
const width = (scale: any) => {
  const at = (px: number) => (typeof scale === 'number' ? px * scale : ['*', scale, px])
  return ['interpolate', ['exponential', 1.5], ['zoom'], 13, at(1), 15, at(1.8), 17, at(3), 20, at(5)]
}

/** Resort outlines and piste areas, which sit in the ground under the woods. */
export function skiAreaLayers(flavor: FlavorId): any[] {
  const c = COLORS[flavor]
  return [
    {
      id: SKI_AREA_LAYER,
      type: 'fill',
      source: DETAIL_SOURCE,
      'source-layer': SKI_TILES,
      minzoom: 13,
      filter: ['==', kind, 'ski_area'],
      paint: {
        'fill-color': c.area,
        'fill-outline-color': c.areaEdge,
      },
    },
  ]
}

/**
 * Pistes over the woods they are cut through. Each run first lays down a wide
 * band of snow, which is what makes a trail map read as a mountain of runs.
 */
export function pisteLayers(flavor: FlavorId): any[] {
  const c = COLORS[flavor]
  const color = pisteColor(flavor)
  const common = {
    type: 'line',
    source: DETAIL_SOURCE,
    'source-layer': SKI_TILES,
    minzoom: 13,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  }
  const ungroomed = [
    'any',
    ['match', ['get', 'grooming'], UNGROOMED, true, false],
    ['match', difficulty, ['freeride', 'extreme'], true, false],
  ]
  return [
    {
      id: PISTE_AREA_LAYER,
      type: 'fill',
      source: DETAIL_SOURCE,
      'source-layer': SKI_TILES,
      minzoom: 13,
      filter: ['==', kind, 'piste_area'],
      paint: {
        'fill-color': c.snow,
        'fill-outline-color': color,
      },
    },
    {
      ...common,
      id: PISTE_TRAIL_LAYER,
      filter: ['all', isLine, ofType(DOWNHILL)],
      paint: {
        'line-color': c.snow,
        // About 12 m of cleared slope.
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 2, 22, 12 * pxPerMetre(22)],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 2],
      },
    },
    {
      ...common,
      id: PISTE_LAYER,
      filter: ['all', isLine, ['!', ungroomed], ofType([...DOWNHILL, 'connection'])],
      paint: {
        'line-color': color,
        'line-width': width(['case', ['==', piste, 'connection'], 0.6, 1]),
      },
    },
    {
      ...common,
      id: PISTE_DASHED_LAYER,
      filter: [
        'all', isLine,
        ['any', ['==', piste, 'nordic'], ['all', ungroomed, ofType(DOWNHILL)]],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': width(['case', ['==', piste, 'nordic'], 0.8, 1]),
        'line-dasharray': [3, 1.5],
      },
    },
    {
      ...common,
      id: PISTE_DOTTED_LAYER,
      filter: ['all', isLine, ofType(DOTTED)],
      paint: {
        'line-color': color,
        'line-width': width(1),
        'line-dasharray': [0, 2],
      },
    },
  ]
}

/** Lifts, from the basemap's aerialways: cables solid, surface lifts dashed. */
export function liftLayers(flavor: FlavorId, source: string): any[] {
  const c = COLORS[flavor]
  const SURFACE = ['t-bar', 'j-bar', 'platter', 'drag_lift', 'rope_tow', 'magic_carpet']
  const aerialway = ['==', ['get', 'class'], 'aerialway']
  const surface = ['match', ['get', 'subclass'], SURFACE, true, false]
  const common = {
    type: 'line',
    source,
    'source-layer': 'transportation',
    minzoom: 13,
  }
  return [
    {
      ...common,
      id: LIFT_HALO_LAYER,
      filter: aerialway,
      paint: {
        'line-color': c.liftHalo,
        'line-width': width(2.2),
      },
    },
    {
      ...common,
      id: DRAG_LIFT_LAYER,
      filter: ['all', aerialway, surface],
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': c.lift,
        'line-width': width(0.7),
        'line-dasharray': [2, 1.5],
      },
    },
    {
      ...common,
      id: LIFT_LAYER,
      filter: ['all', aerialway, ['!', surface]],
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': c.lift,
        'line-width': width(['match', ['get', 'subclass'], ['gondola', 'cable_car'], 1, 0.75]),
      },
    },
    {
      id: LIFT_PYLON_LAYER,
      type: 'circle',
      source: DETAIL_SOURCE,
      'source-layer': SKI_TILES,
      minzoom: 15,
      filter: ['==', kind, 'pylon'],
      paint: {
        'circle-color': c.lift,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.4, 18, 2.6, 20, 3.5],
        'circle-stroke-color': c.liftHalo,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 18, 1],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 1],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 1],
      },
    },
  ]
}

/** Run difficulty signs and run and lift names, written the way the basemap names a park. */
export function skiLabelLayers(flavor: FlavorId, label: GolfLabelStyle, source: string): any[] {
  const c = COLORS[flavor]
  const color = pisteColor(flavor)
  const name = ['coalesce', ['get', 'name:en'], ['get', 'name']]
  return [
    {
      id: PISTE_SYMBOL_LAYER,
      type: 'symbol',
      source: DETAIL_SOURCE,
      'source-layer': SKI_TILES,
      minzoom: 14,
      filter: ['all', isLine, ofType(DOWNHILL), ['any', ['has', 'difficulty'], ['==', piste, 'snow_park']]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 220,
        'icon-image': PISTE_ICON,
        'icon-rotation-alignment': 'viewport',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 0.85],
        'icon-padding': 4,
      },
      paint: {
        'icon-color': color,
        'icon-halo-color': label.halo,
        'icon-halo-width': 1.5,
      },
    },
    {
      id: PISTE_LABEL_LAYER,
      type: 'symbol',
      source: DETAIL_SOURCE,
      'source-layer': SKI_TILES,
      minzoom: 14.5,
      filter: ['all', ['match', kind, ['piste', 'route'], true, false], ['has', 'name']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 400,
        'text-field': ['get', 'name'],
        'text-font': label.font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 11, 18, 13],
        'text-max-angle': 30,
        'text-padding': 4,
      },
      paint: {
        'text-color': color,
        'text-halo-color': label.halo,
        'text-halo-width': label.haloWidth,
        'text-halo-blur': label.haloBlur,
      },
    },
    {
      id: LIFT_LABEL_LAYER,
      type: 'symbol',
      source,
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: ['==', ['get', 'class'], 'aerialway'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 600,
        'text-field': name,
        'text-font': label.font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 18, 13],
        'text-offset': [0, 0.8],
        'text-max-angle': 30,
      },
      paint: {
        'text-color': c.lift,
        'text-halo-color': label.halo,
        'text-halo-width': label.haloWidth,
        'text-halo-blur': label.haloBlur,
      },
    },
  ]
}
