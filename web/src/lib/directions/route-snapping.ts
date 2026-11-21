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
import { pathFromTrip, type RoutePath } from '@server/lib/directions/route-path'
import type { RouteMode } from '@/types/routes.types'

export interface SnapWaypoint {
  lat: number
  lng: number
  name?: string
}

export type SnappedPath = RoutePath

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
