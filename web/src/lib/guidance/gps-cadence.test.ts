import { describe, expect, it } from 'vitest'
import {
  ALIGHT_TIGHTEN_METERS,
  CRUISE_INTERVAL_MS,
  CRUISE_SETTLE_SEC,
  GpsCadence,
  PRECISE_INTERVAL_MS,
  RIDE_INTERVAL_MS,
  TIGHTEN_METERS,
  type CadenceInput,
} from './gps-cadence'

const highway = (over: Partial<CadenceInput> = {}): CadenceInput => ({
  t: 0,
  tracking: true,
  mode: 'driving',
  speed: 28,
  distanceToManeuver: 8000,
  ride: null,
  ...over,
})

function cruise(cadence: GpsCadence, from = 0, over: Partial<CadenceInput> = {}) {
  cadence.update(highway({ t: from, ...over }))
  return cadence.update(highway({ t: from + CRUISE_SETTLE_SEC, ...over }))
}

describe('GpsCadence', () => {
  it('relaxes once a highway cruise has settled', () => {
    const cadence = new GpsCadence()
    expect(cadence.update(highway({ t: 0 }))).toBe(PRECISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: CRUISE_SETTLE_SEC - 1 }))).toBe(PRECISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: CRUISE_SETTLE_SEC }))).toBe(CRUISE_INTERVAL_MS)
  })

  it('stays precise on city streets and on foot', () => {
    expect(cruise(new GpsCadence(), 0, { speed: 12 })).toBe(PRECISE_INTERVAL_MS)
    expect(cruise(new GpsCadence(), 0, { mode: 'walking', speed: 1.4 })).toBe(PRECISE_INTERVAL_MS)
    expect(cruise(new GpsCadence(), 0, { mode: 'cycling', speed: 20 })).toBe(PRECISE_INTERVAL_MS)
  })

  it('tightens ahead of the next maneuver', () => {
    const cadence = new GpsCadence()
    expect(cruise(cadence)).toBe(CRUISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: 30, distanceToManeuver: TIGHTEN_METERS - 1 }))).toBe(PRECISE_INTERVAL_MS)
  })

  it('tightens earlier the faster the cruise', () => {
    const cadence = new GpsCadence()
    cruise(cadence, 0, { speed: 40 })
    expect(cadence.update(highway({ t: 30, speed: 40, distanceToManeuver: 1700 }))).toBe(PRECISE_INTERVAL_MS)
  })

  it('needs a margin past the tightening point to relax again', () => {
    const cadence = new GpsCadence()
    expect(cruise(cadence, 0, { distanceToManeuver: TIGHTEN_METERS + 100 })).toBe(PRECISE_INTERVAL_MS)
    const relaxed = new GpsCadence()
    expect(cruise(relaxed, 0, { distanceToManeuver: 5000 })).toBe(CRUISE_INTERVAL_MS)
    expect(relaxed.update(highway({ t: 25, distanceToManeuver: TIGHTEN_METERS + 100 }))).toBe(CRUISE_INTERVAL_MS)
  })

  it('relaxes on the last stretch with no maneuver left', () => {
    expect(cruise(new GpsCadence(), 0, { distanceToManeuver: null })).toBe(CRUISE_INTERVAL_MS)
  })

  it('tightens at once off the route, and has to settle again after', () => {
    const cadence = new GpsCadence()
    cruise(cadence)
    expect(cadence.update(highway({ t: 30, tracking: false }))).toBe(PRECISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: 31 }))).toBe(PRECISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: 31 + CRUISE_SETTLE_SEC }))).toBe(CRUISE_INTERVAL_MS)
  })

  it('slowing below a cruise restarts the settle time', () => {
    const cadence = new GpsCadence()
    cruise(cadence)
    expect(cadence.update(highway({ t: 25, speed: 8 }))).toBe(PRECISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: 26 }))).toBe(PRECISE_INTERVAL_MS)
  })

  it('rides sparse between stops and tightens for the alighting stop', () => {
    const cadence = new GpsCadence()
    const riding = (stopsLeft: number, remaining: number) =>
      cadence.update(highway({ mode: 'transit', speed: 10, ride: { stopsLeft, remaining } }))
    expect(riding(5, 4000)).toBe(RIDE_INTERVAL_MS)
    expect(riding(3, ALIGHT_TIGHTEN_METERS - 1)).toBe(PRECISE_INTERVAL_MS)
    expect(riding(1, 3000)).toBe(PRECISE_INTERVAL_MS)
  })

  it('reset returns to precise', () => {
    const cadence = new GpsCadence()
    cruise(cadence)
    cadence.reset()
    expect(cadence.interval).toBe(PRECISE_INTERVAL_MS)
    expect(cadence.update(highway({ t: 100 }))).toBe(PRECISE_INTERVAL_MS)
  })
})
