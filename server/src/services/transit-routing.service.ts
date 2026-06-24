import {
  IntegrationCapabilityId,
  type TransitRouteRequest,
  type IntermodalRouteRequest,
  type TransitRouteResponse,
  type NearbyStopsRequest,
  type NearbyStopResult,
  type StopRouteResult,
  type StationEntrance,
} from '../types/integration.types'
import { integrationManager } from './integrations'

/**
 * Transit routing service — bridges the integration system to the
 * TransitRoutingCapability.
 *
 * Follows the same delegation pattern as RoutingService: look up the
 * highest-priority integration that provides TRANSIT_ROUTING, then
 * forward calls to its capability implementation.
 */
export class TransitRoutingService {
  /**
   * Plan a transit trip between two points.
   *
   * Delegates to the configured transit routing integration (Barrelman →
   * MOTIS). The response contains itineraries with walking + transit legs;
   * callers (e.g. TripService) are responsible for replacing walking legs
   * with accurate GraphHopper routes.
   */
  async getTransitRoute(
    request: TransitRouteRequest,
  ): Promise<TransitRouteResponse> {
    const capability = this.getTransitRoutingCapability()
    return capability.getTransitRoute(request)
  }

  /**
   * Intermodal routing with pre/post-transit mode selection.
   *
   * Requires MOTIS to have OSM street data loaded. Falls back to
   * getTransitRoute() if the integration doesn't support intermodal.
   */
  async getIntermodalRoute(
    request: IntermodalRouteRequest,
  ): Promise<TransitRouteResponse> {
    const capability = this.getTransitRoutingCapability()
    if (capability.getIntermodalRoute) {
      return capability.getIntermodalRoute(request)
    }
    return capability.getTransitRoute(request)
  }

  /**
   * Find transit stops near a coordinate.
   */
  async getNearbyStops(
    request: NearbyStopsRequest,
  ): Promise<NearbyStopResult[]> {
    const capability = this.getTransitRoutingCapability()
    return capability.getNearbyStops(request)
  }

  /**
   * Get routes serving a specific stop.
   */
  async getRoutesForStop(
    feedId: string,
    stopId: string,
  ): Promise<StopRouteResult[]> {
    const capability = this.getTransitRoutingCapability()
    return capability.getRoutesForStop(feedId, stopId)
  }

  /**
   * Find the nearest station entrance to a coordinate.
   * Used to replace station centroids with actual entrance locations
   * for walking directions during transfers.
   * Returns null if no entrance found or capability not available.
   */
  async getNearestEntrance(
    lat: number,
    lon: number,
    maxDistanceM?: number,
    wheelchair?: boolean,
  ): Promise<StationEntrance | null> {
    try {
      const capability = this.getTransitRoutingCapability()
      if (capability.getNearestEntrance) {
        // await so a rejected promise is caught here, not surfaced to callers
        return await capability.getNearestEntrance(lat, lon, maxDistanceM, wheelchair)
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Check if transit routing is available.
   */
  isTransitRoutingAvailable(): boolean {
    const integrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.TRANSIT_ROUTING,
      )
    return integrations.length > 0
  }

  /**
   * Resolve the TransitRoutingCapability from the highest-priority
   * configured integration, or throw if none is available.
   */
  private getTransitRoutingCapability() {
    const integrations =
      integrationManager.getConfiguredIntegrationsByCapability(
        IntegrationCapabilityId.TRANSIT_ROUTING,
      )

    if (integrations.length === 0) {
      throw new Error('No transit routing integrations configured')
    }

    const instance = integrationManager.getCachedIntegrationInstance(
      integrations[0],
    )

    if (!instance || !instance.capabilities.transitRouting) {
      throw new Error(
        `Transit routing integration ${integrations[0].integrationId} not available or not initialized`,
      )
    }

    return instance.capabilities.transitRouting
  }
}

export const transitRoutingService = new TransitRoutingService()
