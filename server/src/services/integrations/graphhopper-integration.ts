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
  RouteInstruction,
  RouteSummary,
  Coordinate,
} from '../../types/unified-routing.types'
import { getLanguageCode } from '../../lib/i18n'
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
          // Auto/driving preferences
          avoidHighways: true, // via custom_model (requires paid/self-hosted)
          avoidTolls: true, // via custom_model (requires paid/self-hosted)
          avoidFerries: true, // via snap_preventions (works in free tier)
          avoidUnpaved: true, // via custom_model (requires paid/self-hosted)
          preferHOV: false, // Not directly supported

          // Bicycle preferences
          avoidHills: true, // via custom_model (requires paid/self-hosted)
          preferPavedPaths: true, // via custom_model (requires paid/self-hosted)

          // Pedestrian preferences
          preferLitPaths: false, // Not directly supported
          wheelchairAccessible: false, // Not directly supported
          maxWalkDistance: false, // Not applicable

          // General preferences
          safetyVsEfficiency: true, // via distance_influence in custom_model (requires paid/self-hosted)
          maxTransfers: false, // Not applicable
        },
        supportedModes: ['driving', 'walking', 'cycling', 'motorcycle', 'truck'],
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
    cacheTtl: {
      routing: { getRoute: 24 * 3600 },
    },
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
      const url = `${baseUrl}/route`

      // Make a simple test request with two points
      const testRequest: GraphHopperRouteRequest = {
        profile: 'car',
        points: [
          [11.539421, 48.118477], // Munich example
          [11.559023, 48.12228],
        ],
        instructions: false,
        calc_points: false,
      }

      const queryParams = new URLSearchParams()
      if (config.apiKey) {
        queryParams.append('key', config.apiKey)
      }

      const requestUrl = `${url}${queryParams.toString() ? '?' + queryParams.toString() : ''}`

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testRequest),
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

      // Check if response contains GraphHopper-specific data
      const data: GraphHopperRouteResponse = await response.json()
      if (data && data.paths && data.paths.length > 0) {
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
      default:
        throw new Error(`Unsupported travel mode for GraphHopper: ${mode}`)
    }
  }

  /**
   * Apply routing preferences to GraphHopper request
   * Note: Custom models require flexible mode (ch.disable=true) which is not available in free tier
   */
  private applyPreferences(
    requestBody: GraphHopperRouteRequest,
    request: RouteRequest,
  ): void {
    const preferences = request.preferences

    if (!preferences) return

    // Check if we need flexible mode (custom model features)
    const needsFlexibleMode = 
      preferences.optimize === 'distance' ||
      preferences.optimize === 'balanced' ||
      preferences.avoidHighways ||
      preferences.avoidTolls ||
      preferences.avoidUnpaved

    // Only apply custom model features if we're not using the free API
    // Free API doesn't support ch.disable=true
    const isSelfHosted = Boolean(this.config.host && !this.config.host.includes('graphhopper.com'))
    
    if (needsFlexibleMode && !isSelfHosted) {
      console.warn('GraphHopper: Custom model features require paid plan or self-hosted instance. Using basic routing.')
    }

    // Handle optimization preference (only if self-hosted or paid)
    if (preferences.optimize && isSelfHosted) {
      if (preferences.optimize === 'distance') {
        // Use custom model to prefer shorter routes
        requestBody['ch.disable'] = true
        requestBody.custom_model = {
          distance_influence: 200, // Higher value prefers shorter routes
        }
      } else if (preferences.optimize === 'balanced') {
        requestBody['ch.disable'] = true
        requestBody.custom_model = {
          distance_influence: 100, // Balanced between time and distance
        }
      }
      // 'time' is the default, no need to set anything
    }

    // Handle avoidances via custom model (only if self-hosted or paid)
    const avoidances: string[] = []

    if (preferences.avoidHighways && isSelfHosted) {
      avoidances.push('road_class == MOTORWAY')
    }

    if (preferences.avoidTolls && isSelfHosted) {
      // Note: GraphHopper can provide toll info via details, but avoiding requires custom model
      avoidances.push('toll == true')
    }

    if (preferences.avoidFerries) {
      // Use snap_preventions for ferries (works in free tier)
      if (!requestBody.snap_preventions) {
        requestBody.snap_preventions = []
      }
      requestBody.snap_preventions.push('ferry')
    }

    if (preferences.avoidUnpaved && isSelfHosted) {
      avoidances.push('road_class == TRACK')
      avoidances.push('surface == UNPAVED')
    }

    // Apply avoidances to custom model (only if self-hosted or paid)
    if (avoidances.length > 0 && isSelfHosted) {
      requestBody['ch.disable'] = true
      if (!requestBody.custom_model) {
        requestBody.custom_model = {}
      }
      if (!requestBody.custom_model.priority) {
        requestBody.custom_model.priority = []
      }

      // Add priority rules to avoid certain road types
      for (const condition of avoidances) {
        requestBody.custom_model.priority.push({
          if: condition,
          multiply_by: '0', // Avoid completely
        })
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
