import { describe, test, expect } from 'bun:test'
import { nearbyFirst } from './nearby-match'

const result = (name: string, lat: number, lng: number) => ({ name: { value: name }, geometry: { value: { center: { lat, lng } } } })
const brooklyn = { lat: 40.6662, lng: -73.9603 }

describe('nearbyFirst', () => {
  const nj = result('Prospect Park', 40.938, -74.174)
  const south = result('Prospect Park South', 40.646, -73.967)
  const park = result('Prospect Park', 40.6627, -73.9624)

  test('puts the nearby exact match ahead of a distant one', () => {
    expect(nearbyFirst([nj, south, park], 'prospect park', brooklyn)).toEqual([park, nj, south])
  })

  test('matches on the name before the first comma', () => {
    expect(nearbyFirst([nj, park], 'Prospect Park, Brooklyn', brooklyn)).toEqual([park, nj])
  })

  test('keeps the ranking when no exact match is nearby, or no position is known', () => {
    const paris = result('Paris', 48.85, 2.35)
    expect(nearbyFirst([paris, south], 'Paris', brooklyn)).toEqual([paris, south])
    expect(nearbyFirst([nj, park], 'Prospect Park', undefined)).toEqual([nj, park])
  })
})
