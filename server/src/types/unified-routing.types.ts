// Unified Routing Types for Parchment
// Supports: Valhalla, OSRM, GraphHopper, OpenRouteService, OpenTripPlanner, Google Maps

export interface Coordinate {
  lng: number
  lat: number
  elevation?: number // meters above sea level
}

// Travel modes standardized across providers
export enum TravelMode {
  DRIVING = 'driving',
  WALKING = 'walking',
  CYCLING = 'cycling',
  TRANSIT = 'transit',
  MOTORCYCLE = 'motorcycle',
  TRUCK = 'truck',
}

// Waypoint types for different use cases
export enum WaypointType {
  STOP = 'stop', // Regular destination
  VIA = 'via', // Route modifier waypoint
  TRANSFER = 'transfer', // Transit transfer point
  HAZARD = 'hazard', // Point/area to avoid
}

export interface RouteWaypoint {
  id?: string
  coordinate: Coordinate
  type: WaypointType
  name?: string

  // Time constraints
  arrivalTime?: Date
  departureTime?: Date
  serviceTime?: number // minutes at waypoint

  // Routing hints
  heading?: number // preferred direction (0-360)
  radius?: number // search radius in meters
}

export interface VehicleConfig {
  id: string
  name: string
  mode: TravelMode

  // Physical constraints
  height?: number // meters
  width?: number // meters
  weight?: number // kg

  // Preferences
  avoidTolls?: boolean
  avoidHighways?: boolean
  maxSpeed?: number // km/h

  // Vehicle type for filtering
  vehicleType: 'car' | 'bike' | 'scooter' | 'motorcycle' | 'truck' | 'walking'
}

export interface RoutingPreferences {
  optimize?: 'time' | 'distance' | 'balanced'
  alternatives?: boolean
  maxAlternatives?: number

  // Avoidances
  avoidTolls?: boolean
  avoidHighways?: boolean
  avoidFerries?: boolean
  avoidUnpaved?: boolean

  // Transit options
  maxWalkDistance?: number
  maxTransfers?: number
  wheelchairAccessible?: boolean

  // Provider-specific options
  providerOptions?: Record<string, any>
}

export interface RouteRequest {
  waypoints: RouteWaypoint[]
  mode: TravelMode
  vehicle?: VehicleConfig
  preferences?: RoutingPreferences

  // Response options
  includeInstructions?: boolean
  includeGeometry?: boolean
  geometryFormat?: 'geojson' | 'polyline'

  // Timing
  departureTime?: Date

  // Provider selection
  preferredProvider?: string
  requestId?: string
}

export interface RouteInstruction {
  type: string
  text: string
  coordinate: Coordinate
  distance: number // meters to next instruction
  duration: number // seconds to next instruction
  heading?: number
  streetName?: string

  // Turn details
  modifier?:
    | 'left'
    | 'right'
    | 'straight'
    | 'slight-left'
    | 'slight-right'
    | 'u-turn'
  exitNumber?: number // for roundabouts

  // Elevation and surface data (for bike/pedestrian modes)
  elevation?: number // meters above sea level
  elevationGain?: number // meters gained in this segment
  elevationLoss?: number // meters lost in this segment
  maxElevation?: number // highest point in this segment
  minElevation?: number // lowest point in this segment
  surface?: string // road surface type
  roadClass?: string // classification of the road
}

export interface RouteLeg {
  startWaypoint: RouteWaypoint
  endWaypoint: RouteWaypoint
  mode: TravelMode

  distance: number // meters
  duration: number // seconds
  geometry: Coordinate[]

  instructions: RouteInstruction[]

  // Route characteristics
  hasTolls?: boolean
  hasHighways?: boolean
  hasFerries?: boolean

  // Elevation data (for bike/pedestrian modes)
  totalElevationGain?: number // total meters climbed
  totalElevationLoss?: number // total meters descended
  maxElevation?: number // highest point on this leg
  minElevation?: number // lowest point on this leg

  // Traffic
  durationInTraffic?: number

  // Transit info
  transitInfo?: {
    lineName?: string
    agencyName?: string
    mode: TravelMode
  }
}

export interface RouteSummary {
  totalDistance: number // meters
  totalDuration: number // seconds
  totalDurationInTraffic?: number

  hasTolls: boolean
  hasHighways: boolean
  hasFerries: boolean

  // Elevation data (for bike/pedestrian modes)
  totalElevationGain?: number // total meters climbed
  totalElevationLoss?: number // total meters descended
  maxElevation?: number // highest point on route
  minElevation?: number // lowest point on route

  departureTime?: Date
  arrivalTime?: Date

  // Costs
  tollCost?: { currency: string; amount: number }
  fuelCost?: { currency: string; amount: number }
}

export interface Route {
  id?: string
  summary: RouteSummary
  legs: RouteLeg[]
  geometry: Coordinate[]
  boundingBox: [number, number, number, number] // [minLng, minLat, maxLng, maxLat]

  // Quality metrics
  confidence?: number // 0-1
  rank?: number // among alternatives

  // Provider info
  provider: string
  createdAt: Date
}

export interface Trip {
  id?: string
  request: RouteRequest
  routes: Route[]

  // Metadata
  primaryProvider: string
  providers: string[]
  createdAt: Date
  processingTime: number // milliseconds

  errors?: Array<{
    provider: string
    message: string
  }>
}

export interface UnifiedRoute {
  routes: Route[]
  metadata: {
    provider: string
    requestId?: string
    processingTime: number
    attribution?: string[]
  }
  errors?: Array<{
    code: string
    message: string
  }>
}

// Matrix/Table API types
export interface MatrixRequest {
  origins: Coordinate[]
  destinations: Coordinate[]
  mode: TravelMode

  returnDistances?: boolean
  returnDurations?: boolean

  preferences?: RoutingPreferences
  vehicle?: VehicleConfig
}

export interface MatrixResponse {
  origins: Coordinate[]
  destinations: Coordinate[]

  distances?: number[][] // meters, null for unreachable
  durations?: number[][] // seconds, null for unreachable

  provider: string
  processingTime: number
}

// Navigation types
export interface NavigationState {
  trip: Trip
  activeRoute: Route

  currentPosition: Coordinate
  currentHeading?: number

  currentLegIndex: number
  currentInstructionIndex: number
  distanceToNextInstruction: number
  timeToDestination: number

  isOnRoute: boolean
  isRerouting: boolean
  hasArrived: boolean
}

// Provider adapter interface
export interface RoutingAdapter {
  readonly providerId: string
  readonly supportedModes: TravelMode[]

  calculateRoute(request: RouteRequest): Promise<UnifiedRoute>
  calculateMatrix?(request: MatrixRequest): Promise<MatrixResponse>

  isHealthy(): Promise<boolean>
}

export interface RoutingCapabilities {
  supportsAlternatives: boolean
  supportsTraffic: boolean
  supportsInstructions: boolean
  supportsMatrix: boolean
  supportsTransit: boolean

  maxWaypoints: number
  maxMatrixSize: number
}

// Timeline and Trip Planning Types
export interface TimelineSegment {
  id: string
  type: 'route' | 'waiting' | 'transfer'
  mode: TravelMode
  vehicleType?: 'car' | 'bike' | 'scooter' | 'motorcycle' | 'truck' | 'walking'
  vehicleId?: string // Reference to user's vehicle

  // Timing
  startTime: Date
  endTime: Date
  duration: number // seconds

  // Route information
  distance?: number // meters
  instructions?: RouteInstruction[]
  geometry?: Coordinate[]

  // Elevation data
  totalElevationGain?: number // meters
  totalElevationLoss?: number // meters
  maxElevation?: number // meters
  minElevation?: number // meters

  // Transit specific (for future use)
  lineName?: string
  lineColor?: string
  vehicleNumber?: string
  fare?: {
    currency: string
    amount: number
  }

  // Hazards and alerts
  hazards?: Array<{
    type: string
    description: string
    severity: 'low' | 'medium' | 'high'
    coordinate: Coordinate
    timestamp: Date
  }>

  // Status
  isRecommended?: boolean
  confidence?: number // 0-1
}

export interface TripOption {
  id: string
  mode: TravelMode
  vehicleType?: 'car' | 'bike' | 'scooter' | 'motorcycle' | 'truck' | 'walking'
  vehicleId?: string

  // Overall trip info
  summary: RouteSummary
  segments: TimelineSegment[]

  // Timeline positioning
  startTime: Date
  endTime: Date

  // Trip characteristics
  isRecommended?: boolean
  rank: number // 1 = best option
  provider: string

  // Costs and environmental impact
  cost?: {
    fuel?: { currency: string; amount: number }
    tolls?: { currency: string; amount: number }
    parking?: { currency: string; amount: number }
    total?: { currency: string; amount: number }
  }
  co2Emissions?: number // kg
}

export interface TripsRequest {
  waypoints: RouteWaypoint[]

  // Available vehicles/modes
  availableVehicles?: string[] // ['car', 'bike', 'scooter']
  userVehicles?: VehicleConfig[] // User's personal vehicles

  // Timing preferences
  departureTime?: Date
  arrivalTime?: Date

  // Trip options
  maxOptions?: number // Max number of alternatives per mode
  includeWalking?: boolean // Always include walking as fallback

  // Routing preferences
  preferences?: RoutingPreferences

  // Request metadata
  requestId?: string
}

export interface SingleTripRequest {
  waypoints: RouteWaypoint[]
  mode: TravelMode
  vehicleType?: 'car' | 'bike' | 'scooter' | 'motorcycle' | 'truck' | 'walking'

  // User vehicles
  userVehicles?: VehicleConfig[]

  // Timing preferences
  departureTime?: Date
  arrivalTime?: Date

  // Routing preferences
  preferences?: RoutingPreferences

  // Request metadata
  requestId?: string
}

export interface TripsResponse {
  request: TripsRequest
  trips: TripOption[]

  // Timeline bounds for UI
  earliestStart: Date
  latestEnd: Date

  // Metadata
  metadata: {
    providers: string[]
    processingTime: number
    requestId?: string
  }

  // Errors for individual modes/providers
  errors?: Array<{
    mode: TravelMode
    vehicleType?: string
    provider: string
    message: string
  }>
}

// Vehicle mode mapping for routing profiles
export const VEHICLE_MODE_MAP: Record<string, TravelMode> = {
  car: TravelMode.DRIVING,
  motorcycle: TravelMode.MOTORCYCLE,
  truck: TravelMode.TRUCK,
  bike: TravelMode.CYCLING,
  scooter: TravelMode.CYCLING, // Use cycling profile for scooters
  walking: TravelMode.WALKING,
}
