// This file re-exports from the split layers modules for backward compatibility.
// New code should import directly from '@/constants/layers' or its sub-modules.
//
// NB: the default layer definitions (cycling, transit, mapillary, friends,
// user templates, layer groups, integration requirements) used to live here.
// They were all moved server-side into `server/src/constants/default-layers/*`
// as part of the clone-on-modify refactor and are fetched via `/layers/defaults`.
export {
  // Helpers
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
  serverUrl,
  buildProxyUrl,
  // Core layers
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
  // Tool layers
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
} from './layers'
