import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

export interface FirmsConfig extends IntegrationConfig {
  apiKey: string
}

/**
 * NASA FIRMS — active-fire satellite detections (VIIRS/MODIS). A configurable
 * key holder (FIRMS calls it a MAP_KEY); the fetch/parse lives in the
 * environment controller, which reads this integration's `apiKey` from the
 * integration manager. Powers the Environment "Fire hotspots" overlay.
 */
export class FirmsIntegration implements Integration<FirmsConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.FIRMS
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_LAYER,
  ]
  readonly capabilities = {}

  protected config: FirmsConfig = { apiKey: '' }

  initialize(config: FirmsConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: MAP_KEY is required')
    }
    this.config = { apiKey: config.apiKey }
    this.initialized = true
  }

  validateConfig(config: FirmsConfig): boolean {
    return Boolean(config && config.apiKey)
  }

  async testConnection(config: FirmsConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Invalid configuration: MAP_KEY is required' }
    }
    try {
      // FIRMS validates the key via a small availability query.
      const res = await fetch(
        `https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/${config.apiKey}/VIIRS_SNPP_NRT`,
        { signal: AbortSignal.timeout(8_000) },
      )
      const text = await res.text()
      if (!res.ok || /Invalid MAP_KEY/i.test(text)) {
        return { success: false, message: 'Invalid MAP_KEY' }
      }
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to NASA FIRMS API',
      }
    }
  }
}
