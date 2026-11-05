import { describe, expect, it } from 'vitest'
import {
  defaultRoutingPreferences,
  mergeGuidancePreferences,
  parseRoutingPreferences,
  RUN_PACE_FACTOR,
  runPaceFactor,
  unsavedSections,
  withModeEnabled,
} from './navigation-preferences'

describe('parseRoutingPreferences', () => {
  it('falls back to defaults for anything unreadable', () => {
    expect(parseRoutingPreferences(null)).toEqual(defaultRoutingPreferences())
    expect(parseRoutingPreferences('nope')).toEqual(defaultRoutingPreferences())
  })

  it('overlays the split shape on the defaults', () => {
    const prefs = parseRoutingPreferences({
      general: { ferries: 0 },
      mode: { transit: { transitBufferMinutes: 4 }, biking: 'broken' },
    })
    expect(prefs.general).toMatchObject({ ferries: 0, useKnownVehicleLocations: true })
    expect(prefs.mode.transit).toMatchObject({ transitBufferMinutes: 4, maxTransfers: 3 })
    expect(prefs.mode.biking.surfaceQuality).toBe(0.25)
  })

  it('spreads the legacy flat shape across every mode', () => {
    const prefs = parseRoutingPreferences({ ferries: 0.25, hills: 0.2, highways: 0.75 })
    expect(prefs.general.ferries).toBe(0.25)
    expect(prefs.mode.walking.hills).toBe(0.2)
    expect(prefs.mode.biking.hills).toBe(0.2)
    expect(prefs.mode.driving.highways).toBe(0.75)
  })

  it('never shares objects with the defaults', () => {
    parseRoutingPreferences({ general: {}, mode: {} }).mode.walking.hills = 1
    expect(defaultRoutingPreferences().mode.walking.hills).toBe(0.5)
  })
})

describe('withModeEnabled', () => {
  it('keeps exclusions in canonical order', () => {
    expect(withModeEnabled(['driving'], 'transit', false)).toEqual(['transit', 'driving'])
  })

  it('drops a mode once re-enabled', () => {
    expect(withModeEnabled(['transit', 'driving'], 'driving', true)).toEqual(['transit'])
  })
})

describe('unsavedSections', () => {
  it('lists device-owned sections the account lacks', () => {
    expect(unsavedSections({ excludedModes: [], sortPreference: null, speech: {} })).toEqual([
      'routing',
      'guidance',
    ])
  })
})

describe('mergeGuidancePreferences', () => {
  it('fills keys added since the account last saved', () => {
    const prefs = mergeGuidancePreferences({ cameraMode: 'north-up' })
    expect(prefs.cameraMode).toBe('north-up')
    expect(prefs.adaptiveSpeech).toBe(true)
  })
})

describe('runPaceFactor', () => {
  it('lets a rider at a normal walking pace run', () => {
    expect(runPaceFactor(defaultRoutingPreferences())).toBe(RUN_PACE_FACTOR)
  })

  it('never asks a wheelchair user or a slow walker to run', () => {
    const wheelchair = defaultRoutingPreferences()
    wheelchair.mode.transit.wheelchairAccessible = true
    expect(runPaceFactor(wheelchair)).toBeNull()

    const slow = defaultRoutingPreferences()
    slow.mode.walking.walkingSpeed = 3.5
    expect(runPaceFactor(slow)).toBeNull()
  })
})
