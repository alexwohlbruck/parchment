import { describe, test, expect } from 'bun:test'
import { normalizeNavigationPreferences, toPreferencesResponse } from './user-preferences'

describe('normalizeNavigationPreferences', () => {
  test('defaults a missing blob', () => {
    expect(normalizeNavigationPreferences(null)).toEqual({
      excludedModes: [],
      sortPreference: null,
    })
  })

  test('keeps valid sections as stored', () => {
    const stored = {
      excludedModes: ['rideshare', 'driving'],
      sortPreference: 'least_walking',
      routing: { general: { ferries: 0 }, mode: { transit: { transitBufferMinutes: 4 } } },
      speech: { rate: 1.25 },
      guidance: { cameraMode: 'follow-2d' },
    }
    expect(normalizeNavigationPreferences(stored)).toEqual(stored)
  })

  test('drops modes and sorts it does not know', () => {
    const prefs = normalizeNavigationPreferences({
      excludedModes: ['walking', 'teleport', 'transit', 'transit'],
      sortPreference: 'scenic',
    })
    expect(prefs.excludedModes).toEqual(['transit'])
    expect(prefs.sortPreference).toBeNull()
  })

  test('drops malformed client-owned sections', () => {
    const prefs = normalizeNavigationPreferences({
      routing: { general: {} },
      speech: 'loud',
      guidance: [1],
    })
    expect(prefs).toEqual({ excludedModes: [], sortPreference: null })
  })

  test('drops non-object routing mode slices', () => {
    const prefs = normalizeNavigationPreferences({
      routing: { general: {}, mode: { walking: { hills: 0 }, biking: 3 } },
    })
    expect(prefs.routing).toEqual({ general: {}, mode: { walking: { hills: 0 } } })
  })
})

describe('toPreferencesResponse', () => {
  test('exposes only the public fields', () => {
    expect(
      toPreferencesResponse({ language: 'es-ES', unitSystem: 'imperial', navigation: null }),
    ).toEqual({
      language: 'es-ES',
      unitSystem: 'imperial',
      navigation: { excludedModes: [], sortPreference: null },
    })
  })
})
