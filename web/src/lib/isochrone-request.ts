/**
 * Asking Barrelman what is reachable from a point.
 *
 * Extracted so the isochrone map tool and the canvas isochrone tool ask the
 * same question the same way — one place that knows the endpoint, the
 * timeout, and how to read the contours back.
 */

import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import type {
  IsochroneMode,
  IsochroneResponse,
} from '@server/types/isochrone.types'
import { toIsochroneBands, type IsochroneBand } from '@/lib/isochrone.utils'

/**
 * Isochrones outrun the client's 15s default: a transit contour fans out to
 * hundreds of per-stop graph searches upstream. Sits just above the server's
 * own 60s Barrelman budget so a slow engine surfaces as its 502 rather than as
 * a client-side timeout that says nothing about what went wrong.
 */
export const ISOCHRONE_TIMEOUT_MS = 65_000

export async function fetchIsochroneBands(options: {
  origin: LngLat
  mode: IsochroneMode
  /** Contour durations in seconds, innermost first. */
  durations: number[]
  arriveBy?: boolean
  signal?: AbortSignal
}): Promise<{ bands: IsochroneBand[]; meta: IsochroneResponse['meta'] | null }> {
  const { data } = await api.get<IsochroneResponse>('/isochrone', {
    params: {
      lat: options.origin.lat,
      lng: options.origin.lng,
      mode: options.mode,
      durations: options.durations.join(','),
      arriveBy: options.arriveBy || undefined,
    },
    signal: options.signal,
    timeout: ISOCHRONE_TIMEOUT_MS,
    // Callers report failures next to the controls that caused them; the
    // global toast would just say the same thing twice.
    silent: true,
  } as never)

  return {
    bands: toIsochroneBands(data.isochrones?.features ?? []),
    meta: data.meta ?? null,
  }
}
