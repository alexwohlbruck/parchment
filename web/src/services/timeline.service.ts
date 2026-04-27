import { api } from '@/lib/api'
import { useIntegrationsStore } from '@/stores/integrations.store'
import type {
  LocationHistory,
  PlaceVisitHistory,
} from '@server/types/location-history.types'

export class MissingDawarichConfigError extends Error {
  constructor() {
    super('Dawarich is not configured')
    this.name = 'MissingDawarichConfigError'
  }
}

export interface FetchLocationHistoryArgs {
  start: Date
  end: Date
  /** Wider range used to populate the daily-distance chart. */
  statsStart?: Date
  statsEnd?: Date
  /** IANA timezone for daily-stats bucketing. Defaults to the browser's. */
  timezone?: string
  /** Pass an AbortController.signal to cancel a stale request. */
  signal?: AbortSignal
}

/**
 * Fetch unified location history for a date range.
 *
 * The Dawarich config is decrypted client-side at sign-in (user-e2ee scheme),
 * so the URL + token live only in memory. They're forwarded to our server via
 * `X-Integration-Endpoint` and `X-Integration-Token` headers per request; our
 * server uses them in-memory to call Dawarich and never persists or logs them.
 */
export async function fetchLocationHistory(
  args: FetchLocationHistoryArgs,
): Promise<LocationHistory> {
  const integrationsStore = useIntegrationsStore()
  const config = integrationsStore.dawarichConfig
  if (!config) throw new MissingDawarichConfigError()

  const timezone =
    args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'

  const params: Record<string, string> = {
    start: args.start.toISOString(),
    end: args.end.toISOString(),
    timezone,
  }
  if (args.statsStart && args.statsEnd) {
    params.statsStart = args.statsStart.toISOString()
    params.statsEnd = args.statsEnd.toISOString()
  }

  const response = await api.get<LocationHistory>('/location-history', {
    params,
    headers: {
      'X-Integration-Endpoint': config.url,
      'X-Integration-Token': config.apiToken,
    },
    signal: args.signal,
  })

  return response.data
}

export interface FetchPlaceVisitHistoryArgs {
  lat: number
  lng: number
  /** Search radius in meters. Server defaults to ~75 m if omitted. */
  radius?: number
  /** Cap on `recentVisits` returned. Server defaults to 5. */
  recentLimit?: number
  signal?: AbortSignal
}

/**
 * Fetch "You've been here N times" aggregate for a coordinate. Same e2ee
 * passthrough as the timeline endpoint — Dawarich credentials forwarded
 * via headers, never persisted server-side.
 */
export async function fetchPlaceVisitHistory(
  args: FetchPlaceVisitHistoryArgs,
): Promise<PlaceVisitHistory> {
  const integrationsStore = useIntegrationsStore()
  const config = integrationsStore.dawarichConfig
  if (!config) throw new MissingDawarichConfigError()

  const params: Record<string, string> = {
    lat: String(args.lat),
    lng: String(args.lng),
  }
  if (args.radius !== undefined) params.radius = String(args.radius)
  if (args.recentLimit !== undefined)
    params.recentLimit = String(args.recentLimit)

  const response = await api.get<PlaceVisitHistory>('/location-history/place', {
    params,
    headers: {
      'X-Integration-Endpoint': config.url,
      'X-Integration-Token': config.apiToken,
    },
    signal: args.signal,
  })
  return response.data
}
