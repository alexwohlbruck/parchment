import { LayerType, MapEngine, MapboxLayerType } from '@/types/map.types'
import type { Layer } from '@/types/map.types'

// Search results layer constants - these are internal and not user-modifiable
export const SEARCH_RESULTS_LAYER_ID = 'search-results-internal'
export const SEARCH_RESULTS_SOURCE_ID = 'search-results-source-internal'
export const SEARCH_RESULTS_LABELS_LAYER_ID = 'search-results-labels-internal'

// Search results layer configuration - this layer is always present but hidden when no results
export const SEARCH_RESULTS_LAYER_CONFIG: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
  name: 'Search Results (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false, // Hidden from user - not user-modifiable
  visible: false, // Hidden by default
  icon: null,
  order: 9999, // Very high order to ensure it's on top
  groupId: null,
  configuration: {
    id: SEARCH_RESULTS_LABELS_LAYER_ID,
    type: MapboxLayerType.SYMBOL,
    source: SEARCH_RESULTS_SOURCE_ID,
    minzoom: 6,
    filter: ['has', 'name'],
    layout: {
      'symbol-z-elevate': true,
      'text-size': 13,
      'text-field': ['get', 'name'],
      'text-font': [
        ['concat', ['config', 'font'], ' Medium'],
        'DIN Pro',
        'Inter',
        'Arial Unicode MS Bold',
      ],
      'text-padding': ['interpolate', ['linear'], ['zoom'], 16, 6, 17, 4],
      'text-offset': [0, 1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': 1000,
    },
    paint: {
      'text-halo-width': 2,
      'text-halo-blur': 0,
      'text-halo-color': [
        'interpolate',
        ['linear'],
        ['measure-light', 'brightness'],
        0.25,
        'hsl(0, 0%, 5%)',
        0.3,
        'hsl(0, 0%, 100%)',
      ],
      'text-color': [
        'interpolate',
        ['linear'],
        ['measure-light', 'brightness'],
        0.25,
        'hsl(0, 0%, 95%)',
        0.3,
        'hsl(0, 0%, 15%)',
      ],
    },
  },
}

// Default empty GeoJSON for the search results source
export const EMPTY_SEARCH_RESULTS_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [],
}
