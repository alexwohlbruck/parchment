import {
  MapboxConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  MapEngineCapability,
} from '../../types/integration.types'

/**
 * Mapbox integration for map rendering and tiles
 */
export class MapboxIntegration implements Integration<MapboxConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.MAPBOX
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_ENGINE,
  ]
  readonly capabilities = {
    mapEngine: {
      // No methods
    } as MapEngineCapability,
  }

  protected config: MapboxConfig = {
    accessToken: '',
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: MapboxConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Access token is required')
    }

    this.config = {
      accessToken: config.accessToken,
    }

    this.initialized = true
  }

  /**
   * Ensures the integration has been initialized before performing operations
   * @throws Error if the integration has not been initialized
   */
  // TODO: Review this function in all integrations
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  async testConnection(config: MapboxConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: Access token is required',
      }
    }

    try {
      // Test the access token by making a request to Mapbox API
      const url =
        'https://api.mapbox.com/tokens/v2?access_token=' + config.accessToken

      const response = await fetch(url)

      if (!response.ok) {
        return {
          success: false,
          message: 'Invalid access token or API error',
        }
      }

      const data = await response.json()

      if (data.code && data.code === 'TokenValid') {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Access token is not valid',
        }
      }
    } catch (error: any) {
      console.error('Error testing Mapbox API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Mapbox API',
      }
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: MapboxConfig): boolean {
    return Boolean(config && config.accessToken)
  }
}
