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
