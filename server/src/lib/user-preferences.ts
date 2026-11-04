import type { UserPreferences } from '../schema/user-preferences.schema'
import { TRIP_MODE_TOKENS } from '../types/departure-profile.types'
import {
  DEFAULT_NAVIGATION_PREFERENCES,
  SORT_PREFERENCES,
  type NavigationPreferences,
  type RoutingPreferenceSlices,
} from '../types/navigation-preferences.types'

export interface UserPreferencesResponse {
  language: string
  unitSystem: string
  navigation: NavigationPreferences
}

type Blob = Record<string, unknown>

const isBlob = (value: unknown): value is Blob =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function normalizeRouting(value: unknown): RoutingPreferenceSlices | undefined {
  if (!isBlob(value) || !isBlob(value.general) || !isBlob(value.mode)) return undefined
  const mode = Object.fromEntries(
    Object.entries(value.mode).filter((entry): entry is [string, Blob] => isBlob(entry[1])),
  )
  return { general: value.general, mode }
}

/** Fills defaults and drops anything stored that is no longer valid. */
export function normalizeNavigationPreferences(stored: unknown): NavigationPreferences {
  const raw = isBlob(stored) ? stored : {}
  const excluded = Array.isArray(raw.excludedModes) ? raw.excludedModes : null
  const routing = normalizeRouting(raw.routing)
  return {
    excludedModes: excluded
      ? TRIP_MODE_TOKENS.filter(token => excluded.includes(token))
      : DEFAULT_NAVIGATION_PREFERENCES.excludedModes,
    sortPreference: SORT_PREFERENCES.find(sort => sort === raw.sortPreference) ?? null,
    ...(routing && { routing }),
    ...(isBlob(raw.speech) && { speech: raw.speech }),
    ...(isBlob(raw.guidance) && { guidance: raw.guidance }),
  }
}

export function toPreferencesResponse(
  prefs: Pick<UserPreferences, 'language' | 'unitSystem' | 'navigation'>,
): UserPreferencesResponse {
  return {
    language: prefs.language,
    unitSystem: prefs.unitSystem,
    navigation: normalizeNavigationPreferences(prefs.navigation),
  }
}
