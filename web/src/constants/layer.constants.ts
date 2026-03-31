import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  SourceType,
} from '@/types/map.types'
import type { Layer, LayerGroup } from '@/types/map.types'
import { cssHslToHex } from '@/lib/utils'
import { useStorage } from '@vueuse/core'
import { DEFAULT_SERVER_URL } from '@/lib/constants'
import { computed } from 'vue'

// Dynamic color functions for reactive theme updates
export function getPlacePolygonFillColor(): string {
  return cssHslToHex('hsl(var(--primary))')
}

export function getPlacePolygonStrokeColor(): string {
  return cssHslToHex('hsl(var(--primary))')
}

// Search results layer constants - these are internal and not user-modifiable
export const SEARCH_RESULTS_LAYER_ID = 'search-results-internal'
export const SEARCH_RESULTS_SOURCE_ID = 'search-results-source-internal'
export const SEARCH_RESULTS_LABELS_LAYER_ID = 'search-results-labels-internal'

// Place polygon layer constants - these are internal and not user-modifiable
export const PLACE_POLYGON_LAYER_ID = 'place-polygon-internal'
export const PLACE_POLYGON_SOURCE_ID = 'place-polygon-source-internal'
export const PLACE_POLYGON_FILL_LAYER_ID = 'place-polygon-fill-internal'
export const PLACE_POLYGON_STROKE_LAYER_ID = 'place-polygon-stroke-internal'

// Reactive server URL
export const serverUrl = useStorage(
  'parchment-selected-server',
  DEFAULT_SERVER_URL,
)

// Reactive helper function to build API proxy URLs
export const buildProxyUrl = computed(() => {
  return (endpoint: string): string => {
    const baseUrl = serverUrl.value.endsWith('/')
      ? serverUrl.value.slice(0, -1)
      : serverUrl.value
    return `${baseUrl}/proxy/${endpoint}`
  }
})

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
        'interpolate', ['linear'], ['measure-light', 'brightness'],
        0.25, '#0D0D0D',
        0.3,  '#FFFFFF',
      ],
      // Category-based text colors, matching Mapbox Standard POI label palette.
      // Uses measure-light brightness so they automatically adapt to day/dusk/night presets.
      'text-color': [
        'match', ['get', 'category'],
        'food_and_drink',         ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(40, 95%, 70%)',   0.3, 'hsl(30, 100%, 48%)'],
        'education',              ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(30, 50%, 70%)',   0.3, 'hsl(30, 50%, 38%)'],
        'medical',                ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(0, 70%, 70%)',    0.3, 'hsl(0, 90%, 60%)'],
        'sport_and_leisure',      ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(190, 60%, 70%)', 0.3, 'hsl(190, 75%, 38%)'],
        'store',                  ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(210, 70%, 75%)', 0.3, 'hsl(210, 75%, 53%)'],
        'arts_and_entertainment', ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(320, 70%, 75%)', 0.3, 'hsl(320, 85%, 60%)'],
        'commercial_services',    ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(260, 70%, 75%)', 0.3, 'hsl(250, 75%, 60%)'],
        'park',                   ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(110, 55%, 65%)', 0.3, 'hsl(110, 70%, 28%)'],
        // default
        ['interpolate', ['linear'], ['measure-light', 'brightness'], 0.25, 'hsl(210, 20%, 70%)', 0.3, 'hsl(210, 20%, 43%)'],
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

// ============================================================================
// MEASURE TOOL LAYERS
// Internal layers for the measure tool (line, line case, fill). Colors are set
// at add/update time by MeasureTool from theme.
// ============================================================================

export const MEASURE_SOURCE_ID = 'measure-line'
export const MEASURE_LAYER_ID = 'measure-line-layer'
export const MEASURE_POINTS_LAYER_ID = 'measure-points-layer'
export const MEASURE_FILL_SOURCE_ID = 'measure-fill'
export const MEASURE_FILL_LAYER_ID = 'measure-fill-layer'
export const MEASURE_LINE_CASE_LAYER_ID = 'measure-line-case'

export const EMPTY_MEASURE_LINE_GEOJSON = {
  type: 'Feature' as const,
  properties: {} as Record<string, unknown>,
  geometry: { type: 'LineString' as const, coordinates: [] as number[][] },
}

export const EMPTY_MEASURE_FILL_GEOJSON = {
  type: 'Feature' as const,
  properties: {} as Record<string, unknown>,
  geometry: { type: 'Polygon' as const, coordinates: [[]] as number[][][] },
}

/** Fill layer spec; paint['fill-color'] set by MeasureTool from theme */
export const MEASURE_FILL_LAYER_SPEC = {
  type: 'fill' as const,
  source: MEASURE_FILL_SOURCE_ID,
  paint: {
    'fill-opacity': 0.18,
    'fill-emissive-strength': 1,
  },
} as const

/** Line casing (outline) spec; paint['line-color'] set by MeasureTool from theme */
export const MEASURE_LINE_CASE_LAYER_SPEC = {
  type: 'line' as const,
  source: MEASURE_SOURCE_ID,
  layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
  paint: {
    'line-width': 6,
    'line-emissive-strength': 1,
  },
} as const

/** Primary line spec; paint['line-color'] set by MeasureTool from theme */
export const MEASURE_LINE_LAYER_SPEC = {
  type: 'line' as const,
  source: MEASURE_SOURCE_ID,
  layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
  paint: {
    'line-width': 3,
    'line-emissive-strength': 1,
  },
} as const

// ============================================================================
// RADIUS TOOL LAYERS
// Circle fill and outline for the radius tool. Colors set at add time from theme.
// ============================================================================

export const RADIUS_SOURCE_ID = 'radius-circle'
export const RADIUS_FILL_LAYER_ID = 'radius-fill-layer'
export const RADIUS_LINE_LAYER_ID = 'radius-line-layer'

export const EMPTY_RADIUS_GEOJSON = {
  type: 'Feature' as const,
  properties: {} as Record<string, unknown>,
  geometry: { type: 'Polygon' as const, coordinates: [[]] as number[][][] },
}

/** Fill layer spec; paint['fill-color'] set by RadiusTool from theme */
export const RADIUS_FILL_LAYER_SPEC = {
  type: 'fill' as const,
  source: RADIUS_SOURCE_ID,
  paint: {
    'fill-opacity': 0.18,
    'fill-emissive-strength': 1,
  },
} as const

/** Line (outline) spec; paint['line-color'] set by RadiusTool from theme */
export const RADIUS_LINE_LAYER_SPEC = {
  type: 'line' as const,
  source: RADIUS_SOURCE_ID,
  layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
  paint: {
    'line-width': 3,
    'line-emissive-strength': 1,
  },
} as const

// ============================================================================
// CORE APPLICATION LAYERS
// These layers are required for basic app functionality and are hidden from users
// ============================================================================

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

// ============================================================================
// USER-AVAILABLE LAYERS
// These layers can be shown/hidden by users and some require integrations
// ============================================================================

// Client-side only layers (never persisted to database, always reactive)
export const CLIENT_SIDE_LAYERS = computed(
  (): Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    // Friends location layer (uses Vue markers instead of map layers)
    {
      name: 'Friends',
      icon: 'UsersIcon',
      showInLayerSelector: true,
      visible: true,
      type: LayerType.FRIENDS,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: null,
      order: -1,
      configuration: {
        id: 'friends-locations',
        type: MapboxLayerType.CIRCLE,
        source: 'friends-locations',
      },
    },
    // Mapillary layers (require Mapillary integration)
    {
      name: 'Mapillary Overview',
      icon: 'CameraIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.STREET_VIEW,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Mapillary', // Will be replaced with actual group ID
      order: 0,
      configuration: {
        id: 'mapillary-overview',
        type: MapboxLayerType.CIRCLE,
        source: {
          id: 'mapillary-overview',
          type: SourceType.VECTOR,
          tiles: [
            buildProxyUrl.value('mapillary/mly1_computed_public/2/{z}/{x}/{y}'),
          ],
          minzoom: 0,
          maxzoom: 5,
        },
        'source-layer': 'images',
        paint: {
          'circle-color': '#04CB63',
          'circle-radius': 4,
          'circle-opacity': 1,
          'circle-stroke-color': '#04CB63',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.7,
          'circle-emissive-strength': 1,
        },
      },
    },
    {
      name: 'Mapillary Sequences',
      icon: 'CameraIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.STREET_VIEW,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Mapillary',
      order: 1,
      configuration: {
        id: 'mapillary-sequence',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'mapillary-sequence',
          type: SourceType.VECTOR,
          tiles: [
            buildProxyUrl.value('mapillary/mly1_computed_public/2/{z}/{x}/{y}'),
          ],
          minzoom: 6,
          maxzoom: 14,
        },
        'source-layer': 'sequence',
        paint: {
          'line-color': '#04CB63',
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6,
            0,
            14,
            1,
            22,
            0.5,
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6,
            0,
            7,
            1,
            14,
            2,
          ],
          'line-emissive-strength': 1,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      },
    },
    {
      name: 'Mapillary Images',
      icon: 'CameraIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.STREET_VIEW,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Mapillary',
      order: 2,
      configuration: {
        id: 'mapillary-image',
        type: MapboxLayerType.CIRCLE,
        slot: 'middle',
        source: {
          id: 'mapillary-image',
          type: SourceType.VECTOR,
          tiles: [
            buildProxyUrl.value('mapillary/mly1_computed_public/2/{z}/{x}/{y}'),
          ],
          minzoom: 6,
          maxzoom: 14,
        },
        'source-layer': 'image',
        paint: {
          'circle-color': '#04CB63',
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            0,
            16,
            3,
            22,
            6,
          ],
          'circle-opacity': 1,
          'circle-stroke-color': '#04CB63',
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            0,
            16,
            2,
          ],
          'circle-stroke-opacity': 0.7,
          'circle-emissive-strength': 1,
        },
      },
    },
    // {
    //   name: 'Transitland',
    //   icon: 'TrainIcon',
    //   showInLayerSelector: true,
    //   visible: false,
    //   type: LayerType.CUSTOM,
    //   engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
    //   order: 9,
    //   groupId: null,
    //   configuration: {
    //     id: 'transitland',
    //     type: MapboxLayerType.LINE,
    //     slot: 'middle',
    //     source: {
    //       id: 'transitland',
    //       type: SourceType.VECTOR,
    //       tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
    //       maxzoom: 14,
    //     },
    //     'source-layer': 'routes',
    //     layout: {
    //       'line-cap': 'round',
    //       'line-join': 'round',
    //     },
    //     paint: {
    //       // Variable line width based on route type and zoom
    //       'line-width': [
    //         'interpolate',
    //         ['linear'],
    //         ['zoom'],
    //         8, [
    //           'match',
    //           ['get', 'route_type'],
    //           // Light Rail, Subway, Metro - thicker lines
    //           0, 1.5,  // Tram/Light Rail
    //           1, 2.0,  // Subway/Metro
    //           2, 2.5,  // Rail/Intercity
    //           // Bus routes - thinner lines
    //           3, 1.0,  // Bus
    //           // Ferry, Cable Car, etc - medium lines
    //           4, 1.5,  // Ferry
    //           5, 1.5,  // Cable Tram
    //           6, 1.5,  // Aerial Lift
    //           7, 1.5,  // Funicular
    //           11, 1.0, // Trolleybus
    //           12, 1.5, // Monorail
    //           // Default
    //           1.0
    //         ],
    //         12, [
    //           'match',
    //           ['get', 'route_type'],
    //           // Light Rail, Subway, Metro - thicker lines
    //           0, 2.5,  // Tram/Light Rail
    //           1, 3.0,  // Subway/Metro
    //           2, 3.5,  // Rail/Intercity
    //           // Bus routes - thinner lines
    //           3, 1.5,  // Bus
    //           // Ferry, Cable Car, etc - medium lines
    //           4, 2.0,  // Ferry
    //           5, 2.0,  // Cable Tram
    //           6, 2.0,  // Aerial Lift
    //           7, 2.0,  // Funicular
    //           11, 1.5, // Trolleybus
    //           12, 2.5, // Monorail
    //           // Default
    //           1.5
    //         ],
    //         16, [
    //           'match',
    //           ['get', 'route_type'],
    //           // Light Rail, Subway, Metro - thicker lines
    //           0, 4.0,  // Tram/Light Rail
    //           1, 5.0,  // Subway/Metro
    //           2, 6.0,  // Rail/Intercity
    //           // Bus routes - thinner lines
    //           3, 2.5,  // Bus
    //           // Ferry, Cable Car, etc - medium lines
    //           4, 3.0,  // Ferry
    //           5, 3.0,  // Cable Tram
    //           6, 3.0,  // Aerial Lift
    //           7, 3.0,  // Funicular
    //           11, 2.5, // Trolleybus
    //           12, 4.0, // Monorail
    //           // Default
    //           2.5
    //         ]
    //       ],
    //       // Simple color scheme based on route type - reliable fallbacks
    //       'line-color': [
    //         'match',
    //         ['get', 'route_type'],
    //         0, '#1E88E5',    // Tram/Light Rail - blue
    //         1, '#1565C0',    // Subway/Metro - dark blue
    //         2, '#D32F2F',    // Rail/Intercity - red
    //         3, '#42A5F5',    // Bus - light blue (most common)
    //         4, '#00ACC1',    // Ferry - teal
    //         5, '#8E24AA',    // Cable Tram - purple
    //         6, '#FF7043',    // Aerial Lift - orange
    //         7, '#795548',    // Funicular - brown
    //         11, '#66BB6A',   // Trolleybus - green
    //         12, '#AB47BC',   // Monorail - magenta
    //         // Default fallback
    //         '#42A5F5'
    //       ],
    //       'line-opacity': [
    //         'interpolate',
    //         ['linear'],
    //         ['zoom'],
    //         8, 0.6,
    //         10, 0.8,
    //         12, 0.9,
    //         16, 1.0
    //       ],
    //       'line-emissive-strength': 0.8,
    //     },
    //   },
    // },
    // Transitland Route Active (hitbox/hover layer)
    {
      name: 'Route Active',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 1,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-route-active',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 1,
          'line-color': '#ffff66',
          'line-width': 12,
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1.0,
            0.0,
          ],
        },
      },
    },
    // Rail Outline (route_type 2)
    {
      name: 'Rail Outline',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 2,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-rail-outline',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 2]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 0.2,
          'line-width': 3.0,
          'line-gap-width': 1.0,
          'line-color': '#ffffff',
        },
      },
    },
    // Rail (route_type < 3)
    {
      name: 'Rail',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 3,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-rail',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['<', 'route_type', 3]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 1,
          'line-width': 3.0,
          'line-color': '#666666',
        },
      },
    },
    // Bus Low Outline
    {
      name: 'Bus Low Outline',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 4,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-bus-low-outline',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: [
          'all',
          ['==', 'route_type', 3],
          ['any', ['<=', 'headway_secs', 0], ['>', 'headway_secs', 1260]],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 0.2,
          'line-width': 1.5,
          'line-gap-width': 0.5,
          'line-color': '#ffffff',
        },
      },
    },
    // Bus Low/Unknown
    {
      name: 'Bus Low',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 5,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-bus-low',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: [
          'all',
          ['==', 'route_type', 3],
          ['any', ['<=', 'headway_secs', 0], ['>', 'headway_secs', 1260]],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 1,
          'line-width': 1.5,
          'line-color': '#8acaeb',
        },
      },
    },
    // Bus Medium/High Outline
    {
      name: 'Bus Medium Outline',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 6,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-bus-medium-outline',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: [
          'all',
          ['==', 'route_type', 3],
          ['<=', 'headway_secs', 1260],
          ['>', 'headway_secs', 0],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 0.2,
          'line-width': 2.0,
          'line-gap-width': 1.0,
          'line-color': '#ffffff',
        },
      },
    },
    // Bus Medium/High
    {
      name: 'Bus Medium',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 7,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-bus-medium',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: [
          'all',
          ['==', 'route_type', 3],
          ['<=', 'headway_secs', 1260],
          ['>', 'headway_secs', 0],
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 1,
          'line-width': 2.0,
          'line-color': '#1c96d6',
        },
      },
    },
    // Tram Outline (route_type 0)
    {
      name: 'Tram Outline',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 8,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-tram-outline',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 0]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 0.2,
          'line-width': 3.0,
          'line-gap-width': 1.0,
          'line-color': '#ffffff',
        },
      },
    },
    // Tram (route_type 0)
    {
      name: 'Tram',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 9,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-tram',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 0]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 1,
          'line-width': 3.0,
          'line-color': ['coalesce', ['get', 'route_color'], '#ff9966'],
        },
      },
    },
    // Metro Outline (route_type 1)
    {
      name: 'Metro Outline',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 10,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-metro-outline',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 1]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 0.2,
          'line-width': 3.0,
          'line-gap-width': 1.0,
          'line-color': '#ffffff',
        },
      },
    },
    // Metro (route_type 1)
    {
      name: 'Metro',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 11,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-metro',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 1]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-emissive-strength': 1,
          'line-width': 3.0,
          'line-color': ['coalesce', ['get', 'route_color'], '#ff0000'],
        },
      },
    },
    // Other Routes Outline (route_type > 3)
    {
      name: 'Other Routes Outline',
      icon: 'TrainIcon',
      showInLayerSelector: false,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 12,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-other-outline',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['>', 'route_type', 3]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': [
            'step',
            ['get', 'headway_secs'],
            1.5,
            1,
            2.5,
            600,
            1.5,
            1200,
            1.5,
          ],
          'line-gap-width': [
            'step',
            ['get', 'headway_secs'],
            0.5,
            1,
            1.0,
            600,
            0.5,
            1200,
            0.5,
          ],
          'line-color': '#ffffff',
          'line-emissive-strength': 0.2,
        },
      },
    },
    // Other Routes (route_type > 3)
    {
      name: 'Other Routes',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 13,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-other',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['>', 'route_type', 3]],
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-opacity': 1.0,
          'line-width': [
            'step',
            ['get', 'headway_secs'],
            1,
            1,
            2,
            600,
            1,
            1200,
            1,
          ],
          'line-color': '#E6A615',
          'line-emissive-strength': 1,
        },
      },
    },
    // Route Labels - Tram
    {
      name: 'Tram Labels',
      icon: 'TrainIcon',
      showInLayerSelector: false, // Managed with tram layer
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 16,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-tram-labels',
        type: MapboxLayerType.SYMBOL,
        slot: 'top',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 0]],
        minzoom: 12, // Only show labels at higher zoom levels
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['!=', ['get', 'route_long_name'], ''],
            ['get', 'route_long_name'],
            ['!=', ['get', 'route_short_name'], ''],
            ['get', 'route_short_name'],
            '',
          ],
          'text-font': [
            ['concat', ['config', 'font'], ' Bold'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            10,
            14,
            11,
            16,
            12,
            18,
            13,
          ],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 400,
          'text-max-angle': 30,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': [
            'case',
            [
              'all',
              ['!=', ['get', 'route_color'], ''],
              ['!=', ['get', 'route_color'], '#000'],
              ['!=', ['get', 'route_color'], '#000000'],
              ['!=', ['get', 'route_color'], 'black'],
            ],
            [
              'case',
              ['!=', ['slice', ['get', 'route_color'], 0, 1], '#'],
              ['concat', '#', ['get', 'route_color']],
              ['get', 'route_color'],
            ],
            '#ff9966',
          ],
          'text-halo-width': 2,
          'text-halo-blur': 0,
          'text-halo-color': '#ffffff',
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            0.8,
            14,
            0.9,
            16,
            1.0,
          ],
          'line-emissive-strength': 1,
        },
      },
    },
    // Route Labels - Metro
    {
      name: 'Metro Labels',
      icon: 'TrainIcon',
      showInLayerSelector: false, // Managed with metro layer
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 17,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-metro-labels',
        type: MapboxLayerType.SYMBOL,
        slot: 'top',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['==', 'route_type', 1]],
        minzoom: 12,
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['!=', ['get', 'route_long_name'], ''],
            ['get', 'route_long_name'],
            ['!=', ['get', 'route_short_name'], ''],
            ['get', 'route_short_name'],
            '',
          ],
          'text-font': [
            ['concat', ['config', 'font'], ' Bold'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            10,
            14,
            11,
            16,
            12,
            18,
            13,
          ],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 400,
          'text-max-angle': 30,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'line-emissive-strength': 1,
          'text-color': [
            'case',
            [
              'all',
              ['!=', ['get', 'route_color'], ''],
              ['!=', ['get', 'route_color'], '#000'],
              ['!=', ['get', 'route_color'], '#000000'],
              ['!=', ['get', 'route_color'], 'black'],
            ],
            [
              'case',
              ['!=', ['slice', ['get', 'route_color'], 0, 1], '#'],
              ['concat', '#', ['get', 'route_color']],
              ['get', 'route_color'],
            ],
            '#ff0000',
          ],
          'text-halo-width': 2,
          'text-halo-blur': 0,
          'text-halo-color': '#ffffff',
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            0.8,
            14,
            0.9,
            16,
            1.0,
          ],
        },
      },
    },
    // Route Labels - Rail
    {
      name: 'Rail Labels',
      icon: 'TrainIcon',
      showInLayerSelector: false, // Managed with rail layer
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 18,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-rail-labels',
        type: MapboxLayerType.SYMBOL,
        slot: 'top',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['<', 'route_type', 3]],
        minzoom: 12,
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['!=', ['get', 'route_long_name'], ''],
            ['get', 'route_long_name'],
            ['!=', ['get', 'route_short_name'], ''],
            ['get', 'route_short_name'],
            '',
          ],
          'text-font': [
            ['concat', ['config', 'font'], ' Bold'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            10,
            14,
            11,
            16,
            12,
            18,
            13,
          ],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 400,
          'text-max-angle': 30,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': [
            'case',
            [
              'all',
              ['!=', ['get', 'route_color'], ''],
              ['!=', ['get', 'route_color'], '#000'],
              ['!=', ['get', 'route_color'], '#000000'],
              ['!=', ['get', 'route_color'], 'black'],
            ],
            [
              'case',
              ['!=', ['slice', ['get', 'route_color'], 0, 1], '#'],
              ['concat', '#', ['get', 'route_color']],
              ['get', 'route_color'],
            ],
            '#666666',
          ],
          'text-halo-width': 2,
          'text-halo-blur': 0,
          'text-halo-color': '#ffffff',
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            0.8,
            14,
            0.9,
            16,
            1.0,
          ],
          'text-emissive-strength': 1,
        },
      },
    },
    // Route Labels - Bus Medium/High
    {
      name: 'Bus Medium Labels',
      icon: 'TrainIcon',
      showInLayerSelector: false, // Managed with bus medium layer
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 19,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-bus-medium-labels',
        type: MapboxLayerType.SYMBOL,
        slot: 'top',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: [
          'all',
          ['==', 'route_type', 3],
          ['<=', 'headway_secs', 1260],
          ['>', 'headway_secs', 0],
        ],
        minzoom: 13, // Show bus labels at higher zoom since they're more numerous
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['!=', ['get', 'route_long_name'], ''],
            ['get', 'route_long_name'],
            ['!=', ['get', 'route_short_name'], ''],
            ['get', 'route_short_name'],
            '',
          ],
          'text-font': [
            ['concat', ['config', 'font'], ' Bold'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            9,
            15,
            10,
            17,
            11,
            19,
            12,
          ],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 300,
          'text-max-angle': 30,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': [
            'case',
            [
              'all',
              ['!=', ['get', 'route_color'], ''],
              ['!=', ['get', 'route_color'], '#000'],
              ['!=', ['get', 'route_color'], '#000000'],
              ['!=', ['get', 'route_color'], 'black'],
            ],
            [
              'case',
              ['!=', ['slice', ['get', 'route_color'], 0, 1], '#'],
              ['concat', '#', ['get', 'route_color']],
              ['get', 'route_color'],
            ],
            '#1c96d6',
          ],
          'text-halo-width': 2,
          'text-halo-blur': 0,
          'text-halo-color': '#ffffff',
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            0.7,
            15,
            0.8,
            17,
            0.9,
            19,
            1.0,
          ],
          'text-emissive-strength': 1,
        },
      },
    },
    // Route Labels - Other Routes
    {
      name: 'Other Routes Labels',
      icon: 'TrainIcon',
      showInLayerSelector: false, // Managed with other routes layer
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 20,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-other-labels',
        type: MapboxLayerType.SYMBOL,
        slot: 'top',
        source: {
          id: 'transitland',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/routes/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'routes',
        filter: ['all', ['>', 'route_type', 3]],
        minzoom: 12,
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'case',
            ['!=', ['get', 'route_long_name'], ''],
            ['get', 'route_long_name'],
            ['!=', ['get', 'route_short_name'], ''],
            ['get', 'route_short_name'],
            '',
          ],
          'text-font': [
            ['concat', ['config', 'font'], ' Bold'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            10,
            14,
            11,
            16,
            12,
            18,
            13,
          ],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 400,
          'text-max-angle': 30,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': [
            'case',
            [
              'all',
              ['!=', ['get', 'route_color'], ''],
              ['!=', ['get', 'route_color'], '#000'],
              ['!=', ['get', 'route_color'], '#000000'],
              ['!=', ['get', 'route_color'], 'black'],
            ],
            [
              'case',
              ['!=', ['slice', ['get', 'route_color'], 0, 1], '#'],
              ['concat', '#', ['get', 'route_color']],
              ['get', 'route_color'],
            ],
            '#E6A615',
          ],
          'text-halo-width': 2,
          'text-halo-blur': 0,
          'text-halo-color': '#ffffff',
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            0.8,
            14,
            0.9,
            16,
            1.0,
          ],
          'text-emissive-strength': 1,
        },
      },
    },
    // Transit Stops
    {
      name: 'Transit Stops',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 21,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-stops',
        type: MapboxLayerType.CIRCLE,
        slot: 'middle',
        source: {
          id: 'transitland-stops',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/stops/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'stops',
        minzoom: 12, // Only show stops at higher zoom levels
        layout: {},
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            2,
            14,
            3,
            16,
            4,
            18,
            5,
          ],
          'circle-color': '#007cbf', // Transitland blue for stops
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            1,
            16,
            2,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
          'circle-stroke-opacity': 1.0,
          'circle-emissive-strength': 1,
        },
      },
    },
    // Transit Stop Labels
    {
      name: 'Transit Stop Labels',
      icon: 'TrainIcon',
      showInLayerSelector: false, // Managed with stops layer
      visible: false,
      type: LayerType.TRANSIT,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 22,
      groupId: 'Transit',
      configuration: {
        id: 'transitland-stops-labels',
        type: MapboxLayerType.SYMBOL,
        slot: 'top',
        source: {
          id: 'transitland-stops',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('transitland/stops/{z}/{x}/{y}')],
          maxzoom: 14,
        },
        'source-layer': 'stops',
        minzoom: 14, // Only show labels at high zoom
        filter: ['has', 'stop_name'],
        layout: {
          'text-field': ['get', 'stop_name'],
          'text-font': [
            ['concat', ['config', 'font'], ' Medium'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            9,
            16,
            10,
            18,
            11,
          ],
          'text-offset': [1, 0],
          'text-anchor': 'left',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-sort-key': 100,
        },
        paint: {
          'text-color': [
            'interpolate',
            ['linear'],
            ['measure-light', 'brightness'],
            0.25,
            'hsl(0, 0%, 95%)',
            0.3,
            'hsl(0, 0%, 15%)',
          ],
          'text-halo-width': 1.5,
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
          'text-emissive-strength': 1,
        },
      },
    },
  ],
)

// Database-persisted layer templates that users can add to their account
export const USER_LAYER_TEMPLATES = computed(
  (): Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    // General overlay layers
    {
      name: 'CyclOSM',
      icon: 'BikeIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 3,
      groupId: null,
      configuration: {
        id: 'cyclosm',
        type: MapboxLayerType.RASTER,
        slot: 'middle',
        source: {
          id: 'cyclosm',
          type: SourceType.RASTER,
          tiles: [
            'https://a.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution:
            '<a href="https://www.opencyclemap.org/">© OpenCycleMap</a>',
        },
        paint: {
          'raster-emissive-strength': 0.9,
          'raster-hue-rotate': 290,
          'raster-saturation': 0.3,
        },
      },
    },
    {
      name: 'Waymarked Trails',
      icon: 'BikeIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 4,
      groupId: null,
      configuration: {
        id: 'waymarkedTrails',
        type: MapboxLayerType.RASTER,
        slot: 'middle',
        source: {
          id: 'waymarkedTrails',
          type: SourceType.RASTER,
          tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
          tileSize: 512,
          attribution:
            '<a href="https://cycling.waymarkedtrails.org/">© Waymarked Trails</a>',
        },
      },
    },

    // Loom Transit layers
    {
      name: 'Loom Light Rail',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Loom Transit',
      order: 5,
      configuration: {
        id: 'loom-light-rail',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'loom-light-rail',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('loom/subway-lightrail/geo/{z}/{x}/{y}')],
          maxzoom: 17,
        },
        'source-layer': 'lines',
        paint: {
          'line-color': ['concat', '#', ['get', 'color']],
          'line-width': 5,
          'line-opacity': 1,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.15,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      },
    },
    {
      name: 'Loom Tram',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Loom Transit',
      order: 6,
      configuration: {
        id: 'loom-tram',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'loom-tram',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('loom/tram/geo/{z}/{x}/{y}')],
          maxzoom: 17,
        },
        'source-layer': 'lines',
        paint: {
          'line-color': ['concat', '#', ['get', 'color']],
          'line-width': 5,
          'line-opacity': 1,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.15,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      },
    },
    {
      name: 'Loom Rail (Commuter)',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Loom Transit',
      order: 7,
      configuration: {
        id: 'loom-rail-commuter',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'loom-rail-commuter',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('loom/rail-commuter/geo/{z}/{x}/{y}')],
          maxzoom: 17,
        },
        'source-layer': 'lines',
        paint: {
          'line-color': ['concat', '#', ['get', 'color']],
          'line-width': 5,
          'line-opacity': 1,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.15,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      },
    },
    {
      name: 'Loom Rail (Long Distance)',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      groupId: 'Loom Transit',
      order: 8,
      configuration: {
        id: 'loom-rail',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'loom-rail',
          type: SourceType.VECTOR,
          tiles: [buildProxyUrl.value('loom/rail/geo/{z}/{x}/{y}')],
          maxzoom: 17,
        },
        'source-layer': 'lines',
        paint: {
          'line-color': ['concat', '#', ['get', 'color']],
          'line-width': 5,
          'line-opacity': 1,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.15,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      },
    },

    // Mapbox-specific layers
    {
      name: 'Mapbox traffic',
      icon: 'CarFrontIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX],
      order: 10,
      groupId: null,
      configuration: {
        id: 'traffic',
        type: MapboxLayerType.LINE,
        slot: 'middle',
        source: {
          id: 'traffic',
          type: SourceType.VECTOR,
          url: 'mapbox://mapbox.mapbox-traffic-v1',
          attribution: 'Mapbox',
        },
        'source-layer': 'traffic',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 20, 7],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 14, 0, 20, 2],
          'line-color': [
            'match',
            ['get', 'congestion'],
            'low',
            '#1A9641',
            'moderate',
            '#EED322',
            'heavy',
            '#E6B71E',
            'severe',
            '#DA3838',
            '#000000',
          ],
          'line-opacity': 0.8,
          'line-occlusion-opacity': 0.15,
          'line-emissive-strength': 1,
        },
      },
    },
    {
      name: 'Hillshade',
      icon: 'MountainSnowIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX],
      groupId: 'Terrain',
      order: 11,
      configuration: {
        id: 'hillshade',
        type: MapboxLayerType.HILLSHADE,
        source: {
          id: 'terrain-rgb',
          type: SourceType.RASTER_DEM,
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        },
        paint: {
          'hillshade-shadow-color': '#0f172a',
          'hillshade-highlight-color': '#fef3c7',
          'hillshade-accent-color': '#fcd34d',
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': 1,
        },
      },
    },
    {
      name: 'Contours',
      icon: 'MountainSnowIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX],
      groupId: 'Terrain',
      order: 12,
      configuration: {
        id: 'contours',
        type: MapboxLayerType.LINE,
        source: {
          id: 'contours',
          type: SourceType.VECTOR,
          url: 'mapbox://mapbox.mapbox-terrain-v2',
        },
        'source-layer': 'contour',
        paint: {
          'line-color': '#334155',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 1],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            0.5,
            16,
            0.8,
          ],
        },
        layout: {
          'line-join': 'round',
        },
      },
    },
    {
      name: 'Contour Labels',
      icon: 'MountainSnowIcon',
      showInLayerSelector: true,
      visible: false,
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX],
      groupId: 'Terrain',
      order: 13,
      configuration: {
        id: 'contour-labels',
        type: MapboxLayerType.SYMBOL,
        source: {
          id: 'contours',
          type: SourceType.VECTOR,
          url: 'mapbox://mapbox.mapbox-terrain-v2',
        },
        'source-layer': 'contour',
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
        layout: {
          'symbol-placement': 'line',
          'text-field': ['concat', ['get', 'ele'], 'm'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 10,
          'text-letter-spacing': 0.1,
          'text-max-angle': 30,
          'text-padding': 5,
          'text-spacing': 500,
        },
      },
    },
  ],
)

// Client-side layer groups (never persisted to database)
export const CLIENT_SIDE_LAYER_GROUP_TEMPLATES = computed(
  (): Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    {
      name: 'Mapillary',
      icon: 'CameraIcon',
      showInLayerSelector: true,
      visible: false,
      order: 0,
    },
    {
      name: 'Transit',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      order: 1,
    },
  ],
)

// Database-persisted layer group templates that users can have
export const USER_LAYER_GROUP_TEMPLATES = computed(
  (): Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    {
      name: 'Loom Transit',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      order: 1,
    },
    {
      name: 'Terrain',
      icon: 'MountainSnowIcon',
      showInLayerSelector: true,
      visible: false,
      order: 2,
    },
  ],
)

// Integration requirements for layers
export const LAYER_INTEGRATION_REQUIREMENTS = {
  'mapillary-overview': 'mapillary',
  'mapillary-sequence': 'mapillary',
  'mapillary-image': 'mapillary',
  'loom-light-rail': 'loom',
  'loom-tram': 'loom',
  'loom-rail-commuter': 'loom',
  'loom-rail': 'loom',
  'transitland-route-active': 'transitland',
  'transitland-rail-outline': 'transitland',
  'transitland-rail': 'transitland',
  'transitland-bus-low-outline': 'transitland',
  'transitland-bus-low': 'transitland',
  'transitland-bus-medium-outline': 'transitland',
  'transitland-bus-medium': 'transitland',
  'transitland-tram-outline': 'transitland',
  'transitland-tram': 'transitland',
  'transitland-metro-outline': 'transitland',
  'transitland-metro': 'transitland',
  'transitland-other-outline': 'transitland',
  'transitland-other': 'transitland',
  'transitland-tram-labels': 'transitland',
  'transitland-metro-labels': 'transitland',
  'transitland-rail-labels': 'transitland',
  'transitland-bus-medium-labels': 'transitland',
  'transitland-other-labels': 'transitland',
  'transitland-stops': 'transitland',
  'transitland-stops-labels': 'transitland',
} as const
