import { describe, expect, it } from 'vitest'
import type { AutocompleteResult } from '@/types/search.types'
import { offersArrivalPoints, visibleArrivalPoints } from './arrival-points'

function result(arrivalPresetId?: string): AutocompleteResult {
  return { id: 'osm/way/1', type: 'place', title: 'Somewhere', arrivalPresetId }
}

describe('offersArrivalPoints', () => {
  it('lists an airport\'s terminals in every mode', () => {
    expect(offersArrivalPoints(result('aeroway/aerodrome'), 'transit')).toBe(true)
  })

  it('lists a campus only when its parking matters', () => {
    expect(offersArrivalPoints(result('education/university'), 'driving')).toBe(true)
    expect(offersArrivalPoints(result('education/university'), 'walking')).toBe(false)
  })

  it('lists nothing under an ordinary result', () => {
    expect(offersArrivalPoints(result(), 'driving')).toBe(false)
  })
})

describe('visibleArrivalPoints', () => {
  it('folds a long list behind a count', () => {
    expect(visibleArrivalPoints([1, 2, 3, 4, 5], false)).toEqual({ shown: [1, 2, 3], hidden: 2 })
  })

  it('shows everything once expanded', () => {
    expect(visibleArrivalPoints([1, 2, 3, 4, 5], true)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 0 })
  })

  it('never folds away a single row', () => {
    expect(visibleArrivalPoints([1, 2, 3, 4], false)).toEqual({ shown: [1, 2, 3, 4], hidden: 0 })
  })
})
