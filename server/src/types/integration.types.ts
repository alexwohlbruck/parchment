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
  getPlaceInfo(id: string): Promise<Place | null>
}

// TODO: Return types
export interface GeocodingCapability {
  geocode(query: string, lat?: number, lng?: number): Promise<any[]>
  reverseGeocode(lat: number, lng: number): Promise<any[]>
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
