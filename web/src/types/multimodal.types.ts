// Frontend types for multimodal trip planning
// Mirrors the backend types but adapted for frontend use

import type { RouteEdgeSegment } from './directions.types'

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
  | 'wheelchair'
  | 'rideshare'

export type SortPreference =
  | 'shortest'
  | 'earliest_arrival'
  | 'cheapest'
  | 'fewest_transfers'
  | 'least_walking'
  | 'greenest'

export type WaypointType = 'origin' | 'destination' | 'via'

export type OwnershipType = 'personal' | 'shared'

export type EnergyType = 'electric' | 'gas' | 'diesel' | 'hybrid'

export interface Coordinate {
  lat: number
  lng: number
}

export interface TripRequest {
  waypoints: Waypoint[]
  selectedMode?: SelectedMode // Filter trips by mode
  routingPreferences?: RoutingPreferences
  availableVehicles?: Vehicle[]
  knownAccessPoints?: AccessPoint[]
  preferredDepartureTime?: string
  preferredArrivalTime?: string
  requestId?: string
  timestamp?: string
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
  location?: Coordinate
}

export interface AccessPoint {
  osmId: string
  code?: string
  name?: string
  location?: Coordinate
}

export interface RoutingPreferences {
  // ── Range preferences (0-1 float, displayed as 5-stop slider) ──
  // Higher values = more willingness to use that feature
  highways?: number       // driving: 0=avoid, 1=prefer
  tolls?: number          // driving: 0=avoid, 1=don't care
  ferries?: number        // all modes: 0=avoid, 1=prefer
  hills?: number          // walking/cycling: 0=avoid, 1=prefer
  surfaceQuality?: number // cycling: 0=any surface, 1=paved only
  litPaths?: number       // walking: 0=don't care, 1=strongly prefer lit
  safetyVsSpeed?: number  // cycling: 0=safest (paths), 1=fastest (roads)

  // ── Boolean preferences ──
  shortest?: boolean
  preferHOV?: boolean
  wheelchairAccessible?: boolean

  // ── Numeric/enum preferences ──
  cyclingSpeed?: number   // kph (5-60)
  walkingSpeed?: number   // kph (0.5-10)
  bicycleType?: string    // Road, City, Mountain

  // ── Transit ──
  maxWalkingDistance?: number // meters
  maxTransfers?: number
  transitBufferMinutes?: number // 1-5, minutes to arrive early at stop

  // ── UI state (not sent to routing engine) ──
  useKnownVehicleLocations?: boolean
  useKnownParkingLocations?: boolean
  routingEngine?: string

  // ── Advanced: raw custom_model JSON override ──
  customModelOverride?: string  // JSON string — if set, replaces auto-generated custom_model

  // ── Legacy boolean fields (deprecated — kept for backward compat with localStorage) ──
  avoidHighways?: boolean
  avoidTolls?: boolean
  avoidFerries?: boolean
  preferLitPaths?: boolean
  preferPavedPaths?: boolean
  avoidHills?: boolean
  safetyVsEfficiency?: number
}

// Support level for each routing preference
// 'range' = engine supports 0-1 float values (render as 5-stop slider)
// 'boolean' = engine only supports on/off (render as toggle switch)
// false = engine does not support this preference
export type PreferenceSupportLevel = 'range' | 'boolean' | false

// Routing engine capability metadata
export interface RoutingEngineMetadata {
  supportedPreferences: {
    highways?: PreferenceSupportLevel
    tolls?: PreferenceSupportLevel
    ferries?: PreferenceSupportLevel
    hills?: PreferenceSupportLevel
    surfaceQuality?: PreferenceSupportLevel
    litPaths?: PreferenceSupportLevel
    safetyVsSpeed?: PreferenceSupportLevel
    shortest?: PreferenceSupportLevel
    preferHOV?: PreferenceSupportLevel
    wheelchairAccessible?: PreferenceSupportLevel
    cyclingSpeed?: PreferenceSupportLevel
    walkingSpeed?: PreferenceSupportLevel
    bicycleType?: PreferenceSupportLevel
    maxWalkDistance?: PreferenceSupportLevel
    maxTransfers?: PreferenceSupportLevel
  }
  supportedModes: string[]
  supportedOptimizations?: string[]
  features?: {
    alternatives?: boolean
    traffic?: boolean
    elevation?: boolean
    instructions?: boolean
    matrix?: boolean
    transit?: boolean
  }
  limits?: {
    maxWaypoints?: number
    maxAlternatives?: number
  }
}

export interface RoutingEngine {
  integrationId: string
  name: string
  metadata: RoutingEngineMetadata | null
}

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
  instructions: string[]
  cost?: CurrencyAmount
  co2?: number // grams
  details?: SegmentDetails
  edgeSegments?: RouteEdgeSegment[]
  totalElevationGain?: number
  totalElevationLoss?: number
  maxElevation?: number
  minElevation?: number
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
  transitDetails?: TransitDetails
  rideshareDetails?: RideshareDetails
  vehicleDetails?: VehicleDetails
  sharedMobilityDetails?: SharedMobilityDetails
}

export interface SharedMobilityDetails {
  provider: string
  stationName?: string
  toStationName?: string
  vehicleType: 'bike' | 'ebike' | 'scooter' | 'car' | 'moped' | 'other'
  propulsionType?: 'human' | 'electric_assist' | 'electric'
  stationId?: string
  availableVehicles?: number
  availableDocks?: number
  unlockUri?: string
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

/** A live GTFS-RT vehicle position enriched by Barrelman. */
export interface TransitVehiclePosition {
  vehicleId: string
  tripId?: string
  routeId?: string
  feedId: string
  position: { lat: number; lng: number }
  bearing?: number
  speed?: number
  timestamp: string
  routeColor?: string
  routeTextColor?: string
  routeShortName?: string
  routeType?: TransitRouteType
  nextStopId?: string
  nextStopArrival?: string
  /** Position from the previous GTFS-RT snapshot.
   *  Allows starting interpolation on first fetch without waiting for a second poll. */
  previousPosition?: { lat: number; lng: number }
  /** Timestamp of the previous position snapshot. */
  previousTimestamp?: string
}

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
  productId?: string
  productName?: string
  vehicleType: VehicleType
  estimatedPickupTime?: string
  pickupEta?: number
  estimatedPrice?: CurrencyAmount
  priceRange?: { low: CurrencyAmount; high: CurrencyAmount }
  surgeMultiplier?: number
  bookingUrl?: string
  expiresAt?: string
  capacity?: number
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
  updated?: string
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

export interface MultimodalTripResponse {
  request: TripRequest
  trips: TripCandidate[]
  metadata: {
    totalCandidatesGenerated: number
    processingTime: number
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
// User Vehicle Management
// =============================================================================

export type LocationSource = 'manual' | 'inferred' | 'tracker'

export type LocationStaleness = 'fresh' | 'aging' | 'stale' | 'very-stale' | 'unknown'

export interface UserVehicle {
  id: string
  type: VehicleType
  energyType?: EnergyType | null
  name?: string | null
  isActive: boolean
  lastKnownLocation: Coordinate | null
  locationSource: LocationSource
  locationUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

// Utility types for UI
export interface VehicleTypeInfo {
  type: VehicleType
  name: string
  description: string
  supportedEnergyTypes: EnergyType[]
}

export interface ServiceStatus {
  status: 'operational' | 'degraded' | 'down'
  version: string
  capabilities: {
    supportedModes: Mode[]
    supportedVehicleTypes: VehicleType[]
    features: {
      multimodalPlanning: boolean
      realtimeTransit: boolean
      vehicleStateTracking: boolean
      accessibilitySupport: boolean
      costEstimation: boolean
      co2Estimation: boolean
      hazardDetection: boolean
    }
    limits: {
      maxWaypoints: number
      maxVehicles: number
      maxTripDuration: number
      requestTimeout: number
    }
  }
  integrations: {
    transitData: string[]
    rideshareProviders: string[]
  }
  lastUpdated: string
}
