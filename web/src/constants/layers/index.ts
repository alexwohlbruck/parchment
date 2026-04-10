// Barrel re-exports for the client-side layer constants that survived the
// server-side defaults refactor. The modules for cycling / transit /
// mapillary / friends / user templates / integration requirements / layer
// group templates were all deleted — their authoritative source now lives
// in `server/src/constants/default-layers/*` and is fetched via the
// `/layers/defaults` endpoint.

// Helpers
export {
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
  serverUrl,
  buildProxyUrl,
} from './helpers'

// Core layers (client-only: search results, place polygons, etc.)
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

// Tool layers (measure, radius)
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
