import { describe, expect, it } from 'vitest'
import { basemapId, clearedBuildings, focusedVenue, openingLevel, parseVenueLevels, replacedPlaces } from './indoor-venue'

const square = (x: number, y: number, r = 1) => ({
  type: 'Polygon',
  coordinates: [[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]]],
})

const everywhere = square(0, 0, 100).coordinates[0]

const venue = (id: number, geometry: any, props: Record<string, unknown> = {}) => ({
  properties: { venue: id, levels: '-1;0;1', default_level: 0, ...props },
  geometry,
})

describe('parseVenueLevels', () => {
  it('lists the top floor first, named by the signs where it can', () => {
    expect(parseVenueLevels('0;-1;1;-0.5', '0=Concourse;1=Mezz')).toEqual([
      { level: 1, name: 'Mezz' },
      { level: 0, name: 'Concourse' },
      { level: -0.5, name: '-0.5' },
      { level: -1, name: 'B1' },
    ])
  })

  it('reads a negative level in a name pair', () => {
    expect(parseVenueLevels('-2', '-2=LL')).toEqual([{ level: -2, name: 'LL' }])
  })

  it('numbers an unnamed ground floor G', () => {
    expect(parseVenueLevels('0;2', '')).toEqual([
      { level: 2, name: '2' },
      { level: 0, name: 'G' },
    ])
  })
})

describe('focusedVenue', () => {
  const middle = square(0, 0, 2).coordinates[0]

  it('prefers the venue under the centre over a nearer edge', () => {
    const big = venue(1, square(0, 0, 5))
    const small = venue(2, square(6.5, 0, 1))
    expect(focusedVenue([small, big], [4.9, 0], everywhere)?.id).toBe(1)
  })

  it('falls back to the nearest venue reaching the middle of the screen', () => {
    const far = venue(1, square(10, 10))
    const near = venue(2, square(3, 0))
    expect(focusedVenue([far, near], [0, 0], middle)?.id).toBe(2)
  })

  it('ignores a venue loaded but outside the middle of the screen', () => {
    expect(focusedVenue([venue(1, square(6, 0))], [0, 0], middle)).toBeNull()
  })

  it('offers no picker for a single-level venue', () => {
    expect(focusedVenue([venue(1, square(0, 0), { levels: '0' })], [0, 0], everywhere)).toBeNull()
  })
})

describe('openingLevel', () => {
  it('opens a station that is all underground on its outside', () => {
    const station = focusedVenue([venue(1, square(0, 0), { levels: '-2;-1', default_level: -1 })], [0, 0], everywhere)!
    expect(openingLevel(station)).toBeNull()
  })
})

describe('clearedBuildings', () => {
  const features = [
    venue(1, square(0, 0), { buildings: 'way/1;way/2' }),
    venue(2, square(5, 5), { buildings: 'way/3' }),
  ]

  it('clears the buildings every venue stands in', () => {
    const focus = { venue: focusedVenue(features, [0, 0], everywhere)!, level: 0 }
    expect(clearedBuildings(features, focus)).toBe(';way/1;way/2;way/3;')
  })

  it('gives a venue shown from outside its buildings back', () => {
    const focus = { venue: focusedVenue(features, [0, 0], everywhere)!, level: null }
    expect(clearedBuildings(features, focus)).toBe(';way/3;')
  })

  it('clears nothing with no venue in view', () => {
    expect(clearedBuildings([], null)).toBe('')
  })
})

describe('replacedPlaces', () => {
  const poi = (props: Record<string, unknown>) => ({ properties: { kind: 'poi', ...props } })

  it('numbers OSM elements the way basemap tiles do', () => {
    expect(basemapId('node/1096086074')).toBe('10960860741')
    expect(basemapId('way/5')).toBe('52')
    expect(basemapId('relation/7')).toBe('73')
    expect(basemapId('changeset/7')).toBeNull()
  })

  it('takes over gates and named shops, but leaves the basemap its facilities', () => {
    const places = replacedPlaces([
      poi({ id: 'node/1', class: 'aeroway', subclass: 'gate', ref: 'E2' }),
      poi({ id: 'node/2', class: 'shop', subclass: 'clothes', name: 'Gap' }),
      poi({ id: 'node/3', class: 'amenity', subclass: 'toilets', name: 'Restrooms' }),
      poi({ id: 'node/4', class: 'shop', subclass: 'kiosk' }),
      poi({ id: 'way/5', class: 'amenity', subclass: 'atm' }),
      { properties: { kind: 'area', class: 'room', id: 'way/6', name: 'Lounge' } },
    ])
    expect(places).toBe(';11;21;52;')
  })

  it('is empty with nothing to replace', () => {
    expect(replacedPlaces([])).toBe('')
  })
})
