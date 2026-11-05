import type { TripModeToken } from './departure-profile.types'
import type { SortPreference } from './trip.types'

export { SORT_PREFERENCES } from './trip.types'

/** Routing preferences split into keys shared by every mode and per-mode slices. */
export interface RoutingPreferenceSlices {
  general: Record<string, unknown>
  mode: Record<string, Record<string, unknown>>
}

/**
 * Trip planning and guidance preferences synced to the account. The client
 * owns the shape of `routing`, `speech` and `guidance`; each is absent until
 * first saved.
 */
export interface NavigationPreferences {
  excludedModes: TripModeToken[]
  /** Null ranks trips balanced. */
  sortPreference: SortPreference | null
  routing?: RoutingPreferenceSlices
  speech?: Record<string, unknown>
  guidance?: Record<string, unknown>
}

export type NavigationPreferencesPatch = Partial<NavigationPreferences>

export const DEFAULT_NAVIGATION_PREFERENCES: NavigationPreferences = {
  excludedModes: [],
  sortPreference: null,
}
