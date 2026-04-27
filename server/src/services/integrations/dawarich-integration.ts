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
import {
  DawarichAdapter,
  type DawarichTracksResponse,
  type DawarichVisit,
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
    _config: DawarichConfig,
  ): Promise<IntegrationTestResult> {
    // Real probe is deferred until we have a confirmed status endpoint
    // worth hitting. Returning success keeps the form's "test before save"
    // UX working until then.
    return { success: true }
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
    const startIso = request.range.start.toISOString()
    const endIso = request.range.end.toISOString()
    const timezone = request.timezone ?? 'UTC'

    const [visits, tracks] = await Promise.all([
      this.fetchVisits(client, startIso, endIso),
      this.fetchTracks(client, startIso, endIso),
    ])

    return this.adapter.toLocationHistory({
      visits,
      tracks,
      range: request.range,
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

  private async fetchVisits(
    client: AxiosInstance,
    startAt: string,
    endAt: string,
  ): Promise<DawarichVisit[]> {
    const { data } = await client.get<DawarichVisit[]>('/api/v1/visits', {
      params: { start_at: startAt, end_at: endAt },
    })
    return Array.isArray(data) ? data : []
  }

  private async fetchTracks(
    client: AxiosInstance,
    startAt: string,
    endAt: string,
  ): Promise<DawarichTracksResponse> {
    const { data } = await client.get<DawarichTracksResponse>(
      '/api/v1/tracks',
      { params: { start_at: startAt, end_at: endAt } },
    )
    if (!data || data.type !== 'FeatureCollection') {
      return { type: 'FeatureCollection', features: [] }
    }
    return data
  }
}
