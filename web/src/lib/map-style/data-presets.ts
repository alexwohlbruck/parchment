/**
 * Turning a data layer into the style layers that draw it.
 *
 * The canvas UI offers four ways to render a set of features — points, lines,
 * shapes, a heatmap — rather than the nine layer types the style spec has,
 * because that is the choice people actually make about their own data. Each
 * one expands here into the layers the engine needs, which is sometimes more
 * than one: shapes want a fill and an outline, points want a dot and
 * (optionally) a label above it.
 *
 * A `filter` on each layer keeps a mixed document honest — a KML with both
 * tracks and waypoints drawn as "shapes" should show its polygons rather than
 * nothing, and the point layers shouldn't try to draw a LineString.
 */

import type { CanvasDataRender, CanvasDataStyle } from '@/types/canvas.types'

/** One style layer, with its source already resolved to an id. */
export interface PresetLayer {
  /** Suffix appended to the canvas layer's id, so ids stay stable. */
  suffix: string
  configuration: Record<string, unknown>
}

export const DATA_RENDERS: readonly CanvasDataRender[] = [
  'points',
  'lines',
  'shapes',
  'heatmap',
]

const DEFAULTS: Record<CanvasDataRender, Required<Omit<CanvasDataStyle, 'labelProperty'>>> = {
  points: { color: '#2563eb', size: 6, opacity: 0.9 },
  lines: { color: '#2563eb', size: 3, opacity: 0.9 },
  shapes: { color: '#2563eb', size: 2, opacity: 0.35 },
  heatmap: { color: '#2563eb', size: 30, opacity: 0.8 },
}

export function defaultStyleFor(render: CanvasDataRender): CanvasDataStyle {
  return { ...DEFAULTS[render] }
}

/** Geometry filters, so one document can be drawn several ways. */
const POINTS_ONLY = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const LINES_ONLY = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
]
const POLYGONS_ONLY = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
]

export function presetLayers(
  render: CanvasDataRender,
  sourceId: string,
  style: CanvasDataStyle | undefined,
): PresetLayer[] {
  const resolved = { ...DEFAULTS[render], ...style }
  const color = resolved.color
  const size = resolved.size
  const opacity = resolved.opacity

  if (render === 'points') {
    const layers: PresetLayer[] = [
      {
        suffix: '-points',
        configuration: {
          type: 'circle',
          source: sourceId,
          filter: POINTS_ONLY,
          paint: {
            'circle-color': color,
            'circle-radius': size,
            'circle-opacity': opacity,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': Math.min(1, opacity + 0.1),
          },
        },
      },
    ]

    if (style?.labelProperty) {
      layers.push({
        suffix: '-labels',
        configuration: {
          type: 'symbol',
          source: sourceId,
          filter: POINTS_ONLY,
          layout: {
            'text-field': ['coalesce', ['get', style.labelProperty], ''],
            'text-size': 12,
            'text-anchor': 'top',
            // Clear the dot, whatever radius it was given.
            'text-offset': [0, size / 12 + 0.6],
            'text-allow-overlap': false,
            'text-optional': true,
          },
          paint: {
            'text-color': '#111827',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.2,
          },
        },
      })
    }
    return layers
  }

  if (render === 'lines') {
    return [
      {
        suffix: '-lines',
        configuration: {
          type: 'line',
          source: sourceId,
          filter: LINES_ONLY,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': color,
            'line-width': size,
            'line-opacity': opacity,
          },
        },
      },
    ]
  }

  if (render === 'shapes') {
    return [
      {
        suffix: '-fill',
        configuration: {
          type: 'fill',
          source: sourceId,
          filter: POLYGONS_ONLY,
          paint: { 'fill-color': color, 'fill-opacity': opacity },
        },
      },
      {
        suffix: '-outline',
        configuration: {
          type: 'line',
          source: sourceId,
          filter: POLYGONS_ONLY,
          layout: { 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': size, 'line-opacity': 1 },
        },
      },
    ]
  }

  return [
    {
      suffix: '-heatmap',
      configuration: {
        type: 'heatmap',
        source: sourceId,
        filter: POINTS_ONLY,
        paint: {
          'heatmap-radius': size,
          'heatmap-opacity': opacity,
          // Transparent at zero so the layer doesn't wash the whole viewport;
          // the ramp itself is the engine default otherwise.
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(0,0,0,0)',
            0.2,
            'rgba(59,130,246,0.5)',
            0.4,
            'rgba(16,185,129,0.6)',
            0.6,
            'rgba(250,204,21,0.7)',
            0.8,
            'rgba(249,115,22,0.8)',
            1,
            'rgba(239,68,68,0.9)',
          ],
        },
      },
    },
  ]
}

/**
 * The render mode that suits a document, used when data first arrives.
 * Mirrors `inferLayerKind` but speaks the canvas's four modes.
 */
export function inferRender(
  geometryCounts: Record<string, number>,
): CanvasDataRender {
  const points = (geometryCounts.Point ?? 0) + (geometryCounts.MultiPoint ?? 0)
  const lines =
    (geometryCounts.LineString ?? 0) + (geometryCounts.MultiLineString ?? 0)
  const polygons =
    (geometryCounts.Polygon ?? 0) + (geometryCounts.MultiPolygon ?? 0)

  if (polygons >= points && polygons >= lines && polygons > 0) return 'shapes'
  if (lines >= points && lines > 0) return 'lines'
  return 'points'
}

/** Count geometry types in a collection, for `inferRender`. */
export function countGeometries(collection: {
  features?: { geometry?: { type?: string } | null }[]
}): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const feature of collection.features ?? []) {
    const type = feature?.geometry?.type
    if (type) counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}
