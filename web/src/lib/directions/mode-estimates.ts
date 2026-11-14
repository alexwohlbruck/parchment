import { ESTIMATE_MODES, type EstimateMode } from '@server/lib/directions/mode-estimates'
import type { TripOption } from '@/types/directions.types'
import type { SelectedMode } from '@/types/multimodal.types'

export type { EstimateMode }

/** Seconds per mode; null where the mode has no route. */
export type TravelTimes = Partial<Record<SelectedMode, number | null>>

export type TravelTime =
  | { state: 'ready'; seconds: number }
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'unknown' }

/** About 10 m, so a current-location fix that wanders a little still hits the cache. */
const KEY_PRECISION = 4

export function travelTimesKey(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  departureTime: string | null,
  preferences: unknown,
): string {
  const coords = points.map(p => `${p.lat.toFixed(KEY_PRECISION)},${p.lng.toFixed(KEY_PRECISION)}`).join(';')
  return `${coords}|${departureTime ?? ''}|${JSON.stringify(preferences)}`
}

/** The duration the list leads with: its recommended trip, else its first. */
export function plannedSeconds(trips: readonly Pick<TripOption, 'isRecommended' | 'summary'>[]): number | null {
  const lead = trips.find(trip => trip.isRecommended) ?? trips[0]
  return lead ? lead.summary.totalDuration : null
}

/** A planned trip outranks an estimate, so the tab agrees with the list beneath it. */
export function travelTimeFor(
  mode: SelectedMode,
  planned: TravelTimes | undefined,
  estimated: TravelTimes | undefined,
  loading: boolean,
): TravelTime {
  const seconds = planned && mode in planned ? planned[mode] : estimated?.[mode]
  if (seconds === null) return { state: 'none' }
  if (seconds !== undefined) return { state: 'ready', seconds }
  return { state: loading ? 'loading' : 'unknown' }
}

/** The quickest mode once every mode has a time, standing in for a mixed trip nobody has planned yet. */
export function fastestTravelTime(
  planned: TravelTimes | undefined,
  estimated: TravelTimes | undefined,
  loading: boolean,
): TravelTime {
  const known = { ...estimated, ...planned }
  if (!ESTIMATE_MODES.every(mode => mode in known)) return { state: loading ? 'loading' : 'unknown' }
  const seconds = ESTIMATE_MODES.flatMap(mode => known[mode] ?? [])
  return seconds.length ? { state: 'ready', seconds: Math.min(...seconds) } : { state: 'none' }
}

/** Modes still without a time, leaving out the one a full plan is answering. */
export function modesToEstimate(
  planning: SelectedMode,
  planned: TravelTimes | undefined,
  estimated: TravelTimes | undefined,
): EstimateMode[] {
  return ESTIMATE_MODES.filter(mode =>
    mode !== planning && !(planned && mode in planned) && !(estimated && mode in estimated))
}


const TRAVEL_TIMES_KEPT = 30

/** Merges `times` into the entry at `key`, dropping the least recently written past the cap. */
export function withTravelTimes(
  map: ReadonlyMap<string, TravelTimes>,
  key: string,
  times: TravelTimes,
  max = TRAVEL_TIMES_KEPT,
): Map<string, TravelTimes> {
  const next = new Map(map)
  next.delete(key)
  next.set(key, { ...map.get(key), ...times })
  while (next.size > max) next.delete(next.keys().next().value!)
  return next
}
