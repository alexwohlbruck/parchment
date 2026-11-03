import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { chooseOffer, overlapShare, shouldCheck, type Candidate, type RouteMetrics } from './alternatives'
import { polyline } from './test-routes'

const metrics = (over: Partial<RouteMetrics>): RouteMetrics => ({
  duration: 1000, distance: 5000, turns: 5, protectedShare: 0.1, majorRoadShare: 0.5, crossings: 40, via: null, ...over,
})
const candidate = (name: string, overlap: number, m: Partial<RouteMetrics>): Candidate<string> => ({ route: name, overlap, metrics: metrics(m) })

describe('chooseOffer', () => {
  const current = candidate('current', 0.95, {})

  test('offers a clearly faster route', () => {
    const offer = chooseOffer([current, candidate('fast', 0.2, { duration: 800, via: 'Elm St' })], 'driving', 1000)
    expect(offer).toMatchObject({ route: 'fast', reason: 'faster', saved: 200, via: 'Elm St' })
  })

  test('a small saving is not worth interrupting for', () => {
    expect(chooseOffer([current, candidate('bit faster', 0.2, { duration: 950 })], 'driving', 1000)).toBeNull()
  })

  test('cyclists get a more protected route at a small cost', () => {
    const offer = chooseOffer([current, candidate('track', 0.3, { duration: 1040, protectedShare: 0.5 })], 'cycling', 1000)
    expect(offer).toMatchObject({ route: 'track', reason: 'protected' })
    expect(chooseOffer([current, candidate('track', 0.3, { duration: 1040, protectedShare: 0.5 })], 'driving', 1000)).toBeNull()
  })

  test('walkers get a quieter route, but not a much slower one', () => {
    expect(chooseOffer([current, candidate('quiet', 0.3, { duration: 1030, majorRoadShare: 0.2 })], 'walking', 1000)?.reason).toBe('quieter')
    expect(chooseOffer([current, candidate('slow', 0.3, { duration: 1200, majorRoadShare: 0.1 })], 'walking', 1000)).toBeNull()
  })

  test('without the current route among them, compares time against what is left', () => {
    expect(chooseOffer([candidate('fast', 0.1, { duration: 700 })], 'driving', 1000)?.saved).toBe(300)
  })
})

describe('overlapShare', () => {
  const line = polyline([[0, 1000]])
  const route = buildNavRoute([{ mode: 'driving', geometry: line }])
  test('the route itself overlaps fully, a parallel street not at all', () => {
    expect(overlapShare(line, route, 0)).toBe(1)
    expect(overlapShare(polyline([[0, 1000]], polyline([[90, 200]]).at(-1)), route, 0)).toBe(0)
  })
})

describe('shouldCheck', () => {
  test('only on a long stretch without a turn coming', () => {
    expect(shouldCheck(1200, 120)).toBe(true)
    expect(shouldCheck(300, 120)).toBe(false)
    expect(shouldCheck(1200, 30)).toBe(false)
  })
})
