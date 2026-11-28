import { describe, expect, it } from 'vitest'
import type { AutocompleteResult } from '@/types/search.types'
import type { Waypoint } from '@/types/map.types'
import { arrivalTarget, offersArrivalPoints, visibleArrivalPoints } from './arrival-points'

function result(arrivalPresetId?: string): AutocompleteResult {
  return { id: 'osm/way/1', type: 'place', title: 'Somewhere', arrivalPresetId }
}

describe('offersArrivalPoints', () => {
  it('lists an airport\'s terminals in every mode', () => {
    expect(offersArrivalPoints(result('aeroway/aerodrome'), 'transit')).toBe(true)
  })

  it('lists what is inside a campus in every mode', () => {
    expect(offersArrivalPoints(result('education/university'), 'walking')).toBe(true)
  })

  it('lists nothing under an ordinary result', () => {
    expect(offersArrivalPoints(result(), 'driving')).toBe(false)
  })
})

describe('visibleArrivalPoints', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i)

  it('folds a long list behind a count', () => {
    expect(visibleArrivalPoints(rows(14), false)).toEqual({ shown: rows(6), hidden: 8 })
  })

  it('shows everything once expanded', () => {
    expect(visibleArrivalPoints(rows(14), true)).toEqual({ shown: rows(14), hidden: 0 })
  })

  it('never folds away a single row', () => {
    expect(visibleArrivalPoints(rows(7), false)).toEqual({ shown: rows(7), hidden: 0 })
  })
})

describe('arrivalTarget', () => {
  const lngLat = { lat: 40.641312345, lng: -73.778198765 }

  it('sends an OSM id along with the point', () => {
    const waypoint = { lngLat, place: { id: 'osm/way/1' } } as unknown as Waypoint
    expect(arrivalTarget(waypoint)).toEqual({ id: 'osm/way/1', lat: 40.64131, lng: -73.7782 })
  })

  it('sends only the point for a pin or a geocoded address', () => {
    expect(arrivalTarget({ lngLat } as Waypoint)).toEqual({ lat: 40.64131, lng: -73.7782 })
    const address = { lngLat, place: { id: 'pelias/openaddresses:1' } } as unknown as Waypoint
    expect(arrivalTarget(address)).toEqual({ lat: 40.64131, lng: -73.7782 })
  })

  it('asks nothing for an empty stop or your own location', () => {
    expect(arrivalTarget({ lngLat: null } as Waypoint)).toBeNull()
    const here = { lngLat, place: { id: 'current-location' } } as unknown as Waypoint
    expect(arrivalTarget(here)).toBeNull()
  })
})
