import { describe, expect, it } from 'vitest'
import { mercator } from '@/lib/map-decks/decks'
import { standsOnGround, venueOutlines } from './venue-outline'

const piece = (venue: number, ring: number[][]) => ({ properties: { venue }, geometry: { type: 'Polygon', coordinates: [ring] } })

describe('venueOutlines', () => {
  it('joins a venue clipped across tiles back into one outline', () => {
    const west = piece(7, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
    const east = piece(7, [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]])
    const outline = venueOutlines([west, east]).get(7)!
    expect(outline).toHaveLength(4)
    expect(outline).toEqual(expect.arrayContaining([mercator([0, 0]), mercator([2, 0]), mercator([2, 1]), mercator([0, 1])]))
  })

  it('keeps venues apart and skips features without one', () => {
    const outlines = venueOutlines([
      piece(1, [[0, 0], [1, 0], [0, 1], [0, 0]]),
      piece(2, [[5, 5], [6, 5], [5, 6], [5, 5]]),
      { properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1]]] } },
    ])
    expect([...outlines.keys()].sort()).toEqual([1, 2])
  })
})

describe('standsOnGround', () => {
  it('takes a venue with any floor at street level or above, not one wholly underground', () => {
    const venue = (levels: string) => ({ properties: { venue: 1, levels }, geometry: { type: 'Polygon', coordinates: [] } })
    expect(standsOnGround(venue('-2;-1;0'))).toBe(true)
    expect(standsOnGround(venue('-2;-1'))).toBe(false)
  })
})
