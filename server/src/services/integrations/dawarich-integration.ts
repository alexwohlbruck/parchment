import axios, { type AxiosInstance } from 'axios'
import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationId,
  IntegrationCapabilityId,
  Integration,
  IntegrationCredentials,
  LocationHistoryCapability,
} from '../../types/integration.types'
import type {
  LocationHistory,
  LocationHistoryRequest,
} from '../../types/location-history.types'
import type { Coordinate } from '../../types/unified-routing.types'
import {
  DawarichAdapter,
  type DawarichTimelineResponse,
  type DawarichTimelineDay,
  type DawarichTracksResponse,
} from './adapters/dawarich-adapter'

/**
 * Dawarich — self-hosted location-history service.
 *
 * Configured under `scheme: 'user-e2ee'`: the URL + API token are encrypted
 * client-side and never reach the server at rest. Capability calls forward
 * those credentials per-request via headers; the server uses them only for
 * the duration of one upstream call.
 */
export interface DawarichConfig extends IntegrationConfig {
  url: string
  apiToken: string
}

const DEFAULT_TIMEOUT_MS = 15_000
/**
 * Dawarich caps `/api/v1/timeline` at 31 days per request. We chunk wider
 * ranges into 31-day windows and fire them in parallel.
 */
const TIMELINE_MAX_DAYS = 31

export class DawarichIntegration
  implements Integration<DawarichConfig>, LocationHistoryCapability
{
  readonly integrationId = IntegrationId.DAWARICH
  readonly capabilityIds = [IntegrationCapabilityId.LOCATION_HISTORY]
  readonly capabilities = {
    locationHistory: {
      getLocationHistory: this.getLocationHistory.bind(this),
    } satisfies LocationHistoryCapability,
  }

  private adapter = new DawarichAdapter()

  initialize(_config: DawarichConfig): void {
    // user-e2ee: the server has no cleartext config to cache. Credentials
    // arrive per-request from the client; nothing to wire up here.
  }

  async testConnection(
    config: DawarichConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'URL and API token are required',
      }
    }

    let baseUrl: string
    try {
      const url = new URL(config.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { success: false, message: 'URL must use http:// or https://' }
      }
      baseUrl = `${url.protocol}//${url.host}`
    } catch {
      return { success: false, message: 'URL is not a valid web address' }
    }

    try {
      // /api/v1/stats has no required params and returns 200 with auth, 401
      // without — a clean way to verify both reachability and the token.
      await axios.get(`${baseUrl}/api/v1/stats`, {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          Accept: 'application/json',
        },
        timeout: 5000,
      })
      return { success: true }
    } catch (err: any) {
      const status = err?.response?.status as number | undefined
      if (status === 401 || status === 403) {
        return { success: false, message: 'Invalid API token' }
      }
      if (status === 404) {
        return {
          success: false,
          message:
            'No Dawarich API at this URL — double-check the host (no path needed)',
        }
      }
      if (typeof status === 'number') {
        return { success: false, message: `Dawarich responded with ${status}` }
      }
      const code = err?.code as string | undefined
      if (code === 'ECONNABORTED') {
        return { success: false, message: 'Connection timed out' }
      }
      if (
        code === 'ENOTFOUND' ||
        code === 'ECONNREFUSED' ||
        code === 'EAI_AGAIN'
      ) {
        return { success: false, message: 'Could not reach the host' }
      }
      return {
        success: false,
        message: `Connection failed: ${err?.message ?? 'unknown error'}`,
      }
    }
  }

  validateConfig(config: DawarichConfig): boolean {
    return Boolean(
      config &&
        typeof config.url === 'string' &&
        config.url.length > 0 &&
        typeof config.apiToken === 'string' &&
        config.apiToken.length > 0,
    )
  }

  async getLocationHistory(
    credentials: IntegrationCredentials,
    request: LocationHistoryRequest,
  ): Promise<LocationHistory> {
    const client = this.buildClient(credentials)
    const timezone = request.timezone ?? 'UTC'
    const statsRange = request.statsRange ?? request.range

    // /timeline gives us pre-grouped days with visits + journeys (with rich
    // place metadata, distances, and per-day summaries) — covers both the
    // entries list and the chart in a single call shape, no N+1.
    //
    // /tracks is fetched only for the entries window so we can render
    // polylines on the map. Off-range tracks contribute nothing visual.
    const [timeline, tracks] = await Promise.all([
      this.fetchTimeline(client, statsRange.start, statsRange.end),
      this.fetchTracks(
        client,
        request.range.start.toISOString(),
        request.range.end.toISOString(),
      ),
    ])

    const geometryByTrackId = new Map<number, Coordinate[]>()
    for (const f of tracks.features) {
      geometryByTrackId.set(
        f.properties.id,
        f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      )
    }

    return this.adapter.toLocationHistory({
      timeline,
      geometryByTrackId,
      range: request.range,
      statsRange,
      timezone,
      instanceUrl: credentials.endpoint,
    })
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private buildClient(credentials: IntegrationCredentials): AxiosInstance {
    return axios.create({
      baseURL: credentials.endpoint.replace(/\/+$/, ''),
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        Accept: 'application/json',
      },
    })
  }

  /**
   * `GET /api/v1/timeline` — Dawarich's pre-grouped day-by-day feed of
   * visits + journeys. Hard-capped at 31 days per request, so wider ranges
   * are split into chunks and merged.
   */
  private async fetchTimeline(
    client: AxiosInstance,
    start: Date,
    end: Date,
  ): Promise<DawarichTimelineResponse> {
    const chunks = chunkRangeByDays(start, end, TIMELINE_MAX_DAYS)
    const responses = await Promise.all(
      chunks.map(async ([a, b]) => {
        const { data } = await client.get<DawarichTimelineResponse>(
          '/api/v1/timeline',
          {
            params: {
              start_at: a.toISOString(),
              end_at: b.toISOString(),
              distance_unit: 'km',
            },
          },
        )
        return data?.days ?? []
      }),
    )

    // Merge by date in case chunks overlap or repeat days; later wins.
    const byDate = new Map<string, DawarichTimelineDay>()
    for (const days of responses) {
      for (const d of days) byDate.set(d.date, d)
    }
    const days = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    )
    return { days }
  }

  /**
   * Page through `/api/v1/tracks` until exhausted. Dawarich defaults to
   * `per_page=500` and exposes `X-Total-Pages` — without looping we'd
   * silently drop tracks past the first page on heavy users / wide ranges.
   */
  private async fetchTracks(
    client: AxiosInstance,
    startAt: string,
    endAt: string,
  ): Promise<DawarichTracksResponse> {
    const features: DawarichTracksResponse['features'] = []
    let page = 1
    const PER_PAGE = 500
    const MAX_PAGES = 20

    while (page <= MAX_PAGES) {
      const response = await client.get<DawarichTracksResponse>(
        '/api/v1/tracks',
        { params: { start_at: startAt, end_at: endAt, page, per_page: PER_PAGE } },
      )
      const { data, headers } = response
      if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
        features.push(...data.features)
      }
      const totalPages = Number.parseInt(
        (headers['x-total-pages'] as string | undefined) ?? '1',
        10,
      )
      if (page >= totalPages || !Number.isFinite(totalPages)) break
      page++
    }

    return { type: 'FeatureCollection', features }
  }
}

/**
 * Split a date range into N-day-or-less chunks. End-inclusive: every chunk's
 * `end` is at most `maxDays` after its `start`, and the last chunk ends at
 * the original `end`.
 */
function chunkRangeByDays(
  start: Date,
  end: Date,
  maxDays: number,
): [Date, Date][] {
  const chunkMs = maxDays * 24 * 3600 * 1000
  const chunks: [Date, Date][] = []
  let cursor = start.getTime()
  const endMs = end.getTime()
  while (cursor < endMs) {
    const next = Math.min(cursor + chunkMs, endMs)
    chunks.push([new Date(cursor), new Date(next)])
    cursor = next + 1
  }
  if (chunks.length === 0) chunks.push([start, end])
  return chunks
}
