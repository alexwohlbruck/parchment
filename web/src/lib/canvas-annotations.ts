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
import {
  circleAreaSquareMeters,
  circleCircumferenceMeters,
  pathLengthMeters,
  polygonAreaSquareMeters,
} from '@/lib/measure.utils'
import type { Feature, FeatureCollection, Position } from 'geojson'
import type {
  AnnotationLabelPosition,
  AnnotationTool,
  CanvasAnnotation,
} from '@/types/canvas.types'

/** How many clicks a tool needs before it can be committed. */
export const TOOL_MINIMUM: Record<AnnotationTool, number> = {
  pin: 1,
  line: 2,
  route: 2,
  polygon: 3,
  // A baseline and then its depth, so a rectangle can sit at any angle.
  rectangle: 3,
  circle: 2,
  // One click sets the origin; the engine supplies the shape.
  isochrone: 1,
}

/**
 * Tools that finish on their own once they have what they need. A rectangle
 * is a baseline and a depth, a circle is a centre and an edge — there is
 * nothing to add, so waiting for a Done press would only be ceremony.
 */
export const TOOL_AUTOCOMPLETES: Record<AnnotationTool, boolean> = {
  pin: true,
  line: false,
  // A route keeps taking waypoints until you say you're done, like a line.
  route: false,
  polygon: false,
  rectangle: true,
  circle: true,
  // Committed once the engine answers, not when the origin is clicked.
  isochrone: false,
}

/**
 * Marks are coloured from the app's palette, like everything else that can
 * be recoloured — see `THEME_COLORS`. A canvas made before that holds a hex,
 * which still works: a colour is resolved on the way to the map, and a CSS
 * value passes straight through.
 */
export const DEFAULT_ANNOTATION_COLOR = 'compass'

/** Where a label sits when nothing has been chosen. */
export const DEFAULT_LABEL_POSITION: AnnotationLabelPosition = 'bottom'

/** Circle geometry is approximated by a ring; 64 steps reads as smooth. */
const CIRCLE_STEPS = 64

export function metersBetween(a: Position, b: Position): number {
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' })
}

/** Web Mercator metres, where a rectangle's corners can be found with vectors. */
const merc = (position: Position) =>
  turf.toMercator(position as [number, number]) as Position
const wgs = (position: Position) =>
  turf.toWgs84(position as [number, number]) as Position

/**
 * A point partway along the straight line between two positions, measured in
 * the projected space the map draws in.
 *
 * The renderer joins two coordinates with a line that is straight in Web
 * Mercator, not on screen — on a globe, and anywhere near the poles, that is
 * a curve. Anything painting the same geometry by hand has to walk the same
 * path or it will not sit on top of what the map drew.
 */
export function mercatorLerp(a: Position, b: Position, t: number): Position {
  const [ax, ay] = merc(a)
  const [bx, by] = merc(b)
  return wgs([ax + (bx - ax) * t, ay + (by - ay) * t])
}

/**
 * The corners of a rectangle, closed.
 *
 * Three positions describe one at any angle: the first two are a baseline,
 * and the third sets how deep the rectangle runs from it. Two positions are
 * read as opposite corners of an upright one — which is what rectangles drawn
 * before they could be angled still hold.
 */
export function rectangleRing(positions: Position[]): Position[] {
  const [a, b, c] = positions
  if (!c) {
    const [x1, y1] = a
    const [x2, y2] = b
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]
  }

  const [ax, ay] = merc(a)
  const [bx, by] = merc(b)
  const [cx, cy] = merc(c)
  const length = Math.hypot(bx - ax, by - ay) || 1
  // The baseline, and the direction at right angles to it.
  const [ux, uy] = [(bx - ax) / length, (by - ay) / length]
  const [nx, ny] = [-uy, ux]
  // How far the third click sits off the baseline, signed so the rectangle
  // opens towards it.
  const depth = (cx - bx) * nx + (cy - by) * ny

  return [
    [ax, ay],
    [bx, by],
    [bx + nx * depth, by + ny * depth],
    [ax + nx * depth, ay + ny * depth],
    [ax, ay],
  ].map(wgs)
}

/** The bearing a rectangle's baseline runs along, and how long it is. */
function baseline(a: Position, b: Position) {
  const [ax, ay] = merc(a)
  const [bx, by] = merc(b)
  return { length: Math.hypot(bx - ax, by - ay), ax, ay, bx, by }
}

/** Angles that shift snaps a line to, the way every drawing tool does it. */
const SNAP_DEGREES = 15

/**
 * Radii worth landing on exactly. A circle drawn to "about 500 m" is nearly
 * always meant to be 500 m, so shift makes it so.
 */
function niceRadius(meters: number): number {
  if (meters <= 0) return meters
  const magnitude = 10 ** Math.floor(Math.log10(meters))
  const steps = [1, 2, 2.5, 5, 10].map(step => step * magnitude)
  return steps.reduce((best, step) =>
    Math.abs(step - meters) < Math.abs(best - meters) ? step : best,
  )
}

/**
 * Where a click lands once shift has had its say.
 *
 * Shift constrains rather than snaps to anything on the map: a rectangle's
 * baseline runs at a round angle, its depth matches its length to make a
 * square, and a circle takes a round radius.
 */
export function constrainPosition(
  tool: AnnotationTool,
  positions: Position[],
  cursor: Position,
): Position {
  if (tool === 'rectangle' && positions.length === 1) {
    // The baseline: hold the angle to 15° steps.
    const from = positions[0]
    const bearing = turf.bearing(turf.point(from), turf.point(cursor))
    const snapped = Math.round(bearing / SNAP_DEGREES) * SNAP_DEGREES
    const distance = metersBetween(from, cursor)
    return turf.destination(turf.point(from), distance, snapped, {
      units: 'meters',
    }).geometry.coordinates
  }

  if (tool === 'rectangle' && positions.length === 2) {
    // The depth: match the baseline's length, so the rectangle is a square.
    const { length, ax, ay, bx, by } = baseline(positions[0], positions[1])
    if (!length) return cursor
    const [nx, ny] = [-(by - ay) / length, (bx - ax) / length]
    const [cx, cy] = merc(cursor)
    const depth = (cx - bx) * nx + (cy - by) * ny
    const square = Math.sign(depth || 1) * length
    return wgs([bx + nx * square, by + ny * square])
  }

  if (tool === 'circle' && positions.length === 1) {
    const centre = positions[0]
    const radius = niceRadius(metersBetween(centre, cursor))
    const bearing = turf.bearing(turf.point(centre), turf.point(cursor))
    return turf.destination(turf.point(centre), radius, bearing, {
      units: 'meters',
    }).geometry.coordinates
  }

  if (tool === 'line' || tool === 'polygon' || tool === 'route') {
    const from = positions[positions.length - 1]
    if (!from) return cursor
    const bearing = turf.bearing(turf.point(from), turf.point(cursor))
    const snapped = Math.round(bearing / SNAP_DEGREES) * SNAP_DEGREES
    const distance = metersBetween(from, cursor)
    return turf.destination(turf.point(from), distance, snapped, {
      units: 'meters',
    }).geometry.coordinates
  }

  return cursor
}

/**
 * The GeoJSON an annotation draws as, or null when it doesn't yet have enough
 * positions — which is the normal state mid-draw.
 */
export function annotationFeature(
  annotation: CanvasAnnotation,
  /**
   * Turns a colour name into something the map can paint. Left alone by
   * default so the geometry here stays testable without a document.
   */
  resolveColor: (color: string) => string = color => color,
): Feature | null {
  const { tool, positions } = annotation
  // A committed circle keeps its centre and a radius, so it needs one
  // position where drawing one needs two.
  const needed =
    tool === 'isochrone'
      ? 1
      : tool === 'circle' && annotation.radiusMeters
      ? 1
      : // Two opposite corners still draw: that is what rectangles made
        // before they could be angled hold.
        tool === 'rectangle'
        ? 2
        : TOOL_MINIMUM[tool]
  if (positions.length < needed) return null

  const properties = {
    id: annotation.id,
    tool,
    color: resolveColor(annotation.color ?? DEFAULT_ANNOTATION_COLOR),
    labelPosition: annotation.labelPosition ?? DEFAULT_LABEL_POSITION,
    // An empty label draws nothing, which is also how the label toggle is
    // expressed to the style layer.
    label:
      annotation.labelVisible === false ? '' : (annotation.label ?? ''),
    icon: annotation.icon ?? '',
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
    case 'route':
      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          // Fall back to the straight line between waypoints while the engine
          // is still thinking, so the shape never disappears mid-draw.
          coordinates: annotation.routed?.geometry ?? positions,
        },
        properties: { ...properties, routed: !!annotation.routed },
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
          coordinates: [rectangleRing(positions)],
        },
        properties,
      }
    case 'isochrone': {
      const rings = annotation.isochrone?.geometry
      if (!rings?.length) return null
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          ...properties,
          minutes: annotation.isochrone!.minutes,
          mode: annotation.isochrone!.mode,
        },
      }
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

/**
 * The rubber band from the last placed vertex to the cursor.
 *
 * Drawing without one is guesswork: you click, and nothing happens until the
 * next click. For a polygon it also shows the edge that will close the ring,
 * so the shape you are making is the shape you can see.
 */
export function guideFeature(
  tool: AnnotationTool,
  positions: Position[],
  cursor: Position | null,
): Feature | null {
  if (!cursor || !positions.length) return null
  if (tool === 'pin' || tool === 'circle') return null
  // A rectangle's first click only sets a baseline; there is no shape to
  // preview until the second, so show the line being laid down.
  if (tool === 'rectangle') {
    return positions.length === 1
      ? {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [positions[0], cursor] },
          properties: { guide: true },
        }
      : null
  }

  const last = positions[positions.length - 1]
  const coordinates =
    // A polygon shows both open edges, so the ring reads as a ring.
    tool === 'polygon' && positions.length >= 2
      ? [last, cursor, positions[0]]
      : [last, cursor]

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { guide: true },
  }
}

/**
 * Everything drawn on a canvas, as one collection for one map source.
 * `extra` carries the in-progress annotation and its rubber band.
 */
export function annotationsCollection(
  annotations: CanvasAnnotation[] | undefined,
  /**
   * Which mark is selected, carried on the feature rather than matched by a
   * layer filter. A filter lives in the layer's configuration, so changing it
   * means taking the layer off the map and putting it back; a property rides
   * along with the data the source is already being given.
   */
  selectedId: string | null = null,
  resolveColor: (color: string) => string = color => color,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (annotations ?? [])
      .filter(annotation => annotation.visible !== false)
      .map(annotation => {
        const feature = annotationFeature(annotation, resolveColor)
        if (feature && annotation.id === selectedId) {
          feature.properties = { ...feature.properties, selected: true }
        }
        return feature
      })
      .filter((feature): feature is Feature => feature !== null),
  }
}

/** A fresh annotation from a tool and the positions clicked for it. */
export function createAnnotation(
  tool: AnnotationTool,
  positions: Position[],
  color = DEFAULT_ANNOTATION_COLOR,
  routed?: CanvasAnnotation['routed'],
): CanvasAnnotation {
  const annotation: CanvasAnnotation = {
    id: `an-${Math.random().toString(36).slice(2, 10)}`,
    tool,
    positions,
    color,
    ...(tool === 'route' && routed ? { routed } : {}),
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

/**
 * The handles a committed mark can be reshaped by.
 *
 * These are the positions that were clicked, not the geometry they imply — so
 * a rectangle stays a rectangle when a corner moves, and a circle stays round.
 * A circle's radius has no clicked position left once it is committed, so it
 * gets a handle due east of the centre.
 */
export interface AnnotationNode {
  /** Index into `positions`, or -1 for a circle's radius handle. */
  index: number
  position: Position
  kind: 'vertex' | 'radius'
}

export function annotationNodes(
  annotation: CanvasAnnotation,
): AnnotationNode[] {
  const { tool, positions } = annotation

  if (tool === 'circle' && annotation.radiusMeters) {
    const centre = positions[0]
    if (!centre) return []
    return [
      { index: 0, position: centre, kind: 'vertex' },
      {
        index: -1,
        position: turf.destination(
          turf.point(centre),
          annotation.radiusMeters,
          90,
          { units: 'meters' },
        ).geometry.coordinates,
        kind: 'radius',
      },
    ]
  }

  return positions.map((position, index) => ({
    index,
    position,
    kind: 'vertex' as const,
  }))
}

/**
 * Where a new vertex could be added: the middle of each edge.
 *
 * Only for the shapes made of a run of points. A rectangle's corners are
 * fixed by its three defining clicks, and a circle has no edges to split.
 */
export function annotationMidpoints(
  annotation: CanvasAnnotation,
): { index: number; position: Position }[] {
  const { tool, positions } = annotation
  if (tool !== 'line' && tool !== 'route' && tool !== 'polygon') return []
  if (positions.length < 2) return []

  // A polygon's closing edge can be split too, so its last midpoint wraps.
  const edges = tool === 'polygon' ? positions.length : positions.length - 1
  return Array.from({ length: edges }, (_unused, index) => {
    const from = positions[index]
    const to = positions[(index + 1) % positions.length]
    return {
      index: index + 1,
      position: turf.midpoint(turf.point(from), turf.point(to)).geometry
        .coordinates,
    }
  })
}

/**
 * A mark with one of its nodes moved.
 *
 * Returns the fields that changed rather than the whole annotation, so the
 * caller patches rather than replaces — a route keeps the path it snapped
 * until it is asked for a new one.
 */
export function moveNode(
  annotation: CanvasAnnotation,
  node: Pick<AnnotationNode, 'index' | 'kind'>,
  to: Position,
): Partial<CanvasAnnotation> {
  if (node.kind === 'radius') {
    return { radiusMeters: metersBetween(annotation.positions[0], to) }
  }
  return {
    positions: annotation.positions.map((position, index) =>
      index === node.index ? to : position,
    ),
  }
}

/** A mark with a vertex added partway along it. */
export function insertNode(
  annotation: CanvasAnnotation,
  index: number,
  at: Position,
): Partial<CanvasAnnotation> {
  const positions = [...annotation.positions]
  positions.splice(index, 0, at)
  return { positions }
}

/** A mark with a vertex taken out, or nothing if that would break it. */
export function removeNode(
  annotation: CanvasAnnotation,
  index: number,
): Partial<CanvasAnnotation> | null {
  if (annotation.positions.length <= TOOL_MINIMUM[annotation.tool]) return null
  return {
    positions: annotation.positions.filter((_unused, i) => i !== index),
  }
}

/**
 * Everything the measure tool could tell you about a mark.
 *
 * Measured with its helpers, so a line drawn on a canvas and a distance
 * measured on the map can never disagree about the same path. A shape has
 * more than one number worth knowing — an area is rarely interesting without
 * its perimeter — so this returns the set rather than picking one.
 */
export interface AnnotationMetric {
  /** Which unit formatter reads it. */
  kind: 'length' | 'area'
  /** Translation key under `canvases.annotations.metrics`. */
  key: 'length' | 'perimeter' | 'area' | 'radius' | 'circumference'
  value: number
}

export function annotationMetrics(
  annotation: CanvasAnnotation,
): AnnotationMetric[] {
  const points = (positions: Position[]) =>
    positions.map(([lng, lat]) => ({ lng, lat }))

  switch (annotation.tool) {
    case 'pin':
      return []

    case 'line':
      return [
        {
          kind: 'length',
          key: 'length',
          value: pathLengthMeters(points(annotation.positions)),
        },
      ]

    case 'route':
      return [
        {
          kind: 'length',
          key: 'length',
          value: pathLengthMeters(
            points(annotation.routed?.geometry ?? annotation.positions),
          ),
        },
      ]

    case 'circle': {
      const radius = annotation.radiusMeters
      if (!radius) return []
      return [
        { kind: 'length', key: 'radius', value: radius },
        {
          kind: 'length',
          key: 'circumference',
          value: circleCircumferenceMeters(radius),
        },
        { kind: 'area', key: 'area', value: circleAreaSquareMeters(radius) },
      ]
    }

    case 'isochrone':
    case 'polygon':
    case 'rectangle': {
      const feature = annotationFeature(annotation)
      if (feature?.geometry.type !== 'Polygon') return []
      const ring = points(feature.geometry.coordinates[0])
      return [
        { kind: 'area', key: 'area', value: polygonAreaSquareMeters(ring) },
        { kind: 'length', key: 'perimeter', value: pathLengthMeters(ring) },
      ]
    }
  }
}

/** The one number worth putting in a list, where there is room for one. */
export function annotationMeasurement(
  annotation: CanvasAnnotation,
): AnnotationMetric | null {
  const metrics = annotationMetrics(annotation)
  return metrics.find(m => m.key === 'area') ?? metrics[0] ?? null
}
