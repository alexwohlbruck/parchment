import { describe, test, expect } from 'bun:test'
import { knownPlaces } from './known-places'

describe('knownPlaces', () => {
  test('names saved places case-insensitively, keeping "here" for the device', () => {
    const places = knownPlaces({ lat: 1, lng: 2 }, [
      { name: 'Home', lat: 3, lng: 4 },
      { name: 'Here', lat: 5, lng: 6 },
      { name: 'home', lat: 7, lng: 8 },
      { name: ' ', lat: 9, lng: 9 },
    ])
    expect([...places.keys()]).toEqual(['here', 'home'])
    expect(places.get('here')).toEqual({ lat: 1, lng: 2 })
    expect(places.get('home')).toEqual({ name: 'Home', lat: 3, lng: 4 })
  })

  test('has no "here" without a device position', () => {
    expect(knownPlaces(undefined, []).size).toBe(0)
  })
})
