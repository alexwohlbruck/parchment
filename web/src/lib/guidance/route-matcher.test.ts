import { describe, expect, test } from 'vitest'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { buildNavRoute, pointAt } from './nav-route'
import { matchToRoute } from './route-matcher'
import { polyline } from './test-routes'

describe('matchToRoute', () => {
  test('projects a fix beside the road onto it', () => {
    const route = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 500]]) }])
    const fix = projectLatLng(pointAt(route, 250), 8, 90, 1)
    const match = matchToRoute(route, fix)!
    expect(match.s).toBeCloseTo(250, 0)
    expect(match.offset).toBeCloseTo(8, 0)
  })

  test('a search window keeps a loop from matching its other pass', () => {
    // Out 300 m north, step 20 m east, back 300 m south: the two passes run
    // side by side, so a fix on the outbound pass is near both.
    const route = buildNavRoute([{ mode: 'walking', geometry: polyline([[0, 300], [90, 20], [180, 300]]) }])
    const fix = projectLatLng(pointAt(route, 150), 12, 90, 1)
    expect(matchToRoute(route, fix)!.s).toBeGreaterThan(320)
    expect(matchToRoute(route, fix, { window: { from: 100, to: 250 } })!.s).toBeCloseTo(150, -1)
  })

  test('course breaks ties between nearby passes in opposite directions', () => {
    const route = buildNavRoute([{ mode: 'walking', geometry: polyline([[0, 300], [90, 20], [180, 300]]) }])
    const fix = projectLatLng(pointAt(route, 150), 10, 90, 1)
    const match = matchToRoute(route, fix, { course: 0, sigma: 10 })!
    expect(match.s).toBeLessThan(300)
  })
})
