import type { Coordinate } from '../types/unified-routing.types'
import type { RoutingPreferences } from '../types/trip.types'
import type { Language } from '../lib/i18n'
import { routingService } from './routing.service'
import { transitRoutingService } from './transit-routing.service'
import { TransitPriority } from '../lib/transit/transit-gate'
import { MemoCache } from '../lib/memo-cache'
import { logWarn } from '../lib/logger'
import {
  type EstimateMode,
  pathMeters,
  routeSeconds,
  transitSeconds,
  withinReach,
} from '../lib/directions/mode-estimates'

export interface ModeEstimatesRequest {
  points: Coordinate[]
  modes: EstimateMode[]
  routingPreferences?: Partial<Record<EstimateMode, RoutingPreferences>>
  departureTime?: string
  language?: Language
}

export type ModeEstimates = Partial<Record<EstimateMode, number | null>>

const COSTING: Record<Exclude<EstimateMode, 'transit'>, string> = {
  walking: 'pedestrian',
  biking: 'bicycle',
  driving: 'auto',
}

/** Leave-now transit times drift as departures pass; street times barely move. */
const cache = new MemoCache<number | null>({ max: 500, ttlMs: 2 * 60_000 })

async function streetSeconds(mode: Exclude<EstimateMode, 'transit'>, request: ModeEstimatesRequest) {
  const preferences = { ...request.routingPreferences?.[mode], ...(request.language && { language: request.language }) }
  const route = await routingService.getRoute(
    request.points.map(p => ({ type: 'coordinates', value: [p.lat, p.lng] })),
    COSTING[mode],
    preferences,
    { summary: true },
  )
  return routeSeconds(route)
}

async function rideSeconds(request: ModeEstimatesRequest) {
  // A multi-stop transit time depends on every connection along the chain; only the planner can say.
  if (request.points.length !== 2) return null
  const [from, to] = request.points
  const prefs = request.routingPreferences?.transit
  const response = await transitRoutingService.getIntermodalRoute({
    from,
    to,
    time: request.departureTime ?? new Date().toISOString(),
    numItineraries: 2,
    searchWindow: 1800,
    maxTransfers: prefs?.maxTransfers,
    wheelchair: prefs?.wheelchairAccessible,
    preTransitModes: ['WALK'],
    postTransitModes: ['WALK'],
    maxPreTransitTime: 1500,
    maxPostTransitTime: 1500,
  }, TransitPriority.Variant)
  return transitSeconds(response?.itineraries)
}

function estimate(mode: EstimateMode, request: ModeEstimatesRequest): Promise<number | null> {
  if (!withinReach(mode, pathMeters(request.points))) return Promise.resolve(null)
  const key = JSON.stringify([
    mode,
    request.points.map(p => [p.lat, p.lng]),
    request.routingPreferences?.[mode] ?? null,
    mode === 'transit' ? request.departureTime ?? null : null,
    request.language ?? null,
  ])
  return cache.get(key, () => (mode === 'transit' ? rideSeconds(request) : streetSeconds(mode, request)))
    .catch((error) => {
      logWarn(`No ${mode} estimate: ${error instanceof Error ? error.message : error}`)
      return null
    })
}

/** Rough door-to-door seconds per mode, without planning full trips; null where a mode has no route. */
export async function estimateModes(request: ModeEstimatesRequest): Promise<ModeEstimates> {
  const modes = [...new Set(request.modes)]
  const seconds = await Promise.all(modes.map(mode => estimate(mode, request)))
  return Object.fromEntries(modes.map((mode, i) => [mode, seconds[i]]))
}
