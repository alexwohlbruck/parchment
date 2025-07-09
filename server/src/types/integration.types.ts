import { Place } from './place.types'
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
}

// TODO: Return types
export interface ImageryCapability {
  getImagery(lat: number, lng: number, options?: any): Promise<any[]>
}

export interface MapEngineCapability {} // No methods needed for now

// Integration capabilities container
export interface IntegrationCapabilities {
  search?: SearchCapability
  autocomplete?: AutocompleteCapability
  placeInfo?: PlaceInfoCapability
  geocoding?: GeocodingCapability
  routing?: RoutingCapability
  imagery?: ImageryCapability
  mapEngine?: MapEngineCapability
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
