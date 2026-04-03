import { IntegrationCapabilityId } from '../types/integration.types'
import { integrationManager } from './integrations'
import type { Location } from '../types/valhalla.types'
import {
  RouteRequest,
  UnifiedRoute,
  TravelMode,
  WaypointType,
  RouteWaypoint,
} from '../types/unified-routing.types'

export class RoutingService {
  /**
   * Get a route between multiple locations
   * @param locations Array of locations to route between
   * @param costing Routing costing model (auto, bicycle, pedestrian, etc.)
   * @param preferences Routing preferences (avoid highways, tolls, etc.)
   * @returns Unified route response
   */
  async getRoute(
    locations: Location[],
    costing: string = 'auto',
    preferences?: any,
  ): Promise<UnifiedRoute> {
    // Get configured routing integrations
    const routingIntegrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.ROUTING,
      )

    if (routingIntegrations.length === 0) {
      // TODO: Return useful error to client (Do this for all integration-based endpoints)
      throw new Error('No routing integrations configured')
    }

    // Use preferred routing engine if specified, otherwise use the first available
    let routingIntegrationRecord = routingIntegrations[0]
    if (preferences?.routingEngine) {
      const preferredIntegration = routingIntegrations.find(
        (integration) => integration.integrationId === preferences.routingEngine,
      )
      if (preferredIntegration) {
        routingIntegrationRecord = preferredIntegration
      } else {
        console.warn(
          `Preferred routing engine ${preferences.routingEngine} not found, using default`,
        )
      }
    }

    // Get the cached integration instance
    const integrationInstance = integrationManager.getCachedIntegrationInstance(
      routingIntegrationRecord,
    )

    if (!integrationInstance || !integrationInstance.capabilities.routing) {
      throw new Error(
        `Routing integration ${routingIntegrationRecord.integrationId} not available or not initialized`,
      )
    }

    // Convert locations to unified waypoints format
    const waypoints: RouteWaypoint[] = locations.map((location, index) => ({
      id: `waypoint-${index}`,
      coordinate: {
        lat: location.value[0], // Frontend sends [lat, lng]
        lng: location.value[1],
      },
      type:
        index === 0 || index === locations.length - 1
          ? WaypointType.STOP
          : WaypointType.VIA,
    }))

    // Convert costing to travel mode
    const mode = this.mapCostingToTravelMode(costing)

    // Build unified route request with preferences
    // Map safetyVsEfficiency (0=fastest, 1=safest) to optimize strategy
    let optimize: 'time' | 'distance' | 'balanced' = 'time'
    if (preferences?.safetyVsEfficiency !== undefined) {
      if (preferences.safetyVsEfficiency < 0.33) {
        optimize = 'time' // Fast routes
      } else if (preferences.safetyVsEfficiency > 0.66) {
        optimize = 'distance' // Shorter routes (potentially safer)
      } else {
        optimize = 'balanced' // Balanced approach
      }
    }
    
    const request: RouteRequest = {
      waypoints,
      mode,
      includeInstructions: true,
      includeGeometry: true,
      language: (preferences as { language?: import('../lib/i18n').Language })?.language,
      preferences: preferences ? {
        optimize,
        avoidTolls: preferences.avoidTolls,
        avoidHighways: preferences.avoidHighways,
        avoidFerries: preferences.avoidFerries,
        avoidUnpaved: preferences.preferPavedPaths ? true : undefined,
        maxWalkDistance: preferences.maxWalkingDistance,
        maxTransfers: preferences.maxTransfers,
        wheelchairAccessible: preferences.wheelchairAccessible,
      } : {
        optimize: 'time',
      },
    }

    console.log('Routing waypoints:', waypoints)
    console.log('Routing preferences:', request.preferences)

    try {
      const result = await integrationInstance.capabilities.routing.getRoute(
        request,
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
   * Map legacy costing parameter to unified travel mode
   */
  private mapCostingToTravelMode(costing: string): TravelMode {
    switch (costing.toLowerCase()) {
      case 'auto':
      case 'car':
      case 'driving':
        return TravelMode.DRIVING
      case 'bicycle':
      case 'cycling':
      case 'bike':
        return TravelMode.CYCLING
      case 'pedestrian':
      case 'walking':
      case 'foot':
        return TravelMode.WALKING
      case 'motorcycle':
        return TravelMode.MOTORCYCLE
      case 'truck':
        return TravelMode.TRUCK
      case 'transit':
        return TravelMode.TRANSIT
      default:
        return TravelMode.DRIVING
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
