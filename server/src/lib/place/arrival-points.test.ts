import { describe, expect, test } from 'bun:test'
import type { Place } from '../../types/place.types'
import { arrivalCategories, pickArrivalPoints } from './arrival-points'

const bounds = { south: 40, north: 41, west: -74, east: -73 }

function place(id: string, name: string | null, lat = 40.5, lng = -73.5, access?: string): Place {
  return {
    id,
    tags: access ? { access } : {},
    name: name ? { value: name } : null,
    geometry: { value: { type: 'point', center: { lat, lng } } },
  } as unknown as Place
}

describe('arrivalCategories', () => {
  test('offers terminals at an airport in every mode', () => {
    expect(arrivalCategories('aeroway/aerodrome', 'transit')).toEqual(['aeroway/terminal'])
  })

  test('adds parking only when a car is involved', () => {
    expect(arrivalCategories('aeroway/aerodrome', 'driving')).toEqual([
      'aeroway/terminal',
      'amenity/parking',
    ])
    expect(arrivalCategories('amenity/university', 'multi')).toEqual(['amenity/parking'])
    expect(arrivalCategories('amenity/university', 'walking')).toEqual([])
  })

  test('offers nothing for an ordinary place', () => {
    expect(arrivalCategories('amenity/cafe', 'driving')).toEqual([])
    expect(arrivalCategories('', 'driving')).toEqual([])
  })
})

describe('pickArrivalPoints', () => {
  test('keeps one place per name, in natural order', () => {
    const picked = pickArrivalPoints(
      [
        place('a', 'Terminal 10'),
        place('b', 'Terminal 4'),
        place('c', 'terminal 4'),
        place('d', 'Terminal 1'),
      ],
      bounds,
    )
    expect(picked.map((p) => p.id)).toEqual(['d', 'b', 'a'])
  })

  test('drops unnamed and private places, the parent itself and anything outside it', () => {
    const picked = pickArrivalPoints(
      [
        place('parent', 'Airport'),
        place('unnamed', null),
        place('far', 'Terminal 9', 42, -73.5),
        place('staff', 'Employee Lot', 40.5, -73.5, 'private'),
        place('ok', 'Terminal 2'),
      ],
      bounds,
      'parent',
    )
    expect(picked.map((p) => p.id)).toEqual(['ok'])
  })
})
