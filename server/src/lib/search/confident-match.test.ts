import { describe, it, expect } from 'bun:test'
import type { SearchResult } from '../../types/search.types'
import { confidentMatch, type ScoredResult } from './confident-match'

const CHARLOTTE = { lat: 35.227, lng: -80.843 }

let nextLng = 0
const result = (
  type: SearchResult['type'],
  title: string,
  id = title,
  {
    relevance = 0.9,
    placeType = 'Restaurant',
    description = '',
    at = { lat: CHARLOTTE.lat + 0.01, lng: CHARLOTTE.lng + 0.01 * ++nextLng },
  } = {},
): ScoredResult => ({
  result: {
    id,
    type,
    title,
    description,
    metadata: {
      place: { placeType: { value: placeType }, geometry: { value: { center: at } } } as any,
    },
  },
  relevance,
})

const address = (title: string, city: string, id = `pelias/${title}/${city}`) =>
  result('place', title, id, { placeType: 'Address', description: `Address · ${title}, ${city}` })

describe('confidentMatch', () => {
  it('opens the only place named what was typed', () => {
    expect(confidentMatch('pianoland', [
      result('place', 'Pianoland', 'node/1'),
      result('transit_stop', 'Poland Park'),
    ])).toBe('node/1')
  })

  it('opens a place from part of its name', () => {
    expect(confidentMatch('kimpton tryon', [
      result('place', 'Kimpton Tryon Park Hotel', 'node/2'),
      result('place', 'Tryon Plaza Gym'),
    ])).toBe('node/2')
    expect(confidentMatch('joes piz', [result('place', 'Joe’s Pizza', 'node/3')])).toBe('node/3')
  })

  it('opens a place whose name only streets and addresses share', () => {
    expect(confidentMatch('romare bearden', [
      result('place', 'Romare Bearden Park', 'relation/4', { placeType: 'Park' }),
      address('2901 Romare Bearden Drive', 'Charlotte'),
      result('place', 'Romare Bearden Drive & West Boulevard', 'osm/intersection/5', { placeType: 'Intersection' }),
      result('place', 'Romare Bearden Drive', 'way/6', { placeType: 'Residential Road' }),
    ])).toBe('relation/4')
  })

  it('opens a place listed twice by different sources', () => {
    const at = { lat: 35.25, lng: -80.8 }
    expect(confidentMatch('dyad', [
      result('place', 'Dyad Coffee', 'osm/node/7', { at }),
      result('place', 'Dyad Coffee', 'foursquare/7', { at: { lat: at.lat + 0.0005, lng: at.lng } }),
    ], CHARLOTTE)).toBe('osm/node/7')
  })

  it('opens the nearest place when the others named alike are far away', () => {
    expect(confidentMatch('empire state building', [
      result('place', 'Empire State Building', 'way/8', { at: { lat: 40.748, lng: -73.986 } }),
      result('place', 'Empire State Building', 'way/9', { at: { lat: 41.26, lng: -95.94 } }),
    ], CHARLOTTE)).toBe('way/8')
  })

  it('prefers the place named exactly what was typed over longer names', () => {
    expect(confidentMatch('first ward', [
      result('place', 'First Ward', 'relation/10', { placeType: 'Neighborhood' }),
      result('place', 'First Ward Park', 'way/11', { placeType: 'Park' }),
    ], CHARLOTTE)).toBe('relation/10')
  })

  it('opens a town over the places named after it', () => {
    expect(confidentMatch('charlotte', [
      result('place', 'Charlotte', 'relation/22', { placeType: 'City', at: CHARLOTTE }),
      result('place', 'Charlotte', 'node/23', { placeType: 'Train Station' }),
      result('place', 'Charlotte', 'relation/24', { placeType: 'Town', at: { lat: 42.56, lng: -84.84 } }),
    ], CHARLOTTE)).toBe('relation/22')
  })

  it('opens the nearest match for a street address', () => {
    const results = [
      address('300 South Church Street', 'Charlotte', 'pelias/a'),
      address('300 South Church Street', 'Winston-Salem', 'pelias/b'),
    ]
    expect(confidentMatch('300 s church st', results)).toBe('pelias/a')
    expect(confidentMatch('300 South Church Street, Charl', results)).toBe('pelias/a')
  })

  it('finds an address under the city named after it', () => {
    expect(confidentMatch('300 s church st charlotte', [
      result('place', 'Charlotte', 'relation/12', { placeType: 'City' }),
      address('300 South Church Street', 'Charlotte', 'pelias/a'),
    ])).toBe('pelias/a')
  })

  it('lists an address whose number or street differs', () => {
    expect(confidentMatch('302 s church st', [address('300 South Church Street', 'Charlotte')]))
      .toBeUndefined()
    expect(confidentMatch('300 elm st', [address('300 South Church Street', 'Charlotte')]))
      .toBeUndefined()
    expect(confidentMatch('300 church st', [result('place', 'Church Street Cafe')]))
      .toBeUndefined()
  })

  it('opens a typed coordinate', () => {
    expect(confidentMatch('40.7, -74', [result('place', '40.7, -74', 'coords/40.7/-74')]))
      .toBe('coords/40.7/-74')
  })

  it('opens a brand named what was typed', () => {
    expect(confidentMatch('starbucks', [
      result('brand', 'Starbucks', 'Q37158'),
      result('brand', 'Starbucks', 'name:starbucks'),
      result('place', 'Starbucks', 'node/13'),
    ])).toBe('Q37158')
  })

  it('lists a chain no brand covers', () => {
    expect(confidentMatch('joes pizza', [
      result('place', "Joe's Pizza", 'node/14'),
      result('place', "Joe's Pizza", 'node/15'),
    ], CHARLOTTE)).toBeUndefined()
  })

  it('opens the kind of place the query names', () => {
    expect(confidentMatch('coffee', [
      result('place', '& Coffee', 'node/16'),
      result('category', 'Cafe', 'amenity/cafe', { relevance: 0.846 }),
      result('category', 'Restaurant', 'amenity/restaurant', { relevance: 0.84 }),
    ])).toBe('amenity/cafe')
    expect(confidentMatch('gas station', [
      result('category', 'Gas Station', 'amenity/fuel', { relevance: 1 }),
      result('brand', 'Gas Station', 'name:gas station'),
    ])).toBe('amenity/fuel')
  })

  it('ignores a category matching only loosely', () => {
    expect(confidentMatch('target', [
      result('brand', 'Target', 'Q1046951'),
      result('category', 'Shooting Range', 'leisure/shooting_ground', { relevance: 0.44 }),
    ])).toBe('Q1046951')
  })

  it('opens a transit line by name', () => {
    expect(confidentMatch('gold line', [
      result('transit_route', 'Gold Line', 'transit-route/f:gold', { placeType: 'transit_route' }),
      result('place', 'Golden Corral'),
    ], CHARLOTTE)).toBe('transit-route/f:gold')
  })

  it('lists when another place nearby also holds every typed word', () => {
    expect(confidentMatch('spectrum', [
      result('place', 'Spectrum Center', 'way/17'),
      result('place', 'Spectrum Store', 'node/18'),
    ], CHARLOTTE)).toBeUndefined()
  })

  it('lists when a place elsewhere has exactly the typed name', () => {
    expect(confidentMatch('gold line', [
      result('place', 'Gold Line Motors', 'way/25', { at: { lat: 34.87, lng: -82.38 } }),
      result('place', 'Gold Line', 'relation/26', { placeType: 'Line', at: { lat: 39.65, lng: -79.99 } }),
    ], CHARLOTTE)).toBeUndefined()
  })

  it('lists when the top place does not hold every typed word', () => {
    expect(confidentMatch('mugs coffee', [
      result('place', 'Mean Mug Coffee Company', 'node/19'),
      result('place', 'Mugs Coffee', 'node/20'),
    ])).toBeUndefined()
    expect(confidentMatch('q', [result('place', 'Q', 'node/21')])).toBeUndefined()
  })
})
