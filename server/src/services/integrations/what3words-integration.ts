import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

export interface What3wordsConfig extends IntegrationConfig {
  apiKey: string
}

/**
 * what3words — a configurable key holder. The API calls live in
 * `services/what3words.service.ts`, which reads this integration's `apiKey`
 * from the integration manager. It powers three-word addresses in search
 * and in the map's copy-location menu.
 */
export class What3wordsIntegration implements Integration<What3wordsConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.WHAT3WORDS
  readonly capabilityIds: IntegrationCapabilityId[] = []
  readonly capabilities = {}

  protected config: What3wordsConfig = { apiKey: '' }

  initialize(config: What3wordsConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API Key is required')
    }
    this.config = { apiKey: config.apiKey }
    this.initialized = true
  }

  validateConfig(config: What3wordsConfig): boolean {
    return Boolean(config && config.apiKey)
  }

  async testConnection(config: What3wordsConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Invalid configuration: API Key is required' }
    }
    try {
      const params = new URLSearchParams({ words: 'filled.count.soap', key: config.apiKey })
      const res = await fetch(`https://api.what3words.com/v3/convert-to-coordinates?${params}`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403) {
        return { success: false, message: 'Invalid API key' }
      }
      if (!res.ok) {
        return { success: false, message: `what3words API error: ${res.status}` }
      }
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to the what3words API',
      }
    }
  }
}
