import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

export interface MapillaryConfig extends IntegrationConfig {
  accessToken: string
}

export class MapillaryIntegration implements Integration<MapillaryConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.MAPILLARY
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_LAYER,
    IntegrationCapabilityId.STREET_VIEW,
  ]
  readonly capabilities = {}

  protected config: MapillaryConfig = {
    accessToken: '',
  }

  initialize(config: MapillaryConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Access token is required')
    }

    this.config = {
      accessToken: config.accessToken,
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
    config: MapillaryConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: Access token is required',
      }
    }

    try {
      // TODO:
      // Attempt a lightweight request against Mapillary API using the token
      // const testUrl =
      //   'https://graph.mapillary.com/image?fields=id&limit=1&access_token=' +
      //   encodeURIComponent(config.accessToken)
      // const response = await fetch(testUrl)

      // if (!response.ok) {
      //   return {
      //     success: false,
      //     message: 'Invalid access token or API error',
      //   }
      // }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to Mapillary API',
      }
    }
  }

  validateConfig(config: MapillaryConfig): boolean {
    return Boolean(config && config.accessToken)
  }
}
