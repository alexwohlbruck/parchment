import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { bridgeSpans, deckProfile, liftAt, liftPixels } from './deck-lift'
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

  test('a route that reports no bridge there stays under the deck', () => {
    const under = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 200]]), edgeSegments: [{ startDistance: 0, endDistance: 200, roadEnvironment: 'road' }] }])
    expect(liftAt(deckProfile(under, deckAt, () => 20), 80)).toBe(0)
  })

  test('only decks running with the route count', () => {
    const across = deckProfile(route, (lng, lat, along) => (along && Math.abs(along[0]) > 0.5 ? 40 : null), () => 20)
    expect(liftAt(across, 80)).toBe(0)
  })
})

describe('bridgeSpans', () => {
  test('the bridges a route reports, padded for the deck ends, and all of a segment that reports nothing', () => {
    const walk = polyline([[0, 100]])
    const route = buildNavRoute([
      { mode: 'driving', geometry: walk, edgeSegments: [{ startDistance: 0, endDistance: 40, roadEnvironment: 'road' }, { startDistance: 40, endDistance: 70, roadEnvironment: 'bridge' }, { startDistance: 70, endDistance: 100, roadEnvironment: 'road' }] },
      { mode: 'walking', geometry: polyline([[0, 100]], walk.at(-1)) },
    ])
    const [bridge, walking] = bridgeSpans(route)
    expect(bridge[0]).toBeCloseTo(20, 0)
    expect(bridge[1]).toBeCloseTo(90, 0)
    expect(walking[0]).toBeCloseTo(100, 0)
    expect(walking[1]).toBeCloseTo(200, 0)
  })
})

describe('liftPixels', () => {
  test('a height shows by the sine of the pitch', () => {
    expect(liftPixels(10, 0.5, 0)).toBe(0)
    expect(liftPixels(10, 0.5, 90)).toBeCloseTo(20)
    expect(liftPixels(0, 0.5, 60)).toBe(0)
  })
})
