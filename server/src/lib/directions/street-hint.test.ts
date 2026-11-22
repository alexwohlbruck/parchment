import { describe, expect, test } from 'bun:test'
import { streetFromAddress, streetHints, waypointLocation } from './street-hint'

describe('streetFromAddress', () => {
  test('drops the house number', () => {
    expect(streetFromAddress('139 Rogers Avenue')).toBe('Rogers Avenue')
  })

  test('reads only the first line of a formatted address', () => {
    expect(streetFromAddress('139 Rogers Avenue, Brooklyn, NY 11216')).toBe('Rogers Avenue')
  })

  test('handles lettered and hyphenated house numbers', () => {
    expect(streetFromAddress('12B Main St')).toBe('Main St')
    expect(streetFromAddress('37-12 31st Avenue')).toBe('31st Avenue')
  })

  test('gives nothing for an address without a house number', () => {
    expect(streetFromAddress('Rogers Avenue')).toBeUndefined()
    expect(streetFromAddress('Brooklyn, NY')).toBeUndefined()
    expect(streetFromAddress(undefined)).toBeUndefined()
    expect(streetFromAddress('11216')).toBeUndefined()
  })
})

describe('waypointLocation', () => {
  test('carries the street of an addressed waypoint', () => {
    expect(waypointLocation({ location: { lat: 1, lng: 2 }, address: '139 Rogers Avenue' }))
      .toEqual({ type: 'coordinates', value: [1, 2], street: 'Rogers Avenue' })
  })

  test('leaves a bare coordinate without one', () => {
    expect(waypointLocation({ location: { lat: 1, lng: 2 } })).toEqual({ type: 'coordinates', value: [1, 2] })
  })
})

describe('streetHints', () => {
  test('pads points without a street', () => {
    expect(streetHints([{}, { street: 'Rogers Avenue' }])).toEqual(['', 'Rogers Avenue'])
  })

  test('is undefined when no point has a street', () => {
    expect(streetHints([{}, {}])).toBeUndefined()
  })
})
