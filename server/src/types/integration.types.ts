import { Place } from './place.types'
import { Source } from '../lib/constants'

export enum IntegrationCapabilityId {
  ROUTING = 'routing',
  GEOCODING = 'geocoding',
  PLACE_INFO = 'placeInfo',
  IMAGERY = 'imagery',
  AUTOCOMPLETE = 'autocomplete',
}

export enum IntegrationId {
  GOOGLE_MAPS = 'google-maps',
  PELIAS = 'pelias',
  OVERPASS = 'overpass',
  GRAPHHOPPER = 'graphhopper',
  YELP = 'yelp',
  OPENTABLE = 'opentable',
  FOURSQUARE = 'foursquare',
  MAPILLARY = 'mapillary',
  NOMINATIM = 'nominatim',
  TRIPADVISOR = 'tripadvisor',
  GEOAPIFY = 'geoapify',
}

// Capability interfaces
export interface AutocompleteCapability {
  getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
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

// TODO: Return types
export interface RoutingCapability {
  getRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    options?: any,
  ): Promise<any>
}

// TODO: Return types
export interface ImageryCapability {
  getImagery(lat: number, lng: number, options?: any): Promise<any[]>
}

// Integration capabilities container
export interface IntegrationCapabilities {
  autocomplete?: AutocompleteCapability
  placeInfo?: PlaceInfoCapability
  geocoding?: GeocodingCapability
  routing?: RoutingCapability
  imagery?: ImageryCapability
}

// Integration interfaces
export interface IntegrationTestResult {
  success: boolean
  message?: string
}

export interface IntegrationConfig {
  [key: string]: any
}

/**
 * Base interface that all integrations must implement
 */
export interface Integration {
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
  readonly sources: Source[]

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  testConnection(config: IntegrationConfig): Promise<IntegrationTestResult>

  /**
   * Initializes the integration with the given configuration
   * @param config The configuration to use
   */
  initialize(config: IntegrationConfig): void

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: IntegrationConfig): boolean

  /**
   * Search for places matching a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of place results
   */
  searchPlaces?(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<any[]>

  /**
   * Get autocomplete suggestions for a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of Place objects
   */
  getAutocomplete?(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<Place[]>

  /**
   * Get place details by provider-specific ID
   * @param id The provider-specific ID of the place
   * @returns Provider-specific place data or null if not found
   */
  getPlaceDetails?(id: string): Promise<any | null>
}

// Integration data types
export type CachedIntegration = {
  userId: string | null
  id: string // db random generated id
  integrationId: IntegrationId // unique readable id for the integration
  integration: Integration
  capabilities: IntegrationCapability[]
  config: IntegrationConfig
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
}

// Response shape for client
export type IntegrationResponse = {
  id: string
  integrationId: IntegrationId
  capabilities: IntegrationCapability[]
  config: Record<string, any>
}

// Request to create a new integration
export type CreateIntegrationRequest = {
  integrationId: IntegrationId
  config: Record<string, any>
}

// Request to update an integration
export type UpdateIntegrationRequest = {
  config?: Record<string, any>
  capabilities?: IntegrationCapability[]
}

// Response for testing an integration
export type TestIntegrationResponse = {
  success: boolean
  message?: string
}

// Request to test an integration
export type TestIntegrationRequest = {
  integrationId: IntegrationId
  config: Record<string, any>
}
