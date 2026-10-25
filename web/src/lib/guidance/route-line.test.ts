import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { drawnProgress, laneOffset, pointBeside, routeGradient } from './route-line'
import { polyline } from './test-routes'

const walkThenDrive = buildNavRoute([
  { mode: 'walking', geometry: polyline([[0, 100]]) },
  { mode: 'driving', geometry: polyline([[0, 300]], polyline([[0, 100]]).at(-1)) },
])
const color = (mode: string) => (mode === 'walking' ? 'blue' : 'violet')

describe('routeGradient', () => {
  test('colours each segment by mode before any travel', () => {
    expect(routeGradient(walkThenDrive, 0, color, 'grey')).toEqual(['step', ['line-progress'], 'blue', expect.closeTo(0.25, 2), 'violet'])
  })

  test('greys the travelled part and starts the remaining colour at the puck', () => {
    expect(routeGradient(walkThenDrive, 200, color, 'grey')).toEqual(['step', ['line-progress'], 'grey', expect.closeTo(0.5, 2), 'violet'])
  })

  test('a finished route is all travelled', () => {
    expect(routeGradient(walkThenDrive, 1e6, color, 'grey')).toEqual(['step', ['line-progress'], 'grey', 1, 'grey'])
  })
})

describe('laneOffset', () => {
  test('a metre distance doubles in pixels with each zoom', () => {
    const [, , , z10, px10, z22, px22] = laneOffset(1.8, 40) as [string, unknown, unknown, number, number, number, number]
    expect([z10, z22]).toEqual([10, 22])
    expect(px22 / px10).toBeCloseTo(2 ** 12)
    expect(px22).toBeGreaterThan(50)
  })
})

describe('drawnProgress', () => {
  test('maps route distance to the share of a line drawn shorter than the route', () => {
    const points = polyline([[0, 100]])
    const line = { points, cumulative: Float64Array.from(points.map((_, i) => (i * 200) / (points.length - 1))), length: 200 }
    const progress = drawnProgress(line)
    expect(progress(0)).toBe(0)
    expect(progress(100)).toBeCloseTo(0.5, 3)
    expect(progress(400)).toBe(1)
  })

  test('remaps the gradient stops onto it', () => {
    const stretched = (d: number) => Math.min(1, d / 800)
    expect(routeGradient(walkThenDrive, 0, color, 'grey', stretched)).toEqual(['step', ['line-progress'], 'blue', expect.closeTo(0.125, 2), 'violet'])
  })
})

describe('pointBeside', () => {
  test('moves the point to the right of the direction of travel', () => {
    const route = buildNavRoute([{ mode: 'driving', geometry: polyline([[0, 100]]) }])
    const on = pointBeside(route, 50)
    const right = pointBeside(route, 50, 2)
    expect(right.lat).toBeCloseTo(on.lat, 6)
    expect(right.lng).toBeGreaterThan(on.lng)
  })
})
