import { describe, expect, it } from 'vitest'
import { FacingFilter, compassWeight, holdBearing, type CompassReading } from './facing'

const inHand: CompassReading = { heading: 200, accuracy: 10, tilt: 40 }

describe('compassWeight', () => {
  it('lets the compass decide for a walker standing still', () => {
    expect(compassWeight({ speed: 0, mode: 'walking', compass: inHand })).toBe(1)
  })

  it('hands over to the route at walking pace', () => {
    expect(compassWeight({ speed: 1.4, mode: 'walking', compass: inHand })).toBe(0)
    const slow = compassWeight({ speed: 0.85, mode: 'cycling', compass: inHand })
    expect(slow).toBeGreaterThan(0)
    expect(slow).toBeLessThan(1)
  })

  it('never uses the compass in a car', () => {
    expect(compassWeight({ speed: 0, mode: 'driving', compass: inHand })).toBe(0)
    expect(compassWeight({ speed: 0, mode: 'transit', compass: inHand })).toBe(0)
  })

  it('ignores a pocketed, face-down or uncalibrated phone', () => {
    expect(compassWeight({ speed: 0, mode: 'walking', compass: { ...inHand, tilt: 88 } })).toBe(0)
    expect(compassWeight({ speed: 0, mode: 'walking', compass: { ...inHand, tilt: -80 } })).toBe(0)
    expect(compassWeight({ speed: 0, mode: 'walking', compass: { ...inHand, accuracy: -1 } })).toBe(0)
    expect(compassWeight({ speed: 0, mode: 'walking', compass: { ...inHand, accuracy: 45 } })).toBe(0)
  })

  it('trusts a phone that reports no accuracy or tilt', () => {
    expect(compassWeight({ speed: 0, mode: 'walking', compass: { heading: 200, accuracy: null, tilt: null } })).toBe(1)
  })
})

describe('holdBearing', () => {
  it('ignores wobble inside the band and follows a real turn', () => {
    expect(holdBearing(355, 3)).toBe(355)
    expect(holdBearing(355, 20)).toBe(20)
    expect(holdBearing(null, 20)).toBe(20)
  })
})

describe('FacingFilter', () => {
  function run(filter: FacingFilter, input: Parameters<FacingFilter['update']>[0], from: number, seconds: number) {
    let facing = filter.update(input, from)
    for (let t = from; t <= from + seconds; t += 1 / 60) facing = filter.update(input, t)
    return facing
  }

  it('turns from the route to the compass when the walker stops', () => {
    const filter = new FacingFilter()
    const stopped = { routeBearing: 90, speed: 0, mode: 'walking', compass: inHand }
    expect(filter.update(stopped, 0).bearing).toBe(90)
    expect(run(filter, stopped, 0, 3).bearing).toBeCloseTo(200, 0)
  })

  it('eases back to the route once they move off', () => {
    const filter = new FacingFilter()
    run(filter, { routeBearing: 90, speed: 0, mode: 'walking', compass: inHand }, 0, 3)
    const moving = run(filter, { routeBearing: 90, speed: 1.5, mode: 'walking', compass: inHand }, 3, 3)
    expect(moving.bearing).toBeCloseTo(90, 0)
  })

  it('takes the compass outright when the route gives no course', () => {
    const filter = new FacingFilter()
    expect(run(filter, { routeBearing: null, speed: 0, mode: 'walking', compass: inHand }, 0, 0.1).bearing).toBeCloseTo(200, 0)
    expect(new FacingFilter().update({ routeBearing: null, speed: 0, mode: 'driving', compass: inHand }, 0).bearing).toBeNull()
  })
})
