import { describe, expect, it } from 'vitest'
import { timelineY } from './timeline-position'

const anchors = [
  { s: 0, y: 10 },
  { s: 100, y: 50 },
  { s: 100, y: 120 },
  { s: 300, y: 220 },
]

describe('timelineY', () => {
  it('has no height without anchors', () => {
    expect(timelineY([], 50)).toBeNull()
  })

  it('interpolates between the anchors either side', () => {
    expect(timelineY(anchors, 50)).toBe(30)
    expect(timelineY(anchors, 200)).toBe(170)
  })

  it('jumps across anchors that share a distance', () => {
    expect(timelineY(anchors, 99.9)).toBeCloseTo(49.96)
    expect(timelineY(anchors, 100.1)).toBeCloseTo(120.05)
  })

  it('clamps to the ends', () => {
    expect(timelineY(anchors, -20)).toBe(10)
    expect(timelineY(anchors, 900)).toBe(220)
  })
})
