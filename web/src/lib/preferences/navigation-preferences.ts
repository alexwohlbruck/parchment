import type { RoutingPreferences, SortPreference, TripModeToken } from '@/types/multimodal.types'
import { TRIP_MODE_TOKENS } from '@/types/multimodal.types'
import type { NavigationPreferences } from '@server/types/navigation-preferences.types'
import { SORT_PREFERENCES } from '@server/types/navigation-preferences.types'
import { DEFAULT_GUIDANCE_PREFERENCES, type GuidancePreferences } from '@/lib/guidance/guidance-preferences'

export type { NavigationPreferences } from '@server/types/navigation-preferences.types'

export type ModeKey = 'walking' | 'biking' | 'driving' | 'transit'

export interface RoutingPreferenceSlices {
  general: Partial<RoutingPreferences>
  mode: Record<ModeKey, Partial<RoutingPreferences>>
}

export interface SpeechPreferences {
  rate: number
  /** Voice id per locale; empty picks automatically. */
  voices: Record<string, string>
}

/** A trip ranking the rider can pick. `balanced` is the server's default order. */
export type TripSort = SortPreference | 'balanced'

export const TRIP_SORTS: readonly TripSort[] = ['balanced', ...SORT_PREFERENCES]

export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = { rate: 1, voices: {} }

export const DEFAULT_TRANSIT_BUFFER_MINUTES = 2
export const DEFAULT_WALKING_SPEED_KPH = 5.1
/** A jog, relative to the rider's own walking pace. */
export const RUN_PACE_FACTOR = 1.8

/** How much faster than walking the rider can run, or null when we shouldn't ask them to. */
export function runPaceFactor(routing: RoutingPreferenceSlices): number | null {
  const { walking, transit } = routing.mode
  if (walking.wheelchairAccessible || transit.wheelchairAccessible) return null
  if ((walking.walkingSpeed ?? DEFAULT_WALKING_SPEED_KPH) < DEFAULT_WALKING_SPEED_KPH) return null
  return RUN_PACE_FACTOR
}

/** Keys shared by every mode; everything else is stored per mode. */
export const GENERAL_KEY_SET: ReadonlySet<string> = new Set<keyof RoutingPreferences>([
  'ferries',
  'routingEngine',
  'useKnownVehicleLocations',
  'useKnownParkingLocations',
  'customModelOverride',
])

const DEFAULT_GENERAL: Partial<RoutingPreferences> = {
  ferries: 0.5,
  useKnownVehicleLocations: true,
  useKnownParkingLocations: true,
}

const DEFAULT_MODE: Record<ModeKey, Partial<RoutingPreferences>> = {
  walking: { hills: 0.5, litPaths: 0, walkingSpeed: undefined },
  biking: {
    hills: 0.5,
    surfaceQuality: 0.25,
    safetyVsSpeed: 0.5,
    cyclingSpeed: undefined,
    bicycleType: undefined,
  },
  driving: { highways: 0.5, tolls: 0.5, preferHOV: false, shortest: false },
  transit: {
    maxWalkingDistance: 1000,
    maxTransfers: 3,
    transitBufferMinutes: DEFAULT_TRANSIT_BUFFER_MINUTES,
    wheelchairAccessible: false,
  },
}

export const ROUTING_MODES: readonly ModeKey[] = ['walking', 'biking', 'transit', 'driving']

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function defaultRoutingPreferences(): RoutingPreferenceSlices {
  return {
    general: { ...DEFAULT_GENERAL },
    mode: Object.fromEntries(ROUTING_MODES.map(k => [k, { ...DEFAULT_MODE[k] }])) as RoutingPreferenceSlices['mode'],
  }
}

/** Overlays stored routing preferences on the defaults; a legacy flat blob applies its per-mode keys to every mode. */
export function parseRoutingPreferences(stored: unknown): RoutingPreferenceSlices {
  const result = defaultRoutingPreferences()
  if (!isObject(stored)) return result

  if (isObject(stored.general) && isObject(stored.mode)) {
    Object.assign(result.general, stored.general)
    for (const k of ROUTING_MODES) Object.assign(result.mode[k], isObject(stored.mode[k]) ? stored.mode[k] : {})
    return result
  }

  for (const [key, value] of Object.entries(stored)) {
    if (GENERAL_KEY_SET.has(key)) (result.general as any)[key] = value
    else for (const k of ROUTING_MODES) (result.mode[k] as any)[key] = value
  }
  return result
}

export function withModeEnabled(
  excluded: readonly TripModeToken[],
  token: TripModeToken,
  enabled: boolean,
): TripModeToken[] {
  return TRIP_MODE_TOKENS.filter(t => (t === token ? !enabled : excluded.includes(t)))
}

const NAVIGATION_SECTIONS = [
  'excludedModes',
  'sortPreference',
  'routing',
  'speech',
  'guidance',
] as const satisfies ReadonlyArray<keyof NavigationPreferences>

/** Sections the account has never saved, which a device should seed from its own values. */
export function unsavedSections(remote: NavigationPreferences): Array<keyof NavigationPreferences> {
  return NAVIGATION_SECTIONS.filter(section => remote[section] === undefined)
}

export const mergeSpeechPreferences = (stored: unknown): SpeechPreferences => ({
  ...DEFAULT_SPEECH_PREFERENCES,
  ...(isObject(stored) ? stored : {}),
})

export const mergeGuidancePreferences = (stored: unknown): GuidancePreferences => ({
  ...DEFAULT_GUIDANCE_PREFERENCES,
  ...(isObject(stored) ? stored : {}),
})
