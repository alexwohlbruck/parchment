/**
 * Uber rideshare integration.
 *
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
  serverToken: string
}

const UBER_API_BASE = 'https://api.uber.com'

export class UberIntegration implements Integration<UberConfig> {
  readonly integrationId = IntegrationId.UBER
  readonly capabilityIds = [IntegrationCapabilityId.RIDESHARE_ESTIMATE]

  private config: UberConfig | null = null

  readonly capabilities: IntegrationCapabilities = {
    rideshareEstimate: {
      getRideshareEstimates: this.getRideshareEstimates.bind(this),
    } satisfies RideshareEstimateCapability,
  }

  validateConfig(config: UberConfig): boolean {
    return !!config?.serverToken?.trim()
  }

  async testConnection(config: UberConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Server token is required' }
    }
    try {
      const res = await fetch(`${UBER_API_BASE}/v1.2/estimates/time?start_latitude=40.758&start_longitude=-73.985`, {
        headers: { Authorization: `Token ${config.serverToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { success: false, message: `Uber API returned ${res.status}` }
      return { success: true, message: 'Connected to Uber API' }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection failed' }
    }
  }

  initialize(config: UberConfig): void {
    this.config = config
  }

  private async getRideshareEstimates(
    request: RideshareEstimateRequest,
  ): Promise<RideshareEstimateResponse> {
    if (!this.config) throw new Error('Uber integration not initialized')

    const headers = { Authorization: `Token ${this.config.serverToken}` }
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
