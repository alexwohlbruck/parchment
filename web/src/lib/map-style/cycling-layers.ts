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
 *
 * Strength is carried by chroma rather than by lightness, because the street's
 * own name is printed on top: taking the daylight tint darker to make it read
 * more pushes `label_ink_road` under 4.5:1 against it.
 */
const STRENGTH: Record<FlavorId, Record<string, string>> = {
  light: {
    strong: 'hsl(158, 78%, 90%)',
    medium: 'hsl(158, 60%, 92%)',
    faint: 'hsl(158, 45%, 94%)',
  },
  dark: {
    strong: 'hsl(158, 46%, 28%)',
    medium: 'hsl(158, 38%, 30%)',
    faint: 'hsl(158, 30%, 32%)',
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
    shoulder: 'hsl(158, 30%, 49%)',
  },
  dark: {
    track: 'hsl(158, 52%, 62%)',
    lane: 'hsl(156, 46%, 57%)',
    shoulder: 'hsl(156, 24%, 55%)',
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
    kind: 'shoulder',
    values: ['shoulder'],
    dash: [2, 6],
  },
]

/**
 * Barrelman's computed `infra_type`, back as the tag value a side would carry.
 *
 * The last resort, and not a rare one: `cycleway:both=lane` sets neither side
 * tag nor the plain `cycleway` one, so a street tinted as having a lane would
 * carry no marking at all. Anything the tint draws has to get a stroke, or the
 * grammar has a hole exactly where the map is busiest.
 */
const INFRA_AS_SIDE: any = [
  'match',
  ['get', 'infra_type'],
  ['cycle_track'], 'track',
  ['cycle_lane'], 'lane',
  ['shoulder'], 'shoulder',
  '',
]

/**
 * What a side's tag says: that side, then the tag covering both sides, then
 * what Barrelman worked out. Empty strings count as absent — the columns are
 * served from Postgres and an untagged side arrives as `''`, which `coalesce`
 * would otherwise treat as an answer.
 */
const sideValue = (side: string): any => {
  const said = (value: any): any => [
    'case',
    ['all', ['has', value[1]], ['!=', value, '']],
    value,
    null,
  ]
  return [
    'coalesce',
    said(['get', `cycleway_${side}`]),
    said(['get', 'cycleway']),
    INFRA_AS_SIDE,
  ]
}

/**
 * Scale an expression's OUTPUTS, leaving its zoom stops alone.
 *
 * `["zoom"]` is only legal as the direct input of a top-level interpolate, so
 * the offset cannot be `["*", 0.5, <the width expression>]`. Halving each value
 * the ramp produces gets the same number with the zoom still on the outside.
 */
export function scaleOutputs(expression: any, factor: number): any {
  // `-0` is a legal number and an illegible one to find in a style file.
  if (typeof expression === 'number') return expression * factor || 0
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
  ['bicycle_road', 'cycle_street', 'bicycle_designated'],
  STRENGTH[flavor].strong,
  ['shared_lane', 'share_busway', 'opposite'],
  STRENGTH[flavor].faint,
  STRENGTH[flavor].medium,
]

/**
 * What the tint is drawn for: streets you ride IN.
 *
 * The tint claims the whole carriageway, so it has to mean the whole
 * carriageway is yours — a bicycle road, a cycle street, a road designated for
 * bikes, or a lane shared with traffic that you take by riding in it. Where
 * the provision is a strip at the edge, the street is left alone and the strip
 * is drawn where it actually is; see `STROKE_KINDS`. Bedford Avenue has a lane
 * down each side, and painting the middle green would say you belong in the
 * traffic between them.
 *
 * `cycleway` and the bicycle paths are absent — ways built for bikes, not
 * roads marked for them, and they keep their own cased mark. `bicycle_yes` is
 * absent too: permission rather than provision, and on most of the grid.
 */
const TINTED_INFRA = [
  'shared_lane', 'share_busway', 'opposite',
  'bicycle_road', 'cycle_street', 'bicycle_designated',
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
 * The strip of a street that is yours, one layer per pattern per side.
 *
 * These are the only mark an edge-lane street gets — such a street is
 * deliberately not tinted — so they draw from z12. What waits for z16 is the
 * OFFSET: below that the two sides are less than a line apart, so they collapse
 * onto the centreline and read as one route, which is the right answer at a
 * zoom where you are looking at a network rather than at a street.
 *
 * `line-offset` is positive to the right of the way's direction, which is what
 * `cycleway:right` means too, so the sign needs no correction.
 */
/** Where a street becomes wide enough to show which side a lane is on. */
const SIDES_FROM = 16

/** A class `match`'s arms and its fallback, or just the value if it is flat. */
function classArms(value: any): { arms: any[]; fallback: any } {
  if (Array.isArray(value) && value[0] === 'match') {
    return { arms: value.slice(2, -1), fallback: value[value.length - 1] }
  }
  return { arms: [], fallback: value }
}

/**
 * One width ramp covering every rung of the road network.
 *
 * The basemap draws roads in three layers, each holding only its own classes:
 * `Minor road` sizes a residential street and falls back to that width for
 * everything else, so reading it alone put a lane on a primary avenue at
 * residential width — inside the carriageway rather than at its kerb.
 *
 * Above `SIDES_FROM` the three layers share their stop zooms, so the arms of
 * each stop's class `match` can simply be concatenated: the motorway arm from
 * `Highway`, the trunk and primary arms from `Major road`, the rest and the
 * fallback from `Minor road`. Structural, so it stays exact as those ramps are
 * retuned, and it fails loudly if they ever stop sharing stops.
 */
export function roadWidthByClass(roadWidth: (layerId: string) => any): any {
  const rungs = ['Highway', 'Major road', 'Minor road'].map(roadWidth)
  if (rungs.some(r => !Array.isArray(r) || r[0] !== 'interpolate')) return null

  const stopsOf = (e: any) => {
    const out: [number, any][] = []
    for (let i = 3; i < e.length; i += 2) {
      if (e[i] >= SIDES_FROM) out.push([e[i], e[i + 1]])
    }
    return out
  }
  const [highway, major, minor] = rungs.map(stopsOf)
  const zooms = minor.map(([z]) => z)
  const shares = (r: [number, any][]) =>
    r.length === zooms.length && r.every(([z], i) => z === zooms[i])
  if (!shares(highway) || !shares(major)) {
    throw new Error('road width ramps no longer share their stops above z16')
  }

  const merged: any[] = ['interpolate', ['linear', 2], ['zoom']]
  zooms.forEach((zoom, i) => {
    const seen = new Set<string>()
    const arms: any[] = []
    for (const rung of [highway[i][1], major[i][1], minor[i][1]]) {
      const { arms: own } = classArms(rung)
      for (let a = 0; a < own.length; a += 2) {
        const label = JSON.stringify(own[a])
        if (seen.has(label)) continue
        seen.add(label)
        arms.push(own[a], own[a + 1])
      }
    }
    merged.push(zoom, ['match', CLASS_OF_HIGHWAY, ...arms, classArms(minor[i][1]).fallback])
  })
  return merged
}

/**
 * Half the road above `SIDES_FROM`, nothing below it.
 *
 * Built by rebuilding the ramp's stops rather than wrapping it in a `step`:
 * `["zoom"]` is only legal as the direct input of a top-level expression, and
 * a step around an interpolate nests two of them.
 */
export function offsetRamp(width: any, factor: number): any {
  const scaled = scaleOutputs(width, factor)
  if (!Array.isArray(scaled) || scaled[0] !== 'interpolate') return scaled
  const [op, interpolation, input, ...stops] = scaled
  const kept: any[] = []
  for (let i = 0; i < stops.length; i += 2) {
    if (stops[i] >= SIDES_FROM) kept.push(stops[i], stops[i + 1])
  }
  // Half a zoom of fade, so the lanes slide out to the kerb rather than jump.
  return [op, interpolation, input, SIDES_FROM - 0.5, 0, ...kept]
}

export function cyclingStrokeLayers(
  flavor: FlavorId,
  roadWidth: (layerId: string) => any,
): any[] {
  const width = roadWidthByClass(roadWidth)
  if (!width) return []

  return STROKE_KINDS.flatMap(({ kind, values, dash }) =>
    ['left', 'right'].map(side => ({
      id: strokeLayerId(kind, side),
      type: 'line',
      source: CYCLING_WAYS_SOURCE,
      'source-layer': CYCLING_WAYS_TILES,
      minzoom: 12,
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
        'line-offset': offsetRamp(width, side === 'right' ? 0.5 : -0.5),
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
