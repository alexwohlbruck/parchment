import { describe, expect, it } from 'vitest'
import { edgeHint, intersectRect } from './edge-hint'

const area = { x: 0, y: 0, width: 400, height: 800 }

describe('edgeHint', () => {
  it('is null while the point is inside the area', () => {
    expect(edgeHint({ x: 200, y: 400 }, area, 32)).toBeNull()
    expect(edgeHint({ x: 400, y: 800 }, area, 32)).toBeNull()
  })

  it('sits on the inset edge facing the point', () => {
    const hint = edgeHint({ x: 1000, y: 400 }, area, 32)!
    expect(hint.x).toBe(368)
    expect(hint.y).toBe(400)
    expect(hint.angle).toBe(0)
  })

  it('follows the line from the centre toward the point', () => {
    // 200px left and 800px up of centre: the top edge is reached first.
    const hint = edgeHint({ x: 0, y: -400 }, area, 32)!
    expect(hint.y).toBeCloseTo(32)
    expect(hint.x).toBeCloseTo(200 - 368 / 4)
    expect(hint.angle).toBeCloseTo(Math.atan2(-800, -200))
  })

  it('settles in a corner for a diagonal point', () => {
    const hint = edgeHint({ x: 200 + 1680, y: 400 + 3680 }, area, 32)!
    expect(hint.x).toBeCloseTo(368)
    expect(hint.y).toBeCloseTo(768)
  })

  it('stays above a bottom sheet', () => {
    const sheetless = { x: 0, y: 0, width: 400, height: 300 }
    const hint = edgeHint({ x: 200, y: 600 }, sheetless, 32)!
    expect(hint).toMatchObject({ x: 200, y: 268 })
  })

  it('is null when the area is smaller than the inset', () => {
    expect(edgeHint({ x: 500, y: 10 }, { x: 0, y: 0, width: 400, height: 50 }, 32)).toBeNull()
  })
})

describe('intersectRect', () => {
  it('clips to the overlap', () => {
    expect(
      intersectRect({ x: -100, y: 0, width: 500, height: 900 }, area),
    ).toEqual({ x: 0, y: 0, width: 400, height: 800 })
  })

  it('collapses to zero size when the rects do not meet', () => {
    const rect = intersectRect({ x: 500, y: 0, width: 10, height: 10 }, area)
    expect(rect.width).toBe(0)
  })
})
