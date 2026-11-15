import { describe, test, expect } from 'bun:test'
import { knownPlaces, parsePointText } from './known-places'

describe('knownPlaces', () => {
  test('names saved places case-insensitively, keeping "here" for the device', () => {
    const places = knownPlaces({ lat: 1, lng: 2 }, [
      { name: 'Home', lat: 3, lng: 4 },
      { name: 'Here', lat: 5, lng: 6 },
      { name: 'home', lat: 7, lng: 8 },
      { name: ' ', lat: 9, lng: 9 },
    ])
    expect([...places.keys()]).toEqual(['here', 'home'])
    expect(places.get('here')).toEqual({ lat: 1, lng: 2, here: true })
    expect(places.get('home')).toEqual({ name: 'Home', lat: 3, lng: 4 })
  })

  test('has no "here" without a device position', () => {
    expect(knownPlaces(undefined, []).size).toBe(0)
  })
})

describe('parsePointText', () => {
  test('reads coordinates written as JSON or as a pair', () => {
    expect(
      parsePointText('{"lat": 40.66, "lng": -73.96, "name": "Prospect Park"}'),
    ).toEqual({ lat: 40.66, lng: -73.96, name: 'Prospect Park' })
    expect(parsePointText('40.66, -73.96')).toEqual({ lat: 40.66, lng: -73.96 })
  })

  test('leaves names and impossible coordinates alone', () => {
    expect(parsePointText('Prospect Park')).toBeNull()
    expect(parsePointText('140, 20')).toBeNull()
  })
})
