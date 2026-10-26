import { describe, expect, test } from 'vitest'
import { chooseItinerary, isTransitOnly, type ItinerarySegment } from './better-itinerary'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const at = (min: number) => new Date(NOW + min * 60_000)
const line = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }]
const walk = (end: number): ItinerarySegment => ({ mode: 'walking', endTime: at(end), geometry: line })
const ride = (name: string, end: number): ItinerarySegment => ({ mode: 'transit', lineName: name, tripId: `${name}-trip`, endTime: at(end), geometry: line })
const plan = (...segments: ItinerarySegment[]) => ({ segments, endTime: segments.at(-1)!.endTime! })

const current = [walk(5), ride('A', 30), walk(35)]

describe('chooseItinerary', () => {
  test('offers a plan arriving clearly sooner', () => {
    const offer = chooseItinerary(current, [plan(walk(4), ride('B', 20), walk(25))], NOW)
    expect(offer?.gainMs).toBe(10 * 60_000)
    expect(offer?.lines).toEqual(['B'])
  })

  test('ignores a gain smaller than three minutes or a tenth of the time left', () => {
    expect(chooseItinerary(current, [plan(walk(4), ride('B', 30), walk(33))], NOW)).toBeNull()
  })

  test('ignores the same plan found again', () => {
    expect(chooseItinerary(current, [plan(walk(2), ride('A', 20), walk(25))], NOW)).toBeNull()
  })

  test('offers the same ride with a quicker way on from it', () => {
    const slowEnd = [walk(5), ride('A', 30), walk(32), { mode: 'cycling', ownership: 'shared', endTime: at(50), geometry: line }]
    expect(chooseItinerary(slowEnd, [plan(walk(5), ride('A', 30), walk(40))], NOW)?.gainMs).toBe(10 * 60_000)
  })

  test('picks the biggest gain among several', () => {
    const offer = chooseItinerary(current, [plan(walk(4), ride('B', 25), walk(28)), plan(walk(4), ride('C', 15), walk(20))], NOW)
    expect(offer?.lines).toEqual(['C'])
  })

  test('skips a candidate with a segment it cannot follow', () => {
    const shapeless = { ...ride('B', 15), geometry: [] }
    expect(chooseItinerary(current, [plan(walk(4), shapeless, walk(20))], NOW)).toBeNull()
  })

  test('leaves a leg with a bike or car in it alone', () => {
    const biking = [{ mode: 'cycling', endTime: at(10), geometry: line }, ride('A', 30)]
    expect(chooseItinerary(biking, [plan(walk(4), ride('B', 15), walk(20))], NOW)).toBeNull()
  })
})

test('isTransitOnly wants a ride, and nothing personal to bring along', () => {
  expect(isTransitOnly([walk(1), ride('A', 2)])).toBe(true)
  expect(isTransitOnly([walk(1)])).toBe(false)
  expect(isTransitOnly([{ mode: 'cycling', ownership: 'shared' }, ride('A', 2)])).toBe(true)
  expect(isTransitOnly([{ mode: 'cycling', ownership: 'personal' }, ride('A', 2)])).toBe(false)
})
