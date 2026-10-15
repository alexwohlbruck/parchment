/**
 * Running tracks, from barrelman's `sport_tracks`, and motor racing circuits,
 * which the basemap carries as `class=raceway` and otherwise draws as a side
 * street.
 */
import type { FlavorId } from './build'
import { DETAIL_SOURCE } from './detail-layers'
import { metres } from './metres'

export const TRACK_TILES = 'sport_tracks'

export const TRACK_SURFACE_LAYER = 'Track surface'
export const TRACK_LANE_LAYER = 'Track lanes'
export const RACEWAY_LAYER = 'Raceway'

const COLORS: Record<FlavorId, Record<string, string>> = {
  light: {
    tartan: 'hsl(9, 56%, 68%)',
    lane: 'hsla(0, 0%, 100%, 0.9)',
    tarmac: 'hsl(222, 5%, 68%)',
    dirt: 'hsl(30, 32%, 70%)',
  },
  dark: {
    tartan: 'hsl(9, 28%, 36%)',
    lane: 'hsla(9, 20%, 80%, 0.55)',
    tarmac: 'hsl(222, 6%, 50%)',
    dirt: 'hsl(30, 18%, 34%)',
  },
}

/** World Athletics' lane width. */
const LANE_M = 1.22
/** Lanes an untagged oval is drawn with: the common outdoor track. */
const OVAL_LANES = 6
/** Lane lines drawn at most; an eight-lane track has seven. */
const MAX_LANE_LINES = 7

const kind = ['get', 'kind']

/** `m` metres at this track's latitude, from z15 up. */
const trackMetres = (m: unknown, minimum = 0) =>
  metres(['*', m, ['coalesce', ['get', 'scale'], 1]], { from: 15, minimum })

const lanes = (fallback: number) => ['min', ['coalesce', ['get', 'lanes'], fallback], 10]

/**
 * A track's surface and the lines between its lanes. An oval is mapped with its
 * infield inside, so its lanes are a band laid along the inside of its outline,
 * which barrelman winds so that a positive line offset falls inside.
 */
export function trackLayers(flavor: FlavorId): any[] {
  const c = COLORS[flavor]
  const common = {
    source: DETAIL_SOURCE,
    'source-layer': TRACK_TILES,
    minzoom: 15,
  }
  const band = ['*', lanes(OVAL_LANES), LANE_M]
  const laneLines = Array.from({ length: MAX_LANE_LINES }, (_, i) => i + 1).map(n => ({
    ...common,
    id: n === 1 ? TRACK_LANE_LAYER : `${TRACK_LANE_LAYER} ${n}`,
    type: 'line',
    minzoom: 17,
    filter: ['all', ['==', kind, 'oval'], ['>', lanes(OVAL_LANES), n]],
    paint: {
      'line-color': c.lane,
      'line-width': ['interpolate', ['linear'], ['zoom'], 17, 0.5, 20, 1.5],
      'line-offset': trackMetres(n * LANE_M),
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 17, 0, 17.5, 1],
    },
  }))
  return [
    {
      ...common,
      id: TRACK_SURFACE_LAYER,
      type: 'fill',
      filter: ['==', kind, 'surface'],
      paint: { 'fill-color': c.tartan },
    },
    {
      ...common,
      id: `${TRACK_SURFACE_LAYER} oval`,
      type: 'line',
      filter: ['==', kind, 'oval'],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': c.tartan,
        'line-width': trackMetres(band),
        'line-offset': trackMetres(['/', band, 2]),
      },
    },
    {
      ...common,
      id: `${TRACK_SURFACE_LAYER} line`,
      type: 'line',
      filter: ['==', kind, 'line'],
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': c.tartan,
        'line-width': trackMetres(['*', lanes(1), LANE_M], 1),
      },
    },
    ...laneLines,
  ]
}

/** A circuit's tarmac, or its dirt, over the side-street fill the basemap gives it. */
export function racewayLayer(flavor: FlavorId, minorRoad: any): any {
  const c = COLORS[flavor]
  return {
    ...minorRoad,
    id: RACEWAY_LAYER,
    minzoom: 12,
    filter: ['all', ['==', ['get', 'class'], 'raceway'], ['!', ['match', ['get', 'brunnel'], ['tunnel', 'bridge'], true, false]]],
    paint: {
      ...minorRoad.paint,
      'line-color': ['match', ['get', 'surface'], 'unpaved', c.dirt, c.tarmac],
    },
  }
}
