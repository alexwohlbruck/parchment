/**
 * The cycling network Barrelman knows about, painted onto the basemap's roads.
 *
 * The basemap can tint the ways that *are* cycling infrastructure by itself —
 * `subclass=cycleway` and `bicycle=designated` are in our own tiles, and
 * `addCyclingSurface` in `convert-basemap-style.mjs` makes a green twin of each
 * road layer for them. What our tiles do not carry is the lane: a street tagged
 * `cycleway:right=lane` says nothing about `bicycle`, so the whole on-street
 * network is invisible to the basemap. Barrelman has it.
 *
 * The treatment is the same either way — the road's own surface, repainted —
 * because that is the thing being described: you ride on that street. What
 * differs is only how strong the green is, which is how good the provision is.
 *
 * These live here rather than in a server-side layer config for one reason: the
 * width has to be the road's width, at every zoom, and the only honest way to
 * get that is to read the expression off the road layer itself. A second ramp
 * maintained on the server would be a copy, and copies drift. The tiles come
 * from Barrelman the same way the parking and the trees do; see
 * `detail-layers.ts`.
 */
import type { FlavorId } from './build'

export const CYCLING_WAYS_SOURCE = 'bicycle-ways'
export const CYCLING_WAYS_TILES = 'bicycle_ways'

/** Appended to the road layer a Barrelman tint is derived from. */
export const CYCLING_WAYS_SUFFIX = ' (cycling ways)'

/**
 * OSM's `highway` mapped onto the class OpenMapTiles sizes roads by.
 *
 * Barrelman serves the raw tag; the basemap's width expressions switch on
 * `class`. Without this the `match` inside those expressions falls through to
 * its default arm and every street is drawn at the same width — which is the
 * bug the whole module exists to avoid.
 */
const CLASS_OF_HIGHWAY: any = [
  'match',
  ['get', 'highway'],
  ['motorway', 'motorway_link'], 'motorway',
  ['trunk', 'trunk_link'], 'trunk',
  ['primary', 'primary_link'], 'primary',
  ['secondary', 'secondary_link'], 'secondary',
  ['tertiary', 'tertiary_link'], 'tertiary',
  ['unclassified', 'residential', 'living_street', 'road'], 'minor',
  ['service'], 'service',
  ['track'], 'track',
  ['pedestrian'], 'pedestrian',
  'path',
]

/**
 * The road's width expression, rewritten to read Barrelman's properties.
 *
 * Structural: every `["get", "class"]` anywhere inside becomes the mapping
 * above, and nothing else is touched — so the stops, the curve and the ramp
 * stay bit-for-bit the road's own. A retune of the roads reaches these layers
 * without anyone remembering to come here.
 */
export function forBarrelmanProperties(expression: any): any {
  if (Array.isArray(expression)) {
    if (
      expression.length === 2 &&
      expression[0] === 'get' &&
      expression[1] === 'class'
    ) {
      return CLASS_OF_HIGHWAY
    }
    return expression.map(forBarrelmanProperties)
  }
  if (expression && typeof expression === 'object') {
    return Object.fromEntries(
      Object.entries(expression).map(([k, v]) => [k, forBarrelmanProperties(v)]),
    )
  }
  return expression
}

/**
 * How strong the green is, by what the street actually offers a rider.
 *
 * A protected track is a lane of the street given over to bikes and takes the
 * full tint; a painted lane is a line on the asphalt and sits a step back; a
 * sharrow is a marking in a lane shared with traffic and is fainter again,
 * because that is honestly what it offers.
 *
 * All three are opaque. A translucent tint would compound wherever two ways
 * overlap — a corner, a junction, a street carrying both a lane and a route —
 * and leave a dark blot at every one of them, which no paint property can
 * prevent. Opaque colours of the same value simply coincide.
 */
const STRENGTH: Record<FlavorId, Record<string, string>> = {
  light: {
    strong: 'hsl(158, 44%, 90%)',
    medium: 'hsl(158, 40%, 93%)',
    faint: 'hsl(158, 34%, 96%)',
  },
  dark: {
    strong: 'hsl(158, 28%, 35%)',
    medium: 'hsl(158, 24%, 32%)',
    faint: 'hsl(158, 18%, 29%)',
  },
}

/**
 * The stroke drawn on a tinted street, and the grammar it is drawn in.
 *
 * Three channels, each carrying exactly one fact, after CyclOSM — which is the
 * only cycling style with a real grammar rather than a list of colours:
 *
 *   dash gap   how much separation is missing. Solid is kerbed off from the
 *              traffic, a short dash is paint, a dot is a marking in a lane
 *              shared with cars. The gap depicts the absent barrier, which is
 *              why it reads without a legend.
 *   value      how exclusive the space is, deepest for a protected track.
 *   offset     which side of the street it is on, past z16.
 *
 * The hue is a cooler green than the basemap's vegetation — parks and street
 * trees sit at hue 95-100, these at 158 — so a bike lane never reads as a
 * strip of planting.
 */
const STROKE: Record<FlavorId, Record<string, string>> = {
  light: {
    track: 'hsl(160, 64%, 27%)',
    lane: 'hsl(158, 56%, 35%)',
    shared: 'hsl(158, 30%, 49%)',
  },
  dark: {
    track: 'hsl(158, 52%, 62%)',
    lane: 'hsl(156, 46%, 57%)',
    shared: 'hsl(156, 24%, 55%)',
  },
}

/**
 * `line-dasharray` takes no feature expression — only zoom — so each pattern
 * needs its own layer. That is also how CyclOSM is built, for the same reason.
 */
const STROKE_KINDS: { kind: string; values: string[]; dash?: number[] }[] = [
  {
    kind: 'track',
    values: ['track', 'opposite_track', 'sidepath'],
  },
  {
    kind: 'lane',
    values: ['lane', 'opposite_lane', 'buffered_lane'],
    dash: [6, 3],
  },
  {
    kind: 'shared',
    values: ['shared_lane', 'share_busway', 'shoulder', 'opposite'],
    dash: [2, 6],
  },
]

/** What a side's tag says, falling back to the tag that covers both sides. */
const sideValue = (side: string): any => [
  'coalesce',
  ['get', `cycleway_${side}`],
  ['get', 'cycleway'],
]

/**
 * Scale an expression's OUTPUTS, leaving its zoom stops alone.
 *
 * `["zoom"]` is only legal as the direct input of a top-level interpolate, so
 * the offset cannot be `["*", 0.5, <the width expression>]`. Halving each value
 * the ramp produces gets the same number with the zoom still on the outside.
 */
export function scaleOutputs(expression: any, factor: number): any {
  if (typeof expression === 'number') return expression * factor
  if (!Array.isArray(expression)) return expression
  const [op] = expression
  if (op === 'interpolate' || op === 'step') {
    // interpolate: [op, interpolation, input, ...stops] — step: [op, input, fallback, ...stops]
    const head = op === 'interpolate' ? 3 : 3
    const out = expression.slice(0, head)
    if (op === 'step') out[2] = scaleOutputs(expression[2], factor)
    for (let i = head; i < expression.length; i += 2) {
      out.push(expression[i], scaleOutputs(expression[i + 1], factor))
    }
    return out
  }
  if (op === 'match') {
    const out = expression.slice(0, 2)
    for (let i = 2; i < expression.length - 1; i += 2) {
      out.push(expression[i], scaleOutputs(expression[i + 1], factor))
    }
    out.push(scaleOutputs(expression[expression.length - 1], factor))
    return out
  }
  if (op === 'case') {
    const out = [op]
    for (let i = 1; i < expression.length - 1; i += 2) {
      out.push(expression[i], scaleOutputs(expression[i + 1], factor))
    }
    out.push(scaleOutputs(expression[expression.length - 1], factor))
    return out
  }
  return expression
}

/** Barrelman's `infra_type`, graded by how much of the street a rider gets. */
const TINT_OF_INFRA = (flavor: FlavorId): any => [
  'match',
  ['get', 'infra_type'],
  ['cycle_track', 'bicycle_road', 'cycle_street', 'bicycle_designated'],
  STRENGTH[flavor].strong,
  ['cycle_lane'],
  STRENGTH[flavor].medium,
  ['shared_lane', 'opposite', 'shoulder', 'share_busway'],
  STRENGTH[flavor].faint,
  STRENGTH[flavor].faint,
]

/**
 * What the tint is drawn for: provision ON a road.
 *
 * `cycleway` and the bicycle paths are absent — those are ways built for
 * bikes, not roads marked for them, and they keep their own cased mark.
 * `bicycle_yes` is absent too: permission rather than provision, and on most
 * of the residential grid.
 */
const TINTED_INFRA = [
  'cycle_track', 'cycle_lane', 'shared_lane', 'opposite', 'shoulder',
  'share_busway', 'bicycle_road', 'cycle_street', 'bicycle_designated',
]

/**
 * Which road layer carries which classes, so a tinted street keeps the
 * basemap's own hierarchy — a green residential street still passes under the
 * avenue that crosses it.
 */
const BY_ROAD_LAYER: { road: string; classes: string[] }[] = [
  { road: 'Path', classes: ['path', 'pedestrian'] },
  { road: 'Minor road', classes: ['minor', 'service', 'track', 'secondary', 'tertiary'] },
  { road: 'Major road', classes: ['primary', 'trunk'] },
  { road: 'Highway', classes: ['motorway'] },
]

/** Appended to a stroke layer's id: which side, drawn in which grammar. */
export const strokeLayerId = (kind: string, side: string) =>
  `Cycling ${kind} ${side}`

/** The ids every cycling layer takes, so the toggle can name them up front. */
export const CYCLING_WAYS_LAYER_IDS = [
  ...BY_ROAD_LAYER.map(r => r.road + CYCLING_WAYS_SUFFIX),
  ...STROKE_KINDS.flatMap(k => ['left', 'right'].map(s => strokeLayerId(k.kind, s))),
]

/**
 * The markings on a tinted street, one layer per pattern per side.
 *
 * From z16 only. Below that the offset is smaller than the line drawn at it,
 * so the two sides collapse onto each other and the map gains nothing but
 * twice the geometry; the road tint carries the network at those zooms.
 *
 * `line-offset` is positive to the right of the way's direction, which is what
 * `cycleway:right` means too, so the sign needs no correction.
 */
export function cyclingStrokeLayers(
  flavor: FlavorId,
  roadWidth: (layerId: string) => any,
): any[] {
  // Every tinted street is a road, and the minor rung is the one nearly all of
  // them sit on — its ramp is what puts the stroke at the kerb.
  const width = roadWidth('Minor road')
  if (!width) return []

  return STROKE_KINDS.flatMap(({ kind, values, dash }) =>
    ['left', 'right'].map(side => ({
      id: strokeLayerId(kind, side),
      type: 'line',
      source: CYCLING_WAYS_SOURCE,
      'source-layer': CYCLING_WAYS_TILES,
      minzoom: 16,
      filter: [
        'all',
        ['!', ['has', 'state']],
        ['match', sideValue(side), values, true, false],
      ],
      layout: {
        'line-cap': dash ? 'butt' : 'round',
        'line-join': 'round',
        visibility: 'none',
      },
      paint: {
        'line-color': STROKE[flavor][kind],
        'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.1, 19, 2],
        'line-offset': scaleOutputs(
          forBarrelmanProperties(width),
          side === 'right' ? 0.5 : -0.5,
        ),
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    })),
  )
}

export function cyclingWaysSource(tileUrl: (source: string) => string) {
  return {
    [CYCLING_WAYS_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(CYCLING_WAYS_TILES)],
      minzoom: 9,
      maxzoom: 16,
    },
  }
}

/**
 * A tint layer per road rung, each carrying that rung's own width.
 *
 * Returned keyed by the road layer it belongs above, so `build.ts` can splice
 * each one directly over the road it repaints — which is what puts the green
 * on top of the asphalt and still under every casing, label and overlay.
 */
export function cyclingWaysLayers(
  flavor: FlavorId,
  roadWidth: (layerId: string) => any,
): { above: string; layer: any }[] {
  return BY_ROAD_LAYER.flatMap(({ road, classes }) => {
    const width = roadWidth(road)
    if (!width) return []
    return [{
      above: road,
      layer: {
        id: road + CYCLING_WAYS_SUFFIX,
        type: 'line',
        source: CYCLING_WAYS_SOURCE,
        'source-layer': CYCLING_WAYS_TILES,
        minzoom: 12,
        filter: [
          'all',
          ['match', ['get', 'infra_type'], TINTED_INFRA, true, false],
          ['!', ['has', 'state']],
          ['match', CLASS_OF_HIGHWAY, classes, true, false],
        ],
        layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': TINT_OF_INFRA(flavor),
          'line-width': forBarrelmanProperties(width),
        },
      },
    }]
  })
}
