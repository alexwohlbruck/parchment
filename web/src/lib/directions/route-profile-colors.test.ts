import { describe, expect, it } from 'vitest'
import { bikeSuitabilityColor } from '@server/lib/bike-suitability'
import { getEdgeCategory } from './route-profile-colors'
import type { RouteEdgeSegment } from '@/types/directions.types'

const edge = (e: Partial<RouteEdgeSegment>) => ({ startDistance: 0, endDistance: 10, ...e }) as RouteEdgeSegment

describe('bike friendly profile', () => {
  it('colours an edge exactly as the suitability layer draws its way', () => {
    const cat = getEdgeCategory('stress', edge({ bikeSuitability: 42, bikePriority: 1.3 }))
    expect(cat.color).toBe(bikeSuitabilityColor(42))
    expect(cat.group).toBe('low')
  })

  it('falls back to bike_priority where the route carries no scores', () => {
    expect(getEdgeCategory('stress', edge({ bikePriority: 1.3 })).group).toBe('very_high')
  })
})
