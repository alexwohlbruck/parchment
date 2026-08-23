import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import {
  annotationFeature,
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
      '#000000',
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
