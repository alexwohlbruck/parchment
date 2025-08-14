import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

export interface TransitlandConfig extends IntegrationConfig {
  apiKey: string
}

export class TransitlandIntegration implements Integration<TransitlandConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.TRANSITLAND
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_LAYER,
  ]
  readonly capabilities = {}

  protected config: TransitlandConfig = {
    apiKey: '',
  }

  initialize(config: TransitlandConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API key is required')
    }

    this.config = {
      apiKey: config.apiKey,
    }

    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  async testConnection(
    config: TransitlandConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API key is required',
      }
    }

    try {
      // Attempt a lightweight request against Transitland tiles using the key
      const testUrl =
        'https://transit.land/api/v2/tiles/routes/tiles/0/0/0.pbf?apikey=' +
        encodeURIComponent(config.apiKey)
      const response = await fetch(testUrl)

      if (!response.ok) {
        return {
          success: false,
          message: 'Invalid API key or API error',
        }
      }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to Transitland API',
      }
    }
  }

  validateConfig(config: TransitlandConfig): boolean {
    return Boolean(config && config.apiKey)
  }
}
