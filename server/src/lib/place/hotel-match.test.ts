import { describe, expect, test } from 'bun:test'
import { hotelNameContains, hotelNameSimilarity, hotelQueryScore, pickHotelMatch } from './hotel-match'

const at = { lat: 40.758, lng: -73.9855 }
const near = (metresNorth: number) => at.lat + metresNorth / 111_320

const candidates = [
  { id: 'lp1', name: 'Hotel Example NYC', lat: near(10), lng: at.lng },
  { id: 'lp2', name: 'Example Suites Times Square', lat: near(60), lng: at.lng },
  { id: 'lp3', name: 'Hotel Example NYC', lat: near(400), lng: at.lng },
  { id: 'lp4', name: 'Hotel Example NYC', lat: near(120), lng: at.lng },
]

describe('hotelNameSimilarity', () => {
  test('matches the same hotel written differently', () => {
    expect(hotelNameSimilarity('Hilton Garden Inn New York/Times Square Central', 'Hilton Garden Inn Times Square Central')).toBeGreaterThanOrEqual(0.8)
    expect(hotelNameSimilarity('The Ludlow Hotel', 'Ludlow')).toBe(1)
    expect(hotelNameSimilarity('Café Royal', 'Hotel Cafe Royal')).toBe(1)
  })

  test('keeps apart hotels that only share a neighbourhood', () => {
    expect(hotelNameSimilarity('Pod Times Square', 'Example Suites Times Square')).toBeLessThan(0.8)
  })

  test('compares names made only of generic words as they are', () => {
    expect(hotelNameSimilarity('The Inn', 'The Inn')).toBe(1)
    expect(hotelNameSimilarity('The Inn', 'The Hotel')).toBe(0)
  })
})

describe('pickHotelMatch', () => {
  test('picks the nearest same-named hotel', () => {
    expect(pickHotelMatch(candidates, { name: 'Hotel Example NYC', ...at })?.id).toBe('lp1')
  })

  test('ignores a same-named hotel more than 250 m away', () => {
    expect(pickHotelMatch(candidates.slice(2, 3), { name: 'Hotel Example NYC', ...at })).toBeNull()
  })

  test('returns null when nothing nearby has a similar name', () => {
    expect(pickHotelMatch(candidates, { name: 'Pod Times Square', ...at })).toBeNull()
  })
})

describe('short names', () => {
  const even = { id: 'lp-even', name: 'EVEN Hotel Brooklyn by IHG', lat: near(20), lng: at.lng }

  test('matches a shorter form of the name right next to the place', () => {
    expect(hotelNameContains('EVEN Hotel', 'EVEN Hotel Brooklyn by IHG')).toBe(true)
    expect(pickHotelMatch([even], { name: 'EVEN Hotel', ...at })?.id).toBe('lp-even')
  })

  test('needs to be within 75 m for that', () => {
    expect(pickHotelMatch([{ ...even, lat: near(120) }], { name: 'EVEN Hotel', ...at })).toBeNull()
  })

  test('needs every word of the shorter name', () => {
    expect(hotelNameContains('Pod Times Square', 'Example Suites Times Square')).toBe(false)
  })
})

describe('hotelQueryScore', () => {
  test('ranks the hotel containing the typed name above a lookalike', () => {
    expect(hotelQueryScore('EVEN Hotel Brooklyn by IHG', 'EVEN Hotel')).toBeGreaterThan(hotelQueryScore('Essence hotel', 'EVEN Hotel'))
  })
})
