/**
 * Lyft rideshare integration.
 *
 * Calls Lyft's Ride Estimates API for cost/ETA estimates and maps
 * ride types to the unified RideshareProduct interface.
 */

import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
  RideshareEstimateCapability,
  RideshareEstimateRequest,
  RideshareEstimateResponse,
} from '../../types/integration.types'
import { IntegrationId, IntegrationCapabilityId } from '../../types/integration.enums'
import { adaptLyftEstimates } from './adapters/lyft-adapter'

export interface LyftConfig extends IntegrationConfig {
  clientId: string
  clientSecret: string
}

const LYFT_API_BASE = 'https://api.lyft.com'

export class LyftIntegration implements Integration<LyftConfig> {
  readonly integrationId = IntegrationId.LYFT
  readonly capabilityIds = [IntegrationCapabilityId.RIDESHARE_ESTIMATE]

  private accessToken: string | null = null
  private tokenExpiresAt = 0
  private config: LyftConfig | null = null

  readonly capabilities: IntegrationCapabilities = {
    rideshareEstimate: {
      getRideshareEstimates: this.getRideshareEstimates.bind(this),
    } satisfies RideshareEstimateCapability,
  }

  validateConfig(config: LyftConfig): boolean {
    return !!(config?.clientId?.trim() && config?.clientSecret?.trim())
  }

  async testConnection(config: LyftConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Client ID and secret are required' }
    }
    try {
      const token = await this.getAccessToken(config)
      if (!token) return { success: false, message: 'Failed to obtain access token' }
      return { success: true, message: 'Connected to Lyft API' }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection failed' }
    }
  }

  initialize(config: LyftConfig): void {
    this.config = config
  }

  /**
   * Lyft uses OAuth2 client credentials flow for server-to-server.
   */
  private async getAccessToken(config?: LyftConfig): Promise<string | null> {
    const cfg = config ?? this.config
    if (!cfg) return null

    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken
    }

    const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
    const res = await fetch(`${LYFT_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'client_credentials', scope: 'public' }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return null
    const data = await res.json() as any
    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000
    return this.accessToken
  }

  private async getRideshareEstimates(
    request: RideshareEstimateRequest,
  ): Promise<RideshareEstimateResponse> {
    const token = await this.getAccessToken()
    if (!token) throw new Error('Lyft: failed to authenticate')

    const headers = { Authorization: `Bearer ${token}` }
    const timeout = AbortSignal.timeout(10_000)

    const [costRes, etaRes] = await Promise.all([
      fetch(
        `${LYFT_API_BASE}/v1/cost?` +
        `start_lat=${request.origin.lat}&start_lng=${request.origin.lng}` +
        `&end_lat=${request.destination.lat}&end_lng=${request.destination.lng}`,
        { headers, signal: timeout },
      ),
      fetch(
        `${LYFT_API_BASE}/v1/eta?` +
        `lat=${request.origin.lat}&lng=${request.origin.lng}`,
        { headers, signal: timeout },
      ),
    ])

    if (!costRes.ok) throw new Error(`Lyft cost API: ${costRes.status}`)

    const costData = await costRes.json() as any
    const etaData = etaRes.ok ? await etaRes.json() as any : { eta_estimates: [] }

    const products = adaptLyftEstimates(
      costData.cost_estimates ?? [],
      etaData.eta_estimates ?? [],
      request.origin,
      request.destination,
    )

    return {
      provider: 'Lyft',
      products,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  }
}
