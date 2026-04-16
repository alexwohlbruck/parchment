import type {
  Coordinate,
  Route,
  RouteLeg,
  RouteEdgeSegment,
  RouteInstruction,
  RouteSummary,
  UnifiedRoute,
  RouteRequest,
} from '../../../types/unified-routing.types'

/**
 * Adapter for transforming GraphHopper responses received through the
 * Barrelman `/route` enriched endpoint into the unified routing format.
 *
 * The response payload is a GraphHopper response with additional
 * `edge_segments` and `elevation_stats` fields injected by Barrelman's
 * enriched route service.
 */
export class BarrelmanGraphHopperAdapter {
  // ── Public entry point ──────────────────────────────────────────

  adaptRouteResponse(
    data: any,
    request: RouteRequest,
  ): UnifiedRoute {
    const paths = data.paths || []
    if (paths.length === 0) {
      return {
        routes: [],
        metadata: {
          provider: 'barrelman',
          requestId: request.requestId,
          processingTime: 0,
          attribution: ['© GraphHopper routing engine via Barrelman'],
        },
      }
    }

    const routes: Route[] = paths.map((path: any, pathIndex: number) =>
      this.buildRoute(path, request, pathIndex),
    )

    return {
      routes,
      metadata: {
        provider: 'barrelman',
        requestId: request.requestId,
        processingTime: 0,
        attribution: ['© GraphHopper routing engine via Barrelman'],
      },
    }
  }

  // ── Route ──────────────────────────────────────────────────────

  private buildRoute(
    path: any,
    request: RouteRequest,
    pathIndex: number,
  ): Route {
    const coordinates: number[][] = path.points?.coordinates || []
    const geometry: Coordinate[] = coordinates.map(([lon, lat, elevation]) => ({
      lat,
      lng: lon,
      elevation: elevation ?? undefined,
    }))

    const edgeSegments: RouteEdgeSegment[] | undefined =
      path.edge_segments?.map((seg: any) => ({
        startDistance: seg.startDistance,
        endDistance: seg.endDistance,
        surface: this.normalizeSurface(seg.surface),
        roadClass: this.normalizeRoadClass(seg.roadClass),
        // Populate `use` from roadClass for road-type chart compatibility
        use: this.roadClassToUse(seg.roadClass),
        roadEnvironment: seg.roadEnvironment,
        roadAccess: seg.roadAccess,
        bikeNetwork: this.normalizeBikeNetwork(seg.bikeNetwork),
        getOffBike: seg.getOffBike,
        smoothness: seg.smoothness,
        trackType: seg.trackType,
        averageSlope: seg.averageSlope,
        maxSlope: seg.maxSlope,
        averageSpeed: seg.averageSpeed,
        speedLimit: seg.speedLimit,
      }))

    const bbox = path.bbox || [0, 0, 0, 0]

    const leg: RouteLeg = {
      startWaypoint: request.waypoints[0],
      endWaypoint: request.waypoints[request.waypoints.length - 1],
      mode: request.mode,
      distance: path.distance || 0,
      duration: (path.time || 0) / 1000, // ms → s
      geometry,
      instructions: (path.instructions || []).map((instr: any) =>
        this.buildRouteInstruction(instr, geometry),
      ),
      // Elevation data
      totalElevationGain: path.elevation_stats?.totalGain ?? path.ascend,
      totalElevationLoss: path.elevation_stats?.totalLoss ?? path.descend,
      maxElevation: path.elevation_stats?.maxElevation,
      minElevation: path.elevation_stats?.minElevation,
      // Per-edge data
      edgeSegments,
    }

    return {
      id: `barrelman-graphhopper-${Date.now()}-${pathIndex}`,
      summary: {
        totalDistance: path.distance || 0,
        totalDuration: (path.time || 0) / 1000,
        departureTime: request.departureTime,
        arrivalTime: request.departureTime
          ? new Date(request.departureTime.getTime() + (path.time || 0))
          : undefined,
      },
      legs: [leg],
      geometry,
      boundingBox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      provider: 'barrelman',
      createdAt: new Date(),
    }
  }

  // ── Instructions ────────────────────────────────────────────────

  private buildRouteInstruction(
    instr: any,
    geometry: Coordinate[],
  ): RouteInstruction {
    const intervalStart = instr.interval?.[0] ?? 0
    const coordinate = geometry[intervalStart] || { lat: 0, lng: 0 }

    return {
      type: this.mapInstructionSign(instr.sign),
      text: instr.text || '',
      coordinate,
      distance: instr.distance || 0,
      duration: (instr.time || 0) / 1000,
      streetName: instr.street_name || undefined,
      modifier: this.mapInstructionModifier(instr.sign),
      exitNumber: instr.exit_number ?? undefined,
    }
  }

  // ── Instruction sign mapping ────────────────────────────────────

  /**
   * GraphHopper instruction signs:
   *   -98 = U_TURN_UNKNOWN
   *    -8 = U_TURN_LEFT
   *    -7 = KEEP_LEFT
   *    -6 = LEAVE_ROUNDABOUT
   *    -3 = TURN_SHARP_LEFT
   *    -2 = TURN_LEFT
   *    -1 = TURN_SLIGHT_LEFT
   *     0 = CONTINUE_ON_STREET
   *     1 = TURN_SLIGHT_RIGHT
   *     2 = TURN_RIGHT
   *     3 = TURN_SHARP_RIGHT
   *     4 = FINISH
   *     5 = REACHED_VIA
   *     6 = USE_ROUNDABOUT
   *     7 = KEEP_RIGHT
   *     8 = U_TURN_RIGHT
   */
  private mapInstructionSign(sign: number): string {
    switch (sign) {
      case 0: return 'continue'
      case -1: case 1: return 'turn'
      case -2: case 2: return 'turn'
      case -3: case 3: return 'turn'
      case -7: case 7: return 'continue'
      case -8: case 8: case -98: return 'turn'
      case 4: return 'destination'
      case 5: return 'destination'
      case 6: case -6: return 'roundabout'
      default: return 'continue'
    }
  }

  private mapInstructionModifier(
    sign: number,
  ):
    | 'left'
    | 'right'
    | 'straight'
    | 'slight-left'
    | 'slight-right'
    | 'u-turn'
    | undefined {
    switch (sign) {
      case -1: return 'slight-left'
      case 1: return 'slight-right'
      case -2: return 'left'
      case 2: return 'right'
      case -3: return 'left'  // sharp left
      case 3: return 'right'  // sharp right
      case -7: return 'slight-left'  // keep left
      case 7: return 'slight-right'  // keep right
      case -8: case 8: case -98: return 'u-turn'
      case 0: return 'straight'
      default: return undefined
    }
  }

  // ── Value normalization (GraphHopper → frontend categories) ─────

  /**
   * Map GraphHopper surface strings to the frontend's expected categories.
   * GH uses raw OSM values (asphalt, concrete, gravel, etc.) while the
   * frontend expects grouped categories (paved, paved_rough, etc.)
   */
  private normalizeSurface(surface: string | undefined): string {
    if (!surface || surface === 'missing') return 'unknown'
    const s = surface.toLowerCase()
    switch (s) {
      case 'asphalt':
      case 'concrete':
        return 'paved_smooth'
      case 'paving_stones':
        return 'paved'
      case 'sett':
        return 'paved_rough'
      case 'paved':
        return 'paved'
      case 'concrete:plates':
      case 'concrete:lanes':
      case 'cobblestone':
      case 'unhewn_cobblestone':
      case 'metal':
      case 'wood':
        return 'paved_rough'
      case 'compacted':
      case 'fine_gravel':
        return 'compacted'
      case 'gravel':
      case 'pebblestone':
        return 'gravel'
      case 'dirt':
      case 'earth':
      case 'mud':
      case 'clay':
        return 'dirt'
      case 'sand':
      case 'grass':
      case 'grass_paver':
      case 'ground':
      case 'woodchips':
        return 'path'
      default:
        return 'unknown'
    }
  }

  /**
   * Normalize GraphHopper road_class (uppercase) to lowercase for frontend.
   */
  private normalizeRoadClass(roadClass: string | undefined): string {
    if (!roadClass || roadClass === 'missing') return 'unknown'
    return roadClass.toLowerCase()
  }

  /**
   * Map GraphHopper road_class to the frontend's expected `use` field.
   * GH road_class covers road types that Valhalla split across `use` + `road_class`.
   */
  private roadClassToUse(roadClass: string | undefined): string {
    if (!roadClass || roadClass === 'missing') return 'road'
    const rc = roadClass.toLowerCase()
    switch (rc) {
      case 'cycleway': return 'cycleway'
      case 'footway': return 'footway'
      case 'path': return 'footway'
      case 'steps': return 'steps'
      case 'track': return 'track'
      case 'living_street': return 'living_street'
      case 'residential': return 'residential'
      case 'service': return 'service_other'
      case 'unclassified': return 'unclassified'
      case 'tertiary': case 'tertiary_link': return 'tertiary'
      case 'secondary': case 'secondary_link': return 'secondary'
      case 'primary': case 'primary_link': return 'primary'
      case 'trunk': case 'trunk_link': return 'trunk'
      case 'motorway': case 'motorway_link': return 'motorway'
      default: return 'road'
    }
  }

  /**
   * Normalize GraphHopper bike_network values.
   */
  private normalizeBikeNetwork(bikeNetwork: string | undefined): string {
    if (!bikeNetwork || bikeNetwork === 'missing') return 'unknown'
    return bikeNetwork.toLowerCase()
  }
}
