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
  WHEELCHAIR = 'wheelchair',
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
  length?: number // meters
  axleLoad?: number // kg

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

  // ── Range preferences (0-1 float, 5 stops: 0, 0.25, 0.5, 0.75, 1.0) ──
  // Higher values = more willingness to use that feature
  highways?: number       // driving: 0=avoid highways, 1=prefer highways
  tolls?: number          // driving: 0=avoid tolls, 1=don't care
  ferries?: number        // all modes: 0=avoid ferries, 1=prefer ferries
  hills?: number          // walking/cycling: 0=avoid hills, 1=prefer hills
  surfaceQuality?: number // cycling: 0=any surface, 1=paved only
  litPaths?: number       // walking: 0=don't care, 1=strongly prefer lit
  safetyVsSpeed?: number  // cycling: 0=safest (prefer paths), 1=fastest (prefer roads)

  // ── Boolean preferences ──
  shortest?: boolean
  preferHOV?: boolean
  wheelchairAccessible?: boolean

  // ── Numeric/enum preferences ──
  cyclingSpeed?: number   // kph (5-60)
  walkingSpeed?: number   // kph (0.5-10)
  bicycleType?: 'Road' | 'Hybrid' | 'City' | 'Cross' | 'Mountain'

  // ── Transit ──
  maxWalkDistance?: number  // meters
  maxTransfers?: number

  // ── Legacy boolean fields (deprecated — kept for backward compat) ──
  avoidTolls?: boolean
  avoidHighways?: boolean
  avoidFerries?: boolean
  avoidUnpaved?: boolean

  // ── Advanced: raw custom_model JSON override ──
  customModelOverride?: string  // JSON string — if set, replaces auto-generated custom_model

  // ── Provider-specific escape hatch ──
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

  // Localization (for turn-by-turn instructions)
  language?: import('../lib/i18n').Language

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

/** Per-edge attributes mapped to distance along the route */
export interface RouteEdgeSegment {
  startDistance: number     // meters from leg start
  endDistance: number       // meters from leg start
  surface?: string          // asphalt | concrete | paved | gravel | dirt | sand | compacted | etc.
  roadClass?: string        // motorway | trunk | primary | secondary | tertiary | residential | cycleway | footway | track | path | steps | etc.
  roadEnvironment?: string  // road | ferry | bridge | tunnel
  roadAccess?: string       // destination | delivery | private | no | etc.
  bikeNetwork?: string      // international | national | regional | local | other
  getOffBike?: boolean      // whether cyclist must dismount
  smoothness?: string       // excellent | good | intermediate | bad | very_bad | horrible
  trackType?: string        // grade1 | grade2 | grade3 | grade4 | grade5
  cycleway?: string         // track | lane | separate | no
  averageSlope?: number     // signed decimal percent (positive = uphill)
  maxSlope?: number         // signed decimal percent
  averageSpeed?: number     // km/h — actual routing speed used

  // Legacy fields (Valhalla compat — will be removed)
  use?: string
  cycleLane?: string
  shoulder?: boolean
  speedLimit?: number
  laneCount?: number
  weightedGrade?: number
  meanElevation?: number
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

  // Per-edge surface/road/safety data
  edgeSegments?: RouteEdgeSegment[]

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

  // Per-edge surface/road/safety data
  edgeSegments?: RouteEdgeSegment[]

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
