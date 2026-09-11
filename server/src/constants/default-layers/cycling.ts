import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * Cycling default layer templates.
 *
 * Almost nothing is left here, and that is the point. The network itself is
 * drawn by the BASEMAP, which repaints each road's own surface green at
 * exactly the width it already draws that road — `addCyclingSurface` in
 * `convert-basemap-style.mjs` for the ways our own tiles know about, and
 * `cycling-layers.ts` for the on-street lanes only Barrelman can see. Those
 * switch on with this group through `basemapGroup` on the group template.
 *
 * A bike lane is a property of a street, not an object lying on top of one, so
 * the street is what gets painted. Drawing it as a line over the road meant a
 * second object that hid the road's casing, never quite followed the curve
 * underneath, and turned a dense grid into hatching.
 *
 * What is left is the one thing the basemap cannot say: the NAME of a signed
 * route, which belongs to a relation rather than to any road.
 */

export const CYCLING_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
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
        'text-color': [
          'interpolate', ['linear'], ['measure-light', 'brightness'],
          0.25, 'hsl(148, 44%, 54%)', 0.3, 'hsl(146, 52%, 34%)',
        ],
        'text-halo-color': [
          'interpolate', ['linear'], ['measure-light', 'brightness'],
          0.25, '#0d1016', 0.3, '#ffffff',
        ],
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
