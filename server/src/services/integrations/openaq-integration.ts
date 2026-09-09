import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

export interface OpenAqConfig extends IntegrationConfig {
  apiKey: string
}

/**
 * OpenAQ — open air-quality ground-station data. A configurable key holder;
 * the fetching/normalization lives in `services/air-quality.service.ts`, which
 * reads this integration's `apiKey` from the integration manager. Powers the
 * Environment "Air Quality" overlay and the sensor-preferred widget readout.
 */
export class OpenAqIntegration implements Integration<OpenAqConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.OPENAQ
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_LAYER,
  ]
  readonly capabilities = {}

  protected config: OpenAqConfig = { apiKey: '' }

  initialize(config: OpenAqConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API Key is required')
    }
    this.config = { apiKey: config.apiKey }
    this.initialized = true
  }

  validateConfig(config: OpenAqConfig): boolean {
    return Boolean(config && config.apiKey)
  }

  async testConnection(config: OpenAqConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Invalid configuration: API Key is required' }
    }
    try {
      const res = await fetch('https://api.openaq.org/v3/locations?limit=1', {
        headers: { 'X-API-Key': config.apiKey },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403) {
        return { success: false, message: 'Invalid API key' }
      }
      if (!res.ok) {
        return { success: false, message: `OpenAQ API error: ${res.status}` }
      }
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to OpenAQ API',
      }
    }
  }
}
