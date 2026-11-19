import { describe, test, expect } from 'bun:test'
import { normalizeAppPreferences, normalizeNavigationPreferences, toPreferencesResponse } from './user-preferences'
import type { NavigationPreferences } from '../types/navigation-preferences.types'
import { DEFAULT_ASK_PREFERENCES } from '../types/ask-preferences.types'

describe('normalizeNavigationPreferences', () => {
  test('leaves never-saved sections absent', () => {
    expect(normalizeNavigationPreferences(null)).toEqual({})
    expect(normalizeNavigationPreferences({ speech: { rate: 1 } })).toEqual({ speech: { rate: 1 } })
  })

  test('keeps a saved balanced sort and an empty exclusion list', () => {
    expect(normalizeNavigationPreferences({ excludedModes: [], sortPreference: null })).toEqual({
      excludedModes: [],
      sortPreference: null,
    })
  })

  test('keeps valid sections as stored', () => {
    const stored: NavigationPreferences = {
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
    expect(prefs).toEqual({})
  })

  test('drops non-object routing mode slices', () => {
    const prefs = normalizeNavigationPreferences({
      routing: { general: {}, mode: { walking: { hills: 0 }, biking: 3 } },
    })
    expect(prefs.routing).toEqual({ general: {}, mode: { walking: { hills: 0 } } })
  })
})

describe('normalizeAppPreferences', () => {
  test('keeps saved sections and leaves the rest absent', () => {
    expect(normalizeAppPreferences(null)).toEqual({})
    expect(normalizeAppPreferences({ theme: { accentColor: 'teal' }, map: 'flat', sidebar: {} })).toEqual({
      theme: { accentColor: 'teal' },
    })
  })
})

describe('toPreferencesResponse', () => {
  test('exposes only the public fields', () => {
    expect(
      toPreferencesResponse({ language: 'es-ES', unitSystem: 'imperial', navigation: null, ask: { webSearch: false }, app: null }),
    ).toEqual({
      language: 'es-ES',
      unitSystem: 'imperial',
      navigation: {},
      ask: { ...DEFAULT_ASK_PREFERENCES, webSearch: false },
      app: {},
    })
  })
})
