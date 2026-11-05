import type { TripModeToken } from './departure-profile.types'
import type { SortPreference } from './trip.types'

export { SORT_PREFERENCES } from './trip.types'

/** Routing preferences split into keys shared by every mode and per-mode slices. */
export interface RoutingPreferenceSlices {
  general: Record<string, unknown>
  mode: Record<string, Record<string, unknown>>
}

/** Synced trip and guidance preferences, each absent until first saved. The client owns `routing`, `speech` and `guidance`. */
export interface NavigationPreferences {
  excludedModes?: TripModeToken[]
  /** Null ranks trips balanced. */
  sortPreference?: SortPreference | null
  routing?: RoutingPreferenceSlices
  speech?: Record<string, unknown>
  guidance?: Record<string, unknown>
}

export type NavigationPreferencesPatch = Partial<NavigationPreferences>
