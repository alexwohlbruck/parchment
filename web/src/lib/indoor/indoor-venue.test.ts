import { describe, expect, it } from 'vitest'
import { clearedBuildings, focusedVenue, parseVenueLevels } from './indoor-venue'

const square = (x: number, y: number, r = 1) => ({
  type: 'Polygon',
  coordinates: [[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]]],
})

const venue = (id: number, geometry: any, props: Record<string, unknown> = {}) => ({
  properties: { venue: id, levels: '-1;0;1', default_level: 0, ...props },
  geometry,
})

describe('parseVenueLevels', () => {
  it('lists the top floor first, named by the signs where it can', () => {
    expect(parseVenueLevels('0;-1;1;-0.5', '0=Concourse;1=Mezz')).toEqual([
      { level: 1, name: 'Mezz' },
      { level: 0, name: 'Concourse' },
      { level: -0.5, name: '-0.5' },
      { level: -1, name: 'B1' },
    ])
  })

  it('reads a negative level in a name pair', () => {
    expect(parseVenueLevels('-2', '-2=LL')).toEqual([{ level: -2, name: 'LL' }])
  })

  it('numbers an unnamed ground floor G', () => {
    expect(parseVenueLevels('0;2', '')).toEqual([
      { level: 2, name: '2' },
      { level: 0, name: 'G' },
    ])
  })
})

describe('focusedVenue', () => {
  it('prefers the venue under the centre over a nearer edge', () => {
    const big = venue(1, square(0, 0, 5))
    const small = venue(2, square(6.5, 0, 1))
    expect(focusedVenue([small, big], [4.9, 0])?.id).toBe(1)
  })

  it('falls back to the nearest venue in view', () => {
    const far = venue(1, square(10, 10))
    const near = venue(2, square(3, 0))
    expect(focusedVenue([far, near], [0, 0])?.id).toBe(2)
  })

  it('offers no picker for a single-level venue', () => {
    expect(focusedVenue([venue(1, square(0, 0), { levels: '0' })], [0, 0])).toBeNull()
  })
})

describe('clearedBuildings', () => {
  const features = [
    venue(1, square(0, 0), { buildings: 'way/1;way/2', buildings_above: 'way/9' }),
    venue(2, square(5, 5), { buildings: 'way/3' }),
  ]

  it('clears the buildings every venue stands in', () => {
    const focus = { venue: focusedVenue(features, [0, 0])!, level: 0 }
    expect(clearedBuildings(features, focus)).toBe(';way/1;way/2;way/3;')
  })

  it('also clears the towers over a basement while one is shown', () => {
    const focus = { venue: focusedVenue(features, [0, 0])!, level: -1 }
    expect(clearedBuildings(features, focus)).toBe(';way/1;way/2;way/3;way/9;')
  })

  it('clears nothing with no venue in view', () => {
    expect(clearedBuildings([], null)).toBe('')
  })
})
