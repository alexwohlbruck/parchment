import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  SourceType,
} from '@/types/map.types'
import type { Layer, LayerGroup } from '@/types/map.types'
import { computed } from 'vue'

// Re-export helpers
export {
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
  serverUrl,
  buildProxyUrl,
} from './helpers'

// Re-export core layers
export {
  SEARCH_RESULTS_LAYER_ID,
  SEARCH_RESULTS_SOURCE_ID,
  SEARCH_RESULTS_LABELS_LAYER_ID,
  PLACE_POLYGON_LAYER_ID,
  PLACE_POLYGON_SOURCE_ID,
  PLACE_POLYGON_FILL_LAYER_ID,
  PLACE_POLYGON_STROKE_LAYER_ID,
  SEARCH_RESULTS_LAYER_CONFIG,
  EMPTY_SEARCH_RESULTS_GEOJSON,
  PLACE_POLYGON_FILL_LAYER_CONFIG,
  PLACE_POLYGON_STROKE_LAYER_CONFIG,
  EMPTY_PLACE_POLYGON_GEOJSON,
  CORE_LAYER_IDS,
  CORE_LAYERS,
} from './core-layers'

// Re-export tool layers
export {
  MEASURE_SOURCE_ID,
  MEASURE_LAYER_ID,
  MEASURE_POINTS_LAYER_ID,
  MEASURE_FILL_SOURCE_ID,
  MEASURE_FILL_LAYER_ID,
  MEASURE_LINE_CASE_LAYER_ID,
  EMPTY_MEASURE_LINE_GEOJSON,
  EMPTY_MEASURE_FILL_GEOJSON,
  MEASURE_FILL_LAYER_SPEC,
  MEASURE_LINE_CASE_LAYER_SPEC,
  MEASURE_LINE_LAYER_SPEC,
  RADIUS_SOURCE_ID,
  RADIUS_FILL_LAYER_ID,
  RADIUS_LINE_LAYER_ID,
  EMPTY_RADIUS_GEOJSON,
  RADIUS_FILL_LAYER_SPEC,
  RADIUS_LINE_LAYER_SPEC,
} from './tool-layers'

// Re-export domain layers
export { FRIENDS_LAYER } from './friends-layer'
export { MAPILLARY_LAYERS } from './mapillary-layers'
export { TRANSIT_LAYERS } from './transit-layers'
export { CYCLING_LAYERS } from './cycling-layers'

// Re-export user templates
export { USER_LAYER_TEMPLATES } from './user-layer-templates'

// Re-export groups
export {
  CLIENT_SIDE_LAYER_GROUP_TEMPLATES,
  USER_LAYER_GROUP_TEMPLATES,
} from './layer-groups'

// Re-export integration requirements
export { LAYER_INTEGRATION_REQUIREMENTS } from './integration-requirements'

// Composed computed: all client-side layers (never persisted to database, always reactive)
import { FRIENDS_LAYER } from './friends-layer'
import { MAPILLARY_LAYERS } from './mapillary-layers'
import { TRANSIT_LAYERS } from './transit-layers'
import { CYCLING_LAYERS } from './cycling-layers'

export const CLIENT_SIDE_LAYERS = computed(
  (): Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    FRIENDS_LAYER,
    ...MAPILLARY_LAYERS.value,
    ...TRANSIT_LAYERS.value,
    ...CYCLING_LAYERS.value,
  ],
)
