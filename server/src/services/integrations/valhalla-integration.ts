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
} from '../../types/unified-routing.types'
import { getLanguageCode } from '../../lib/i18n'
import type {
  ValhallaConfig,
  ValhallaResponse,
  ValhallaLeg,
  ValhallaManeuver,
} from '../../types/valhalla.types'
import { ValhallaAdapter } from './adapters/valhalla-adapter'

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
      metadata: {
        supportedPreferences: {
          // Range preferences (Valhalla supports 0-1 floats natively)
          highways: 'range',
          tolls: 'range',
          ferries: 'range',
          hills: 'range',
          surfaceQuality: 'range',
          litPaths: 'range',
          safetyVsSpeed: 'range',

          // Boolean preferences
          shortest: 'boolean',
          preferHOV: 'boolean',
          wheelchairAccessible: 'boolean',

          // Numeric/enum preferences
          cyclingSpeed: 'range',
          walkingSpeed: 'range',
          bicycleType: 'full',

          // Transit
          maxWalkDistance: 'full',
          maxTransfers: false,
        },
        supportedModes: ['driving', 'walking', 'cycling', 'motorcycle', 'truck', 'wheelchair'],
        supportedOptimizations: ['time', 'distance'],
        features: {
          alternatives: true, // alternates parameter
          traffic: true, // speed_types with current/predicted/constrained
          elevation: true, // elevation_interval
          instructions: true, // directions_type
          matrix: true, // Matrix API available
          transit: false, // Transit not fully supported yet
        },
        limits: {
          maxWaypoints: 20,
          maxAlternatives: 3,
        },
      },
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
      const host = this.config.host.endsWith('/')
        ? this.config.host.slice(0, -1)
        : this.config.host
      const url = `${host}/route`

      const lang = request.language ? getLanguageCode(request.language) : 'en'
      const requestBody = {
        locations: request.waypoints.map((waypoint) => ({
          lat: waypoint.coordinate.lat,
          lon: waypoint.coordinate.lng,
          type: this.mapWaypointType(waypoint.type),
          heading: waypoint.heading,
        })),
        costing: this.mapTravelModeToCosting(request.mode),
        costing_options: this.buildCostingOptions(request),
        directions_options: {
          units: 'kilometers',
          narrative: request.includeInstructions ?? true,
          format: 'json',
          ...(lang && { language: lang }),
        },
      }

      console.log('Valhalla request URL:', url)
      console.log(
        'Valhalla request body:',
        JSON.stringify(requestBody, null, 2),
      )

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Valhalla error response:', response.status, errorText)
        throw new Error(
          `Valhalla routing error: ${response.status} - ${errorText}`,
        )
      }

      const data: ValhallaResponse = await response.json()
      return this.mapValhallaToUnified(data, request)
    } catch (error) {
      throw new Error(
        `Valhalla routing error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  /**
   * Map travel mode to Valhalla costing model
   */
  private mapTravelModeToCosting(mode: TravelMode): string {
    switch (mode) {
      case TravelMode.DRIVING:
        return 'auto'
      case TravelMode.CYCLING:
        return 'bicycle'
      case TravelMode.WALKING:
        return 'pedestrian'
      case TravelMode.MOTORCYCLE:
        return 'motorcycle'
      default:
        throw new Error(`Unsupported travel mode for Valhalla: ${mode}`)
    }
  }

  /**
   * Map waypoint type to Valhalla location type
   */
  private mapWaypointType(type: WaypointType): string {
    switch (type) {
      case WaypointType.STOP:
        return 'break'
      case WaypointType.VIA:
        return 'through'
      case WaypointType.TRANSFER:
        return 'break'
      case WaypointType.HAZARD:
        return 'break' // Hazards handled via avoidance, not location type
      default:
        return 'break'
    }
  }

  /**
   * Build costing options from request preferences
   */
  private buildCostingOptions(request: RouteRequest): any {
    if (!request.preferences && !request.vehicle) {
      return undefined
    }

    const options: any = {}
    const preferences = request.preferences
    const vehicle = request.vehicle

    // ── Auto / Driving ───────────────────────────────────────────
    if (request.mode === TravelMode.DRIVING) {
      const auto: Record<string, any> = {}

      // Range preferences (new numeric fields, fallback to legacy booleans)
      if (preferences?.tolls !== undefined)
        auto.use_tolls = preferences.tolls
      else if (preferences?.avoidTolls !== undefined)
        auto.use_tolls = preferences.avoidTolls ? 0 : 0.5

      if (preferences?.highways !== undefined)
        auto.use_highways = preferences.highways
      else if (preferences?.avoidHighways !== undefined)
        auto.use_highways = preferences.avoidHighways ? 0 : 0.5

      if (preferences?.ferries !== undefined)
        auto.use_ferry = preferences.ferries
      else if (preferences?.avoidFerries !== undefined)
        auto.use_ferry = preferences.avoidFerries ? 0 : 0.5

      if (preferences?.avoidUnpaved)
        auto.exclude_unpaved = true

      // HOV lanes
      if (preferences?.preferHOV) {
        auto.include_hov2 = true
        auto.include_hov3 = true
        auto.include_hot = true
      }

      // Vehicle physical dimensions
      if (vehicle?.height) auto.height = vehicle.height
      if (vehicle?.width) auto.width = vehicle.width
      if (vehicle?.weight) auto.weight = vehicle.weight

      // Top speed cap
      if (preferences?.providerOptions?.topSpeed)
        auto.top_speed = preferences.providerOptions.topSpeed

      if (Object.keys(auto).length) options.auto = auto
    }

    // ── Truck ────────────────────────────────────────────────────
    if (request.mode === TravelMode.TRUCK) {
      const truck: Record<string, any> = {}

      if (preferences?.tolls !== undefined)
        truck.use_tolls = preferences.tolls
      else if (preferences?.avoidTolls !== undefined)
        truck.use_tolls = preferences.avoidTolls ? 0 : 0.5

      if (preferences?.highways !== undefined)
        truck.use_highways = preferences.highways
      else if (preferences?.avoidHighways !== undefined)
        truck.use_highways = preferences.avoidHighways ? 0 : 0.5

      if (preferences?.ferries !== undefined)
        truck.use_ferry = preferences.ferries
      else if (preferences?.avoidFerries !== undefined)
        truck.use_ferry = preferences.avoidFerries ? 0 : 0.5

      if (preferences?.avoidUnpaved)
        truck.exclude_unpaved = true

      // Vehicle constraints
      if (vehicle?.height) truck.height = vehicle.height
      if (vehicle?.width) truck.width = vehicle.width
      if (vehicle?.weight) truck.weight = vehicle.weight
      if (vehicle?.length) truck.length = vehicle.length
      if (vehicle?.axleLoad) truck.axle_load = vehicle.axleLoad
      if (preferences?.providerOptions?.hazmat) truck.hazmat = true

      if (Object.keys(truck).length) options.truck = truck
    }

    // ── Bicycle ──────────────────────────────────────────────────
    if (request.mode === TravelMode.CYCLING) {
      const bicycle: Record<string, any> = {}

      // Range preferences (new numeric fields, fallback to legacy booleans)
      if (preferences?.ferries !== undefined)
        bicycle.use_ferry = preferences.ferries
      else if (preferences?.avoidFerries !== undefined)
        bicycle.use_ferry = preferences.avoidFerries ? 0 : 0.5

      if (preferences?.hills !== undefined)
        bicycle.use_hills = preferences.hills
      else if (preferences?.avoidHills !== undefined)
        bicycle.use_hills = preferences.avoidHills ? 0 : 0.5

      // Surface quality: 0=any surface, 1=paved only → maps to avoid_bad_surfaces directly
      if (preferences?.surfaceQuality !== undefined)
        bicycle.avoid_bad_surfaces = preferences.surfaceQuality
      else if (preferences?.preferPavedPaths)
        bicycle.avoid_bad_surfaces = 0.8

      // Safety vs Speed → use_roads (0=safest/prefer paths, 1=fastest/prefer roads)
      if (preferences?.safetyVsSpeed !== undefined)
        bicycle.use_roads = preferences.safetyVsSpeed
      else if (preferences?.providerOptions?.useRoads !== undefined)
        bicycle.use_roads = preferences.providerOptions.useRoads

      // Cycling speed override (kph)
      if (preferences?.cyclingSpeed)
        bicycle.cycling_speed = preferences.cyclingSpeed
      else if (preferences?.providerOptions?.cyclingSpeed)
        bicycle.cycling_speed = preferences.providerOptions.cyclingSpeed

      // Bicycle type: Road, Hybrid, Mountain, Cross, BMX
      if (preferences?.bicycleType)
        bicycle.bicycle_type = preferences.bicycleType
      else if (preferences?.providerOptions?.bicycleType)
        bicycle.bicycle_type = preferences.providerOptions.bicycleType

      // Lower the penalty for service roads / driveways so the router
      // considers cutting through them as shortcuts to bike lanes.
      bicycle.service_penalty = 0
      bicycle.service_factor = 0

      // Allow bicycle routing on pedestrian-only paths (sidewalks, footways)
      // with a penalty. 0=disallow (Valhalla default), 1=no penalty.
      bicycle.use_pedestrian_paths = 0.5

      if (Object.keys(bicycle).length) options.bicycle = bicycle
    }

    // ── Pedestrian / Walking ─────────────────────────────────────
    if (request.mode === TravelMode.WALKING) {
      const pedestrian: Record<string, any> = {}

      if (preferences?.hills !== undefined)
        pedestrian.use_hills = preferences.hills
      else if (preferences?.avoidHills !== undefined)
        pedestrian.use_hills = preferences.avoidHills ? 0 : 0.5

      if (preferences?.litPaths !== undefined)
        pedestrian.use_lit = preferences.litPaths
      else if (preferences?.providerOptions?.preferLitPaths)
        pedestrian.use_lit = 1

      // Walking speed override (kph)
      if (preferences?.walkingSpeed)
        pedestrian.walking_speed = preferences.walkingSpeed
      else if (preferences?.providerOptions?.walkingSpeed)
        pedestrian.walking_speed = preferences.providerOptions.walkingSpeed

      // Wheelchair mode
      if (preferences?.wheelchairAccessible)
        pedestrian.type = 'wheelchair'

      // Max walking distance (meters → km for Valhalla)
      if (preferences?.maxWalkDistance) {
        pedestrian.max_distance = preferences.maxWalkDistance / 1000
        pedestrian.transit_start_end_max_distance = preferences.maxWalkDistance
        pedestrian.transit_transfer_max_distance = preferences.maxWalkDistance
      }

      if (Object.keys(pedestrian).length) options.pedestrian = pedestrian
    }

    // ── Motorcycle ───────────────────────────────────────────────
    if (request.mode === TravelMode.MOTORCYCLE) {
      const motorcycle: Record<string, any> = {}

      if (preferences?.highways !== undefined)
        motorcycle.use_highways = preferences.highways
      else if (preferences?.avoidHighways !== undefined)
        motorcycle.use_highways = preferences.avoidHighways ? 0 : 0.5

      if (preferences?.ferries !== undefined)
        motorcycle.use_ferry = preferences.ferries
      else if (preferences?.avoidFerries !== undefined)
        motorcycle.use_ferry = preferences.avoidFerries ? 0 : 0.5

      if (preferences?.tolls !== undefined)
        motorcycle.use_tolls = preferences.tolls
      else if (preferences?.avoidTolls !== undefined)
        motorcycle.use_tolls = preferences.avoidTolls ? 0 : 0.5

      if (preferences?.providerOptions?.useTrails !== undefined)
        motorcycle.use_trails = preferences.providerOptions.useTrails

      if (Object.keys(motorcycle).length) options.motorcycle = motorcycle
    }

    return Object.keys(options).length > 0 ? options : undefined
  }

  /**
   * Map Valhalla response to unified format
   */
  private mapValhallaToUnified(
    data: ValhallaResponse,
    request: RouteRequest,
  ): UnifiedRoute {
    const route: Route = {
      id: `valhalla-${Date.now()}`,
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
      provider: 'valhalla',
      createdAt: new Date(),
    }

    return {
      routes: [route],
      metadata: {
        provider: 'valhalla',
        requestId: request.requestId,
        processingTime: 0, // Valhalla doesn't provide this
        attribution: ['© Valhalla routing engine'],
      },
    }
  }

  /**
   * Build route summary from Valhalla data
   */
  private buildRouteSummary(summary: any, request: RouteRequest): RouteSummary {
    return {
      totalDistance: summary.length * 1000, // Convert km to meters
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

  /**
   * Build route leg from Valhalla leg data
   */
  private buildRouteLeg(
    leg: ValhallaLeg,
    request: RouteRequest,
    legIndex: number,
  ): RouteLeg {
    const startWaypoint = request.waypoints[legIndex]
    const endWaypoint = request.waypoints[legIndex + 1]
    
    // Decode geometry once for use in instructions
    const geometry = this.decodePolyline(leg.shape)

    return {
      startWaypoint,
      endWaypoint,
      mode: request.mode,
      distance: leg.summary.length * 1000, // Convert km to meters
      duration: leg.summary.time,
      geometry,
      instructions: leg.maneuvers.map((maneuver) =>
        this.buildRouteInstruction(maneuver, geometry),
      ),
      hasTolls: leg.summary.has_toll,
      hasHighways: leg.summary.has_highway,
      hasFerries: leg.summary.has_ferry,
    }
  }

  /**
   * Build route instruction from Valhalla maneuver
   */
  private buildRouteInstruction(maneuver: ValhallaManeuver, geometry: { lat: number; lng: number }[]): RouteInstruction {
    // Extract coordinate from geometry using begin_shape_index
    let coordinate = { lat: 0, lng: 0 }
    if (maneuver.begin_shape_index !== undefined && geometry[maneuver.begin_shape_index]) {
      coordinate = geometry[maneuver.begin_shape_index]
    }
    
    return {
      type: this.mapManeuverType(maneuver.type),
      text: maneuver.instruction,
      coordinate,
      distance: maneuver.length * 1000, // Convert km to meters
      duration: maneuver.time,
      streetName: maneuver.street_names?.[0],
      modifier: this.mapManeuverModifier(maneuver.type),
      exitNumber: maneuver.sign?.exit_number
        ? parseInt(maneuver.sign.exit_number)
        : undefined,
    }
  }

  /**
   * Map Valhalla maneuver type to unified instruction type
   */
  private mapManeuverType(type: number): string {
    // Valhalla maneuver type mappings
    switch (type) {
      case 1:
        return 'start'
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
        return 'turn'
      case 7:
      case 8:
        return 'continue'
      case 9:
      case 10:
        return 'merge'
      case 11:
      case 12:
      case 13:
      case 14:
      case 15:
      case 16:
      case 17:
      case 18:
      case 19:
      case 20:
      case 21:
      case 22:
      case 23:
      case 24:
      case 25:
      case 26:
        return 'roundabout'
      case 27:
        return 'ramp'
      case 4:
        return 'destination'
      default:
        return 'continue'
    }
  }

  /**
   * Map Valhalla maneuver type to turn modifier
   */
  private mapManeuverModifier(
    type: number,
  ):
    | 'left'
    | 'right'
    | 'straight'
    | 'slight-left'
    | 'slight-right'
    | 'u-turn'
    | undefined {
    switch (type) {
      case 2:
        return 'straight'
      case 3:
        return 'slight-right'
      case 4:
        return 'right'
      case 5:
        return 'right' // sharp-right -> right
      case 6:
        return 'u-turn'
      case 7:
        return 'left' // sharp-left -> left
      case 8:
        return 'left'
      case 9:
        return 'slight-left'
      default:
        return undefined
    }
  }

  /**
   * Decode Valhalla polyline to coordinates
   * Based on https://valhalla.github.io/valhalla/decoding
   */
  private decodePolyline(
    encoded: string,
    precision: number = 6,
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
}
