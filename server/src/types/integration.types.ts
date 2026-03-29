import { Place, TransitDeparture } from './place.types'
import { Source } from '../lib/constants'
import { IntegrationId, IntegrationCapabilityId } from './integration.enums'
import type { IntegrationRecord } from '../schema/integrations.schema'
import {
  RouteRequest,
  MatrixRequest,
  MatrixResponse,
  UnifiedRoute,
} from './unified-routing.types'

export { IntegrationId, IntegrationCapabilityId, IntegrationRecord }

// Capability interfaces

export interface SearchCapability {
  searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
      language?: import('../lib/i18n').Language
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

// Metadata describing routing engine capabilities
export interface RoutingCapabilityMetadata {
  // Supported routing preferences
  supportedPreferences: {
    avoidHighways?: boolean
    avoidTolls?: boolean
    avoidFerries?: boolean
    avoidUnpaved?: boolean
    avoidHills?: boolean
    preferHOV?: boolean
    preferLitPaths?: boolean
    preferPavedPaths?: boolean
    safetyVsEfficiency?: boolean
    maxWalkDistance?: boolean
    maxTransfers?: boolean
    wheelchairAccessible?: boolean
  }
  
  // Supported travel modes
  supportedModes: string[] // e.g., ['driving', 'walking', 'cycling', 'transit']
  
  // Route optimization types supported
  supportedOptimizations?: string[] // e.g., ['time', 'distance', 'balanced']
  
  // Additional features
  features?: {
    alternatives?: boolean // Can provide alternative routes
    traffic?: boolean // Supports traffic data
    elevation?: boolean // Provides elevation data
    instructions?: boolean // Provides turn-by-turn instructions
    matrix?: boolean // Supports distance/time matrix
    transit?: boolean // Supports transit routing
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
  aqi?: number // Air Quality Index (1-5 scale, 1=Good, 5=Very Poor)
  aqiComponents?: {
    co?: number // Carbon monoxide
    no?: number // Nitrogen monoxide
    no2?: number // Nitrogen dioxide
    o3?: number // Ozone
    so2?: number // Sulphur dioxide
    pm2_5?: number // Fine particulate matter
    pm10?: number // Coarse particulate matter
    nh3?: number // Ammonia
  }
  timestamp: string // ISO 8601 timestamp
  sunrise?: string // ISO 8601 timestamp
  sunset?: string // ISO 8601 timestamp
}

export interface WeatherCapability {
  getWeather(lat: number, lng: number, lang?: string): Promise<WeatherData>
}

/** Logging / observability (e.g. OTLP export to Axiom). No methods; config-only. */
export interface LoggingCapability {}

export interface SpatialContainsCapability {
  getContainingAreas(lat: number, lng: number): Promise<Place[]>
}

export interface SpatialChildrenCapability {
  getChildren(areaId: string, categories?: string[], limit?: number): Promise<Place[]>
}

// Integration capabilities container
export interface IntegrationCapabilities {
  search?: SearchCapability
  searchCategory?: SearchCategoryCapability
  autocomplete?: AutocompleteCapability
  placeInfo?: PlaceInfoCapability
  geocoding?: GeocodingCapability
  routing?: RoutingCapability
  imagery?: ImageryCapability
  mapEngine?: MapEngineCapability
  transitData?: TransitDataCapability
  weather?: WeatherCapability
  logging?: LoggingCapability
  spatialContains?: SpatialContainsCapability
  spatialChildren?: SpatialChildrenCapability
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
  public?: boolean // Mark the integration as public/client-facing, keys will be exposed to all users
  scope: IntegrationScope[] // Defines where this integration can be configured
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
