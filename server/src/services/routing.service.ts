import { IntegrationCapabilityId } from '../types/integration.types'
import { integrationManager } from './integrations'
import type { Location } from '../types/valhalla.types'
import type { UnifiedRoute } from '../types/routing.types'

export class RoutingService {
  /**
   * Get a route between multiple locations
   * @param locations Array of locations to route between
   * @param costing Routing costing model (auto, bicycle, pedestrian, etc.)
   * @param options Additional routing options
   * @returns Unified route response
   */
  async getRoute(
    locations: Location[],
    costing: string = 'auto',
    options?: any,
  ): Promise<UnifiedRoute> {
    // Get configured routing integrations
    const routingIntegrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.ROUTING,
      )

    if (routingIntegrations.length === 0) {
      throw new Error('No routing integrations configured')
    }

    // TODO: Allow user to specify which integration to use
    // Use the first available routing integration
    // based on the request characteristics (e.g., region, routing type, etc.)
    const routingIntegrationRecord = routingIntegrations[0]

    // Get the initialized integration instance from the cache
    const integrationInstance = integrationManager.getCachedIntegrationInstance(
      routingIntegrationRecord,
    )

    if (!integrationInstance || !integrationInstance.capabilities.routing) {
      throw new Error('Routing capability not available')
    }

    // Convert all locations to the format expected by the integration
    const waypoints = locations.map((location) => ({
      lat: location.value[0], // Frontend sends [lat, lng]
      lng: location.value[1],
    }))

    console.log('Routing waypoints:', waypoints)

    try {
      const routeOptions = {
        costing,
        ...options,
      }

      const result = await integrationInstance.capabilities.routing.getRoute(
        waypoints,
        routeOptions,
      )

      // The result is now already in unified format
      return result
    } catch (error) {
      console.error('Routing integration error:', error)
      throw new Error(
        `Failed to get route: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  /**
   * Get available routing integrations
   * @returns Array of configured routing integration IDs
   */
  getAvailableRoutingIntegrations(): string[] {
    const routingIntegrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.ROUTING,
      )

    return routingIntegrations.map((integration) => integration.integrationId)
  }

  /**
   * Check if routing is available
   * @returns True if at least one routing integration is configured
   */
  isRoutingAvailable(): boolean {
    const routingIntegrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.ROUTING,
      )

    return routingIntegrations.length > 0
  }
}

export const routingService = new RoutingService()
