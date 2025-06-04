import { Place } from './place.types'
import { Source } from '../lib/constants'

export enum IntegrationCapabilityId {
  SEARCH = 'search',
  AUTOCOMPLETE = 'autocomplete',
  GEOCODING = 'geocoding',
  PLACE_INFO = 'placeInfo',
  ROUTING = 'routing',
  IMAGERY = 'imagery',
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
  search?: SearchCapability
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

// Integration-specific config interfaces
export interface GoogleMapsConfig {
  apiKey: string
}

export interface PeliasConfig {
  host: string
  apiKey?: string
}

export interface NominatimConfig {
  host: string
  email?: string
}

export interface OverpassConfig {
  host: string
}

export interface GraphHopperConfig {
  apiKey: string
  host?: string
}

export interface YelpConfig {
  clientId: string
  clientSecret: string
}

export interface OpenTableConfig {
  apiKey: string
}

export interface FoursquareConfig {
  clientId: string
  clientSecret: string
}

export interface MapillaryConfig {
  apiKey: string
}

export interface TripAdvisorConfig {
  apiKey: string
}

export interface GeoapifyConfig {
  apiKey: string
}

// Union type for all integration configs
export type IntegrationConfig =
  | GoogleMapsConfig
  | PeliasConfig
  | NominatimConfig
  | OverpassConfig
  | GraphHopperConfig
  | YelpConfig
  | OpenTableConfig
  | FoursquareConfig
  | MapillaryConfig
  | TripAdvisorConfig
  | GeoapifyConfig

// Type helper to get config type for specific integration
export type ConfigForIntegration<T extends IntegrationId> =
  T extends IntegrationId.GOOGLE_MAPS
    ? GoogleMapsConfig
    : T extends IntegrationId.PELIAS
    ? PeliasConfig
    : T extends IntegrationId.NOMINATIM
    ? NominatimConfig
    : T extends IntegrationId.OVERPASS
    ? OverpassConfig
    : T extends IntegrationId.GRAPHHOPPER
    ? GraphHopperConfig
    : T extends IntegrationId.YELP
    ? YelpConfig
    : T extends IntegrationId.OPENTABLE
    ? OpenTableConfig
    : T extends IntegrationId.FOURSQUARE
    ? FoursquareConfig
    : T extends IntegrationId.MAPILLARY
    ? MapillaryConfig
    : T extends IntegrationId.TRIPADVISOR
    ? TripAdvisorConfig
    : T extends IntegrationId.GEOAPIFY
    ? GeoapifyConfig
    : never

/**
 * Base interface that all integrations must implement
 */
export interface Integration<
  TConfig extends IntegrationConfig = IntegrationConfig,
> {
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
  testConnection(config: TConfig): Promise<IntegrationTestResult>

  /**
   * Initializes the integration with the given configuration
   * @param config The configuration to use
   */
  initialize(config: TConfig): void

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: TConfig): boolean
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
  config: IntegrationConfig
}

// Request to create a new integration
export type CreateIntegrationRequest = {
  integrationId: IntegrationId
  config: IntegrationConfig
}

// Request to update an integration
export type UpdateIntegrationRequest = {
  config?: IntegrationConfig
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
  config: IntegrationConfig
}
