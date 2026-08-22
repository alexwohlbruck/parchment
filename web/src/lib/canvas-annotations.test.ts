import { describe, it, expect } from 'vitest'
import {
  annotationFeature,
  annotationsCollection,
  createAnnotation,
  guideFeature,
  isComplete,
  metersBetween,
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
    expect(guideFeature('rectangle', [[0, 0]], cursor)).toBeNull()
    expect(guideFeature('circle', [[0, 0]], cursor)).toBeNull()
    expect(guideFeature('pin', [[0, 0]], cursor)).toBeNull()
  })

  it('offers nothing before the first click, or once the pointer leaves', () => {
    expect(guideFeature('line', [], cursor)).toBeNull()
    expect(guideFeature('line', [[0, 0]], null)).toBeNull()
  })
})

describe('annotationsCollection with a draft', () => {
  it('carries the in-progress shape and its guide alongside the committed ones', () => {
    const collection = annotationsCollection(
      [annotation({ id: 'a', tool: 'pin' })],
      [guideFeature('line', [[0, 0]], [1, 1])],
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[1].properties?.guide).toBe(true)
  })

  it('drops a null guide rather than emitting a hole', () => {
    expect(
      annotationsCollection([annotation({ tool: 'pin' })], [null]).features,
    ).toHaveLength(1)
  })
})
