import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'
import { BIKE_SUITABILITY_COLOR_EXPRESSION } from '../../lib/bike-suitability'
import { CYCLING_WAYS_SOURCE } from './cycling'

/**
 * Every rideable street and path, coloured by how comfortable it is to ride.
 *
 * Barrelman scores each way 0-100 from its own OSM tags — speed, lanes, class,
 * bike facility, surface, smoothness, parked cars, pedestrians, light, grade;
 * see `import/create-bike-suitability.sql` there. This only paints the score.
 */

const WIDTH = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  12, 1.2,
  14, 2.4,
  16, 4.5,
  18, 9,
  20, 16,
]

const SCORED = ['has', 'score']

const BANDS = [
  { band: 'grade', filter: ['all', SCORED, ['!=', ['get', 'bridge'], true], ['!=', ['get', 'tunnel'], true]] },
  { band: 'bridge', filter: ['all', SCORED, ['==', ['get', 'bridge'], true]] },
  { band: 'tunnel', filter: ['all', SCORED, ['==', ['get', 'tunnel'], true]] },
]

export const BIKE_SUITABILITY_LAYER_TEMPLATES: DefaultLayerTemplate[] = BANDS.map(
  ({ band, filter }, i) => ({
    templateId: `default:bike-suitability-${band}`,
    name: `Bike suitability (${band})`,
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'BikeIcon',
    showInLayerSelector: false,
    visible: false,
    order: i,
    groupId: 'default:group:bike-suitability',
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: `bike-suitability-${band}`,
      type: 'line',
      slot: band,
      source: CYCLING_WAYS_SOURCE,
      'source-layer': 'bicycle_ways',
      minzoom: 12,
      filter,
      paint: {
        'line-color': BIKE_SUITABILITY_COLOR_EXPRESSION,
        'line-width': WIDTH,
        'line-opacity': band === 'tunnel' ? 0.5 : 0.9,
        'line-emissive-strength': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        // Worst on top, so a bad crossing is never hidden under a good path.
        'line-sort-key': ['-', 100, ['get', 'score']],
      },
    },
  }),
)
