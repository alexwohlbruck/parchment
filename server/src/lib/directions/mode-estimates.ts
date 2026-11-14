import type { TransitItinerary } from '../../types/integration.types'
import type { Coordinate, UnifiedRoute } from '../../types/unified-routing.types'
import type { RoutingPreferences } from '../../types/trip.types'
import type { Language } from '../i18n/i18n.types'

export const ESTIMATE_MODES = ['walking', 'biking', 'driving', 'transit'] as const
export type EstimateMode = (typeof ESTIMATE_MODES)[number]

export interface ModeEstimatesRequest {
  waypoints: Coordinate[]
  modes: EstimateMode[]
  routingPreferences?: Partial<Record<EstimateMode, RoutingPreferences>>
  departureTime?: string
  language?: Language
}

export type ModeEstimates = Partial<Record<EstimateMode, number | null>>

/** Straight-line distance past which a mode is not worth routing at all. */
const REACH_M: Record<EstimateMode, number> = {
  walking: 100_000,
  biking: 300_000,
  driving: Infinity,
  transit: Infinity,
}

const STREET_MOTIS_MODES = new Set([
  'WALK', 'BIKE', 'BICYCLE', 'CAR', 'CAR_PARKING', 'CAR_DROPOFF', 'RENTAL', 'FLEX', 'ODM',
])

export function withinReach(mode: EstimateMode, meters: number): boolean {
  return meters <= REACH_M[mode]
}

/** Seconds for the engine's first route, summed over its legs. */
export function routeSeconds(route: UnifiedRoute | null | undefined): number | null {
  const first = route?.routes[0]
  if (!first?.legs.length) return null
  const seconds = first.legs.reduce((sum, leg) => sum + leg.duration, 0)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null
}

/** Duration of the earliest-arriving itinerary that actually rides something. */
export function transitSeconds(itineraries: TransitItinerary[] | null | undefined): number | null {
  const rides = (itineraries ?? []).filter(it => it.legs.some(leg => !STREET_MOTIS_MODES.has(leg.mode)))
  if (!rides.length) return null
  const first = rides.reduce((best, it) =>
    new Date(it.endTime).getTime() < new Date(best.endTime).getTime() ? it : best)
  return Math.round(first.duration)
}
