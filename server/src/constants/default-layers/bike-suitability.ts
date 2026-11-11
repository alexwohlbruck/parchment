import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'
import { BIKE_SUITABILITY_COLOR_EXPRESSION } from '../../lib/bike-suitability'

/**
 * Every rideable street and path, coloured by how comfortable it is to ride.
 *
 * Barrelman scores each way 0-100 from its own OSM tags — speed, lanes, class,
 * bike facility, surface, smoothness, parked cars, pedestrians, light, grade;
 * see `import/create-bike-suitability.sql` there. This only paints the score.
 */

const SOURCE = {
  id: 'bike-suitability',
  type: 'vector' as const,
  tiles: ['{PROXY_URL}/barrelman/bike_suitability_tiles/{z}/{x}/{y}'],
  minzoom: 12,
  maxzoom: 16,
}

const WIDTH = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  12, 1.2,
  14, 2.4,
  16, 4.5,
  18, 9,
  20, 16,
]

const BANDS = [
  { band: 'grade', filter: ['all', ['!=', ['get', 'bridge'], true], ['!=', ['get', 'tunnel'], true]] },
  { band: 'bridge', filter: ['==', ['get', 'bridge'], true] },
  { band: 'tunnel', filter: ['==', ['get', 'tunnel'], true] },
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
      source: SOURCE,
      'source-layer': 'bike_suitability',
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
