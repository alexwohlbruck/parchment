import { describe, expect, test } from 'bun:test'
import { hotelNameSimilarity, pickHotelMatch } from './hotel-match'

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
