import axios from 'axios'
import {
  IntegrationConfig,
  IntegrationDefinition,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  PlaceInfoCapability,
} from '../../types/integration.types'
import { Place, Address } from '../../types/place.types'
import { SOURCE } from '../../lib/constants'
import { PeliasAdapter, PeliasFeature } from './adapters/pelias-adapter'

// TODO: Check all SOURCE.PELIAS and SOURCE.OSM references. Idk what to do with these yet. Pelias can use various sources.

export interface PeliasConfig extends IntegrationConfig {
  host: string
}

/**
 * Pelias integration
 */
export class PeliasIntegration implements Integration<PeliasConfig> {
  private initialized = false
  protected config: PeliasConfig = { host: '' }

  readonly integrationId = IntegrationId.PELIAS
  readonly capabilityIds = [
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.AUTOCOMPLETE,
    // IntegrationCapabilityId.PLACE_INFO, // TODO: Doesn't work yet, may not be possible
  ]
  readonly capabilities = {
    geocoding: {
      geocode: this.searchPlaces.bind(this),
      reverseGeocode: async (
        lat: number,
        lng: number,
        _options?: { language?: string },
      ) => {
        // Implement reverse geocoding using Pelias reverse endpoint
        const url = `${this.config.host}/v1/reverse`
        const params: Record<string, any> = {
          'point.lat': lat,
          'point.lon': lng,
          size: 1,
        }

        const response = await axios.get(url, { params })
        return response.data?.features || []
      },
    },
    autocomplete: {
      getAutocomplete: this.getAutocomplete.bind(this),
    },
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
    cacheTtl: {
      search: { searchPlaces: 4 * 3600 },
      autocomplete: { getAutocomplete: 600 },
    },
  }
  readonly sources = [SOURCE.OSM, SOURCE.OPENADDRESSES]

  private adapter: PeliasAdapter

  constructor() {
    this.adapter = new PeliasAdapter()
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: PeliasConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Host is required')
    }

    this.config = { ...config }
    this.initialized = true
  }

  /**
   * Ensures the integration has been initialized before performing operations
   * @throws Error if the integration has not been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  async testConnection(config: PeliasConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: Host and API Key are required',
      }
    }

    try {
      // Build the API URL
      const apiUrl = this.buildApiUrl(config)

      // Test a simple search to validate the connection
      const params: Record<string, any> = {
        text: 'test',
        size: 1,
      }

      // Add API key if provided
      if (config.apiKey) {
        params['api_key'] = config.apiKey
      }

      await axios.get(apiUrl, { params })

      return { success: true }
    } catch (error: any) {
      console.error('Error testing Pelias API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Pelias API',
      }
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: PeliasConfig): boolean {
    const isValid = !!(config.host && typeof config.host === 'string')
    return isValid
  }

  /**
   * Builds the Pelias API URL from the configuration
   * @param config The configuration to use
   * @returns The complete API URL
   */
  private buildApiUrl(config: PeliasConfig = this.config): string {
    const host = config.host.endsWith('/')
      ? config.host.slice(0, -1)
      : config.host
    return `${host}/v1/search`
  }

  /**
   * Search for places matching a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in kilometers for location bias
   * @returns Array of place results
   */
  async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    options?: { radius?: number; limit?: number; language?: string },
  ) {
    this.ensureInitialized()
    const radius = options?.radius
      ? options.radius / 1000
      : undefined

    const apiUrl = this.buildApiUrl()
    const params: Record<string, any> = {
      text: query,
      size: options?.limit ?? 10,
    }

    // Add API key if available
    if (this.config.apiKey) {
      params['api_key'] = this.config.apiKey
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      params['focus.point.lat'] = lat
      params['focus.point.lon'] = lng

      // We can optionally restrict the search radius with boundary.circle (radius in km)
      if (radius !== undefined) {
        params['boundary.circle.lat'] = lat
        params['boundary.circle.lon'] = lng
        params['boundary.circle.radius'] = radius
      }
    }

    const response = await axios.get(apiUrl, { params })
    const features = response.data.features || []

    // Use the adapter to transform each feature
    return features.map((feature: PeliasFeature) =>
      this.adapter.geocoding.adaptPlaceDetails(feature),
    )
  }

  /**
   * Get autocomplete suggestions for a query
   * @param text The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of Place objects
   */
  async getAutocomplete(
    text: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
    },
  ): Promise<Place[]> {
    this.ensureInitialized()

    if (!text || text.length < 2) {
      return []
    }

    const { radius = 50000 } = options || {}

    try {
      // Build the correct autocomplete URL
      const host = this.config.host.endsWith('/')
        ? this.config.host.slice(0, -1)
        : this.config.host
      const url = new URL(`${host}/v1/autocomplete`)

      url.searchParams.set('text', text)

      if (lat !== undefined && lng !== undefined) {
        url.searchParams.set('focus.point.lat', lat.toString())
        url.searchParams.set('focus.point.lon', lng.toString())

        // Set boundary circle if radius is also provided
        if (radius !== undefined) {
          const radiusKm = radius / 1000
          url.searchParams.set('boundary.circle.lat', lat.toString())
          url.searchParams.set('boundary.circle.lon', lng.toString())
          url.searchParams.set('boundary.circle.radius', radiusKm.toString())
        }
      }

      // Exclude address layer for performance
      url.searchParams.set('layers', 'venue,address')

      const response = await fetch(url.toString())

      if (!response.ok) {
        console.error(
          'Pelias autocomplete error:',
          response.status,
          response.statusText,
        )
        return []
      }

      const data = await response.json()

      if (data.geocoding?.warnings) {
        console.warn('Pelias warnings:', data.geocoding.warnings)
      }

      if (data.geocoding?.errors) {
        console.error('Pelias errors:', data.geocoding.errors)
        return []
      }

      if (!data.features || data.features.length === 0) {
        return []
      }

      const places = data.features.map((feature: any) => {
        const place = this.adapter.autocomplete.adaptPlaceDetails(feature)
        return place
      })

      return places
    } catch (error) {
      console.error('Pelias autocomplete error:', error)
      return []
    }
  }

  /**
   * Get place details by Pelias ID
   * @param id The place ID
   * @param options Optional parameters including language
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(
    id: string,
    _options?: { language?: string },
  ): Promise<Place | null> {
    this.ensureInitialized()

    try {
      // Remove provider prefix if present
      let osmId = id
      if (id.startsWith('pelias/')) {
        osmId = id.substring(7)
      }

      // Handle potential prefix like 'openstreetmap:venue:way/123456'
      if (osmId.includes(':') && osmId.includes('/')) {
        const parts = osmId.split(':')
        // Get the last part which should contain the OSM ID
        osmId = parts[parts.length - 1]
      }

      // Parse the OSM type and ID
      let osmType: string = 'node'
      let osmIdValue: string = osmId

      if (osmId.includes('/')) {
        const parts = osmId.split('/')
        osmType = parts[0]
        osmIdValue = parts[1]
      }

      // Build the query for Pelias
      const apiUrl = `${this.config.host}/v1/place`

      // Search parameters
      const params: Record<string, any> = {
        ids: `openstreetmap:${osmType}:${osmIdValue}`,
      }

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          'User-Agent': 'Parchment/1.0',
        },
      })

      if (
        !response.data ||
        !response.data.features ||
        response.data.features.length === 0
      ) {
        return null
      }

      // Use the adapter to convert the Pelias feature to a standardized Place
      const feature = response.data.features[0] as PeliasFeature
      return this.adapter.placeInfo.adaptPlaceDetails(feature)
    } catch (error) {
      console.error('Error getting place details from Pelias:', error)
      return null
    }
  }
}
