import { LayerType, MapEngine, MapboxLayerType, SourceType } from '@/types/map.types'
import type { Layer, LayerGroup } from '@/types/map.types'
import { cssHslToHex } from '@/lib/utils'

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

// Place geometry layer configurations - used for showing place boundaries and lines
export const PLACE_POLYGON_FILL_LAYER_CONFIG: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
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

export const PLACE_POLYGON_STROKE_LAYER_CONFIG: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
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
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.2, 18, 3, 21, 6],
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
export const CORE_LAYERS: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [
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

// Layer templates that users can add to their account
export const USER_LAYER_TEMPLATES: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [
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
          '/api/proxy/mapillary/mly1_computed_public/2/{z}/{x}/{y}',
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
          '/api/proxy/mapillary/mly1_computed_public/2/{z}/{x}/{y}',
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
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 7, 1, 14, 2],
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
          '/api/proxy/mapillary/mly1_computed_public/2/{z}/{x}/{y}',
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
        tiles: [
          '/api/proxy/loom/subway-lightrail/geo/{z}/{x}/{y}',
        ],
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
        tiles: ['/api/proxy/loom/tram/geo/{z}/{x}/{y}'],
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
        tiles: ['/api/proxy/loom/rail-commuter/geo/{z}/{x}/{y}'],
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
        tiles: ['/api/proxy/loom/rail/geo/{z}/{x}/{y}'],
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
    name: 'Transitland',
    icon: 'TrainIcon',
    showInLayerSelector: true,
    visible: false,
    type: LayerType.CUSTOM,
    engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
    order: 9,
    groupId: null,
    configuration: {
      id: 'transitland',
      type: MapboxLayerType.LINE,
      slot: 'middle',
      source: {
        id: 'transitland',
        type: SourceType.VECTOR,
        tiles: ['/api/proxy/transitland/routes/{z}/{x}/{y}'],
        maxzoom: 14,
      },
      'source-layer': 'routes',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'symbol-placement': 'line',
        'text-field': ['get', 'route_long_name'],
        'text-size': 12,
        'text-offset': [0, 1],
      },
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 6],
        'line-color': [
          'match',
          ['get', 'route_type'],
          0,
          ['coalesce', ['get', 'route_color'], 'blue'],
          1,
          ['coalesce', ['get', 'route_color'], 'blue'],
          2,
          'red',
          3,
          ['coalesce', ['get', 'route_color'], 'lightblue'],
          4,
          'blue',
          5,
          'purple',
          6,
          'pink',
          7,
          'brown',
          11,
          'black',
          12,
          'red',
          'grey',
        ],
        'line-occlusion-opacity': 0.15,
        'line-emissive-strength': 1,
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 0.8],
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
]

// Layer group templates that users can have
export const USER_LAYER_GROUP_TEMPLATES: Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Mapillary',
    icon: 'CameraIcon',
    showInLayerSelector: true,
    visible: false,
    order: 0,
  },
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
]

// Integration requirements for layers
export const LAYER_INTEGRATION_REQUIREMENTS = {
  'mapillary-overview': 'mapillary',
  'mapillary-sequence': 'mapillary',
  'mapillary-image': 'mapillary',
  'loom-light-rail': 'loom',
  'loom-tram': 'loom',
  'loom-rail-commuter': 'loom',
  'loom-rail': 'loom',
  'transitland': 'transitland',
} as const
