import { describe, expect, test } from 'vitest'
import { AlongRouteFilter } from './along-route-filter'

describe('AlongRouteFilter', () => {
  test('tracks a constant speed and predicts ahead of the last fix', () => {
    const filter = new AlongRouteFilter({ s: 0, t: 0 })
    for (let t = 1; t <= 20; t++) filter.update({ t, s: 10 * t, sigma: 5, speed: 10 })
    expect(filter.state.v).toBeCloseTo(10, 0)
    expect(filter.predict(20.5).s).toBeCloseTo(205, -1)
  })

  test('never predicts backwards while braking to a stop', () => {
    const filter = new AlongRouteFilter({ s: 0, v: 10, t: 0 })
    filter.update({ t: 1, s: 9, sigma: 3, speed: 6 })
    filter.update({ t: 2, s: 14, sigma: 3, speed: 2 })
    let last = filter.predict(2).s
    for (let t = 2.1; t < 12; t += 0.1) {
      const s = filter.predict(t).s
      expect(s).toBeGreaterThanOrEqual(last - 1e-9)
      last = s
    }
  })

  test('gates a single outlier but re-seeds after repeated disagreement', () => {
    const filter = new AlongRouteFilter({ s: 0, t: 0 })
    for (let t = 1; t <= 10; t++) filter.update({ t, s: 10 * t, sigma: 3, speed: 10 })
    expect(filter.update({ t: 11, s: 400, sigma: 3 }).accepted).toBe(false)
    expect(filter.state.s).toBeLessThan(130)
    filter.update({ t: 12, s: 410, sigma: 3 })
    filter.update({ t: 13, s: 420, sigma: 3 })
    expect(filter.state.s).toBeGreaterThan(400)
  })

  test('hold stops the vehicle in place', () => {
    const filter = new AlongRouteFilter({ s: 0, t: 0 })
    for (let t = 1; t <= 5; t++) filter.update({ t, s: 5 * t, sigma: 3, speed: 5 })
    filter.hold(6)
    expect(filter.state.v).toBe(0)
    expect(filter.predict(10).s).toBeCloseTo(filter.state.s, 6)
  })
})
