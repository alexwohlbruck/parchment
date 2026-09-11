import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * Cycling default layer templates.
 *
 * The network is drawn in two halves, and which half a way belongs to is the
 * whole design.
 *
 * A road or a footpath that is **marked** bike-friendly — a street with a lane
 * or a sharrow, a path where bikes are designated — is a road you ride on, so
 * the road itself is painted. The BASEMAP does that, repainting that road's
 * own surface green at exactly the width it already draws it; see
 * `cycling-layers.ts` and `addCyclingSurface`. Those switch on with this group
 * through `basemapGroup` on the group template.
 *
 * A **dedicated bike path** is not a road that happens to allow bikes, it is
 * its own piece of infrastructure, and it keeps its own mark: a cased line,
 * drawn here from Barrelman, solid where it is paved and dashed where it is
 * not. Tinting those as roads would say a cycleway and a residential street
 * are the same kind of thing.
 *
 * Everything here is ground, so it draws under the labels and under the
 * transit lines that cross above it.
 */

const SOURCE = {
  id: 'bicycle-ways',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/bicycle_ways/{z}/{x}/{y}'],
  maxzoom: 16,
}

/**
 * The on-street palette, keyed to how much of a bike's own space a form is.
 *
 * A protected track is a lane of the street given over to bikes, and takes the
 * deepest green; a painted lane is a line on the asphalt and sits a step back;
 * a sharrow is a marking on a lane shared with traffic and is dashed, because
 * that is honestly what it offers. `permitted` is a road bikes may use and no
 * more, which is most of the residential grid — faint, and off unless asked
 * for.
 *
 * Every one of them lands between the basemap's road surface and its casing in
 * value, so a green line reads as painted ON the street rather than as another
 * street. The night values are lifted rather than inverted: the roads are dark
 * there and the marking still has to be the brighter of the two.
 */
const INK = {
  // A cooler green than the basemap's vegetation, which sits at hue 95-100, so
  // a bike path never reads as a strip of planting. Matches the on-street
  // markings in `cycling-layers.ts`.
  track: { light: 'hsl(160, 64%, 27%)', dark: 'hsl(158, 52%, 62%)' },
  lane: { light: 'hsl(158, 56%, 35%)', dark: 'hsl(156, 46%, 57%)' },
  route: { light: 'hsl(158, 50%, 38%)', dark: 'hsl(156, 44%, 54%)' },
  // The edge under a dedicated way's stroke, so it reads as a path with a
  // width rather than a line ruled across the ground.
  casing: { light: 'hsl(158, 30%, 97%)', dark: 'hsl(158, 24%, 15%)' },
  proposed: { light: 'hsl(158, 16%, 62%)', dark: 'hsl(158, 12%, 48%)' },
  // Amber, because roadworks are amber everywhere. The one warm mark in the
  // set, so the thing you cannot ride yet is the thing that does not look
  // like the network.
  construction: { light: 'hsl(36, 82%, 46%)', dark: 'hsl(38, 74%, 60%)' },
}

/**
 * A light/dark pair, as the expression both engines understand.
 *
 * Mapbox reads `measure-light` natively; on MapLibre `stripMapboxExpressions`
 * resolves it against the app theme, darkest stop first. Written once here
 * because it was written out longhand fourteen times.
 */
const themed = (pair: { light: string; dark: string }) => [
  'interpolate',
  ['linear'],
  ['measure-light', 'brightness'],
  0.25,
  pair.dark,
  0.3,
  pair.light,
]

/** A width ramp, as (zoom, px) pairs. */
const width = (...stops: number[]) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  ...stops,
]

interface WayLayer {
  id: string
  name: string
  group: string
  order: number
  minzoom: number
  filter: any
  color: any
  width: any
  dash?: number[]
  visible?: boolean
}

/** Everything drawn from Barrelman's `bicycle_ways`, as one shape. */
function wayLayer(l: WayLayer): DefaultLayerTemplate {
  return {
    templateId: `default:${l.id}`,
    name: l.name,
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'BikeIcon',
    showInLayerSelector: false,
    visible: l.visible ?? false,
    order: l.order,
    groupId: `default:group:cycling:${l.group}`,
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: l.id,
      type: 'line',
      // Above the roads, below the labels; see `layer-slots.ts`.
      slot: 'middle',
      source: SOURCE,
      'source-layer': 'bicycle_ways',
      minzoom: l.minzoom,
      filter: l.filter,
      paint: {
        'line-color': l.color,
        'line-width': l.width,
        ...(l.dash ? { 'line-dasharray': l.dash } : {}),
        'line-emissive-strength': 1,
      },
      layout: { 'line-cap': l.dash ? 'butt' : 'round', 'line-join': 'round' },
    },
  }
}

/** Barrelman marks a way's state; absent means it is built and open. */
const BUILT = ['!has', 'state']

/**
 * Surfaces you can ride on a road bike. Off-street ways draw solid when the
 * surface is hard and dashed when it is not — the on-street dash grammar
 * (`cycling-layers.ts`) never appears on these, so the two cannot be confused.
 */
const PAVED = [
  'in', 'surface',
  'asphalt', 'paved', 'concrete', 'concrete:plates', 'paving_stones',
  'chipseal', 'sett', 'metal', 'wood',
]
const HARD = ['all', PAVED]
const SOFT = ['!', PAVED]

export const CYCLING_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  // Dedicated cycleways: their own way, not a street. A casing under a solid
  // stroke, the way the basemap cases a path — so it reads as a route you can
  // follow rather than as a line drawn on something else.
  wayLayer({
    id: 'bicycle-cycleways-casing',
    name: 'Cycleways Casing',
    group: 'cycleways',
    order: 30,
    minzoom: 11,
    filter: ['all', ['==', 'infra_type', 'cycleway'], BUILT],
    color: themed(INK.casing),
    width: width(11, 2.2, 14, 3.6, 16, 5.4, 19, 8),
  }),
  wayLayer({
    id: 'bicycle-cycleways',
    name: 'Cycleways',
    group: 'cycleways',
    order: 31,
    minzoom: 11,
    filter: ['all', ['==', 'infra_type', 'cycleway'], BUILT, HARD],
    color: themed(INK.track),
    width: width(11, 1, 14, 1.8, 16, 2.8, 19, 4.4),
  }),
  wayLayer({
    id: 'bicycle-cycleways-unpaved',
    name: 'Cycleways Unpaved',
    group: 'cycleways',
    order: 32,
    minzoom: 11,
    filter: ['all', ['==', 'infra_type', 'cycleway'], BUILT, SOFT],
    color: themed(INK.track),
    width: width(11, 1, 14, 1.8, 16, 2.8, 19, 4.4),
    dash: [3, 2],
  }),

  // Paths and steps built for bikes. Same treatment, dashed: a path is a
  // rougher promise than a cycleway.
  wayLayer({
    id: 'bicycle-paths-casing',
    name: 'Bicycle Paths Casing',
    group: 'bicycle-paths',
    order: 60,
    minzoom: 12,
    filter: ['all', ['in', 'infra_type', 'path_bicycle', 'steps_bicycle'], BUILT],
    color: themed(INK.casing),
    width: width(12, 2, 14, 3.2, 16, 4.6, 19, 6.6),
  }),
  wayLayer({
    id: 'bicycle-paths',
    name: 'Bicycle Paths',
    group: 'bicycle-paths',
    order: 61,
    minzoom: 12,
    filter: ['all', ['in', 'infra_type', 'path_bicycle', 'steps_bicycle'], BUILT, HARD],
    color: themed(INK.lane),
    width: width(12, 0.9, 14, 1.6, 16, 2.4, 19, 3.6),
  }),
  wayLayer({
    id: 'bicycle-paths-unpaved',
    name: 'Bicycle Paths Unpaved',
    group: 'bicycle-paths',
    order: 62,
    minzoom: 12,
    filter: ['all', ['in', 'infra_type', 'path_bicycle', 'steps_bicycle'], BUILT, SOFT],
    color: themed(INK.lane),
    width: width(12, 0.9, 14, 1.6, 16, 2.4, 19, 3.6),
    dash: [3, 2],
  }),

  // Signed route relations (icn / ncn / rcn / lcn): a recommendation laid over
  // whatever infrastructure exists, so a thin line rather than a claim about
  // the road.
  wayLayer({
    id: 'bicycle-routes',
    name: 'Bike Routes',
    group: 'bike-routes',
    order: 10,
    minzoom: 9,
    filter: ['!=', ['get', 'state'], 'proposed'],
    color: themed(INK.route),
    width: width(9, 0.8, 12, 1.2, 14, 1.8, 16, 2.4),
  }),

  // Not built yet. Both are dashed and quiet — a plan is not a route — and the
  // only one that takes a warm colour is the one with a machine on it.
  wayLayer({
    id: 'bicycle-proposed',
    name: 'Proposed Bikeways',
    group: 'proposed-bikeways',
    order: 100,
    minzoom: 11,
    filter: ['==', 'state', 'proposed'],
    color: themed(INK.proposed),
    width: width(11, 0.8, 14, 1.4, 16, 2.2),
    dash: [1, 4],
  }),
  wayLayer({
    id: 'bicycle-construction',
    name: 'Under Construction',
    group: 'proposed-bikeways',
    order: 102,
    minzoom: 11,
    filter: ['==', 'state', 'construction'],
    color: themed(INK.construction),
    width: width(11, 1, 14, 1.8, 16, 2.6),
    dash: [1.5, 1.5],
  }),

  // Route names along the corridor they belong to.
  {
    templateId: 'default:bicycle-routes-labels',
    name: 'Bike Routes Labels',
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'BikeIcon',
    showInLayerSelector: false,
    visible: false,
    order: 110,
    groupId: 'default:group:cycling:bike-routes',
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: 'bicycle-routes-labels',
      type: 'symbol',
      source: {
        id: 'bicycle-routes',
        type: 'vector',
        tiles: ['{PROXY_URL}/barrelman/bicycle_routes/{z}/{x}/{y}'],
        maxzoom: 14,
      },
      'source-layer': 'bicycle_routes',
      minzoom: 10,
      filter: ['any', ['has', 'name'], ['has', 'ref']],
      paint: {
        'text-color': themed(INK.route),
        'text-halo-color': themed({ light: '#ffffff', dark: '#0d1016' }),
        'text-halo-width': 1.5,
        // Soft rather than traced, like every other label on the map.
        'text-halo-blur': 0.4,
        'text-emissive-strength': 0.8,
      },
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'ref'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-transform': 'uppercase',
        // Capitals need opening up; 0.01 set them as tight as mixed case.
        'text-letter-spacing': 0.08,
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
        'text-max-angle': 30,
        'text-padding': 30,
      },
    },
  },
]
