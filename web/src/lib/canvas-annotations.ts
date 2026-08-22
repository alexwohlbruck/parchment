/**
 * Annotations — the things you draw straight onto a canvas.
 *
 * Deliberately not layers. Dropping a pin or ringing an area is the fastest
 * thing anyone does on a map, and making that create a layer first put filing
 * between the user and the mark. Layers are for data that came from somewhere;
 * annotations are for marks you made.
 *
 * Each one stores the positions that were clicked, not the geometry those
 * positions imply. A rectangle stays two corners and a circle stays a centre
 * and a radius, so they remain what they are — and the document stays small,
 * which matters because it is saved whole.
 */

import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, Position } from 'geojson'
import type { AnnotationTool, CanvasAnnotation } from '@/types/canvas.types'

/** How many clicks a tool needs before it can be committed. */
export const TOOL_MINIMUM: Record<AnnotationTool, number> = {
  pin: 1,
  line: 2,
  polygon: 3,
  rectangle: 2,
  circle: 2,
}

/**
 * Tools that finish on their own once they have what they need. A rectangle
 * is two corners and a circle is a centre and an edge — there is nothing to
 * add, so waiting for a Done press would only be ceremony.
 */
export const TOOL_AUTOCOMPLETES: Record<AnnotationTool, boolean> = {
  pin: true,
  line: false,
  polygon: false,
  rectangle: true,
  circle: true,
}

export const DEFAULT_ANNOTATION_COLOR = '#e11d48'

/** Circle geometry is approximated by a ring; 64 steps reads as smooth. */
const CIRCLE_STEPS = 64

export function metersBetween(a: Position, b: Position): number {
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' })
}

/** The four corners implied by two opposite ones, closed. */
function rectangleRing(a: Position, b: Position): Position[] {
  const [x1, y1] = a
  const [x2, y2] = b
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
    [x1, y1],
  ]
}

/**
 * The GeoJSON an annotation draws as, or null when it doesn't yet have enough
 * positions — which is the normal state mid-draw.
 */
export function annotationFeature(
  annotation: CanvasAnnotation,
): Feature | null {
  const { tool, positions } = annotation
  // A committed circle keeps its centre and a radius, so it needs one
  // position where drawing one needs two.
  const needed =
    tool === 'circle' && annotation.radiusMeters ? 1 : TOOL_MINIMUM[tool]
  if (positions.length < needed) return null

  const properties = {
    id: annotation.id,
    tool,
    color: annotation.color ?? DEFAULT_ANNOTATION_COLOR,
    label: annotation.label ?? '',
  }

  switch (tool) {
    case 'pin':
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positions[0] },
        properties,
      }
    case 'line':
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: positions },
        properties,
      }
    case 'polygon':
      return {
        type: 'Feature',
        geometry: {
          // Rings must close on themselves; the user shouldn't have to click
          // the first vertex again to say so.
          type: 'Polygon',
          coordinates: [[...positions, positions[0]]],
        },
        properties,
      }
    case 'rectangle':
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [rectangleRing(positions[0], positions[1])],
        },
        properties,
      }
    case 'circle': {
      const radius =
        annotation.radiusMeters ?? metersBetween(positions[0], positions[1])
      if (!radius) return null
      const circle = turf.circle(positions[0], radius, {
        steps: CIRCLE_STEPS,
        units: 'meters',
      })
      return { ...circle, properties } as Feature
    }
  }
}

/** Everything drawn on a canvas, as one collection for one map source. */
export function annotationsCollection(
  annotations: CanvasAnnotation[] | undefined,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (annotations ?? [])
      .filter(annotation => annotation.visible !== false)
      .map(annotationFeature)
      .filter((feature): feature is Feature => feature !== null),
  }
}

/** A fresh annotation from a tool and the positions clicked for it. */
export function createAnnotation(
  tool: AnnotationTool,
  positions: Position[],
  color = DEFAULT_ANNOTATION_COLOR,
): CanvasAnnotation {
  const annotation: CanvasAnnotation = {
    id: `an-${Math.random().toString(36).slice(2, 10)}`,
    tool,
    positions,
    color,
  }
  // A circle's radius is fixed when it's drawn: keeping it as a distance
  // means the shape survives its centre being moved later.
  if (tool === 'circle' && positions.length >= 2) {
    annotation.radiusMeters = metersBetween(positions[0], positions[1])
    annotation.positions = [positions[0]]
  }
  return annotation
}

/** Whether a tool has enough positions to be committed. */
export function isComplete(tool: AnnotationTool, count: number): boolean {
  return count >= TOOL_MINIMUM[tool]
}
