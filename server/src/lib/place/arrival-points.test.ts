import { describe, expect, test } from 'bun:test'
import type { Place } from '../../types/place.types'
import {
  arrivalCategories,
  hasArrivalPoints,
  offersArrivalPointsIn,
  pickArrivalPoints,
  pickChildren,
} from './arrival-points'

const bounds = { south: 40, north: 41, west: -74, east: -73 }

function child(id: string, name: string | null, presetId: string, tags: Record<string, string> = {}): Place {
  return { ...place(id, name, 40.5, -73.5, tags), icon: { presetId } } as unknown as Place
}

function place(
  id: string,
  name: string | null,
  lat = 40.5,
  lng = -73.5,
  tags: Record<string, string> = {},
): Place {
  return {
    id,
    tags,
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
  })

  test('covers campuses under either preset family, in every mode', () => {
    expect(offersArrivalPointsIn('education/university', 'walking')).toBe(true)
    expect(offersArrivalPointsIn('amenity/college', 'driving')).toBe(true)
    expect(arrivalCategories('education/university', 'driving')).toEqual([])
  })

  test('offers nothing for an ordinary place', () => {
    expect(hasArrivalPoints('amenity/cafe')).toBe(false)
    expect(hasArrivalPoints(undefined)).toBe(false)
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

  test('puts garages ahead of surface lots', () => {
    const picked = pickArrivalPoints(
      [
        place('lot', 'Alumni Lot'),
        place('deck', 'Union Deck', 40.5, -73.5, { parking: 'multi-storey' }),
      ],
      bounds,
    )
    expect(picked.map((p) => p.id)).toEqual(['deck', 'lot'])
  })

  test('drops unnamed and private places, the parent itself and anything outside it', () => {
    const picked = pickArrivalPoints(
      [
        place('parent', 'Airport'),
        place('unnamed', null),
        place('far', 'Terminal 9', 42, -73.5),
        place('staff', 'Employee Lot', 40.5, -73.5, { access: 'private' }),
        place('ok', 'Terminal 2'),
      ],
      bounds,
      'parent',
    )
    expect(picked.map((p) => p.id)).toEqual(['ok'])
  })
})

describe('pickChildren', () => {
  const inside = [
    child('osm/way/1', 'Atkins Library', 'amenity/library'),
    child('osm/way/2', 'John Kirk Drive', 'highway/tertiary', { highway: 'tertiary' }),
    child('osm/intersection/3', 'John Kirk Drive & Mary Alexander Road', ''),
    child('osm/way/4', 'Toby Creek', 'waterway/stream'),
    child('osm/node/5', null, 'amenity/bench'),
    child('osm/way/6', 'Cone Deck', 'amenity/parking/multi-storey'),
    child('osm/way/7', 'Atkins Library', 'building'),
    child('osm/way/8', 'Staff Lot', 'amenity/parking', { access: 'private' }),
    child('osm/relation/9', 'University City', 'place/suburb', { place: 'suburb' }),
  ]

  test('keeps named places someone would go to, in order', () => {
    expect(pickChildren(inside, 'walking').map((p) => p.id)).toEqual(['osm/way/1'])
  })

  test('adds public parking when driving', () => {
    expect(pickChildren(inside, 'driving').map((p) => p.id)).toEqual(['osm/way/1', 'osm/way/6'])
  })
})
