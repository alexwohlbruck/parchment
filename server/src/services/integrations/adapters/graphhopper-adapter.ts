import type {
  UnifiedRoute,
  RouteLeg,
  RouteInstruction,
  RouteSummary,
  RouteCoordinate,
} from '../../../types/routing.types'
import type {
  GraphHopperRouteResponse,
  GraphHopperPath,
  GraphHopperInstruction,
} from '../../../types/graphhopper.types'
import { SOURCE } from '../../../lib/constants'

/**
 * Adapter for transforming GraphHopper API data to unified routing formats
 */
export class GraphHopperAdapter {
  routing = {
    adaptRouteResponse: (
      response: GraphHopperRouteResponse,
      sourceUrl?: string,
    ): UnifiedRoute => {
      return this.adaptRouteResponse(response, sourceUrl)
    },
  }

  /**
   * Decode polyline to coordinates
   * GraphHopper uses polyline5 encoding by default
   */
  private decodePolyline(
    encoded: string,
    precision: number = 5,
  ): Array<{ lat: number; lng: number }> {
    if (!encoded) return []

    let index = 0
    let lat = 0
    let lng = 0
    const coordinates: Array<{ lat: number; lng: number }> = []
    let shift = 0
    let result = 0
    let byte: number | null = null
    const factor = Math.pow(10, precision)

    while (index < encoded.length) {
      byte = null
      shift = 0
      result = 0

      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      const latitude_change = result & 1 ? ~(result >> 1) : result >> 1

      shift = result = 0

      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      const longitude_change = result & 1 ? ~(result >> 1) : result >> 1

      lat += latitude_change
      lng += longitude_change

      coordinates.push({
        lat: lat / factor,
        lng: lng / factor,
      })
    }

    return coordinates
  }

  /**
   * Convert GraphHopper route response to unified format
   */
  private adaptRouteResponse(
    response: GraphHopperRouteResponse,
    sourceUrl?: string,
  ): UnifiedRoute {
    if (!response.paths || response.paths.length === 0) {
      throw new Error('No paths found in GraphHopper response')
    }

    // Use the first path (primary route)
    const path = response.paths[0]

    return {
      legs: this.adaptLegs(path),
      locations: this.adaptLocations(path),
      summary: this.adaptSummary(path),
      language: 'en-US', // GraphHopper supports locale but doesn't return it
      units: 'kilometers',
      source: {
        id: SOURCE.GRAPHHOPPER,
        name: 'GraphHopper',
        url: sourceUrl,
      },
      status: {
        code: 0,
        message: 'OK',
      },
      raw: response,
    }
  }

  /**
   * Convert GraphHopper path to unified legs format
   */
  private adaptLegs(path: GraphHopperPath): RouteLeg[] {
    // GraphHopper doesn't split routes into legs by default
    // We'll create a single leg for the entire route
    const geometry = this.extractGeometry(path.points)

    return [
      {
        shape: typeof path.points === 'string' ? path.points : '',
        distance: path.distance,
        time: Math.round(path.time / 1000), // Convert milliseconds to seconds
        geometry,
        summary: {
          length: path.distance,
          time: Math.round(path.time / 1000),
        },
        maneuvers: path.instructions
          ? path.instructions.map((instruction) =>
              this.adaptInstruction(instruction, geometry),
            )
          : [],
      },
    ]
  }

  /**
   * Extract geometry from GraphHopper points
   */
  private extractGeometry(
    points: GraphHopperPath['points'],
  ): Array<{ lat: number; lng: number }> {
    if (typeof points === 'string') {
      return this.decodePolyline(points)
    } else if (points && points.type === 'LineString') {
      // Convert [lng, lat] to {lat, lng}
      return points.coordinates.map(([lng, lat]) => ({ lat, lng }))
    }
    return []
  }

  /**
   * Convert GraphHopper locations to unified format
   */
  private adaptLocations(path: GraphHopperPath): RouteCoordinate[] {
    const waypoints = this.extractGeometry(path.snapped_waypoints)

    if (waypoints.length === 0) {
      // Fallback to first and last point of geometry
      const geometry = this.extractGeometry(path.points)
      if (geometry.length >= 2) {
        return [geometry[0], geometry[geometry.length - 1]]
      }
    }

    return waypoints
  }

  /**
   * Convert GraphHopper path to unified summary format
   */
  private adaptSummary(path: GraphHopperPath): RouteSummary {
    return {
      distance: path.distance,
      time: Math.round(path.time / 1000), // Convert milliseconds to seconds
      bounds: {
        minLat: path.bbox[1],
        minLng: path.bbox[0],
        maxLat: path.bbox[3],
        maxLng: path.bbox[2],
      },
      // GraphHopper can provide these via details, but not in basic response
      hasFerry: false,
      hasHighway: false,
      hasToll: false,
      hasTimeRestrictions: false,
    }
  }

  /**
   * Convert GraphHopper instruction to unified maneuver format
   */
  private adaptInstruction(
    instruction: GraphHopperInstruction,
    geometry: Array<{ lat: number; lng: number }>,
  ): any {
    // Get coordinate from geometry using interval
    let coordinate = { lat: 0, lng: 0 }
    if (
      instruction.interval &&
      instruction.interval[0] !== undefined &&
      geometry[instruction.interval[0]]
    ) {
      coordinate = geometry[instruction.interval[0]]
    }

    return {
      instruction: instruction.text,
      distance: instruction.distance,
      time: Math.round(instruction.time / 1000), // Convert milliseconds to seconds
      type: this.mapInstructionType(instruction.sign),
      coordinate,
      streetName: instruction.street_name,
      heading: instruction.heading,
    }
  }

  /**
   * Map GraphHopper sign to instruction type
   * Based on GraphHopper documentation
   */
  private mapInstructionType(sign: number): string {
    switch (sign) {
      case -98: // U-turn
        return 'u-turn'
      case -8: // Left U-turn
        return 'u-turn'
      case -7: // Keep left
        return 'keep-left'
      case -6: // Leave roundabout
        return 'roundabout-exit'
      case -3: // Sharp left
        return 'turn-sharp-left'
      case -2: // Left
        return 'turn-left'
      case -1: // Slight left
        return 'turn-slight-left'
      case 0: // Continue straight
        return 'continue'
      case 1: // Slight right
        return 'turn-slight-right'
      case 2: // Right
        return 'turn-right'
      case 3: // Sharp right
        return 'turn-sharp-right'
      case 4: // Finish
        return 'arrive'
      case 5: // Via reached
        return 'waypoint'
      case 6: // Enter roundabout
        return 'roundabout-enter'
      case 7: // Keep right
        return 'keep-right'
      case 8: // Right U-turn
        return 'u-turn'
      default:
        return 'continue'
    }
  }
}
