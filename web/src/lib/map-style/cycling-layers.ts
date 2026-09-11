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
    strong: 'hsl(146, 44%, 90%)',
    medium: 'hsl(146, 40%, 93%)',
    faint: 'hsl(146, 34%, 96%)',
  },
  dark: {
    strong: 'hsl(152, 28%, 36%)',
    medium: 'hsl(152, 24%, 33%)',
    faint: 'hsl(152, 18%, 30%)',
  },
}

/** Barrelman's `infra_type`, graded by how much of the street a rider gets. */
const TINT_OF_INFRA = (flavor: FlavorId): any => [
  'match',
  ['get', 'infra_type'],
  ['cycle_track', 'bicycle_road', 'cycle_street', 'bicycle_designated', 'cycleway'],
  STRENGTH[flavor].strong,
  ['cycle_lane'],
  STRENGTH[flavor].medium,
  ['shared_lane', 'opposite', 'shoulder', 'share_busway'],
  STRENGTH[flavor].faint,
  STRENGTH[flavor].faint,
]

/**
 * What the tint is drawn for. `bicycle_yes` is deliberately absent — that is
 * permission rather than provision, and it is on most of the residential grid.
 */
const TINTED_INFRA = [
  'cycle_track', 'cycle_lane', 'shared_lane', 'opposite', 'shoulder',
  'share_busway', 'bicycle_road', 'cycle_street', 'bicycle_designated',
  'cycleway',
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

/** The ids the tint layers take, so the toggle can name them up front. */
export const CYCLING_WAYS_LAYER_IDS = BY_ROAD_LAYER.map(
  r => r.road + CYCLING_WAYS_SUFFIX,
)

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
