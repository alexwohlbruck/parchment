import type {
  Coordinate,
  Route,
  RouteLeg,
  RouteEdgeSegment,
  RouteInstruction,
  RouteSummary,
  UnifiedRoute,
  RouteRequest,
  TravelMode,
} from '../../../types/unified-routing.types'
import type {
  ValhallaResponse,
  ValhallaLeg,
  ValhallaManeuver,
  ValhallaEdgeSegment,
} from '../../../types/valhalla.types'
import {
  mapManeuverType,
  mapManeuverModifier,
} from '../../../lib/valhalla-maneuvers'

/**
 * Adapter for transforming Valhalla responses received through the Barrelman
 * `/valhalla/*` proxy into the unified routing format.
 *
 * The response payload is identical to a direct Valhalla response — the proxy
 * is transparent — so the mapping logic mirrors ValhallaIntegration. We keep it
 * in a dedicated adapter so Barrelman-specific tweaks (additional metadata,
 * attribution, future extensions) stay isolated from the standalone Valhalla
 * integration.
 */
export class BarrelmanValhallaAdapter {
  // ── Public entry point ──────────────────────────────────────────

  adaptRouteResponse(
    data: ValhallaResponse,
    request: RouteRequest,
  ): UnifiedRoute {
    const route: Route = {
      id: `barrelman-valhalla-${Date.now()}`,
      summary: this.buildRouteSummary(data.trip.summary, request),
      legs: data.trip.legs.map((leg, index) =>
        this.buildRouteLeg(leg, request, index),
      ),
      geometry: this.decodePolyline(data.trip.shape),
      boundingBox: [
        data.trip.summary.min_lon,
        data.trip.summary.min_lat,
        data.trip.summary.max_lon,
        data.trip.summary.max_lat,
      ],
      provider: 'barrelman',
      createdAt: new Date(),
    }

    return {
      routes: [route],
      metadata: {
        provider: 'barrelman',
        requestId: request.requestId,
        processingTime: 0, // Valhalla doesn't expose this
        attribution: ['© Valhalla routing engine via Barrelman'],
      },
    }
  }

  // ── Summary ─────────────────────────────────────────────────────

  private buildRouteSummary(
    summary: any,
    request: RouteRequest,
  ): RouteSummary {
    return {
      totalDistance: summary.length * 1000, // km → m
      totalDuration: summary.time,
      hasTolls: summary.has_toll,
      hasHighways: summary.has_highway,
      hasFerries: summary.has_ferry,
      departureTime: request.departureTime,
      arrivalTime: request.departureTime
        ? new Date(request.departureTime.getTime() + summary.time * 1000)
        : undefined,
    }
  }

  // ── Legs ────────────────────────────────────────────────────────

  private buildRouteLeg(
    leg: ValhallaLeg,
    request: RouteRequest,
    legIndex: number,
  ): RouteLeg {
    const startWaypoint = request.waypoints[legIndex]
    const endWaypoint = request.waypoints[legIndex + 1]
    const decodedCoords = this.decodePolyline(leg.shape)

    // Zip elevation data with geometry coordinates if available
    const geometry: Coordinate[] = decodedCoords.map((coord, i) => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation: leg.elevation?.[i] ?? undefined,
    }))

    // Map edge segments from enriched response
    const edgeSegments: RouteEdgeSegment[] | undefined =
      leg.edge_segments?.map((seg) => ({
        startDistance: seg.startDistance,
        endDistance: seg.endDistance,
        surface: seg.surface,
        roadClass: seg.roadClass,
        use: seg.use,
        cycleLane: seg.cycleLane,
        shoulder: seg.shoulder,
        speedLimit: seg.speedLimit,
        laneCount: seg.laneCount,
        weightedGrade: seg.weightedGrade,
        meanElevation: seg.meanElevation,
      }))

    return {
      startWaypoint,
      endWaypoint,
      mode: request.mode,
      distance: leg.summary.length * 1000,
      duration: leg.summary.time,
      geometry,
      instructions: leg.maneuvers.map((m) =>
        this.buildRouteInstruction(m, decodedCoords),
      ),
      hasTolls: leg.summary.has_toll,
      hasHighways: leg.summary.has_highway,
      hasFerries: leg.summary.has_ferry,
      // Elevation stats from enriched response
      totalElevationGain: leg.elevation_stats?.totalGain,
      totalElevationLoss: leg.elevation_stats?.totalLoss,
      maxElevation: leg.elevation_stats?.maxElevation,
      minElevation: leg.elevation_stats?.minElevation,
      // Per-edge data
      edgeSegments,
    }
  }

  // ── Instructions ────────────────────────────────────────────────

  private buildRouteInstruction(
    maneuver: ValhallaManeuver,
    geometry: { lat: number; lng: number }[],
  ): RouteInstruction {
    let coordinate = { lat: 0, lng: 0 }
    if (
      maneuver.begin_shape_index !== undefined &&
      geometry[maneuver.begin_shape_index]
    ) {
      coordinate = geometry[maneuver.begin_shape_index]
    }

    return {
      type: mapManeuverType(maneuver.type),
      text: maneuver.instruction,
      coordinate,
      distance: maneuver.length * 1000,
      duration: maneuver.time,
      streetName: maneuver.street_names?.[0],
      modifier: mapManeuverModifier(maneuver.type),
      exitNumber: maneuver.sign?.exit_number
        ? parseInt(maneuver.sign.exit_number)
        : undefined,
    }
  }

  // ── Polyline decoding ───────────────────────────────────────────

  /**
   * Decode Valhalla encoded polyline (precision 6).
   * https://valhalla.github.io/valhalla/decoding
   */
  decodePolyline(
    encoded: string,
    precision: number = 6,
  ): Array<{ lat: number; lng: number }> {
    if (!encoded) return []

    let index = 0
    let lat = 0
    let lng = 0
    const coordinates: Array<{ lat: number; lng: number }> = []
    const factor = Math.pow(10, precision)

    while (index < encoded.length) {
      let shift = 0
      let result = 0
      let byte: number

      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      const latChange = result & 1 ? ~(result >> 1) : result >> 1

      shift = result = 0

      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      const lngChange = result & 1 ? ~(result >> 1) : result >> 1

      lat += latChange
      lng += lngChange

      coordinates.push({ lat: lat / factor, lng: lng / factor })
    }

    return coordinates
  }
}
