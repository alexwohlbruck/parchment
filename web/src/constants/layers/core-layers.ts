import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  SourceType,
} from '@/types/map.types'
import type { Layer } from '@/types/map.types'
import {
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
} from './helpers'

// Search results layer constants - these are internal and not user-modifiable
export const SEARCH_RESULTS_LAYER_ID = 'search-results-internal'
export const SEARCH_RESULTS_SOURCE_ID = 'search-results-source-internal'
export const SEARCH_RESULTS_LABELS_LAYER_ID = 'search-results-labels-internal'

// Place polygon layer constants - these are internal and not user-modifiable
export const PLACE_POLYGON_LAYER_ID = 'place-polygon-internal'
export const PLACE_POLYGON_SOURCE_ID = 'place-polygon-source-internal'
export const PLACE_POLYGON_FILL_LAYER_ID = 'place-polygon-fill-internal'
export const PLACE_POLYGON_STROKE_LAYER_ID = 'place-polygon-stroke-internal'

// Search results layer configuration - this layer is always present but hidden when no results
export const SEARCH_RESULTS_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
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
    // Labels only appear when zoomed in close enough; at city-level zoom the
    // dot markers alone are sufficient and labels would create clutter.
    minzoom: 14,
    filter: ['has', 'name'],
    layout: {
      'symbol-z-elevate': true,
      'text-size': 13,
      'text-field': ['get', 'name'],
      // Matches Mapbox Standard's native POI label font stack
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-padding': ['interpolate', ['linear'], ['zoom'], 16, 6, 17, 4],
      'text-offset': [0, 1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': 1000,
    },
    paint: {
      'text-halo-width': 1,
      'text-halo-blur': 0,
      // Halo adapts to map light preset: dark halo in night/dusk, white in day/dawn
      'text-halo-color': [
        'interpolate',
        ['linear'],
        ['measure-light', 'brightness'],
        0.25,
        '#0D0D0D',
        0.3,
        '#FFFFFF',
      ],
      // Category-based text colors, matching Mapbox Standard POI label palette.
      // Uses measure-light brightness so they automatically adapt to day/dusk/night presets.
      'text-color': [
        'match',
        ['get', 'category'],
        'food_and_drink',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(40, 95%, 70%)',
          0.3,
          'hsl(30, 100%, 48%)',
        ],
        'education',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(30, 50%, 70%)',
          0.3,
          'hsl(30, 50%, 38%)',
        ],
        'medical',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(0, 70%, 70%)',
          0.3,
          'hsl(0, 90%, 60%)',
        ],
        'sport_and_leisure',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(190, 60%, 70%)',
          0.3,
          'hsl(190, 75%, 38%)',
        ],
        'store',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(210, 70%, 75%)',
          0.3,
          'hsl(210, 75%, 53%)',
        ],
        'arts_and_entertainment',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(320, 70%, 75%)',
          0.3,
          'hsl(320, 85%, 60%)',
        ],
        'commercial_services',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(260, 70%, 75%)',
          0.3,
          'hsl(250, 75%, 60%)',
        ],
        'park',
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(110, 55%, 65%)',
          0.3,
          'hsl(110, 70%, 28%)',
        ],
        // default
        [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(210, 20%, 70%)',
          0.3,
          'hsl(210, 20%, 43%)',
        ],
      ],
    },
  },
}

// Default empty GeoJSON for the search results source
export const EMPTY_SEARCH_RESULTS_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [],
}

// Place geometry layer configurations - used for showing place boundaries and lines
export const PLACE_POLYGON_FILL_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Place Polygon Fill (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false, // Hidden from user - not user-modifiable
  visible: false, // Hidden by default
  icon: null,
  order: 9998, // High order to ensure it's visible but below search results
  groupId: null,
  configuration: {
    id: PLACE_POLYGON_FILL_LAYER_ID,
    type: MapboxLayerType.FILL,
    source: PLACE_POLYGON_SOURCE_ID,
    slot: 'middle',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], // Only render polygons
    layout: {},
    paint: {
      'fill-color': getPlacePolygonFillColor(), // Will be updated reactively by updatePlacePolygonColors
      'fill-opacity': 0.08,
      'fill-emissive-strength': 1,
    },
  },
}

export const PLACE_POLYGON_STROKE_LAYER_CONFIG: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Place Geometry Stroke (Internal)',
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  showInLayerSelector: false, // Hidden from user - not user-modifiable
  visible: false, // Hidden by default
  icon: null,
  order: 9999, // Highest order to ensure stroke is on top
  groupId: null,
  configuration: {
    id: PLACE_POLYGON_STROKE_LAYER_ID,
    type: MapboxLayerType.LINE,
    source: PLACE_POLYGON_SOURCE_ID,
    slot: 'top',
    // No filter - renders all geometry types (Polygon, MultiPolygon, LineString)
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': getPlacePolygonStrokeColor(), // Will be updated reactively by updatePlacePolygonColors
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        0.2,
        18,
        3,
        21,
        6,
      ],
      'line-opacity': 0.75,
      'line-emissive-strength': 1,
    },
  },
}

// Empty GeoJSON for when no place polygon exists
export const EMPTY_PLACE_POLYGON_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [],
}

// Core layer IDs - these layers are managed entirely by the application
export const CORE_LAYER_IDS = {
  SEARCH_RESULTS: 'core:search-results',
  SEARCH_RESULTS_LABELS: 'core:search-results-labels',
  PLACE_GEOMETRY_FILL: 'core:place-geometry-fill',
  PLACE_GEOMETRY_STROKE: 'core:place-geometry-stroke',
} as const

// Core layers that are essential for app functionality
export const CORE_LAYERS: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
>[] = [
  // Search results layer (for showing search results on map)
  {
    ...SEARCH_RESULTS_LAYER_CONFIG,
    name: 'Search Results (Core)',
    showInLayerSelector: false, // Hidden from UI
    order: 99998,
  },

  // Place geometry fill layer (for highlighting selected places)
  {
    ...PLACE_POLYGON_FILL_LAYER_CONFIG,
    name: 'Place Geometry Fill (Core)',
    showInLayerSelector: false, // Hidden from UI
    order: 99997,
  },

  // Place geometry stroke layer (for highlighting selected places)
  {
    ...PLACE_POLYGON_STROKE_LAYER_CONFIG,
    name: 'Place Geometry Stroke (Core)',
    showInLayerSelector: false, // Hidden from UI
    order: 99999,
  },
]
