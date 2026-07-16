import { Place, TransitDeparture } from './place.types'
import { Source } from '../lib/constants'
import { IntegrationId, IntegrationCapabilityId } from './integration.enums'
import type {
  IntegrationRecord,
  IntegrationScheme,
} from '../schema/integrations.schema'
import {
  RouteRequest,
  MatrixRequest,
  MatrixResponse,
  UnifiedRoute,
} from './unified-routing.types'
import type {
  LocationHistory,
  LocationHistoryRequest,
  PlaceVisitHistory,
  PlaceVisitHistoryRequest,
} from './location-history.types'

export {
  IntegrationId,
  IntegrationCapabilityId,
  IntegrationRecord,
  IntegrationScheme,
}

/**
 * Shape returned by `GET /integrations/configured` per integration row.
 *
 * Covers both system rows (userId/encryptedConfig absent) and user rows
 * (userId always present; encryptedConfig present only when the row is
 * scheme='user-e2ee' and the caller owns it).
 *
 * `config` holds only the integration's `publicFields` — never secrets.
 */
export interface ConfiguredIntegrationDto {
  id: string
  integrationId: IntegrationId
  scheme: IntegrationScheme
  name?: string
  config: Record<string, any>
  capabilities: Array<{
    id: IntegrationCapabilityId
    active: boolean
    metadata: unknown
  }>
  userId?: string | null
  encryptedConfig?: string
}

// Capability interfaces

export interface SearchFilter {
  access?: string[]
  fee?: 'yes' | 'no'
  hasHours?: boolean
}

export interface SearchCapability {
  searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
      language?: import('../lib/i18n').Language
      sort?: 'relevance' | 'distance' | 'name'
      filter?: SearchFilter
      /** Aborts the request when the client disconnects (e.g. user kept typing). */
      signal?: AbortSignal
    },
  ): Promise<Place[]>
}

export interface AutocompleteCapability {
  getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
      /** Aborts the request when the client disconnects (e.g. user kept typing). */
      signal?: AbortSignal
    },
  ): Promise<Place[]>
}

export interface PlaceInfoCapability {
  getPlaceInfo(
    id: string,
    options?: { language?: import('../lib/i18n').Language },
  ): Promise<Place | null>
}

// TODO: Return types
export interface GeocodingCapability {
  geocode(
    query: string,
    lat?: number,
    lng?: number,
    options?: { language?: import('../lib/i18n').Language },
  ): Promise<any[]>
  reverseGeocode(
    lat: number,
    lng: number,
    options?: { language?: import('../lib/i18n').Language },
  ): Promise<any[]>
}

export interface RoutingCapability {
  getRoute(request: RouteRequest): Promise<UnifiedRoute>
  getMatrix?(request: MatrixRequest): Promise<MatrixResponse>
  
  // Metadata about what this routing engine supports
  metadata?: RoutingCapabilityMetadata
}

// Support level for each routing preference
// 'range' = engine supports 0-1 float values (render as 5-stop slider)
// 'boolean' = engine only supports on/off (render as toggle switch)
// false = engine does not support this preference
export type PreferenceSupportLevel = 'range' | 'boolean' | false

// Metadata describing routing engine capabilities
export interface RoutingCapabilityMetadata {
  // Supported routing preferences with support levels
  supportedPreferences: {
    // Range preferences (0-1 float, displayed as 5-stop slider or boolean toggle)
    highways?: PreferenceSupportLevel      // driving: use_highways
    tolls?: PreferenceSupportLevel         // driving: use_tolls
    ferries?: PreferenceSupportLevel       // all modes: use_ferry
    hills?: PreferenceSupportLevel         // walking/cycling: use_hills
    surfaceQuality?: PreferenceSupportLevel // cycling: avoid_bad_surfaces
    litPaths?: PreferenceSupportLevel      // walking: use_lit
    safetyVsSpeed?: PreferenceSupportLevel // cycling: use_roads

    // Boolean preferences
    shortest?: PreferenceSupportLevel
    preferHOV?: PreferenceSupportLevel
    wheelchairAccessible?: PreferenceSupportLevel

    // Numeric/enum preferences
    cyclingSpeed?: PreferenceSupportLevel
    walkingSpeed?: PreferenceSupportLevel
    bicycleType?: PreferenceSupportLevel

    // Transit
    maxWalkDistance?: PreferenceSupportLevel
    maxTransfers?: PreferenceSupportLevel
  }

  // Supported travel modes
  supportedModes: string[]

  // Route optimization types supported
  supportedOptimizations?: string[]

  // Additional features
  features?: {
    alternatives?: boolean
    traffic?: boolean
    elevation?: boolean
    instructions?: boolean
    matrix?: boolean
    transit?: boolean
  }

  // Limits
  limits?: {
    maxWaypoints?: number
    maxAlternatives?: number
  }
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface SearchCategoryCapability {
  searchByCategory(
    presetId: string,
    bounds: MapBounds,
    options?: {
      limit?: number
      /** Extra OSM tag key/value pairs to filter results beyond the primary category. */
      filterTags?: Record<string, string>
      sort?: 'relevance' | 'distance' | 'name'
      filter?: SearchFilter
    },
  ): Promise<Place[]>
}

/** One brand from the brand catalog (aggregated across all its OSM locations). */
export interface BrandSummary {
  /** brand:wikidata QID (e.g. "Q38076") or "name:<lower>" when no QID. */
  brandKey: string
  name: string
  wikidata: string | null
  locationCount: number
  category: string | null
  repLat: number | null
  repLng: number | null
  /** Brand logo (Wikidata P154 via Commons) — resolved in the catalog. */
  logoUrl?: string | null
  /** Short brand description (Wikidata) — resolved in the catalog. */
  description?: string | null
}

export interface BrandCatalogCapability {
  /** Autocomplete over the brand catalog by name. */
  getBrands(q: string, limit?: number): Promise<BrandSummary[]>
  /** Fetch one brand by its brand_key. */
  getBrand(brandKey: string): Promise<BrandSummary | null>
  /**
   * List locations of a brand. Scopes to the given viewport first, and — when
   * the result is sparse (fewer than `minResults`) — widens to the nearest
   * locations globally so a brand is never shown as empty.
   */
  searchByBrand(
    filter: { wikidata?: string; name?: string },
    options?: {
      lat?: number
      lng?: number
      bounds?: MapBounds
      minResults?: number
      limit?: number
    },
  ): Promise<Place[]>
}

// TODO: Return types
export interface ImageryCapability {
  getImagery(lat: number, lng: number, options?: any): Promise<any[]>
}

export interface MapEngineCapability {} // No methods needed for now

export interface TransitDataCapability {
  getDepartures(onestopId: string, options?: {
    next?: number // seconds
    startTime?: string
    endTime?: string
    limit?: number
  }): Promise<TransitDeparture[]>

  // TODO: Implement these endpoints
  // getStops(options?: any): Promise<any[]>
  // getRoutes(options?: any): Promise<any[]>
  // getAgencies(options?: any): Promise<any[]>
  // getTrips(options?: any): Promise<any[]>
}

/**
 * Transit routing capability — stop-to-stop transit routing via MOTIS.
 *
 * Separate from ROUTING (street routing via GraphHopper) because transit
 * routing uses a fundamentally different engine and data model (GTFS +
 * RAPTOR algorithm vs OSM graph + contraction hierarchies).
 */
export interface StationEntrance {
  osmId: string
  name: string | null
  description: string | null
  wheelchair: string | null
  level: string | null
  /** Access point type: subway_entrance, train_station_entrance, railway_crossing, highway_crossing */
  accessType: string
  lat: number
  lon: number
  distanceM: number
}

export interface TransitRoutingCapability {
  getTransitRoute(request: TransitRouteRequest): Promise<TransitRouteResponse>
  getIntermodalRoute?(request: IntermodalRouteRequest): Promise<TransitRouteResponse>
  getNearbyStops(request: NearbyStopsRequest): Promise<NearbyStopResult[]>
  getRoutesForStop(feedId: string, stopId: string): Promise<StopRouteResult[]>
  getNearestEntrance?(lat: number, lon: number, maxDistanceM?: number, wheelchair?: boolean): Promise<StationEntrance | null>
}

export interface TransitRouteRequest {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  /** ISO 8601 datetime */
  time?: string
  /** If true, time is the desired arrival time */
  arriveBy?: boolean
  numItineraries?: number
  searchWindow?: number
  transitModes?: string[]
  maxWalkDistance?: number
  maxTransfers?: number
  wheelchair?: boolean
}

export interface IntermodalRouteRequest extends TransitRouteRequest {
  /** Modes for first mile (coordinate → first transit stop). Default: ['WALK'] */
  preTransitModes?: string[]
  /** Modes for last mile (last transit stop → coordinate). Default: ['WALK'] */
  postTransitModes?: string[]
  /** Direct (non-transit) modes to also compute. Default: ['WALK'] */
  directModes?: string[]
  /** Max duration (s) for direct (non-transit) connections. Barrelman
   *  defaults to 3600 when directModes is set (MOTIS's 1800 is too tight). */
  maxDirectTime?: number
  /** Max first-mile time in seconds (default 900) */
  maxPreTransitTime?: number
  /** Max last-mile time in seconds (default 900) */
  maxPostTransitTime?: number
  /** Filter rental vehicles to specific form factors (BICYCLE, SCOOTER_STANDING, etc.) */
  preTransitRentalFormFactors?: string[]
  postTransitRentalFormFactors?: string[]
  /** Minutes reserved per interchange (transfer penalty). Barrelman defaults to 3. */
  additionalTransferTime?: number
}

export interface TransitRouteResponse {
  itineraries: TransitItinerary[]
  metadata?: {
    searchWindow: number
    nextPageCursor?: string
    prevPageCursor?: string
  }
}

export interface TransitItinerary {
  duration: number
  startTime: string
  endTime: string
  walkTime: number
  transitTime: number
  waitingTime: number
  walkDistance: number
  transfers: number
  legs: TransitLeg[]
  /** Total fare from GTFS fare data (via MOTIS). Undefined if no fare data available. */
  fare?: {
    currency: string
    amount: number
  }
}

export interface TransitLeg {
  mode: string
  from: TransitLegPlace
  to: TransitLegPlace
  startTime: string
  endTime: string
  duration: number
  distance: number
  geometry?: { type: 'LineString'; coordinates: [number, number][] }
  transitLeg: boolean
  routeShortName?: string
  routeLongName?: string
  routeColor?: string
  routeTextColor?: string
  agencyName?: string
  agencyId?: string
  tripId?: string
  headsign?: string
  routeId?: string
  intermediateStops?: TransitLegPlace[]
  realTime?: boolean
  departureDelay?: number
  arrivalDelay?: number
  rentalProvider?: string
  rentalStationName?: string
  rentalFormFactor?: string
  rentalStationId?: string
  rentalSystemId?: string
  /** Estimated fare from the operator's GBFS pricing feed, when published. */
  rentalPricing?: {
    currency: string
    unlockPrice: number
    perMinuteRate: number
    perKmRate: number
    planName?: string
    estimatedCost: number
  }
}

export interface TransitLegPlace {
  name: string
  lat: number
  lng: number
  stopId?: string
  arrival?: string
  departure?: string
  platformCode?: string
}

export interface NearbyStopsRequest {
  lat: number
  lng: number
  radius?: number
  limit?: number
}

export interface NearbyStopResult {
  stopId: string
  feedId: string
  stopName: string
  stopCode: string | null
  lat: number
  lng: number
  distance: number
  locationType: number
  parentStation: string | null
  wheelchairBoarding: number
  platformCode: string | null
}

export interface StopRouteResult {
  routeId: string
  feedId: string
  routeShortName: string | null
  routeLongName: string | null
  routeType: number
  routeColor: string | null
  routeTextColor: string | null
  agencyName: string | null
}

export interface WeatherData {
  locationName?: string // City or location name
  temperature: number // in Celsius
  temperatureFeelsLike: number // in Celsius
  temperatureMin?: number // in Celsius
  temperatureMax?: number // in Celsius
  humidity?: number // percentage
  pressure?: number // hPa
  windSpeed?: number // m/s
  windDirection?: number // degrees
  cloudiness?: number // percentage
  visibility?: number // meters
  condition: string // e.g., "Clear", "Clouds", "Rain", etc.
  conditionDescription: string // e.g., "clear sky", "light rain"
  conditionIcon: string // weather icon code
  airQuality?: AirQuality // Air quality computed with the location's regional standard
  aqiComponents?: {
    co?: number // Carbon monoxide (μg/m³)
    no?: number // Nitrogen monoxide (μg/m³)
    no2?: number // Nitrogen dioxide (μg/m³)
    o3?: number // Ozone (μg/m³)
    so2?: number // Sulphur dioxide (μg/m³)
    pm2_5?: number // Fine particulate matter (μg/m³)
    pm10?: number // Coarse particulate matter (μg/m³)
    nh3?: number // Ammonia (μg/m³)
  }
  timestamp: string // ISO 8601 timestamp
  sunrise?: string // ISO 8601 timestamp
  sunset?: string // ISO 8601 timestamp
}

/** Regional air-quality standards supported by the AQI engine. */
export type AqiStandard =
  | 'us_epa' // United States EPA AQI (0–500), updated May 2024
  | 'eu_eea' // European Environment Agency European Air Quality Index (1–6 bands)
  | 'uk_daqi' // UK Daily Air Quality Index (1–10)
  | 'in_naqi' // India National Air Quality Index (0–500)
  | 'cn_mee' // China MEE / GB 3095-2012 AQI (0–500)
  | 'ca_aqhi' // Canada Air Quality Health Index (1–10+)

/** Pollutants that can drive a regional index. */
export type AqiPollutant = 'pm2_5' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co'

export interface AirQuality {
  standard: AqiStandard // Which regional standard was applied (chosen from the location's country)
  index: number // The standard's own index value (US/CN/IN: 0–500, UK/CA: 1–10+, EU: 1–6 band)
  severity: number // Normalized 1–6 severity; drives the color scale and the friendly word
  dominant: AqiPollutant // The pollutant with the highest sub-index
  source?: 'openaq' | 'model' // Ground sensor (OpenAQ) vs modeled (OpenWeatherMap/CAMS)
  stationName?: string // Name of the OpenAQ station, when source === 'openaq'
}

export interface WeatherCapability {
  getWeather(lat: number, lng: number, lang?: string): Promise<WeatherData>
}

/** Logging / observability (e.g. OTLP export to Axiom). No methods; config-only. */
export interface LoggingCapability {}

export interface SpatialParentsCapability {
  getContainingAreas(lat: number, lng: number): Promise<Place[]>
}

export interface SpatialChildrenCapability {
  getChildren(areaId: string, categories?: string[], limit?: number): Promise<Place[]>
}

export interface SearchAlongRouteCapability {
  searchAlongRoute(
    route: { type: 'LineString'; coordinates: number[][] },
    options?: {
      query?: string
      buffer?: number
      categories?: string[]
      tags?: Record<string, string>
      limit?: number
      semantic?: boolean
      autocomplete?: boolean
    },
  ): Promise<Place[]>
}

export interface OsmNote {
  id: number
  lat: number
  lng: number
  status: 'open' | 'closed'
  comments: OsmNoteComment[]
  createdAt: string
  closedAt?: string
}

export interface OsmNoteComment {
  date: string
  uid?: number
  user?: string
  action: 'opened' | 'commented' | 'closed' | 'reopened'
  text: string
}

export interface OsmMapEditCapability {
  createNote(lat: number, lng: number, text: string): Promise<OsmNote>
  getNote(id: number): Promise<OsmNote>
  commentOnNote(id: number, text: string): Promise<OsmNote>
  closeNote(id: number, text?: string): Promise<OsmNote>
  createChangeset(tags: Record<string, string>): Promise<number>
  uploadChange(changesetId: number, osmChange: string): Promise<void>
  closeChangeset(changesetId: number): Promise<void>
}

/**
 * Per-request credentials forwarded to capabilities backed by
 * `scheme: 'user-e2ee'` integrations.
 *
 * Unlike server-key capabilities — which read cleartext config from the
 * cached integration instance — user-e2ee capabilities have no server-side
 * cleartext to read. The client decrypts its config locally and forwards
 * `endpoint` + `token` per request via headers; the server uses them only
 * for the duration of a single upstream call and never persists or logs them.
 */
export interface IntegrationCredentials {
  endpoint: string
  token: string
}

export interface LocationHistoryCapability {
  getLocationHistory(
    credentials: IntegrationCredentials,
    request: LocationHistoryRequest,
  ): Promise<LocationHistory>
  /**
   * Aggregate visit history at a coordinate — backs the "You've been here
   * N times" widget on the place-detail page. Resolves by proximity since
   * OSM IDs aren't queryable on Dawarich.
   */
  getPlaceVisitHistory(
    credentials: IntegrationCredentials,
    request: PlaceVisitHistoryRequest,
  ): Promise<PlaceVisitHistory>
}

// Integration capabilities container
// ── Rideshare estimation ─────────────────────────────────────────────

export interface RideshareEstimateRequest {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  /** ISO 8601 departure time. Null = now. */
  departureTime?: string
}

export interface RideshareProduct {
  /** Provider-specific product ID (e.g. "uberX", "lyft_standard") */
  productId: string
  /** Human-readable name (e.g. "UberX", "Lyft XL") */
  displayName: string
  /** Estimated price range */
  estimatedPrice: {
    low: { value: number; currency: string }
    high: { value: number; currency: string }
    surgeMultiplier?: number
  }
  /** ETA for nearest driver in seconds */
  estimatedPickupTime: number
  /** Estimated trip duration in seconds */
  estimatedDuration: number
  /** Estimated trip distance in meters */
  estimatedDistance: number
  /** Deep link to open the provider's app with this trip pre-filled */
  bookingUrl: string
  /** Maximum passenger capacity */
  capacity?: number
}

export interface RideshareEstimateResponse {
  provider: string
  products: RideshareProduct[]
  /** When this estimate expires (ISO 8601). */
  expiresAt: string
}

export interface RideshareEstimateCapability {
  getRideshareEstimates(
    request: RideshareEstimateRequest,
  ): Promise<RideshareEstimateResponse>
}

// ── Capability container ─────────────────────────────────────────────

export interface IntegrationCapabilities {
  search?: SearchCapability
  searchCategory?: SearchCategoryCapability
  brandCatalog?: BrandCatalogCapability
  autocomplete?: AutocompleteCapability
  placeInfo?: PlaceInfoCapability
  geocoding?: GeocodingCapability
  routing?: RoutingCapability
  imagery?: ImageryCapability
  mapEngine?: MapEngineCapability
  transitData?: TransitDataCapability
  weather?: WeatherCapability
  logging?: LoggingCapability
  spatialParents?: SpatialParentsCapability
  spatialChildren?: SpatialChildrenCapability
  searchAlongRoute?: SearchAlongRouteCapability
  osmMapEdit?: OsmMapEditCapability
  locationHistory?: LocationHistoryCapability
  transitRouting?: TransitRoutingCapability
  rideshareEstimate?: RideshareEstimateCapability
}

/**
 * Base interface that all integrations must implement
 */
export interface Integration<Config extends Record<string, any>> {
  /**
   * The integration ID that this integration implements
   */
  readonly integrationId: IntegrationId

  /**
   * The capability IDs this integration provides
   */
  readonly capabilityIds: IntegrationCapabilityId[]

  /**
   * The capability implementations this integration provides
   */
  readonly capabilities: IntegrationCapabilities

  /**
   * The data sources this integration can access
   */
  readonly sources?: Source[]

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  testConnection(config: Config): Promise<IntegrationTestResult>

  /**
   * Initializes the integration with the given configuration
   * @param config The configuration to use
   */
  initialize(config: Config): void

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: Config): boolean
}

export type IntegrationCapability = {
  id: IntegrationCapabilityId
  active: boolean
}

// Integration definition that will be used for available integrations
export type IntegrationDefinition = {
  id: IntegrationId
  name: string
  description: string
  color: string
  capabilities: IntegrationCapabilityId[]
  paid: boolean
  cloud: boolean
  configSchema: string // Reference to schema name used on the client
  publicFields?: string[] // Config field names safe to expose to all users (including unauthenticated)
  resolvePublicConfig?: (config: Record<string, any>) => Record<string, any> // Optional override to compute public config from raw config
  scope: IntegrationScope[] // Defines where this integration can be configured
  supportedSchemes?: IntegrationScheme[] // Which config-encryption schemes this integration accepts. Defaults to ['server-key'] for all existing integrations.
  authType?: 'form' | 'oauth2' // Defaults to 'form'. OAuth2 integrations use redirect-based auth instead of config forms.
  requiresSystemIntegration?: IntegrationId // This integration is only available when the referenced system integration is configured
}

export enum IntegrationScope {
  SYSTEM = 'system',
  USER = 'user',
}

export type IntegrationTestResult = {
  success: boolean
  message?: string
}

export interface IntegrationConfig {
  [key: string]: any
}
