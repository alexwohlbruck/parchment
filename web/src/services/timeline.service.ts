import { api } from '@/lib/api'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'
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

/**
 * The Dawarich config is decrypted client-side at sign-in (user-e2ee scheme),
 * so the URL + token live only in memory. They're forwarded to our server via
 * `X-Integration-Endpoint` and `X-Integration-Token` headers per request; our
 * server uses them in-memory to call Dawarich and never persists or logs them.
 *
 * `integrationId` routes upstream failures into the degraded-integration flow
 * (settings badge) instead of an error toast.
 */
async function dawarichGet<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const config = useIntegrationsStore().dawarichConfig
  if (!config) throw new MissingDawarichConfigError()

  const response = await api.get<T>(path, {
    params,
    headers: {
      'X-Integration-Endpoint': config.url,
      'X-Integration-Token': config.apiToken,
    },
    signal,
    integrationId: IntegrationId.DAWARICH,
  })
  return response.data
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

/** Fetch unified location history for a date range. */
export async function fetchLocationHistory(
  args: FetchLocationHistoryArgs,
): Promise<LocationHistory> {
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

  return dawarichGet<LocationHistory>('/location-history', params, args.signal)
}

export interface FetchPlaceVisitHistoryArgs {
  lat: number
  lng: number
  /**
   * The OSM polygon's bounding box, when available. Server uses it to
   * size the search area to the actual place — small radius for a house,
   * many hundreds of meters for an amusement park.
   */
  bounds?: {
    minLat: number
    minLng: number
    maxLat: number
    maxLng: number
  }
  /** Search radius in meters. Server falls back to a default when omitted. */
  radius?: number
  /** Cap on `recentVisits` returned. Server defaults to 5. */
  recentLimit?: number
  signal?: AbortSignal
}

/** Fetch "You've been here N times" aggregate for a coordinate. */
export async function fetchPlaceVisitHistory(
  args: FetchPlaceVisitHistoryArgs,
): Promise<PlaceVisitHistory> {
  const params: Record<string, string> = {
    lat: String(args.lat),
    lng: String(args.lng),
  }
  if (args.bounds) {
    params.minLat = String(args.bounds.minLat)
    params.minLng = String(args.bounds.minLng)
    params.maxLat = String(args.bounds.maxLat)
    params.maxLng = String(args.bounds.maxLng)
  }
  if (args.radius !== undefined) params.radius = String(args.radius)
  if (args.recentLimit !== undefined)
    params.recentLimit = String(args.recentLimit)

  return dawarichGet<PlaceVisitHistory>(
    '/location-history/place',
    params,
    args.signal,
  )
}
