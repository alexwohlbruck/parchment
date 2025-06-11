import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  RoutingCapability,
} from '../../types/integration.types'
import type { UnifiedRoute } from '../../types/routing.types'
import { ValhallaAdapter } from './adapters/valhalla-adapter'

export interface ValhallaConfig extends IntegrationConfig {
  host: string
}

/**
 * Valhalla integration for routing
 */
export class ValhallaIntegration implements Integration<ValhallaConfig> {
  private initialized = false
  private adapter = new ValhallaAdapter()
  protected config: ValhallaConfig = { host: '' }

  readonly integrationId = IntegrationId.VALHALLA
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.ROUTING,
  ]
  readonly capabilities = {
    routing: {
      getRoute: this.getRoute.bind(this),
    } as RoutingCapability,
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: ValhallaConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Host is required')
    }

    this.config = { ...config }
    this.initialized = true
  }

  /**
   * Ensures the integration has been initialized before performing operations
   * @throws Error if the integration has not been initialized
   */
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
  async testConnection(config: ValhallaConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: Host is required',
      }
    }

    try {
      // Test the connection by making a simple request to the Valhalla status endpoint
      const host = config.host.endsWith('/')
        ? config.host.slice(0, -1)
        : config.host
      const url = `${host}/status`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        return {
          success: false,
          message: `Valhalla server returned ${response.status}: ${response.statusText}`,
        }
      }

      // Check if response contains Valhalla-specific data
      const data = await response.json()
      if (data && (data.version || data.tileset_last_modified)) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Server does not appear to be a Valhalla instance',
        }
      }
    } catch (error: any) {
      console.error('Error testing Valhalla API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Valhalla server',
      }
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: ValhallaConfig): boolean {
    return Boolean(config && config.host && typeof config.host === 'string')
  }

  /**
   * Get route between multiple waypoints
   * @param waypoints Array of waypoint coordinates
   * @param options Optional routing parameters
   * @returns Route information in unified format
   */
  private async getRoute(
    waypoints: Array<{ lat: number; lng: number }>,
    options?: any,
  ): Promise<UnifiedRoute> {
    this.ensureInitialized()

    if (waypoints.length < 2) {
      throw new Error('At least 2 waypoints are required for routing')
    }

    try {
      const host = this.config.host.endsWith('/')
        ? this.config.host.slice(0, -1)
        : this.config.host
      const url = `${host}/route`

      const requestBody = {
        locations: waypoints.map((waypoint) => ({
          lat: waypoint.lat,
          lon: waypoint.lng,
        })),
        costing: options?.costing || 'auto',
        directions_options: {
          units: 'kilometers',
          language: 'en-US',
        },
        ...options,
      }

      console.log(
        `Valhalla routing request: ${waypoints.length} waypoints`,
        waypoints,
      )

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`Valhalla routing error: ${response.status}`)
      }

      const data = await response.json()

      // Use the adapter to convert raw Valhalla response to unified format
      return this.adapter.routing.adaptRouteResponse(data, url)
    } catch (error) {
      console.error('Valhalla routing error:', error)
      throw error
    }
  }
}
