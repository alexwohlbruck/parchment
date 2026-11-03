import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VEHICLE_COLOR,
  DEFAULT_VEHICLE_PREFERENCES,
  headingKnown,
  inkOn,
  puckMode,
  vehicleChoice,
  vehicleScale,
} from './vehicle-indicator'

describe('vehicleChoice', () => {
  it('defaults every mode to a blue arrow', () => {
    for (const mode of ['driving', 'cycling', 'walking', 'transit'])
      expect(vehicleChoice(DEFAULT_VEHICLE_PREFERENCES, mode)).toEqual({ indicator: 'arrow', color: DEFAULT_VEHICLE_COLOR })
    expect(vehicleChoice(undefined, 'driving').indicator).toBe('arrow')
  })

  it('maps travel modes onto the three puck modes', () => {
    expect(puckMode('truck')).toBe('driving')
    expect(puckMode('biking')).toBe('cycling')
    expect(puckMode('transit')).toBe('walking')
  })

  it('keeps a stored choice the mode offers', () => {
    const prefs = { ...DEFAULT_VEHICLE_PREFERENCES, driving: { indicator: 'pickup' as const, color: '#e5383b' } }
    expect(vehicleChoice(prefs, 'motorcycle')).toEqual({ indicator: 'pickup', color: '#e5383b' })
  })

  it('falls back to the arrow and default colour for choices a mode cannot use', () => {
    const prefs = { ...DEFAULT_VEHICLE_PREFERENCES, walking: { indicator: 'suv' as const, color: 'red' } }
    expect(vehicleChoice(prefs, 'walking')).toEqual({ indicator: 'arrow', color: DEFAULT_VEHICLE_COLOR })
  })
})

describe('headingKnown', () => {
  it('trusts the route bearing, and an unsnapped one only while moving', () => {
    expect(headingKnown({ snapped: true, speed: 0 })).toBe(true)
    expect(headingKnown({ snapped: false, speed: 0.3 })).toBe(false)
    expect(headingKnown({ snapped: false, speed: 4 })).toBe(true)
  })
})

describe('inkOn', () => {
  it('puts dark ink on light paint and white on dark', () => {
    expect(inkOn('#f2f2f2')).toBe('#1c1c1e')
    expect(inkOn('#007aff')).toBe('#ffffff')
    expect(inkOn('#3a3d42')).toBe('#ffffff')
  })
})

describe('vehicleScale', () => {
  it('holds a steady screen size, halving the enlargement per zoom level', () => {
    const z17 = vehicleScale('hatchback', 4, 17, 40)
    const z18 = vehicleScale('hatchback', 4, 18, 40)
    expect(z17 / z18).toBeCloseTo(2)
  })

  it('never draws below life size or past the cap', () => {
    expect(vehicleScale('hatchback', 4, 22, 40)).toBe(1)
    expect(vehicleScale('hatchback', 4, 10, 40)).toBe(10)
  })
})
