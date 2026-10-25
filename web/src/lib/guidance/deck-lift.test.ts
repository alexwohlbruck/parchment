import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { deckProfile, liftAt, liftPixels } from './deck-lift'
import { polyline } from './test-routes'

const route = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 200]]) }])
const start = route.points[0].lat
const metresNorth = (lat: number) => (lat - start) * 110_540

describe('deckProfile', () => {
  // A deck 12 m over 20 m ground between 50 and 120 m along, heading north.
  const deckAt = (_lng: number, lat: number, along?: [number, number]) =>
    metresNorth(lat) >= 50 && metresNorth(lat) <= 120 && along && Math.abs(along[1] + 1) < 0.01 ? 32 : null
  const profile = deckProfile(route, deckAt, () => 20)

  test('lifts the route where it runs on the deck, nowhere else', () => {
    expect(liftAt(profile, 20)).toBe(0)
    expect(liftAt(profile, 80)).toBeCloseTo(12)
    expect(liftAt(profile, 180)).toBe(0)
  })

  test('only decks running with the route count', () => {
    const across = deckProfile(route, (lng, lat, along) => (along && Math.abs(along[0]) > 0.5 ? 40 : null), () => 20)
    expect(liftAt(across, 80)).toBe(0)
  })
})

describe('liftPixels', () => {
  test('a height shows by the sine of the pitch', () => {
    expect(liftPixels(10, 0.5, 0)).toBe(0)
    expect(liftPixels(10, 0.5, 90)).toBeCloseTo(20)
    expect(liftPixels(0, 0.5, 60)).toBe(0)
  })
})
