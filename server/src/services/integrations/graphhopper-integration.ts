import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  RoutingCapability,
} from '../../types/integration.types'
import {
  RouteRequest,
  UnifiedRoute,
  TravelMode,
  WaypointType,
  RouteWaypoint,
  Route,
  RouteLeg,
  RouteEdgeSegment,
  RouteInstruction,
  RouteSummary,
  Coordinate,
} from '../../types/unified-routing.types'
import { getLanguageCode } from '../../lib/i18n'
import { buildGraphHopperCustomModel, getSnapPreventions } from '../../lib/graphhopper-custom-model'
import type {
  GraphHopperConfig,
  GraphHopperRouteRequest,
  GraphHopperRouteResponse,
  GraphHopperErrorResponse,
} from '../../types/graphhopper.types'
import { GraphHopperAdapter } from './adapters/graphhopper-adapter'

/**
 * GraphHopper integration for routing
 * Supports both GraphHopper API and self-hosted instances
 * 
 * Features implemented:
 * - Basic routing with multiple waypoints
 * - Turn-by-turn instructions
 * - Elevation data (ascend/descend)
 * - Alternative routes
 * - Route details (road class, surface, tolls, ferries)
 * - Custom models for route preferences (avoid highways, tolls, ferries, unpaved roads)
 * - Distance influence for shortest vs fastest routes
 * 
 * Additional GraphHopper features that could be added:
 * - point_hints: Street name hints for better waypoint snapping
 * - curbsides: Specify approach side (useful for pickups/dropoffs)
 * - headings: Preferred direction at waypoints
 * - pass_through: Avoid U-turns at via points
 * - Additional details: max_speed, vehicle restrictions, lane info, road quality
 * - round_trip algorithm: Generate circular routes
 * - areas in custom_model: Define geographic areas to avoid/prefer
 * - More granular custom model rules for advanced routing
 */
export class GraphHopperIntegration implements Integration<GraphHopperConfig> {
  private initialized = false
  private adapter = new GraphHopperAdapter()
  protected config: GraphHopperConfig = {}

  readonly integrationId = IntegrationId.GRAPHHOPPER
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.ROUTING,
  ]
  readonly capabilities = {
    routing: {
      getRoute: this.getRoute.bind(this),
      metadata: {
        supportedPreferences: {
          // Range preferences (0-1 sliders) — require self-hosted or paid plan for custom_model
          highways: 'range',
          tolls: 'range',
          ferries: 'range',
          hills: 'range',
          surfaceQuality: 'range',
          litPaths: false,          // TODO: enable after graph cache rebuild with 'lit' encoded value
          safetyVsSpeed: 'range',

          // Boolean preferences
          shortest: 'boolean',
          preferHOV: false,
          wheelchairAccessible: false,

          // Numeric/enum preferences
          cyclingSpeed: 'range',
          walkingSpeed: 'range',
          bicycleType: 'range',

          // Transit
          maxWalkDistance: false,
          maxTransfers: false,
        },
        supportedModes: ['driving', 'walking', 'cycling', 'motorcycle', 'truck', 'wheelchair'],
        supportedOptimizations: ['time', 'distance', 'balanced'], // distance/balanced require paid/self-hosted
        features: {
          alternatives: true, // alternative_route algorithm (works in free tier)
          traffic: false, // Not in basic API
          elevation: true, // elevation parameter (works in free tier)
          instructions: true, // instructions parameter (works in free tier)
          matrix: true, // Separate Matrix API available
          transit: false, // Not supported
        },
        limits: {
          maxWaypoints: 50, // Depends on plan, conservative default
          maxAlternatives: 3,
        },
      },
    } as RoutingCapability,
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: GraphHopperConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error(
        'Invalid configuration: Either host (for self-hosted) or apiKey (for GraphHopper API) is required',
      )
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
  async testConnection(
    config: GraphHopperConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message:
          'Invalid configuration: Either host (for self-hosted) or apiKey (for GraphHopper API) is required',
      }
    }

    try {
      const baseUrl = this.getBaseUrl(config)

      // Use /info endpoint for connection test — it works for both self-hosted
      // (regional data) and GraphHopper API without needing valid coordinates.
      const infoUrl = `${baseUrl}/info`
      const queryParams = new URLSearchParams()
      if (config.apiKey) {
        queryParams.append('key', config.apiKey)
      }
      const requestUrl = `${infoUrl}${queryParams.toString() ? '?' + queryParams.toString() : ''}`

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `GraphHopper server returned ${response.status}: ${response.statusText}`

        try {
          const errorData: GraphHopperErrorResponse = JSON.parse(errorText)
          if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch {
          // Use default error message
        }

        return {
          success: false,
          message: errorMessage,
        }
      }

      // Check if response contains GraphHopper info data (version, profiles, bbox)
      const data = await response.json() as Record<string, any>
      if (data && data.version && data.profiles) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Server does not appear to be a GraphHopper instance',
        }
      }
    } catch (error: any) {
      console.error('Error testing GraphHopper API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to GraphHopper server',
      }
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: GraphHopperConfig): boolean {
    // Either host (self-hosted) or apiKey (GraphHopper API) must be provided
    return Boolean(
      config &&
        ((config.host && typeof config.host === 'string') ||
          (config.apiKey && typeof config.apiKey === 'string')),
    )
  }

  /**
   * Get the base URL for API requests
   */
  private getBaseUrl(config: GraphHopperConfig): string {
    if (config.host) {
      // Self-hosted instance
      return config.host.endsWith('/') ? config.host.slice(0, -1) : config.host
    } else {
      // GraphHopper API
      return 'https://graphhopper.com/api/1'
    }
  }

  /**
   * Get route using unified request format
   * @param request Unified route request
   * @returns Route information in unified format
   */
  private async getRoute(request: RouteRequest): Promise<UnifiedRoute> {
    this.ensureInitialized()

    if (request.waypoints.length < 2) {
      throw new Error('At least 2 waypoints are required for routing')
    }

    try {
      const baseUrl = this.getBaseUrl(this.config)
      const url = `${baseUrl}/route`

      const locale = request.language ? getLanguageCode(request.language) : undefined
      const snapPreventions = getSnapPreventions(request.mode)
      const requestBody: GraphHopperRouteRequest = {
        profile: this.mapTravelModeToProfile(request.mode),
        points: request.waypoints.map((waypoint) => [
          waypoint.coordinate.lng,
          waypoint.coordinate.lat,
        ]),
        instructions: request.includeInstructions ?? true,
        calc_points: request.includeGeometry ?? true,
        points_encoded: false, // Use GeoJSON format for easier parsing
        elevation: true, // Enable elevation data
        details: ['road_class', 'surface', 'toll', 'road_environment'], // Request useful path details
        // Prevent origin/dest from snapping directly onto motorways, tunnels, etc.
        // so the router joins them via proper on-/off-ramps.
        ...(snapPreventions && { snap_preventions: snapPreventions }),
        ...(locale && { locale }),
      }

      // Apply preferences
      if (request.preferences) {
        this.applyPreferences(requestBody, request)
      }

      // Add API key if using GraphHopper API
      const queryParams = new URLSearchParams()
      if (this.config.apiKey) {
        queryParams.append('key', this.config.apiKey)
      }

      const requestUrl = `${url}${queryParams.toString() ? '?' + queryParams.toString() : ''}`

      console.log('GraphHopper request URL:', requestUrl)
      console.log(
        'GraphHopper request body:',
        JSON.stringify(requestBody, null, 2),
      )

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('GraphHopper error response:', response.status, errorText)

        let errorMessage = `GraphHopper routing error: ${response.status}`
        try {
          const errorData: GraphHopperErrorResponse = JSON.parse(errorText)
          if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch {
          errorMessage += ` - ${errorText}`
        }

        throw new Error(errorMessage)
      }

      const data: GraphHopperRouteResponse = await response.json()
      return this.mapGraphHopperToUnified(data, request)
    } catch (error) {
      throw new Error(
        `GraphHopper routing error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  /**
   * Map travel mode to GraphHopper profile
   */
  private mapTravelModeToProfile(
    mode: TravelMode,
  ): 'car' | 'bike' | 'foot' | 'motorcycle' | 'truck' {
    switch (mode) {
      case TravelMode.DRIVING:
        return 'car'
      case TravelMode.CYCLING:
        return 'bike'
      case TravelMode.WALKING:
        return 'foot'
      case TravelMode.MOTORCYCLE:
        return 'motorcycle'
      case TravelMode.TRUCK:
        return 'truck'
      case TravelMode.WHEELCHAIR:
        return 'foot' // Use foot profile with custom_model constraints
      default:
        throw new Error(`Unsupported travel mode for GraphHopper: ${mode}`)
    }
  }

  /**
   * Apply routing preferences to GraphHopper request.
   * Uses the shared buildGraphHopperCustomModel() utility for custom_model generation.
   *
   * Note: Custom models require flexible mode (ch.disable=true) which is not
   * available in the free GraphHopper API tier.
   */
  private applyPreferences(
    requestBody: GraphHopperRouteRequest,
    request: RouteRequest,
  ): void {
    const preferences = request.preferences
    if (!preferences) return

    const isSelfHosted = Boolean(this.config.host && !this.config.host.includes('graphhopper.com'))

    // Build custom_model from preferences (shared logic with Barrelman)
    const customModel = buildGraphHopperCustomModel(request.mode, preferences)

    if (customModel) {
      if (!isSelfHosted) {
        console.warn('GraphHopper: Custom model features require paid plan or self-hosted instance. Skipping custom_model.')
      } else {
        // custom_model requires flexible mode. Our config uses LM (no CH),
        // so ch.disable is technically a no-op, but include it for safety
        // in case CH profiles are added later.
        requestBody['ch.disable'] = true
        requestBody.custom_model = customModel
      }
    }

    // Handle alternatives (works in free tier)
    if (preferences.alternatives) {
      requestBody.algorithm = 'alternative_route'
      requestBody['alternative_route.max_paths'] =
        preferences.maxAlternatives || 2
    }
  }

  /**
   * Map GraphHopper response to unified format
   */
  private mapGraphHopperToUnified(
    data: GraphHopperRouteResponse,
    request: RouteRequest,
  ): UnifiedRoute {
    if (!data.paths || data.paths.length === 0) {
      throw new Error('No routes found in GraphHopper response')
    }

    // Map all paths (including alternatives) to routes
    const routes: Route[] = data.paths.map((path, index) => {
      // Extract geometry
      const geometry = this.extractGeometry(path.points)

      // Build route legs
      const legs = this.buildRouteLegs(path, request, geometry)

      // Build route summary
      const summary = this.buildRouteSummary(path, request)

      return {
        id: `graphhopper-${Date.now()}-${index}`,
        summary,
        legs,
        geometry,
        boundingBox: path.bbox,
        provider: 'graphhopper',
        createdAt: new Date(),
        rank: index + 1, // First route is primary
      }
    })

    return {
      routes,
      metadata: {
        provider: 'graphhopper',
        requestId: request.requestId,
        processingTime: data.info.took,
        attribution: data.info.copyrights,
      },
    }
  }

  /**
   * Extract geometry from GraphHopper points
   * Supports both 2D [lng, lat] and 3D [lng, lat, elevation] coordinates
   */
  private extractGeometry(
    points: any,
  ): Array<{ lat: number; lng: number; elevation?: number }> {
    if (typeof points === 'string') {
      // Encoded polyline - would need decoding
      // For now, return empty array as we request points_encoded: false
      return []
    } else if (points && points.type === 'LineString') {
      // GeoJSON format: [lng, lat] or [lng, lat, elevation]
      return points.coordinates.map((coord: number[]) => {
        const [lng, lat, elevation] = coord
        return {
          lat,
          lng,
          ...(elevation !== undefined && { elevation }),
        }
      })
    }
    return []
  }

  /**
   * Build route legs from GraphHopper path
   */
  private buildRouteLegs(
    path: any,
    request: RouteRequest,
    geometry: Coordinate[],
  ): RouteLeg[] {
    // GraphHopper doesn't split into legs by default
    // Create a single leg for the entire route
    const startWaypoint = request.waypoints[0]
    const endWaypoint = request.waypoints[request.waypoints.length - 1]

    const instructions: RouteInstruction[] = path.instructions
      ? path.instructions.map((instruction: any) =>
          this.buildRouteInstruction(instruction, geometry),
        )
      : []

    // Extract route characteristics from details
    const characteristics = this.extractRouteCharacteristics(path.details)

    // Calculate elevation statistics from geometry
    const elevationStats = this.calculateElevationStats(geometry)

    // Build edge segments from path details
    const edgeSegments = this.buildEdgeSegments(path.details, geometry)

    return [
      {
        startWaypoint,
        endWaypoint,
        mode: request.mode,
        distance: path.distance,
        duration: Math.round(path.time / 1000), // Convert ms to seconds
        geometry,
        instructions,
        hasTolls: characteristics.hasTolls,
        hasHighways: characteristics.hasHighways,
        hasFerries: characteristics.hasFerries,
        totalElevationGain: elevationStats.totalGain,
        totalElevationLoss: elevationStats.totalLoss,
        maxElevation: elevationStats.max,
        minElevation: elevationStats.min,
        edgeSegments,
      },
    ]
  }

  /**
   * Calculate elevation statistics from geometry
   */
  private calculateElevationStats(geometry: Coordinate[]): {
    totalGain: number
    totalLoss: number
    max: number | undefined
    min: number | undefined
  } {
    const elevations = geometry
      .map(coord => coord.elevation)
      .filter((elev): elev is number => elev !== undefined)

    if (elevations.length === 0) {
      return {
        totalGain: 0,
        totalLoss: 0,
        max: undefined,
        min: undefined,
      }
    }

    let totalGain = 0
    let totalLoss = 0
    const max = Math.max(...elevations)
    const min = Math.min(...elevations)

    // Calculate cumulative elevation gain/loss
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1]
      if (diff > 0) {
        totalGain += diff
      } else {
        totalLoss += Math.abs(diff)
      }
    }

    return {
      totalGain: Math.round(totalGain),
      totalLoss: Math.round(totalLoss),
      max: Math.round(max),
      min: Math.round(min),
    }
  }

  /**
   * Extract route characteristics from GraphHopper details
   */
  private extractRouteCharacteristics(details?: Record<string, Array<[number, number, any]>>): {
    hasTolls: boolean
    hasHighways: boolean
    hasFerries: boolean
  } {
    const characteristics = {
      hasTolls: false,
      hasHighways: false,
      hasFerries: false,
    }

    if (!details) return characteristics

    // Check for tolls
    if (details.toll) {
      characteristics.hasTolls = details.toll.some(([, , value]) => value === true || value === 'yes')
    }

    // Check for highways/motorways
    if (details.road_class) {
      characteristics.hasHighways = details.road_class.some(
        ([, , value]) => value === 'motorway' || value === 'trunk'
      )
    }

    // Check for ferries
    if (details.road_environment) {
      characteristics.hasFerries = details.road_environment.some(
        ([, , value]) => value === 'ferry'
      )
    }

    return characteristics
  }

  /**
   * Build route instruction from GraphHopper instruction
   */
  private buildRouteInstruction(
    instruction: any,
    geometry: Coordinate[],
  ): RouteInstruction {
    // Get coordinate from geometry using interval
    let coordinate: Coordinate = { lat: 0, lng: 0 }
    if (
      instruction.interval &&
      instruction.interval[0] !== undefined &&
      geometry[instruction.interval[0]]
    ) {
      coordinate = geometry[instruction.interval[0]]
    }

    return {
      type: this.mapInstructionType(instruction.sign),
      text: instruction.text,
      coordinate,
      distance: instruction.distance,
      duration: Math.round(instruction.time / 1000), // Convert ms to seconds
      heading: instruction.heading,
      streetName: instruction.street_name,
      modifier: this.mapInstructionModifier(instruction.sign),
    }
  }

  /**
   * Map GraphHopper sign to instruction type
   */
  private mapInstructionType(sign: number): string {
    switch (sign) {
      case -98:
      case -8:
      case 8:
        return 'u-turn'
      case -7:
        return 'keep-left'
      case -6:
        return 'roundabout-exit'
      case -3:
        return 'turn-sharp-left'
      case -2:
        return 'turn-left'
      case -1:
        return 'turn-slight-left'
      case 0:
        return 'continue'
      case 1:
        return 'turn-slight-right'
      case 2:
        return 'turn-right'
      case 3:
        return 'turn-sharp-right'
      case 4:
        return 'arrive'
      case 5:
        return 'waypoint'
      case 6:
        return 'roundabout-enter'
      case 7:
        return 'keep-right'
      default:
        return 'continue'
    }
  }

  /**
   * Map GraphHopper sign to turn modifier
   */
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
      case -98:
      case -8:
      case 8:
        return 'u-turn'
      case -3:
      case -2:
        return 'left'
      case -1:
        return 'slight-left'
      case 0:
        return 'straight'
      case 1:
        return 'slight-right'
      case 2:
      case 3:
        return 'right'
      default:
        return undefined
    }
  }

  /**
   * Build edge segments from GraphHopper path details
   * Converts GraphHopper's [startPointIndex, endPointIndex, value] format
   * into distance-based RouteEdgeSegment[] for the frontend
   */
  private buildEdgeSegments(
    details: Record<string, Array<[number, number, any]>> | undefined,
    geometry: Coordinate[],
  ): RouteEdgeSegment[] {
    if (!details) return []

    // Need at least road_class or surface to build meaningful segments
    const roadClassDetails = details.road_class || []
    const surfaceDetails = details.surface || []
    const roadEnvDetails = details.road_environment || []

    if (roadClassDetails.length === 0 && surfaceDetails.length === 0) return []

    // 1. Build cumulative distance array from geometry
    const cumulativeDistances = this.buildCumulativeDistances(geometry)

    // 2. Collect all unique breakpoints from all detail arrays
    const breakpoints = new Set<number>()
    for (const arr of [roadClassDetails, surfaceDetails, roadEnvDetails]) {
      for (const [start, end] of arr) {
        breakpoints.add(start)
        breakpoints.add(end)
      }
    }
    const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b)

    // 3. For each interval [bp[i], bp[i+1]], look up the value from each detail array
    const segments: RouteEdgeSegment[] = []

    for (let i = 0; i < sortedBreakpoints.length - 1; i++) {
      const startIdx = sortedBreakpoints[i]
      const endIdx = sortedBreakpoints[i + 1]

      const startDist = cumulativeDistances[startIdx] ?? 0
      const endDist = cumulativeDistances[endIdx] ?? cumulativeDistances[cumulativeDistances.length - 1] ?? 0

      // Skip zero-length segments
      if (endDist <= startDist) continue

      const surface = this.lookupDetailValue(surfaceDetails, startIdx) || 'unknown'
      const roadClass = this.lookupDetailValue(roadClassDetails, startIdx) || 'unknown'
      const roadEnv = this.lookupDetailValue(roadEnvDetails, startIdx) || 'road'

      segments.push({
        startDistance: Math.round(startDist),
        endDistance: Math.round(endDist),
        surface: this.normalizeGraphHopperSurface(surface),
        roadClass: this.normalizeGraphHopperRoadClass(roadClass),
        use: this.normalizeGraphHopperUse(roadEnv, roadClass),
      })
    }

    return segments
  }

  /**
   * Build cumulative distance array from geometry coordinates (Haversine)
   */
  private buildCumulativeDistances(geometry: Coordinate[]): number[] {
    const distances: number[] = [0]
    for (let i = 1; i < geometry.length; i++) {
      const prev = geometry[i - 1]
      const curr = geometry[i]
      const d = this.haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng)
      distances.push(distances[i - 1] + d)
    }
    return distances
  }

  /**
   * Haversine distance in meters between two coordinates
   * TODO: Extract to a shared utility (e.g. server/src/lib/geo-utils.ts) —
   * this duplicates logic that may also be needed by other integrations.
   */
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000 // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  /**
   * Look up which value covers a given point index in a GraphHopper detail array
   * Detail format: [startPointIndex, endPointIndex, value]
   */
  private lookupDetailValue(
    details: Array<[number, number, any]>,
    pointIndex: number,
  ): string | undefined {
    for (const [start, end, value] of details) {
      if (pointIndex >= start && pointIndex < end) {
        return String(value)
      }
    }
    return undefined
  }

  /**
   * Normalize GraphHopper surface values to our standard set
   */
  private normalizeGraphHopperSurface(surface: string): string {
    const map: Record<string, string> = {
      asphalt: 'paved_smooth',
      concrete: 'paved_smooth',
      paved: 'paved',
      paving_stones: 'paved',
      cobblestone: 'paved_rough',
      'cobblestone:flattened': 'paved_rough',
      sett: 'paved_rough',
      compacted: 'compacted',
      fine_gravel: 'compacted',
      gravel: 'gravel',
      dirt: 'dirt',
      earth: 'dirt',
      mud: 'dirt',
      sand: 'dirt',
      grass: 'path',
      grass_paver: 'path',
      wood: 'path',
      metal: 'paved',
      unpaved: 'gravel',
      ground: 'dirt',
      unknown: 'unknown',
      missing: 'unknown',
      other: 'unknown',
    }
    return map[surface.toLowerCase()] || 'unknown'
  }

  /**
   * Normalize GraphHopper road_class values to our standard set
   */
  private normalizeGraphHopperRoadClass(roadClass: string): string {
    const map: Record<string, string> = {
      motorway: 'motorway',
      trunk: 'trunk',
      primary: 'primary',
      secondary: 'secondary',
      tertiary: 'tertiary',
      unclassified: 'unclassified',
      residential: 'residential',
      service: 'service_other',
      living_street: 'residential',
      track: 'unclassified',
      cycleway: 'residential',
      footway: 'residential',
      path: 'unclassified',
      steps: 'residential',
      other: 'unknown',
    }
    return map[roadClass.toLowerCase()] || 'unknown'
  }

  /**
   * Normalize GraphHopper road_environment + road_class into a "use" category
   */
  private normalizeGraphHopperUse(roadEnv: string, roadClass: string): string {
    // Road environment takes priority for special types
    const envMap: Record<string, string> = {
      ferry: 'ferry',
      bridge: 'road',
      tunnel: 'road',
      ford: 'road',
    }
    if (envMap[roadEnv.toLowerCase()] && envMap[roadEnv.toLowerCase()] !== 'road') {
      return envMap[roadEnv.toLowerCase()]
    }

    // Fall back to road class for use determination
    const classMap: Record<string, string> = {
      cycleway: 'cycleway',
      footway: 'footway',
      path: 'footway',
      steps: 'steps',
      track: 'track',
      living_street: 'living_street',
      service: 'service_other',
    }
    return classMap[roadClass.toLowerCase()] || 'road'
  }

  /**
   * Build route summary from GraphHopper path
   */
  private buildRouteSummary(path: any, request: RouteRequest): RouteSummary {
    // Extract route characteristics from details
    const characteristics = this.extractRouteCharacteristics(path.details)

    return {
      totalDistance: path.distance,
      totalDuration: Math.round(path.time / 1000), // Convert ms to seconds
      hasTolls: characteristics.hasTolls,
      hasHighways: characteristics.hasHighways,
      hasFerries: characteristics.hasFerries,
      totalElevationGain: path.ascend,
      totalElevationLoss: path.descend,
      departureTime: request.departureTime,
      arrivalTime: request.departureTime
        ? new Date(
            request.departureTime.getTime() + Math.round(path.time),
          )
        : undefined,
    }
  }
}
