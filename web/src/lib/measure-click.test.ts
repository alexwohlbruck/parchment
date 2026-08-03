import { describe, it, expect } from 'vitest'
import { nextMeasurePoints } from './measure-click'
import type { LngLat } from '@/types/map.types'

/**
 * A projection where one degree is one hundred pixels, so pixel thresholds in
 * the geometry map to easy-to-reason-about coordinates.
 */
const project = (ll: LngLat) => ({ x: ll.lng * 100, y: ll.lat * 100 })
const at = (lng: number, lat: number) => ({ lng, lat }) as LngLat
const click = (lng: number, lat: number) => ({
  lngLat: at(lng, lat),
  point: { x: lng * 100, y: lat * 100 },
})

// A horizontal open path: (0,0) → (1,0) → (2,0)
const OPEN = [at(0, 0), at(1, 0), at(2, 0)]

describe('nextMeasurePoints', () => {
  it('appends a click that is nowhere near the path', () => {
    const next = nextMeasurePoints(OPEN, click(5, 5), project, false)
    expect(next).toEqual([...OPEN, at(5, 5)])
  })

  it('inserts a point when the click lands on a segment', () => {
    const next = nextMeasurePoints(OPEN, click(0.5, 0), project, false)!
    expect(next).toHaveLength(4)
    // Inserted between the first two points, not appended.
    expect(next[1]).toMatchObject({ lng: expect.closeTo(0.5, 5) })
    expect(next[0]).toEqual(OPEN[0])
    expect(next[3]).toEqual(OPEN[2])
  })

  it('does not insert a duplicate when the click lands on an existing vertex', () => {
    // Clicking the middle vertex should extend the path, not split it there.
    const next = nextMeasurePoints(OPEN, click(1, 0), project, false)!
    expect(next).toHaveLength(4)
    expect(next[3]).toEqual(at(1, 0))
  })

  it('closes the loop when the click lands back on the first point', () => {
    const next = nextMeasurePoints([at(0, 0), at(1, 0), at(1, 1)], click(0, 0), project, false)!
    expect(next).toHaveLength(4)
    expect(next[3]).toEqual(next[0])
  })

  it('returns null for a closed path with nothing to insert', () => {
    // A closed path has no end to extend, so an unrelated click is a no-op
    // rather than silently appending a stray point.
    const closed = [at(0, 0), at(1, 0), at(1, 1), at(0, 0)]
    expect(nextMeasurePoints(closed, click(9, 9), project, true)).toBeNull()
  })

  it('still inserts into a closed path when the click lands on a segment', () => {
    const closed = [at(0, 0), at(1, 0), at(1, 1), at(0, 0)]
    const next = nextMeasurePoints(closed, click(0.5, 0), project, true)!
    expect(next).toHaveLength(5)
  })

  it('appends when the click is off-screen and cannot be compared to segments', () => {
    const offScreen = () => null
    const next = nextMeasurePoints(OPEN, click(0.5, 0), offScreen, false)
    expect(next).toEqual([...OPEN, at(0.5, 0)])
  })

  it('leaves the input array untouched', () => {
    const before = [...OPEN]
    nextMeasurePoints(OPEN, click(0.5, 0), project, false)
    expect(OPEN).toEqual(before)
  })
})
