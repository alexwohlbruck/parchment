/**
 * Writing canvas marks out as GeoJSON, and reading them back in.
 *
 * Each mark carries its own record under a `parchment` property, so a file
 * exported here imports as the same marks rather than as anonymous data. The
 * simplestyle keys ride alongside for every other tool that opens the file.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import {
  DEFAULT_ANNOTATION_COLOR,
  TOOL_MINIMUM,
  annotationFeature,
  annotationStyle,
} from '@/lib/canvas/canvas-annotations'
import {
  newCanvasId,
  type AnnotationTool,
  type CanvasAnnotation,
  type CanvasBody,
} from '@/types/canvas.types'

type StoredAnnotation = Omit<CanvasAnnotation, 'id'>

const AREA_TOOLS: AnnotationTool[] = ['polygon', 'rectangle', 'circle', 'isochrone']

function stored(annotation: CanvasAnnotation): StoredAnnotation {
  const { id: _id, routed, isochrone, ...rest } = annotation
  return {
    ...rest,
    ...(routed && { routed: { ...routed, geometry: [] } }),
    ...(isochrone && { isochrone: { ...isochrone, geometry: [] } }),
  }
}

function simplestyle(
  annotation: CanvasAnnotation,
  resolveColor: (color: string) => string,
) {
  const style = annotationStyle(annotation, resolveColor)
  const color = resolveColor(annotation.color ?? DEFAULT_ANNOTATION_COLOR)
  if (annotation.tool === 'pin') return { 'marker-color': color }
  return {
    stroke: color,
    'stroke-width': style.strokeWidth,
    'stroke-opacity': style.strokeOpacity,
    ...(AREA_TOOLS.includes(annotation.tool) && {
      fill: style.fillColor,
      'fill-opacity': style.fillOpacity,
    }),
  }
}

export function annotationExportFeature(
  annotation: CanvasAnnotation,
  resolveColor: (color: string) => string = color => color,
): Feature | null {
  const drawn = annotationFeature(annotation, resolveColor)
  if (!drawn) return null
  return {
    type: 'Feature',
    geometry: drawn.geometry,
    properties: {
      ...(annotation.label && { name: annotation.label }),
      ...simplestyle(annotation, resolveColor),
      parchment: stored(annotation),
    },
  }
}

/** Every mark, then every inline data layer's features, as one file. */
export function canvasCollection(
  body: Pick<CanvasBody, 'annotations' | 'layers'>,
  resolveColor?: (color: string) => string,
): FeatureCollection {
  const marks = (body.annotations ?? [])
    .map(annotation => annotationExportFeature(annotation, resolveColor))
    .filter((feature): feature is Feature => feature !== null)
  const data = body.layers.flatMap(layer =>
    layer.kind === 'data' ? layer.data.features : [],
  )
  return { type: 'FeatureCollection', features: [...marks, ...data] }
}

function isTool(value: unknown): value is AnnotationTool {
  return typeof value === 'string' && value in TOOL_MINIMUM
}

function outerPolygon(geometry: Geometry): Position[][] | null {
  if (geometry.type === 'Polygon') return geometry.coordinates
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0] ?? null
  return null
}

/** The mark a feature was exported from, or null for anyone else's data. */
export function annotationFromFeature(feature: Feature): CanvasAnnotation | null {
  const record = feature.properties?.parchment as Partial<StoredAnnotation> | undefined
  if (!record || !isTool(record.tool) || !Array.isArray(record.positions)) {
    return null
  }

  const annotation = { ...record, id: newCanvasId('an') } as CanvasAnnotation
  const { geometry } = feature
  if (annotation.routed) {
    if (geometry?.type !== 'LineString') return null
    annotation.routed = { ...annotation.routed, geometry: geometry.coordinates }
  }
  if (annotation.isochrone) {
    const rings = geometry && outerPolygon(geometry)
    if (!rings) return null
    annotation.isochrone = { ...annotation.isochrone, geometry: rings }
  }
  return annotation
}

/** An imported file, split into marks it holds and everything else. */
export function splitAnnotations(collection: FeatureCollection): {
  annotations: CanvasAnnotation[]
  rest: FeatureCollection
} {
  const annotations: CanvasAnnotation[] = []
  const rest: Feature[] = []
  for (const feature of collection.features) {
    const annotation = annotationFromFeature(feature)
    if (annotation) annotations.push(annotation)
    else rest.push(feature)
  }
  return { annotations, rest: { type: 'FeatureCollection', features: rest } }
}

export function geoJsonFilename(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'parchment'}.geojson`
}

export function geoJsonBlob(collection: FeatureCollection): Blob {
  return new Blob([JSON.stringify(collection)], { type: 'application/geo+json' })
}
