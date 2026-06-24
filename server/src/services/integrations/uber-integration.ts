/**
 * Uber rideshare integration.
 *
 * Uses OAuth2 client_credentials flow (server tokens are deprecated).
 * Calls Uber's Ride Estimates API for price/time estimates and maps
 * products to the unified RideshareProduct interface.
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
import { adaptUberEstimates } from './adapters/uber-adapter'

export interface UberConfig extends IntegrationConfig {
  clientId: string
  clientSecret: string
}

const UBER_API_BASE = 'https://api.uber.com'
const UBER_AUTH_URL = 'https://login.uber.com/oauth/v2/token'

export class UberIntegration implements Integration<UberConfig> {
  readonly integrationId = IntegrationId.UBER
  readonly capabilityIds = [IntegrationCapabilityId.RIDESHARE_ESTIMATE]

  private config: UberConfig | null = null
  private accessToken: string | null = null
  private tokenExpiresAt = 0

  readonly capabilities: IntegrationCapabilities = {
    rideshareEstimate: {
      getRideshareEstimates: this.getRideshareEstimates.bind(this),
    } satisfies RideshareEstimateCapability,
  }

  validateConfig(config: UberConfig): boolean {
    return !!(config?.clientId?.trim() && config?.clientSecret?.trim())
  }

  async testConnection(config: UberConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Client ID and Client Secret are required' }
    }
    try {
      const token = await this.getAccessToken(config)
      if (!token) return { success: false, message: 'Failed to obtain access token' }
      return { success: true, message: 'Connected to Uber API' }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection failed' }
    }
  }

  initialize(config: UberConfig): void {
    this.config = config
  }

  /**
   * OAuth2 client_credentials flow. Token cached ~30 days.
   */
  private async getAccessToken(config?: UberConfig): Promise<string | null> {
    const cfg = config ?? this.config
    if (!cfg) return null

    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken
    }

    const res = await fetch(UBER_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'client_credentials',
        scope: 'ride_request.estimate',
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return null
    const data = await res.json() as any
    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 2592000) * 1000
    return this.accessToken
  }

  private async getRideshareEstimates(
    request: RideshareEstimateRequest,
  ): Promise<RideshareEstimateResponse> {
    const token = await this.getAccessToken()
    if (!token) throw new Error('Uber: failed to authenticate')

    const headers = { Authorization: `Bearer ${token}` }
    const timeout = AbortSignal.timeout(10_000)

    // Fetch price + time estimates in parallel
    const [priceRes, timeRes] = await Promise.all([
      fetch(
        `${UBER_API_BASE}/v1.2/estimates/price?` +
        `start_latitude=${request.origin.lat}&start_longitude=${request.origin.lng}` +
        `&end_latitude=${request.destination.lat}&end_longitude=${request.destination.lng}`,
        { headers, signal: timeout },
      ),
      fetch(
        `${UBER_API_BASE}/v1.2/estimates/time?` +
        `start_latitude=${request.origin.lat}&start_longitude=${request.origin.lng}`,
        { headers, signal: timeout },
      ),
    ])

    if (!priceRes.ok) throw new Error(`Uber price API: ${priceRes.status}`)

    const priceData = await priceRes.json() as any
    const timeData = timeRes.ok ? await timeRes.json() as any : { times: [] }

    const products = adaptUberEstimates(
      priceData.prices ?? [],
      timeData.times ?? [],
      request.origin,
      request.destination,
    )

    return {
      provider: 'Uber',
      products,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  }
}
