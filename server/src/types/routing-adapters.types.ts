// Provider-specific adapter interfaces for routing services
// Maps external API formats to our unified interface

import {
  RouteRequest,
  UnifiedRoute,
  MatrixRequest,
  MatrixResponse,
  RoutingAdapter,
  TravelMode,
  Coordinate,
} from './unified-routing.types'

// =============================================================================
// VALHALLA ADAPTER
// =============================================================================

export interface ValhallaRequest {
  locations: Array<{
    lat: number
    lon: number
    type?: 'break' | 'through' | 'via'
    heading?: number
    heading_tolerance?: number
    street_side_tolerance?: number
    search_cutoff?: number
    node_snap_tolerance?: number
    way_id?: number
  }>
  costing: 'auto' | 'bicycle' | 'pedestrian' | 'taxi' | 'bus' | 'motorcycle'
  costing_options?: {
    auto?: {
      maneuver_penalty?: number
      gate_cost?: number
      gate_penalty?: number
      toll_booth_cost?: number
      toll_booth_penalty?: number
      ferry_cost?: number
      use_ferry?: number
      use_highways?: number
      use_tolls?: number
      use_primary?: number
      use_tracks?: number
    }
    bicycle?: {
      bicycle_type?: 'Road' | 'Hybrid' | 'City' | 'Cross' | 'Mountain'
      cycling_speed?: number
      use_roads?: number
      use_ferry?: number
      avoid_bad_surfaces?: number
    }
    pedestrian?: {
      walking_speed?: number
      walkway_factor?: number
      alley_factor?: number
      driveway_factor?: number
      step_penalty?: number
    }
  }
  directions_options?: {
    units?: 'kilometers' | 'miles'
    language?: import('../lib/i18n').Language
    format?: 'json' | 'gpx' | 'osrm'
    narrative?: boolean
    banner_instructions?: boolean
    voice_instructions?: boolean
  }
  filters?: {
    attributes?: string[]
    action?: 'include' | 'exclude'
  }
  shape_match?: 'edge_walk' | 'map_snap' | 'walk_or_snap'
  begin_time?: number
  durations?: number[]
  targets?: number[]
  sources?: number[]
}

export interface ValhallaResponse {
  trip: {
    locations: Array<{
      type: string
      lat: number
      lon: number
      original_index?: number
    }>
    legs: Array<{
      maneuvers: Array<{
        type: number
        instruction: string
        verbal_success_message?: string
        verbal_pre_instruction?: string
        verbal_post_instruction?: string
        time: number
        length: number
        begin_shape_index: number
        end_shape_index: number
        rough?: boolean
        travel_mode?: string
        travel_type?: string
        street_names?: string[]
        begin_street_names?: string[]
        sign?: {
          exit_number?: string
          exit_branch?: string
          exit_toward?: string
          exit_name?: string
        }
      }>
      summary: {
        has_time_restrictions: boolean
        has_toll: boolean
        has_highway: boolean
        has_ferry: boolean
        min_lat: number
        min_lon: number
        max_lat: number
        max_lon: number
        time: number
        length: number
        cost: number
      }
      shape: string
    }>
    summary: {
      has_time_restrictions: boolean
      has_toll: boolean
      has_highway: boolean
      has_ferry: boolean
      min_lat: number
      min_lon: number
      max_lat: number
      max_lon: number
      time: number
      length: number
      cost: number
    }
    units: 'kilometers' | 'miles'
    shape: string
    confidence_score?: number
  }
  warnings?: Array<{
    code: number
    description: string
  }>
  status?: number
  status_message?: string
}

export class ValhallaAdapter implements RoutingAdapter {
  readonly providerId = 'valhalla'
  readonly supportedModes = [
    TravelMode.DRIVING,
    TravelMode.CYCLING,
    TravelMode.WALKING,
  ]

  async calculateRoute(request: RouteRequest): Promise<UnifiedRoute>
  async calculateMatrix?(request: MatrixRequest): Promise<MatrixResponse>
  async isHealthy(): Promise<boolean>

  // Helper methods
  private mapModeToCosting(mode: TravelMode): string
  private mapRequestToValhalla(request: RouteRequest): ValhallaRequest
  private mapValhallaToUnified(response: ValhallaResponse): UnifiedRoute
}

// =============================================================================
// OSRM ADAPTER
// =============================================================================

export interface OSRMRequest {
  coordinates: number[][] // [longitude, latitude] pairs
  bearings?: string // semicolon-separated bearings
  radiuses?: string // semicolon-separated radiuses
  generate_hints?: boolean
  hints?: string // semicolon-separated hints
  approaches?: string // semicolon-separated approaches
  exclude?: string // comma-separated classes to avoid
  annotations?: boolean | string
  geometries?: 'polyline' | 'polyline6' | 'geojson'
  overview?: 'full' | 'simplified' | 'false'
  steps?: boolean
  continue_straight?: boolean
  waypoints?: string // semicolon-separated indices
  alternatives?: boolean | number
}

export interface OSRMResponse {
  code:
    | 'Ok'
    | 'InvalidUrl'
    | 'InvalidService'
    | 'InvalidVersion'
    | 'InvalidOptions'
    | 'InvalidQuery'
    | 'InvalidValue'
    | 'NoSegment'
    | 'TooBig'
    | 'NoRoute'
  message?: string
  data_version?: string
  routes?: Array<{
    geometry: string | object
    legs: Array<{
      steps?: Array<{
        intersections: Array<{
          out?: number
          in?: number
          entry: boolean[]
          bearings: number[]
          location: [number, number]
          lanes?: Array<{
            indications: string[]
            valid: boolean
          }>
        }>
        driving_side: 'left' | 'right'
        geometry: string | object
        mode: string
        maneuver: {
          bearing_after: number
          bearing_before: number
          location: [number, number]
          modifier?: string
          type: string
          exit?: number
        }
        weight: number
        duration: number
        name: string
        distance: number
      }>
      summary: string
      weight: number
      duration: number
      distance: number
    }>
    weight_name: string
    weight: number
    duration: number
    distance: number
  }>
  waypoints?: Array<{
    hint: string
    distance: number
    name: string
    location: [number, number]
  }>
}

export class OSRMAdapter implements RoutingAdapter {
  readonly providerId = 'osrm'
  readonly supportedModes = [
    TravelMode.DRIVING,
    TravelMode.CYCLING,
    TravelMode.WALKING,
  ]

  async calculateRoute(request: RouteRequest): Promise<UnifiedRoute>
  async calculateMatrix?(request: MatrixRequest): Promise<MatrixResponse>
  async isHealthy(): Promise<boolean>

  private mapRequestToOSRM(request: RouteRequest): OSRMRequest
  private mapOSRMToUnified(response: OSRMResponse): UnifiedRoute
}

// =============================================================================
// GRAPHHOPPER ADAPTER
// =============================================================================

export interface GraphHopperRequest {
  points: number[][] // [longitude, latitude] pairs
  profile: 'car' | 'bike' | 'foot' | 'motorcycle' | 'truck'
  locale?: string
  optimize?: boolean
  instructions?: boolean
  calc_points?: boolean
  debug?: boolean
  elevation?: boolean
  points_encoded?: boolean
  type?: 'json' | 'gpx'
  heading?: number[]
  heading_penalty?: number
  point_hint?: string[]
  details?: string[]
  ch?: {
    disable?: boolean
  }
  lm?: {
    disable?: boolean
  }
  custom_model?: {
    speed?: Array<{
      if: string
      limit_to?: string
      multiply_by?: string
    }>
    priority?: Array<{
      if: string
      multiply_by: string
    }>
    distance_influence?: number
  }
}

export interface GraphHopperResponse {
  hints: {
    'visited_nodes.sum'?: number
    'visited_nodes.average'?: number
  }
  info: {
    copyrights: string[]
    took: number
  }
  paths: Array<{
    distance: number
    weight: number
    time: number
    transfers: number
    points_encoded: boolean
    bbox: [number, number, number, number]
    points:
      | {
          type: 'LineString'
          coordinates: number[][]
        }
      | string
    snapped_waypoints:
      | {
          type: 'LineString'
          coordinates: number[][]
        }
      | string
    instructions?: Array<{
      distance: number
      heading?: number
      sign: number
      interval: [number, number]
      text: string
      time: number
      street_name: string
      last_heading?: number
    }>
    details?: Record<string, Array<[number, number, any]>>
    ascend?: number
    descend?: number
    points_order?: number[]
  }>
}

export class GraphHopperAdapter implements RoutingAdapter {
  readonly providerId = 'graphhopper'
  readonly supportedModes = [
    TravelMode.DRIVING,
    TravelMode.CYCLING,
    TravelMode.WALKING,
    TravelMode.MOTORCYCLE,
    TravelMode.TRUCK,
  ]

  async calculateRoute(request: RouteRequest): Promise<UnifiedRoute>
  async calculateMatrix?(request: MatrixRequest): Promise<MatrixResponse>
  async isHealthy(): Promise<boolean>

  private mapRequestToGraphHopper(request: RouteRequest): GraphHopperRequest
  private mapGraphHopperToUnified(response: GraphHopperResponse): UnifiedRoute
}

// =============================================================================
// OPENROUTESERVICE ADAPTER
// =============================================================================

export interface OpenRouteServiceRequest {
  coordinates: number[][] // [longitude, latitude] pairs
  profile?:
    | 'driving-car'
    | 'driving-hgv'
    | 'cycling-regular'
    | 'cycling-road'
    | 'cycling-mountain'
    | 'cycling-electric'
    | 'foot-walking'
    | 'foot-hiking'
    | 'wheelchair'
  preference?: 'fastest' | 'shortest' | 'recommended'
  format?: 'json' | 'geojson' | 'gpx'
  units?: 'km' | 'mi' | 'm'
  language?: import('../lib/i18n').Language
  geometry?: boolean
  geometry_format?: 'geojson' | 'polyline' | 'encodedpolyline'
  geometry_simplify?: boolean
  instructions?: boolean
  instructions_format?: 'text' | 'json'
  roundabout_exits?: boolean
  attributes?: string[]
  maneuvers?: boolean
  radiuses?: number[]
  bearings?: number[][]
  skip_segments?: number[]
  continue_straight?: boolean
  waypoint_snapping?: string[]
  avoid_borders?: 'all' | 'controlled' | 'none'
  avoid_countries?: number[]
  avoid_features?: string[]
  avoid_polygons?: object
  alternative_routes?: {
    target_count?: number
    weight_factor?: number
    share_factor?: number
  }
  round_trip?: {
    length?: number
    points?: number
    seed?: number
  }
  options?: {
    avoid_features?: string[]
    avoid_borders?: string
    avoid_countries?: number[]
    vehicle_type?: string
    profile_params?: {
      weightings?: {
        steepness_difficulty?: number
        green?: number
        quiet?: number
      }
      restrictions?: {
        length?: number
        width?: number
        height?: number
        axleload?: number
        weight?: number
        hazmat?: boolean
      }
    }
  }
}

export interface OpenRouteServiceResponse {
  bbox: [number, number, number, number]
  routes: Array<{
    summary: {
      distance: number
      duration: number
      ascent?: number
      descent?: number
    }
    geometry: string | object
    way_points: number[]
    segments: Array<{
      distance: number
      duration: number
      steps: Array<{
        distance: number
        duration: number
        type: number
        instruction: string
        name: string
        way_points: [number, number]
        exit_number?: number
        maneuver?: {
          bearing_before: number
          bearing_after: number
          location: [number, number]
        }
      }>
    }>
    bbox: [number, number, number, number]
    legs?: any[]
    warnings?: Array<{
      code: number
      message: string
    }>
  }>
  metadata: {
    attribution: string
    service: string
    timestamp: number
    query: {
      coordinates: number[][]
      profile: string
      format: string
    }
    engine: {
      version: string
      build_date: string
      graph_date: string
    }
  }
}

export class OpenRouteServiceAdapter implements RoutingAdapter {
  readonly providerId = 'openrouteservice'
  readonly supportedModes = [
    TravelMode.DRIVING,
    TravelMode.CYCLING,
    TravelMode.WALKING,
    TravelMode.TRUCK,
  ]

  async calculateRoute(request: RouteRequest): Promise<UnifiedRoute>
  async calculateMatrix?(request: MatrixRequest): Promise<MatrixResponse>
  async isHealthy(): Promise<boolean>

  private mapRequestToOpenRouteService(
    request: RouteRequest,
  ): OpenRouteServiceRequest
  private mapOpenRouteServiceToUnified(
    response: OpenRouteServiceResponse,
  ): UnifiedRoute
}

// =============================================================================
// GOOGLE MAPS ADAPTER
// =============================================================================

export interface GoogleMapsRequest {
  origin: string | { lat: number; lng: number }
  destination: string | { lat: number; lng: number }
  waypoints?: Array<{
    location: string | { lat: number; lng: number }
    stopover?: boolean
  }>
  mode?: 'driving' | 'walking' | 'bicycling' | 'transit'
  units?: 'metric' | 'imperial'
  region?: string
  language?: import('../lib/i18n').Language
  departure_time?: Date
  arrival_time?: Date
  avoid?: string[]
  traffic_model?: 'best_guess' | 'pessimistic' | 'optimistic'
  transit_mode?: string[]
  transit_routing_preference?: 'less_walking' | 'fewer_transfers'
  alternatives?: boolean
  optimize?: boolean
}

export interface GoogleMapsResponse {
  geocoded_waypoints: Array<{
    geocoder_status: string
    place_id: string
    types: string[]
  }>
  routes: Array<{
    bounds: {
      northeast: { lat: number; lng: number }
      southwest: { lat: number; lng: number }
    }
    copyrights: string
    legs: Array<{
      distance: { text: string; value: number }
      duration: { text: string; value: number }
      duration_in_traffic?: { text: string; value: number }
      end_address: string
      end_location: { lat: number; lng: number }
      start_address: string
      start_location: { lat: number; lng: number }
      steps: Array<{
        distance: { text: string; value: number }
        duration: { text: string; value: number }
        end_location: { lat: number; lng: number }
        html_instructions: string
        maneuver?: string
        polyline: { points: string }
        start_location: { lat: number; lng: number }
        travel_mode: string
        transit_details?: {
          arrival_stop: {
            location: { lat: number; lng: number }
            name: string
          }
          arrival_time: {
            text: string
            time_zone: string
            value: number
          }
          departure_stop: {
            location: { lat: number; lng: number }
            name: string
          }
          departure_time: {
            text: string
            time_zone: string
            value: number
          }
          headsign: string
          line: {
            agencies: Array<{
              name: string
              phone: string
              url: string
            }>
            color: string
            name: string
            short_name: string
            text_color: string
            vehicle: {
              icon: string
              name: string
              type: string
            }
          }
          num_stops: number
        }
      }>
      traffic_speed_entry: any[]
      via_waypoint: any[]
    }>
    overview_polyline: { points: string }
    summary: string
    warnings: string[]
    waypoint_order: number[]
  }>
  status: string
  error_message?: string
}

export class GoogleMapsAdapter implements RoutingAdapter {
  readonly providerId = 'googlemaps'
  readonly supportedModes = [
    TravelMode.DRIVING,
    TravelMode.WALKING,
    TravelMode.CYCLING,
    TravelMode.TRANSIT,
  ]

  async calculateRoute(request: RouteRequest): Promise<UnifiedRoute>
  async isHealthy(): Promise<boolean>

  private mapRequestToGoogleMaps(request: RouteRequest): GoogleMapsRequest
  private mapGoogleMapsToUnified(response: GoogleMapsResponse): UnifiedRoute
}

// =============================================================================
// ADAPTER FACTORY
// =============================================================================

export interface AdapterFactory {
  createAdapter(providerId: string): RoutingAdapter
  getSupportedProviders(): string[]
  getAdapter(providerId: string): RoutingAdapter | undefined
}

export class DefaultAdapterFactory implements AdapterFactory {
  private adapters: Map<string, RoutingAdapter> = new Map()

  constructor() {
    // Register all available adapters
    this.adapters.set('valhalla', new ValhallaAdapter())
    this.adapters.set('osrm', new OSRMAdapter())
    this.adapters.set('graphhopper', new GraphHopperAdapter())
    this.adapters.set('openrouteservice', new OpenRouteServiceAdapter())
    this.adapters.set('googlemaps', new GoogleMapsAdapter())
  }

  createAdapter(providerId: string): RoutingAdapter {
    const adapter = this.adapters.get(providerId)
    if (!adapter) {
      throw new Error(`Unknown routing provider: ${providerId}`)
    }
    return adapter
  }

  getSupportedProviders(): string[] {
    return Array.from(this.adapters.keys())
  }

  getAdapter(providerId: string): RoutingAdapter | undefined {
    return this.adapters.get(providerId)
  }
}
