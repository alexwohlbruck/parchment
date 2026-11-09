import { describe, it, expect } from 'bun:test'
import { parseCoordinateQuery, parsePlusCode } from './coordinate-query'

const NYC = { lat: 40.7148341, lng: -73.9915242 }

describe('parseCoordinateQuery', () => {
  it('reads a decimal pair however it is wrapped or separated', () => {
    for (const query of [
      '40.7148341, -73.9915242',
      '40.7148341,-73.9915242',
      '40.7148341 -73.9915242',
      '(40.7148341, -73.9915242)',
      '[40.7148341, -73.9915242]',
      '{40.7148341; -73.9915242}',
      ' ( 40.7148341 , -73.9915242 ) ',
      '40.7148341 / -73.9915242',
      '40.7148341, −73.9915242',
      'lat: 40.7148341, lng: -73.9915242',
      'lat=40.7148341&lon=-73.9915242',
      'geo:40.7148341,-73.9915242',
      'geo:40.7148341,-73.9915242;u=35',
    ]) {
      expect(parseCoordinateQuery(query)).toEqual(NYC)
    }
  })

  it('reads hemisphere letters before or after, in either order', () => {
    for (const query of [
      '40.7148341N 73.9915242W',
      '40.7148341° N, 73.9915242° W',
      'N40.7148341 W73.9915242',
      '73.9915242W 40.7148341N',
      '40.7148341n, 73.9915242w',
    ]) {
      expect(parseCoordinateQuery(query)).toEqual(NYC)
    }
  })

  it('converts degrees, minutes and seconds', () => {
    expect(parseCoordinateQuery(`40°42'53.4"N 73°59'29.5"W`)).toEqual({ lat: 40.7148333, lng: -73.9915278 })
    expect(parseCoordinateQuery('40° 42′ 53.4″ N, 73° 59′ 29.5″ W')).toEqual({ lat: 40.7148333, lng: -73.9915278 })
    expect(parseCoordinateQuery(`33°52'S 151°12'E`)).toEqual({ lat: -33.8666667, lng: 151.2 })
  })

  it('pulls the point out of a pasted map link', () => {
    expect(parseCoordinateQuery('https://www.google.com/maps/@40.7148341,-73.9915242,17z')).toEqual(NYC)
    expect(parseCoordinateQuery('https://maps.google.com/?q=40.7148341,-73.9915242')).toEqual(NYC)
    expect(parseCoordinateQuery('https://www.google.com/maps/search/?api=1&query=40.7148341%2C-73.9915242')).toEqual(NYC)
    expect(parseCoordinateQuery('https://www.openstreetmap.org/#map=17/40.7148341/-73.9915242')).toEqual(NYC)
    expect(parseCoordinateQuery('https://www.openstreetmap.org/?mlat=40.7148341&mlon=-73.9915242')).toEqual(NYC)
  })

  it('swaps a lng, lat pair only when no letters fix the order', () => {
    expect(parseCoordinateQuery('-122.4194, 37.7749')).toEqual({ lat: 37.7749, lng: -122.4194 })
    expect(parseCoordinateQuery('95.1N 10.2E')).toBeNull()
  })

  it('leaves addresses and other text alone', () => {
    for (const query of [
      '123 45',
      '100 W 42',
      '200 E 14',
      '40.7N 73.9N',
      '-40.7S 73.9E',
      '40.5°30\'N 73°W',
      '40°75\'N 73°W',
      'Route 66, 12th',
      'coffee',
      '(coffee)',
      'https://example.com/page',
      '91.5, 181.2',
    ]) {
      expect(parseCoordinateQuery(query)).toBeNull()
    }
  })

  it('decodes a full plus code to the centre of its cell', () => {
    const katz = { lat: 40.722188, lng: -73.987437 }
    expect(parseCoordinateQuery('87G8P2C7+V2')).toEqual(katz)
    expect(parseCoordinateQuery('87g8p2c7+v2')).toEqual(katz)
    // An 11th digit refines past what the decoder reads; it is dropped.
    expect(parseCoordinateQuery('87G8P2C7+V2X')).toEqual(katz)
  })

  it('recovers a short plus code near the reference, and only with one', () => {
    expect(parseCoordinateQuery('P2C7+V2', { lat: 40.75, lng: -73.98 })).toEqual({
      lat: 40.722188,
      lng: -73.987437,
    })
    expect(parseCoordinateQuery('P2C7+V2')).toBeNull()
  })

  it('leaves a short plus code with a town for a caller that can geocode it', () => {
    expect(parseCoordinateQuery('P2C7+V2 New York, NY', { lat: 0, lng: 0 })).toBeNull()
    expect(parsePlusCode('P2C7+V2 New York, NY')).toEqual({
      code: 'P2C7+V2',
      short: true,
      locality: 'New York, NY',
    })
    expect(parsePlusCode('87G8P2C7+V2 New York')).toBeNull()
    expect(parsePlusCode('C7+V2')).toBeNull()
  })
})
