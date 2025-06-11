import type {
  UnifiedRoute,
  RouteLeg,
  RouteManeuver,
  RouteSummary,
  RouteCoordinate,
} from '../../../types/routing.types'
import type {
  ValhallaRouteResponse,
  Directions,
} from '../../../types/valhalla.types'
import { SOURCE } from '../../../lib/constants'

/**
 * Adapter for transforming Valhalla API data to unified routing formats
 */
export class ValhallaAdapter {
  routing = {
    adaptRouteResponse: (
      response: ValhallaRouteResponse,
      sourceUrl?: string,
    ): UnifiedRoute => {
      return this.adaptRouteResponse(response, sourceUrl)
    },
  }

  /**
   * Convert Valhalla route response to unified format
   */
  private adaptRouteResponse(
    response: ValhallaRouteResponse,
    sourceUrl?: string,
  ): UnifiedRoute {
    const trip = response.trip

    return {
      legs: this.adaptLegs(trip.legs),
      locations: this.adaptLocations(trip.locations),
      summary: this.adaptSummary(trip.summary, trip),
      language: trip.language || 'en-US',
      units: trip.units || 'kilometers',
      source: {
        id: SOURCE.VALHALLA,
        name: 'Valhalla',
        url: sourceUrl,
      },
      status: {
        code: trip.status || 0,
        message: trip.status_message || 'OK',
      },
      raw: response, // Keep raw response for debugging
    }
  }

  /**
   * Convert Valhalla legs to unified format
   */
  private adaptLegs(legs: Directions['legs']): RouteLeg[] {
    return legs.map((leg) => ({
      shape: leg.shape,
      distance: leg.summary.length * 1000, // Convert km to meters
      time: leg.summary.time,
      summary: {
        length: leg.summary.length * 1000, // Convert km to meters
        time: leg.summary.time,
      },
      // TODO: Add maneuvers adaptation when we need turn-by-turn directions
      maneuvers: [],
    }))
  }

  /**
   * Convert Valhalla locations to unified format
   */
  private adaptLocations(
    locations: Directions['locations'],
  ): RouteCoordinate[] {
    return locations.map((loc) => ({
      lat: loc.lat,
      lng: loc.lon,
    }))
  }

  /**
   * Convert Valhalla summary to unified format
   */
  private adaptSummary(
    summary: Directions['summary'],
    trip: Directions,
  ): RouteSummary {
    return {
      distance: summary.length * 1000, // Convert km to meters
      time: summary.time,
      bounds: {
        minLat: summary.min_lat,
        minLng: summary.min_lon,
        maxLat: summary.max_lat,
        maxLng: summary.max_lon,
      },
      hasFerry: summary.has_ferry,
      hasHighway: summary.has_highway,
      hasToll: summary.has_toll,
      hasTimeRestrictions: summary.has_time_restrictions,
    }
  }

  /**
   * Convert Valhalla maneuvers to unified format (for future use)
   */
  private adaptManeuvers(maneuvers: any[]): RouteManeuver[] {
    // TODO: Implement when we need turn-by-turn directions
    return maneuvers.map((maneuver) => ({
      instruction: maneuver.instruction || '',
      distance: maneuver.length || 0,
      time: maneuver.time || 0,
      type: maneuver.type || 'unknown',
      coordinate:
        maneuver.lat && maneuver.lon
          ? { lat: maneuver.lat, lng: maneuver.lon }
          : undefined,
    }))
  }
}
