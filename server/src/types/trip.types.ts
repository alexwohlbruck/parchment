// Multimodal Trip Planner Types
// Based on detailed requirements specification

import { Coordinate, RouteInstruction } from './unified-routing.types'

// =============================================================================
// CORE TYPES
// =============================================================================

export type VehicleType =
  | 'car'
  | 'bike'
  | 'scooter'
  | 'e-bike'
  | 'e-scooter'
  | 'wheelchair'
  | 'moped'
  | 'truck'

export type Mode =
  | 'walking'
  | 'driving'
  | 'biking'
  | 'transit'
  | 'rideshare'
  | 'wheelchair'
  | 'paratransit'
  | 'mixed'

// UI-level mode selection (includes 'multi' for all modes)
export type SelectedMode =
  | 'multi'
  | 'walking'
  | 'driving'
  | 'biking'
  | 'transit'

export type WaypointType = 'origin' | 'destination' | 'via'

export type OwnershipType = 'personal' | 'shared'

export type EnergyType = 'electric' | 'gas' | 'diesel' | 'hybrid'

// =============================================================================
// REQUEST TYPES
// =============================================================================

export interface TripRequest {
  waypoints: Waypoint[] // minimum 2
  selectedMode?: SelectedMode // Filter trips by mode
  routingPreferences?: RoutingPreferences
  availableVehicles?: Vehicle[]
  knownAccessPoints?: AccessPoint[]
  preferredDepartureTime?: string // ISO string
  preferredArrivalTime?: string // ISO string
  requestId?: string
  timestamp?: string // For reproducibility
}

export interface Waypoint {
  location: Coordinate
  address?: string
  label?: string
  type: WaypointType
}

export interface Vehicle {
  id: string
  type: VehicleType
  energyType?: EnergyType
  name?: string
  location?: Coordinate // Where it's currently parked
}

export interface AccessPoint {
  osmId: string
  code?: string
  name?: string
  location?: Coordinate
}

export interface RoutingPreferences {
  avoidHighways?: boolean
  avoidTolls?: boolean
  preferHOV?: boolean
  avoidFerries?: boolean
  preferLitPaths?: boolean
  preferPavedPaths?: boolean
  avoidHills?: boolean
  safetyVsEfficiency?: number // 0 (fastest) to 1 (safest)
  maxWalkingDistance?: number // meters
  maxTransfers?: number
  wheelchairAccessible?: boolean
  useKnownVehicleLocations?: boolean
  useKnownParkingLocations?: boolean
  routingEngine?: string // Preferred routing engine integration ID
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

export interface TripResponse {
  segments: TripSegment[]
  tripStats: TripStats
  earliestStartTime: string
  latestEndTime: string
  hazards?: Hazard[]
  dataSources: DataSource[]
  requestId?: string
  generatedAt: string
}

export interface TripSegment {
  segmentIndex: number
  mode: Mode
  ownership?: OwnershipType
  vehicle?: Vehicle
  carryingVehicle?: boolean
  start: Waypoint
  end: Waypoint
  startTime: string
  endTime: string
  duration: number // seconds
  distance: number // meters
  geometry: any // GeoJSON or encoded polyline
  instructions: RouteInstruction[] | string[] // Support both full instructions and simple strings
  cost?: CurrencyAmount
  co2?: number // grams
  details?: SegmentDetails
  // Elevation data
  totalElevationGain?: number // meters
  totalElevationLoss?: number // meters
  maxElevation?: number // meters
  minElevation?: number // meters
}

export interface TripStats {
  totalDuration: number // seconds
  totalDistance: number // meters
  totalCost?: CurrencyAmount
  totalCo2?: number // grams
  totalWalkingDistance?: number // meters
  totalTransfers?: number
}

export interface CurrencyAmount {
  value: number
  currency: string
}

export interface SegmentDetails {
  // Transit-specific details
  transitDetails?: TransitDetails

  // Rideshare-specific details
  rideshareDetails?: RideshareDetails

  // Vehicle-specific details
  vehicleDetails?: VehicleDetails

  // Multimodal-specific details (for walking → vehicle trips)
  multimodalSegments?: TripSegment[]
}

export interface TransitDetails {
  route: TransitRoute
  trip: TransitTrip
  stops: TransitStop[]
  departureStop: TransitStop
  arrivalStop: TransitStop
  headsign?: string
  shortName?: string
  color?: string
  textColor?: string
  realTimeData?: boolean
  delay?: number // seconds
  alerts?: TransitAlert[]
}

export interface TransitRoute {
  id: string
  shortName?: string
  longName?: string
  type: TransitRouteType
  color?: string
  textColor?: string
  agency: TransitAgency
}

export interface TransitTrip {
  id: string
  headsign?: string
  shortName?: string
  direction?: number
  blockId?: string
}

export interface TransitStop {
  id: string
  name: string
  location: Coordinate
  code?: string
  platformCode?: string
  wheelchairBoarding?: boolean
  arrivalTime?: string
  departureTime?: string
  stopSequence?: number
}

export interface TransitAgency {
  id: string
  name: string
  url?: string
  timezone?: string
  phone?: string
}

export interface TransitAlert {
  id: string
  headerText: string
  descriptionText?: string
  url?: string
  effect: TransitAlertEffect
  cause: TransitAlertCause
  severity: TransitAlertSeverity
}

export type TransitRouteType =
  | 'tram'
  | 'subway'
  | 'rail'
  | 'bus'
  | 'ferry'
  | 'cable_tram'
  | 'aerial_lift'
  | 'funicular'
  | 'trolleybus'
  | 'monorail'

export type TransitAlertEffect =
  | 'no_service'
  | 'reduced_service'
  | 'significant_delays'
  | 'detour'
  | 'additional_service'
  | 'modified_service'
  | 'other_effect'
  | 'unknown_effect'
  | 'stop_moved'

export type TransitAlertCause =
  | 'unknown_cause'
  | 'other_cause'
  | 'technical_problem'
  | 'strike'
  | 'demonstration'
  | 'accident'
  | 'holiday'
  | 'weather'
  | 'maintenance'
  | 'construction'
  | 'police_activity'
  | 'medical_emergency'

export type TransitAlertSeverity = 'info' | 'warning' | 'severe'

export interface RideshareDetails {
  provider: string
  vehicleType: VehicleType
  estimatedPickupTime?: string
  estimatedPrice?: CurrencyAmount
  bookingUrl?: string
}

export interface VehicleDetails {
  fuelUsed?: number // liters or kWh
  tollsIncurred?: CurrencyAmount
  parkingCost?: CurrencyAmount
  emissions?: number // grams CO2
}

export interface Hazard {
  id: string
  type: HazardType
  location: Coordinate
  description: string
  severity: 'low' | 'medium' | 'high'
  affectedModes: Mode[]
  validFrom?: string
  validTo?: string
}

export type HazardType =
  | 'construction'
  | 'accident'
  | 'weather'
  | 'flooding'
  | 'road_closure'
  | 'bridge_closure'
  | 'transit_disruption'
  | 'unsafe_area'

export interface DataSource {
  id: string
  name: string
  url: string
  updated?: string // ISO string
  updatedBy?: string
  type: DataSourceType
}

export type DataSourceType =
  | 'gtfs_static'
  | 'gtfs_realtime'
  | 'routing_engine'
  | 'rideshare_api'
  | 'weather_api'
  | 'traffic_api'

// =============================================================================
// SEGMENT PLANNING TYPES
// =============================================================================

export interface SegmentPlanInput {
  from: Waypoint
  to: Waypoint
  priorState: SegmentState
  preferences: RoutingPreferences
  availableVehicles: Vehicle[]
  departureTime: string
}

export interface SegmentPlanResult {
  segment: TripSegment
  resultingState: SegmentState
  alternatives?: TripSegment[] // Alternative segments for this leg
}

export interface SegmentState {
  currentTime: string
  currentLocation: Coordinate
  currentMode: Mode
  carryingVehicle?: Vehicle
  parkedVehicles: ParkedVehicle[]
  energy?: EnergyState // For electric vehicles
}

export interface ParkedVehicle {
  vehicle: Vehicle
  location: Coordinate
  parkedAt: string // ISO timestamp
  cost?: CurrencyAmount // Parking cost
}

export interface EnergyState {
  vehicleId: string
  currentLevel: number // 0-1 (percentage)
  range: number // meters remaining
  chargingNeeded?: boolean
}

// =============================================================================
// TRIP SCORING AND FILTERING
// =============================================================================

export interface TripScore {
  overall: number // 0-1, higher is better
  time: number
  cost: number
  comfort: number
  environmental: number
  safety: number
}

export interface TripCandidate {
  trip: TripResponse
  score: TripScore
  rank: number
}

// =============================================================================
// MULTIMODAL TRIP OPTIONS
// =============================================================================

export interface MultimodalTripResponse {
  request: TripRequest
  trips: TripCandidate[]
  metadata: {
    totalCandidatesGenerated: number
    processingTime: number // milliseconds
    dataSourcesUsed: DataSource[]
    warnings?: string[]
    errors?: TripPlanningError[]
  }
}

export interface TripPlanningError {
  code: string
  message: string
  segment?: number
  mode?: Mode
  details?: any
}

// =============================================================================
// ROUTING ENGINE INTEGRATION
// =============================================================================

export interface RoutingEngineConfig {
  id: string
  name: string
  supportedModes: Mode[]
  baseUrl: string
  apiKey?: string
  rateLimit?: number
  timeout?: number
}

export interface RoutingEngineRequest {
  from: Coordinate
  to: Coordinate
  mode: Mode
  vehicle?: Vehicle
  preferences: RoutingPreferences
  departureTime?: string
}

export interface RoutingEngineResponse {
  segments: TripSegment[]
  metadata: {
    engine: string
    processingTime: number
    dataVersion?: string
  }
}

// =============================================================================
// GTFS INTEGRATION TYPES
// =============================================================================

export interface GTFSFeed {
  id: string
  name: string
  url: string
  realtimeUrls?: {
    tripUpdates?: string
    vehiclePositions?: string
    alerts?: string
  }
  timezone: string
  validFrom: string
  validTo: string
  lastUpdated: string
}

export interface GTFSRealtimeUpdate {
  feedId: string
  timestamp: string
  tripUpdates?: GTFSTripUpdate[]
  vehiclePositions?: GTFSVehiclePosition[]
  alerts?: GTFSAlert[]
}

export interface GTFSTripUpdate {
  tripId: string
  routeId?: string
  delay?: number // seconds
  timestamp: string
  stopTimeUpdates: GTFSStopTimeUpdate[]
}

export interface GTFSStopTimeUpdate {
  stopId: string
  stopSequence?: number
  arrival?: GTFSTimeUpdate
  departure?: GTFSTimeUpdate
  scheduleRelationship: 'scheduled' | 'skipped' | 'no_data' | 'unscheduled'
}

export interface GTFSTimeUpdate {
  delay?: number // seconds
  time?: string // ISO timestamp
  uncertainty?: number // seconds
}

export interface GTFSVehiclePosition {
  tripId?: string
  routeId?: string
  vehicleId: string
  position: Coordinate
  bearing?: number
  speed?: number // m/s
  timestamp: string
}

export interface GTFSAlert {
  id: string
  routeIds?: string[]
  stopIds?: string[]
  tripIds?: string[]
  headerText: string
  descriptionText?: string
  url?: string
  effect: TransitAlertEffect
  cause: TransitAlertCause
  activePeriods: GTFSActivePeriod[]
}

export interface GTFSActivePeriod {
  start?: string // ISO timestamp
  end?: string // ISO timestamp
}
