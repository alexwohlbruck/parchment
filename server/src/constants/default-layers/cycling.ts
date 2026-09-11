import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * Cycling default layer templates.
 *
 * The network is drawn in two halves, and which half a way belongs to is the
 * whole design.
 *
 * A way that **is** cycling infrastructure — a cycleway, a path where bikes
 * are designated — is drawn by the BASEMAP, which repaints that road's own
 * surface green at exactly the width it already draws it; see
 * `addCyclingSurface` in `web/scripts/convert-basemap-style.mjs`. A bike path
 * is a road you ride on, so it is painted like one rather than traced with a
 * dotted line laid over the top. Those layers switch on with this group
 * through `basemapGroup` on the group template.
 *
 * A way that merely **carries** cycling infrastructure — a street with a lane
 * or a protected track down one side — is drawn here, from Barrelman, as a
 * thin line along the street. The lane is part of the road, not the road, and
 * tinting the whole carriageway for it would claim the traffic lanes too.
 *
 * Everything here is ground, so it draws under the labels and under the
 * transit lines that cross above it. The signed-route corridor goes a band
 * lower still, under the roads themselves; see it for why.
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
  track: { light: 'hsl(152, 62%, 31%)', dark: 'hsl(150, 52%, 60%)' },
  lane: { light: 'hsl(150, 55%, 38%)', dark: 'hsl(148, 46%, 56%)' },
  shared: { light: 'hsl(150, 32%, 50%)', dark: 'hsl(148, 26%, 56%)' },
  permitted: { light: 'hsl(150, 24%, 62%)', dark: 'hsl(148, 18%, 48%)' },
  route: { light: 'hsl(146, 52%, 40%)', dark: 'hsl(148, 44%, 54%)' },
  // The corridor is opaque and sits under the streets, so it is a pale wash a
  // step off the ground rather than a colour laid on top of one.
  corridor: { light: 'hsl(146, 46%, 87%)', dark: 'hsl(152, 22%, 27%)' },
  proposed: { light: 'hsl(150, 18%, 58%)', dark: 'hsl(150, 14%, 52%)' },
  construction: { light: 'hsl(36, 78%, 48%)', dark: 'hsl(38, 72%, 60%)' },
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
  /** Mapbox Standard's bands; see `layer-slots.ts`. Defaults to on-street. */
  slot?: 'bottom' | 'middle'
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
      // Above the roads and below the labels, unless the layer says otherwise.
      slot: l.slot ?? 'middle',
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

export const CYCLING_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  /**
   * Signed route relations (icn / ncn / rcn / lcn), as a corridor UNDER the
   * street network rather than a line in it.
   *
   * A signed route is not a piece of infrastructure — it is a recommendation
   * laid over whatever infrastructure exists, and often over none. Drawn as
   * another green line it competed with the lanes it runs along; drawn as a
   * wide translucent band over the roads it blotted at every corner and
   * junction, because MapLibre blends each feature separately and overlapping
   * alpha compounds.
   *
   * Both problems go away below the roads. The band is opaque — nothing to
   * compound — and wider than the street it follows, so what shows is a green
   * verge either side of a street that stays crisply drawn on top of it. That
   * is also the more honest picture: the route is the corridor, not the
   * asphalt.
   */
  wayLayer({
    id: 'bicycle-routes',
    name: 'Bike Routes',
    group: 'bike-routes',
    order: 10,
    minzoom: 5,
    slot: 'bottom',
    filter: ['!=', ['get', 'state'], 'proposed'],
    color: themed(INK.corridor),
    width: width(5, 3, 10, 6, 12, 9, 14, 13, 16, 18, 19, 26),
  }),

  // Protected tracks: a lane of the street, kerbed or posted off for bikes.
  wayLayer({
    id: 'bicycle-tracks',
    name: 'Cycle Tracks',
    group: 'cycle-tracks',
    order: 40,
    minzoom: 11,
    filter: ['all', ['==', 'infra_type', 'cycle_track'], BUILT],
    color: themed(INK.track),
    width: width(11, 0.9, 14, 1.8, 16, 2.6, 19, 4),
  }),

  // Painted lanes.
  wayLayer({
    id: 'bicycle-lanes',
    name: 'Bike Lanes',
    group: 'bike-lanes',
    order: 50,
    minzoom: 12,
    filter: ['all', ['==', 'infra_type', 'cycle_lane'], BUILT],
    color: themed(INK.lane),
    width: width(12, 0.8, 14, 1.5, 16, 2.2, 19, 3.4),
  }),

  // Sharrows, shoulders and contraflows — a marking on a shared lane, so a
  // dash, which is what the paint on the road is.
  wayLayer({
    id: 'bicycle-shared-lanes',
    name: 'Shared Lanes',
    group: 'shared-lanes',
    order: 52,
    minzoom: 13,
    filter: [
      'all',
      ['in', 'infra_type', 'shared_lane', 'opposite', 'shoulder', 'share_busway'],
      BUILT,
    ],
    color: themed(INK.shared),
    width: width(13, 0.8, 15, 1.4, 18, 2.2),
    dash: [2, 2.5],
  }),

  // Bicycle roads and cycle streets: a street where bikes have priority over
  // the traffic on it. `bicycle_designated` is deliberately not here — that is
  // the basemap's green surface, and drawing both doubles it.
  wayLayer({
    id: 'bicycle-roads',
    name: 'Bicycle Roads',
    group: 'bicycle-roads',
    order: 70,
    minzoom: 12,
    filter: ['all', ['in', 'infra_type', 'bicycle_road', 'cycle_street'], BUILT],
    color: themed(INK.track),
    width: width(12, 1.2, 14, 2.2, 16, 3.2, 19, 5),
  }),

  // Roads bikes are merely allowed on. Off by default: it is most of the
  // residential grid, and switching it on paints a whole neighbourhood green
  // while saying nothing about where it is good to ride.
  wayLayer({
    id: 'bicycle-permitted',
    name: 'Bicycle Permitted',
    group: 'bicycle-permitted',
    order: 80,
    minzoom: 14,
    filter: ['all', ['==', 'infra_type', 'bicycle_yes'], BUILT],
    color: themed(INK.permitted),
    width: width(14, 0.6, 16, 1, 19, 1.6),
    dash: [1, 3],
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
    dash: [1, 3],
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
