import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import {
  annotationFeature,
  annotationMarkerSpec,
  annotationMarkerSpecs,
  annotationIconSpecs,
  annotationStyle,
  smoothStroke,
  annotationMeasurement,
  annotationMetrics,
  annotationMidpoints,
  annotationNodes,
  annotationsCollection,
  constrainPosition,
  createAnnotation,
  guideFeature,
  insertNode,
  isComplete,
  metersBetween,
  moveNode,
  removeNode,
  TOOL_AUTOCOMPLETES,
  TOOL_MINIMUM,
} from './canvas-annotations'
import type { CanvasAnnotation } from '@/types/canvas.types'

/**
 * Annotations store the clicks, not the shape those clicks imply, so the
 * derivation is where the behaviour lives: a polygon has to close itself, a
 * rectangle has to become four corners from two, and a circle has to survive
 * as a centre and a radius rather than a frozen ring.
 */

function annotation(over: Partial<CanvasAnnotation>): CanvasAnnotation {
  return { id: 'a', tool: 'pin', positions: [[0, 0]], ...over } as CanvasAnnotation
}

describe('annotationFeature', () => {
  it('draws a pin as a point', () => {
    const feature = annotationFeature(annotation({ tool: 'pin', positions: [[1, 2]] }))

    expect(feature?.geometry).toEqual({ type: 'Point', coordinates: [1, 2] })
  })

  it('draws a line through every click', () => {
    const feature = annotationFeature(
      annotation({ tool: 'line', positions: [[0, 0], [1, 1], [2, 0]] }),
    )

    expect(feature?.geometry.type).toBe('LineString')
    expect((feature?.geometry as never as { coordinates: number[][] }).coordinates)
      .toHaveLength(3)
  })

  it('closes a polygon so the user never has to click the first vertex twice', () => {
    const feature = annotationFeature(
      annotation({ tool: 'polygon', positions: [[0, 0], [2, 0], [2, 2]] }),
    )
    const ring = (feature?.geometry as never as { coordinates: number[][][] })
      .coordinates[0]

    expect(ring).toHaveLength(4)
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('turns two opposite corners into a rectangle', () => {
    const feature = annotationFeature(
      annotation({ tool: 'rectangle', positions: [[0, 0], [2, 3]] }),
    )
    const ring = (feature?.geometry as never as { coordinates: number[][][] })
      .coordinates[0]

    expect(ring).toEqual([
      [0, 0],
      [2, 0],
      [2, 3],
      [0, 3],
      [0, 0],
    ])
  })

  it('keeps a circle as a centre and a radius, not a frozen ring', () => {
    const drawn = createAnnotation('circle', [[0, 0], [0.01, 0]])

    expect(drawn.positions).toHaveLength(1)
    expect(drawn.radiusMeters).toBeGreaterThan(0)
    // One position is enough once the radius is known.
    expect(annotationFeature(drawn)?.geometry.type).toBe('Polygon')
  })

  it('draws nothing until a tool has the clicks it needs', () => {
    expect(annotationFeature(annotation({ tool: 'line', positions: [[0, 0]] }))).toBeNull()
    expect(
      annotationFeature(annotation({ tool: 'polygon', positions: [[0, 0], [1, 1]] })),
    ).toBeNull()
  })

  it('carries colour and label onto the feature for the paint expressions', () => {
    const feature = annotationFeature(
      annotation({ tool: 'pin', color: '#123456', label: 'Camp' }),
    )

    expect(feature?.properties).toMatchObject({ color: '#123456', label: 'Camp' })
  })
})

describe('the label toggle', () => {
  it('draws a label when there is one', () => {
    const feature = annotationFeature(
      annotation({ tool: 'pin', label: 'Camp' }),
    )

    expect(feature?.properties?.label).toBe('Camp')
  })

  it('withholds it when the toggle is off, keeping the name for the list', () => {
    const withheld = annotation({
      tool: 'pin',
      label: 'Camp',
      labelVisible: false,
    })

    // The style layer draws nothing, but the annotation still knows its name.
    expect(annotationFeature(withheld)?.properties?.label).toBe('')
    expect(withheld.label).toBe('Camp')
  })

  it('treats an unset toggle as visible, so old marks keep their labels', () => {
    expect(
      annotationFeature(annotation({ tool: 'pin', label: 'Camp' }))?.properties
        ?.label,
    ).toBe('Camp')
  })
})

describe('annotationsCollection', () => {
  it('skips hidden annotations and incomplete ones', () => {
    const collection = annotationsCollection([
      annotation({ id: 'a', tool: 'pin' }),
      annotation({ id: 'b', tool: 'pin', visible: false }),
      annotation({ id: 'c', tool: 'polygon', positions: [[0, 0]] }),
    ])

    expect(collection.features).toHaveLength(1)
  })

  it('copes with a canvas that has no annotations at all', () => {
    expect(annotationsCollection(undefined).features).toEqual([])
  })
})

describe('the route tool', () => {
  it('draws the snapped path when the engine has returned one', () => {
    const feature = annotationFeature(
      annotation({
        tool: 'route',
        positions: [[0, 0], [1, 1]],
        routed: {
          geometry: [[0, 0], [0.4, 0.7], [1, 1]],
          mode: 'walking',
        },
      }),
    )

    expect(
      (feature?.geometry as never as { coordinates: number[][] }).coordinates,
    ).toHaveLength(3)
    expect(feature?.properties?.routed).toBe(true)
  })

  it('falls back to the straight line while the engine is still thinking', () => {
    const feature = annotationFeature(
      annotation({ tool: 'route', positions: [[0, 0], [1, 1]] }),
    )

    // The shape must never blink out mid-draw.
    expect(
      (feature?.geometry as never as { coordinates: number[][] }).coordinates,
    ).toEqual([[0, 0], [1, 1]])
    expect(feature?.properties?.routed).toBe(false)
  })

  it('keeps the waypoints alongside the path, so it can be re-snapped', () => {
    const created = createAnnotation(
      'route',
      [[0, 0], [1, 1]],
      { color: '#000000' },
      { geometry: [[0, 0], [0.5, 0.5], [1, 1]], mode: 'cycling' },
    )

    expect(created.positions).toEqual([[0, 0], [1, 1]])
    expect(created.routed?.mode).toBe('cycling')
  })

  it('waits for a second waypoint, like a line', () => {
    expect(TOOL_MINIMUM.route).toBe(2)
    expect(TOOL_AUTOCOMPLETES.route).toBe(false)
  })
})

describe('tool rules', () => {
  it('finishes the tools that know when they are done, and no others', () => {
    expect(TOOL_AUTOCOMPLETES.pin).toBe(true)
    expect(TOOL_AUTOCOMPLETES.rectangle).toBe(true)
    expect(TOOL_AUTOCOMPLETES.circle).toBe(true)
    expect(TOOL_AUTOCOMPLETES.line).toBe(false)
    expect(TOOL_AUTOCOMPLETES.polygon).toBe(false)
  })

  it('knows how many clicks each tool needs', () => {
    expect(isComplete('polygon', TOOL_MINIMUM.polygon)).toBe(true)
    expect(isComplete('polygon', TOOL_MINIMUM.polygon - 1)).toBe(false)
  })

  it('measures a radius in metres', () => {
    // ~0.01° of longitude at the equator is a bit over a kilometre.
    expect(metersBetween([0, 0], [0.01, 0])).toBeGreaterThan(1000)
    expect(metersBetween([0, 0], [0.01, 0])).toBeLessThan(1200)
  })
})

describe('guideFeature', () => {
  const cursor = [5, 5]

  it('rubber-bands from the last vertex to the cursor', () => {
    const guide = guideFeature('line', [[0, 0], [1, 1]], cursor)

    expect((guide?.geometry as never as { coordinates: number[][] }).coordinates)
      .toEqual([[1, 1], cursor])
    expect(guide?.properties?.guide).toBe(true)
  })

  it('shows both open edges of a polygon, so the ring reads as a ring', () => {
    const guide = guideFeature('polygon', [[0, 0], [1, 0], [1, 1]], cursor)

    expect((guide?.geometry as never as { coordinates: number[][] }).coordinates)
      .toEqual([[1, 1], cursor, [0, 0]])
  })

  it('offers nothing for tools that preview as their real shape', () => {
    expect(guideFeature('circle', [[0, 0]], cursor)).toBeNull()
    expect(guideFeature('pin', [[0, 0]], cursor)).toBeNull()
    // A rectangle's depth previews as the shape itself, once it has a baseline.
    expect(guideFeature('rectangle', [[0, 0], [1, 0]], cursor)).toBeNull()
  })

  it('offers nothing before the first click, or once the pointer leaves', () => {
    expect(guideFeature('line', [], cursor)).toBeNull()
    expect(guideFeature('line', [[0, 0]], null)).toBeNull()
  })
})

describe('annotationsCollection selection', () => {
  it('marks the selected mark on its feature rather than in a layer filter', () => {
    const collection = annotationsCollection(
      [annotation({ id: 'a', tool: 'pin' }), annotation({ id: 'b', tool: 'pin' })],
      'b',
    )

    // A filter lives in the layer configuration, so selecting a mark by
    // filter means taking the layer off the map and putting it back.
    expect(collection.features[0].properties?.selected).toBeUndefined()
    expect(collection.features[1].properties?.selected).toBe(true)
  })

  it('marks nothing when there is no selection', () => {
    const collection = annotationsCollection([annotation({ tool: 'pin' })])
    expect(collection.features[0].properties?.selected).toBeUndefined()
  })
})

describe('angled rectangles', () => {
  const ring = (positions: Position[]) =>
    (
      annotationFeature(
        annotation({ tool: 'rectangle', positions }),
      ) as Feature<Polygon>
    ).geometry.coordinates[0]

  it('opens a rectangle at whatever angle its baseline runs', () => {
    // A baseline heading north-east, then a depth off to one side.
    const corners = ring([
      [0, 0],
      [0.01, 0.01],
      [0.02, 0],
    ])

    expect(corners).toHaveLength(5)
    expect(corners[0]).toEqual(corners[4])
    // Nothing is axis-aligned, so no two corners share a coordinate.
    expect(corners[1][0]).not.toBeCloseTo(corners[2][0], 6)
    expect(corners[1][1]).not.toBeCloseTo(corners[2][1], 6)
  })

  it('keeps the corners square', () => {
    const corners = ring([
      [0, 0],
      [0.01, 0.006],
      [0.014, -0.004],
    ])
    const merc = (position: Position) => turf.toMercator(position as [number, number])

    // Adjacent edges of a rectangle meet at a right angle: their dot product
    // is zero however the shape is turned.
    for (let i = 0; i < 3; i++) {
      const [a, b, c] = [corners[i], corners[i + 1], corners[(i + 2) % 4]].map(merc)
      const first = [b[0] - a[0], b[1] - a[1]]
      const second = [c[0] - b[0], c[1] - b[1]]
      const dot = first[0] * second[0] + first[1] * second[1]
      const scale = Math.hypot(...first) * Math.hypot(...second)
      expect(Math.abs(dot / scale)).toBeLessThan(1e-6)
    }
  })

  it('still reads two opposite corners as an upright rectangle', () => {
    // Rectangles made before they could be angled hold only two positions.
    expect(ring([[0, 0], [2, 3]])).toEqual([
      [0, 0],
      [2, 0],
      [2, 3],
      [0, 3],
      [0, 0],
    ])
  })
})

describe('constrainPosition', () => {
  it('squares a rectangle off its baseline', () => {
    const positions: Position[] = [
      [0, 0],
      [0.01, 0],
    ]
    const constrained = constrainPosition('rectangle', positions, [0.008, 0.004])

    const baseline = metersBetween(positions[0], positions[1])
    const depth = metersBetween(positions[1], constrained)
    expect(depth).toBeCloseTo(baseline, 0)
  })

  it('keeps the square on the side the cursor is on', () => {
    const positions: Position[] = [
      [0, 0],
      [0.01, 0],
    ]
    const above = constrainPosition('rectangle', positions, [0.008, 0.004])
    const below = constrainPosition('rectangle', positions, [0.008, -0.004])
    expect(Math.sign(above[1])).toBe(-Math.sign(below[1]))
  })

  it('holds a baseline to a round angle', () => {
    // Just off due east; shift should pull it straight.
    const constrained = constrainPosition('rectangle', [[0, 0]], [0.01, 0.0004])
    const bearing = turf.bearing(turf.point([0, 0]), turf.point(constrained))
    expect(Math.round(bearing) % 15).toBe(0)
  })

  it('rounds a circle to a radius someone would have chosen', () => {
    const centre: Position = [0, 0]
    const rough = turf.destination(turf.point(centre), 480, 90, {
      units: 'meters',
    }).geometry.coordinates
    const constrained = constrainPosition('circle', [centre], rough)
    expect(metersBetween(centre, constrained)).toBeCloseTo(500, 0)
  })

  it('leaves a pin exactly where it was put', () => {
    expect(constrainPosition('pin', [], [1, 2])).toEqual([1, 2])
  })
})

describe('reshaping a mark', () => {
  it('hands back a handle for every position', () => {
    const nodes = annotationNodes(
      annotation({ tool: 'line', positions: [[0, 0], [1, 1], [2, 0]] }),
    )
    expect(nodes.map(node => node.index)).toEqual([0, 1, 2])
    expect(nodes.every(node => node.kind === 'vertex')).toBe(true)
  })

  it('gives a circle a radius handle, since its edge was never a click', () => {
    const nodes = annotationNodes(
      annotation({ tool: 'circle', positions: [[0, 0]], radiusMeters: 500 }),
    )
    expect(nodes.map(node => node.kind)).toEqual(['vertex', 'radius'])
    expect(metersBetween([0, 0], nodes[1].position)).toBeCloseTo(500, 0)
  })

  it('resizes a circle rather than moving its centre', () => {
    const circle = annotation({
      tool: 'circle',
      positions: [[0, 0]],
      radiusMeters: 500,
    })
    const to = turf.destination(turf.point([0, 0]), 900, 90, {
      units: 'meters',
    }).geometry.coordinates

    const patch = moveNode(circle, { index: -1, kind: 'radius' }, to)
    expect(patch.radiusMeters).toBeCloseTo(900, 0)
    expect(patch.positions).toBeUndefined()
  })

  it('moves the position a vertex stands for', () => {
    const line = annotation({ tool: 'line', positions: [[0, 0], [1, 1]] })
    expect(moveNode(line, { index: 1, kind: 'vertex' }, [5, 5]).positions).toEqual(
      [[0, 0], [5, 5]],
    )
  })

  it('offers a midpoint per edge, wrapping a polygon closed', () => {
    const line = annotation({ tool: 'line', positions: [[0, 0], [2, 0], [4, 0]] })
    const polygon = annotation({
      tool: 'polygon',
      positions: [[0, 0], [2, 0], [2, 2]],
    })

    // A line has one fewer edge than it has points; a closed ring has one each.
    expect(annotationMidpoints(line)).toHaveLength(2)
    expect(annotationMidpoints(polygon)).toHaveLength(3)
    expect(annotationMidpoints(annotation({ tool: 'rectangle' }))).toEqual([])
  })

  it('adds a vertex where a midpoint was dragged from', () => {
    const line = annotation({ tool: 'line', positions: [[0, 0], [4, 0]] })
    expect(insertNode(line, 1, [2, 0]).positions).toEqual([[0, 0], [2, 0], [4, 0]])
  })

  it('refuses to take a vertex a shape cannot spare', () => {
    const triangle = annotation({
      tool: 'polygon',
      positions: [[0, 0], [2, 0], [2, 2]],
    })
    expect(removeNode(triangle, 1)).toBeNull()

    const quad = annotation({
      tool: 'polygon',
      positions: [[0, 0], [2, 0], [2, 2], [0, 2]],
    })
    expect(removeNode(quad, 1)?.positions).toHaveLength(3)
  })
})

describe('label and colour on the feature', () => {
  it('resolves a colour name into something the map can paint', () => {
    const feature = annotationFeature(
      annotation({ tool: 'pin', color: 'teal' }),
      color => (color === 'teal' ? '#0d9488' : color),
    )
    expect(feature?.properties?.color).toBe('#0d9488')
  })

  it('leaves a custom colour exactly as it was given', () => {
    const feature = annotationFeature(
      annotation({ tool: 'pin', color: '#123456' }),
      color => color,
    )
    expect(feature?.properties?.color).toBe('#123456')
  })

  it('carries the label position, defaulting to below the mark', () => {
    expect(
      annotationFeature(annotation({ tool: 'pin' }))?.properties?.labelPosition,
    ).toBe('bottom')
    expect(
      annotationFeature(annotation({ tool: 'pin', labelPosition: 'left' }))
        ?.properties?.labelPosition,
    ).toBe('left')
  })
})

describe('annotationMeasurement', () => {
  it('measures a line along its path', () => {
    const measure = annotationMeasurement(
      annotation({ tool: 'line', positions: [[0, 0], [0, 1]] }),
    )
    expect(measure?.kind).toBe('length')
    // A degree of latitude is about 111 km anywhere.
    expect(measure!.value).toBeGreaterThan(110_000)
    expect(measure!.value).toBeLessThan(112_000)
  })

  it('measures a route along the path it snapped to, not its waypoints', () => {
    const straight = annotationMeasurement(
      annotation({ tool: 'route', positions: [[0, 0], [0, 1]] }),
    )!
    const snapped = annotationMeasurement(
      annotation({
        tool: 'route',
        positions: [[0, 0], [0, 1]],
        routed: { geometry: [[0, 0], [0, 0.5], [0, 2]], mode: 'walking' },
      }),
    )!
    expect(snapped.value).toBeGreaterThan(straight.value)
  })

  it('measures the shapes that enclose something by area', () => {
    const polygon = annotationMeasurement(
      annotation({ tool: 'polygon', positions: [[0, 0], [0, 1], [1, 1]] }),
    )
    const circle = annotationMeasurement(
      annotation({ tool: 'circle', positions: [[0, 0]], radiusMeters: 1000 }),
    )

    expect(polygon?.kind).toBe('area')
    expect(circle?.kind).toBe('area')
    // pi r squared, near enough.
    expect(circle!.value).toBeCloseTo(Math.PI * 1000 * 1000, -4)
  })

  it('has nothing to say about a pin', () => {
    expect(annotationMeasurement(annotation({ tool: 'pin' }))).toBeNull()
  })
})

describe('annotationMetrics', () => {
  it('gives a shape its area and its perimeter, not one or the other', () => {
    const metrics = annotationMetrics(
      annotation({ tool: 'polygon', positions: [[0, 0], [0, 1], [1, 1]] }),
    )
    expect(metrics.map(m => m.key)).toEqual(['area', 'perimeter'])
  })

  it('describes a circle three ways', () => {
    const metrics = annotationMetrics(
      annotation({ tool: 'circle', positions: [[0, 0]], radiusMeters: 1000 }),
    )
    expect(metrics.map(m => m.key)).toEqual(['radius', 'circumference', 'area'])
    expect(metrics[1].value).toBeCloseTo(2 * Math.PI * 1000, -1)
  })

  it('measures an isochrone by the ground it covers', () => {
    const metrics = annotationMetrics(
      annotation({
        tool: 'isochrone',
        positions: [[0, 0]],
        isochrone: {
          geometry: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
          mode: 'walk',
          minutes: 15,
        },
      }),
    )
    expect(metrics.map(m => m.key)).toEqual(['area', 'perimeter'])
    expect(metrics[0].value).toBeGreaterThan(0)
  })

  it('leads with the area where a shape has one, and the length otherwise', () => {
    expect(
      annotationMeasurement(
        annotation({ tool: 'polygon', positions: [[0, 0], [0, 1], [1, 1]] }),
      )?.key,
    ).toBe('area')
    expect(
      annotationMeasurement(annotation({ tool: 'line', positions: [[0, 0], [0, 1]] }))
        ?.key,
    ).toBe('length')
  })

  it('draws an isochrone only once the engine has answered', () => {
    // A point is not a reachable area; better to draw nothing than a dot.
    expect(
      annotationFeature(annotation({ tool: 'isochrone', positions: [[0, 0]] })),
    ).toBeNull()
  })
})

describe('smoothStroke', () => {
  /** A shaky hand: a straight run with jitter on every other point. */
  const shaky: Position[] = Array.from({ length: 40 }, (_unused, i) => [
    i * 0.0001,
    (i % 2 ? 1 : -1) * 0.000004,
  ])

  it('drops the points a hand leaves that the shape does not need', () => {
    expect(smoothStroke(shaky).length).toBeLessThan(shaky.length)
  })

  it('never hands back more points than it was given', () => {
    // A canvas is saved whole and encrypted whole, so a stroke that grew
    // while being tidied would be paid for on every save.
    const wavy: Position[] = Array.from({ length: 60 }, (_unused, i) => [
      i * 0.0002,
      Math.sin(i / 4) * 0.0004,
    ])
    expect(smoothStroke(wavy).length).toBeLessThanOrEqual(wavy.length)
  })

  it('rounds what is left, so the line reads as deliberate', () => {
    const smoothed = smoothStroke([
      [0, 0],
      [1, 0],
      [1, 1],
    ])
    // Chaikin cuts the corner, so the turn is no longer on the original point.
    expect(smoothed).not.toContainEqual([1, 0])
    expect(smoothed[0]).toEqual([0, 0])
    expect(smoothed[smoothed.length - 1]).toEqual([1, 1])
  })

  it('leaves a stroke too short to smooth alone', () => {
    expect(smoothStroke([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]])
  })

  it('keeps the stroke roughly where it was drawn', () => {
    const smoothed = smoothStroke(shaky)
    const xs = smoothed.map(p => p[0])
    expect(Math.min(...xs)).toBeCloseTo(0, 5)
    expect(Math.max(...xs)).toBeCloseTo(0.0039, 3)
  })
})

describe('doodles', () => {
  it('draws as the line it was drawn as', () => {
    const feature = annotationFeature(
      annotation({ tool: 'doodle', positions: [[0, 0], [1, 1], [2, 0]] }),
    )
    expect(feature?.geometry.type).toBe('LineString')
  })

  it('carries its own thickness, so one layer can draw every stroke', () => {
    const feature = annotationFeature(
      annotation({ tool: 'doodle', positions: [[0, 0], [1, 1]], strokeWidth: 14 }),
    )
    expect(feature?.properties?.strokeWidth).toBe(14)
  })
})

describe('annotationStyle', () => {
  it('draws a mark that was never styled exactly as it always was', () => {
    const style = annotationStyle(annotation({ tool: 'polygon' }))
    expect(style).toMatchObject({
      strokeWidth: 3,
      strokeOpacity: 1,
      strokeStyle: 'solid',
      fillOpacity: 0.18,
    })
  })

  it('gives a doodle the thickness it was drawn at', () => {
    expect(annotationStyle(annotation({ tool: 'doodle' })).strokeWidth).toBe(4)
    expect(
      annotationStyle(annotation({ tool: 'doodle', strokeWidth: 12 })).strokeWidth,
    ).toBe(12)
  })

  it('fills with the mark\'s own colour until told otherwise', () => {
    expect(annotationStyle(annotation({ tool: 'polygon', color: 'teal' })).fillColor).toBe('teal')
    expect(
      annotationStyle(
        annotation({ tool: 'polygon', color: 'teal', fillColor: 'sky' }),
      ).fillColor,
    ).toBe('sky')
  })

  it('resolves both colours through the same resolver', () => {
    const style = annotationStyle(
      annotation({ tool: 'polygon', fillColor: 'teal' }),
      color => (color === 'teal' ? '#0d9488' : color),
    )
    expect(style.fillColor).toBe('#0d9488')
  })

  it('puts every style property on the feature for the paint to read', () => {
    const feature = annotationFeature(
      annotation({
        tool: 'polygon',
        positions: [[0, 0], [0, 1], [1, 1]],
        strokeStyle: 'dashed',
        fillOpacity: 0.5,
      }),
    )
    expect(feature?.properties).toMatchObject({
      strokeStyle: 'dashed',
      fillOpacity: 0.5,
      strokeWidth: 3,
    })
  })
})

/**
 * A pin's shape decides which of two mechanisms draws it: a disc gets a circle
 * plate with a bare glyph over it, anything else gets a single baked image. So
 * exactly one of the two registration lists has to claim any given pin — a pin
 * in both draws twice, a pin in neither draws nothing.
 */
describe('marker shapes', () => {
  const resolve = (c: string) => c

  it('defaults a pin to a disc, which needs no baked image', () => {
    expect(annotationMarkerSpec(annotation({ tool: 'pin' }), resolve, false)).toBeNull()
  })

  it('bakes a marker for the shapes that carry their own plate', () => {
    for (const markerShape of ['square', 'glyph'] as const) {
      const spec = annotationMarkerSpec(
        annotation({ tool: 'pin', markerShape, icon: 'Train' }),
        resolve,
        false,
      )
      expect(spec).toMatchObject({ shape: markerShape, name: 'Train', pack: 'lucide' })
    }
  })

  it('never bakes one for something that is not a pin', () => {
    expect(
      annotationMarkerSpec(
        annotation({ tool: 'polygon', markerShape: 'square' }),
        resolve,
        false,
      ),
    ).toBeNull()
  })

  it('claims each pin exactly once across the two registration lists', () => {
    const marks = [
      annotation({ id: 'a', tool: 'pin' }),
      annotation({ id: 'b', tool: 'pin', markerShape: 'square' }),
      annotation({ id: 'c', tool: 'pin', markerShape: 'glyph' }),
    ]
    expect(annotationIconSpecs(marks)).toHaveLength(1)
    expect(annotationMarkerSpecs(marks, resolve, false)).toHaveLength(2)
  })

  it('puts the baked image on the feature, and nothing on a disc', () => {
    const disc = annotationFeature(annotation({ tool: 'pin' }), resolve, false)
    const square = annotationFeature(
      annotation({ tool: 'pin', markerShape: 'square' }),
      resolve,
      false,
    )
    expect(disc?.properties?.markerImage).toBe('')
    expect(square?.properties?.markerImage).toContain('pm|square')
    expect(disc?.properties?.markerShape).toBe('disc')
  })

  it('gives the same pin different images by flavor, so it turns with the map', () => {
    const mark = annotation({ tool: 'pin', markerShape: 'square' })
    const day = annotationFeature(mark, resolve, false)?.properties?.markerImage
    const night = annotationFeature(mark, resolve, true)?.properties?.markerImage
    expect(day).not.toBe(night)
  })
})
