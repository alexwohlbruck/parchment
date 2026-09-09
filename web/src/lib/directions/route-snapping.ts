/**
 * Snapping a set of dropped points into a routed path.
 *
 * Pulled out of the route builder so the canvas's Route tool can use the same
 * call rather than growing a second one. Everything store-shaped stays with
 * the caller: this takes waypoints and a mode, and returns a path or null.
 *
 * The retry loop is not defensive padding — the routing engine intermittently
 * returns zero candidates for a perfectly valid origin/destination pair, and
 * a transient miss must not read to the user as "there is no route here".
 */

import axios from 'axios'
import { api } from '@/lib/api'
import type { RouteMode, RouteSegment, RouteStats } from '@/types/routes.types'

export interface SnapWaypoint {
  lat: number
  lng: number
  name?: string
}

export interface SnappedPath {
  /** The routed path as [lng, lat] pairs, ready for GeoJSON. */
  geometry: Array<[number, number]>
  /** Per-vertex elevation, aligned to `geometry`, when the engine returned it. */
  elevation?: number[]
  segments: RouteSegment[]
  stats: RouteStats
}

/** Backend `selectedMode` token for a travel mode. */
export function backendMode(mode: RouteMode): string {
  return mode === 'cycling' ? 'biking' : mode
}

/** Delay that resolves early if the request is superseded (aborted). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

interface CollectedLeg extends RouteSegment {
  /** Per-vertex elevation (meters), aligned to `geometry`; may be sparse. */
  elevation: Array<number | undefined>
}

/**
 * Walk a directions response's segment tree and collect the leaf legs that
 * carry geometry. Multimodal candidates nest sub-segments under
 * `details.multimodalSegments`; single-mode routes are already flat.
 */
export function collectLegs(segments: any[]): CollectedLeg[] {
  const legs: CollectedLeg[] = []
  for (const segment of segments ?? []) {
    if (segment.details?.multimodalSegments) {
      legs.push(...collectLegs(segment.details.multimodalSegments))
      continue
    }
    const points = segment.geometry ?? []
    legs.push({
      mode: segment.mode,
      geometry: points.map(
        (c: any) => [c.lng, c.lat] as [number, number],
      ),
      distance: segment.distance ?? 0,
      duration: segment.duration ?? 0,
      elevation: points.map((c: any) =>
        typeof c.elevation === 'number' ? c.elevation : undefined,
      ),
    })
  }
  return legs
}

/** A trip response reduced to the path and its totals. */
export function pathFromTrip(trip: any): SnappedPath {
  const legs = collectLegs(trip.segments)
  const geometry = legs.flatMap(leg => leg.geometry)

  const elevationFlat = legs.flatMap(leg => leg.elevation)
  const hasElevation = elevationFlat.some(value => value !== undefined)

  const elevationGain = (trip.segments ?? []).reduce(
    (sum: number, s: any) => sum + (s.totalElevationGain ?? 0),
    0,
  )
  const elevationLoss = (trip.segments ?? []).reduce(
    (sum: number, s: any) => sum + (s.totalElevationLoss ?? 0),
    0,
  )

  return {
    geometry,
    elevation: hasElevation ? elevationFlat.map(e => e ?? 0) : undefined,
    // Strip the per-leg elevation helper before handing the legs back.
    segments: legs.map(({ elevation: _e, ...rest }) => rest),
    stats: {
      distance: trip.tripStats?.totalDistance ?? 0,
      duration: trip.tripStats?.totalDuration ?? 0,
      elevationGain: elevationGain || undefined,
      elevationLoss: elevationLoss || undefined,
    },
  }
}

/**
 * Named for what the platform calls a cancelled request, so anything asking
 * "was this abandoned or did it fail" gets one answer for both.
 */
export class RouteSnapAborted extends Error {
  override name = 'AbortError'
}

/**
 * Route between the given waypoints. Returns null when the engine had nothing
 * for us — the caller decides whether that is worth surfacing, because a
 * builder mid-edit and a canvas annotation want different things from it.
 *
 * Throws `RouteSnapAborted` when superseded, so callers can tell "cancelled"
 * from "no route".
 */
export async function snapWaypointsToPath(params: {
  waypoints: SnapWaypoint[]
  mode: RouteMode
  signal?: AbortSignal
  /** How many times to retry an empty response. */
  attempts?: number
}): Promise<SnappedPath | null> {
  const { waypoints, mode, signal, attempts = 4 } = params
  if (waypoints.length < 2) return null

  const request = {
    waypoints: waypoints.map((waypoint, index) => ({
      location: { lat: waypoint.lat, lng: waypoint.lng },
      type:
        index === 0
          ? 'origin'
          : index === waypoints.length - 1
            ? 'destination'
            : 'via',
      label: waypoint.name ?? '',
    })),
    selectedMode: backendMode(mode),
    availableVehicles: [],
    routingPreferences: {},
    requestId: `snap-${Date.now()}`,
  }

  let trip: any = null
  for (let attempt = 0; attempt < attempts && !trip; attempt++) {
    if (signal?.aborted) throw new RouteSnapAborted()
    if (attempt > 0) await sleep(250, signal)
    try {
      const { data } = await api.post('/directions/', request, {
        signal,
        timeout: 30_000,
      })
      trip = data.trips?.[0]?.trip ?? null
    } catch (error) {
      if (axios.isCancel(error)) throw new RouteSnapAborted()
      throw error
    }
  }

  return trip ? pathFromTrip(trip) : null
}
