import axios from 'axios'
import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'
import { SOURCE } from '../../lib/constants'

/**
 * Nominatim integration
 */
export class NominatimIntegration implements Integration {
  private initialized = false

  readonly integrationId = IntegrationId.NOMINATIM
  readonly capabilityIds = [
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.AUTOCOMPLETE,
  ]
  readonly capabilities = {
    geocoding: {
      geocode: this.searchPlaces.bind(this),
      reverseGeocode: async (lat: number, lng: number) => {
        // Implement reverse geocoding using Nominatim's reverse endpoint
        const apiUrl = `${
          this.config.host.endsWith('/')
            ? this.config.host.slice(0, -1)
            : this.config.host
        }/reverse`

        const params: Record<string, any> = {
          lat,
          lon: lng,
          format: 'json',
          addressdetails: 1,
          email: this.config.email,
        }

        const response = await axios.get(apiUrl, { params })
        return response.data ? [response.data] : []
      },
    },
    autocomplete: {
      getAutocomplete: this.getAutocomplete.bind(this),
    },
  }
  readonly sources = [SOURCE.OSM]

  protected config: {
    host: string
    email?: string
  } = {
    host: 'https://nominatim.openstreetmap.org',
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: IntegrationConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Host is required')
    }

    this.config = {
      host: config.host,
      email: config.email,
    }

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
  async testConnection(
    config: IntegrationConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: Host is required',
      }
    }

    try {
      // Build the API URL
      const apiUrl = this.buildApiUrl(config)

      // Test a simple search to validate the connection
      const params: Record<string, any> = {
        q: 'test',
        format: 'json',
        limit: 1,
        email: config.email,
      }

      await axios.get(apiUrl, { params })

      return { success: true }
    } catch (error: any) {
      console.error('Error testing Nominatim API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Nominatim API',
      }
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: IntegrationConfig): boolean {
    return Boolean(config && config.host)
  }

  /**
   * Builds the Nominatim API URL from the configuration
   * @param config The configuration to use
   * @returns The complete API URL
   */
  private buildApiUrl(config: IntegrationConfig = this.config): string {
    const host = config.host.endsWith('/')
      ? config.host.slice(0, -1)
      : config.host
    return `${host}/search`
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
    radius?: number,
  ) {
    this.ensureInitialized()

    const apiUrl = this.buildApiUrl()
    const params: Record<string, any> = {
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      limit: '50',
      dedupe: '1',
      'accept-language': 'en', // TODO: i18n
      email: this.config.email,
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      params['viewbox'] = this.createViewbox(lat, lng, radius)
      params['bounded'] = 1
    }

    const response = await axios.get(apiUrl, { params })
    return response.data || []
  }

  /**
   * Creates a viewbox parameter for Nominatim to focus search results in a specific area
   * @param lat Latitude center point
   * @param lng Longitude center point
   * @param radius Optional radius in kilometers (defaults to 10km)
   * @returns Viewbox string in Nominatim format
   */
  private createViewbox(lat: number, lng: number, radius: number = 10): string {
    // Convert radius from km to degrees (approximate)
    const degRadius = radius / 111

    // Calculate bounding box
    const minLng = lng - degRadius
    const maxLng = lng + degRadius
    const minLat = lat - degRadius
    const maxLat = lat + degRadius

    // Format as viewbox parameter (minLon,minLat,maxLon,maxLat)
    return `${minLng},${minLat},${maxLng},${maxLat}`
  }

  /**
   * Get place details by Nominatim ID
   * @param id The place ID
   * @returns Place details or null if not found
   */
  async getPlaceDetails(id: string): Promise<any | null> {
    this.ensureInitialized()

    try {
      console.log(`Getting place details from Nominatim for ID: ${id}`)

      // Remove provider prefix if present
      let osmId = id
      if (id.startsWith('nominatim/')) {
        osmId = id.substring(10)
      }

      // Handle potential prefix like 'node/'
      let osmType: string | null = null
      let osmIdValue: string = osmId

      if (osmId.includes('/')) {
        const parts = osmId.split('/')
        osmType = parts[0]
        osmIdValue = parts[1]
      }

      // Validate OSM type
      if (osmType && !['node', 'way', 'relation'].includes(osmType)) {
        console.error(`Invalid OSM type: ${osmType}`)
        return null
      }

      // Build the query for Nominatim - use reverse lookup if no type is provided
      const apiUrl = `${
        this.config.host.endsWith('/')
          ? this.config.host.slice(0, -1)
          : this.config.host
      }/lookup`

      const params: Record<string, any> = {
        osm_ids: `${osmType?.charAt(0).toUpperCase() || 'N'}${osmIdValue}`,
        format: 'json',
        addressdetails: 1,
        extratags: 1,
        namedetails: 1,
        'accept-language': 'en',
      }

      if (this.config.email) {
        params.email = this.config.email
      }

      console.log(`Calling Nominatim lookup API with params:`, params)

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          'User-Agent': 'Parchment/1.0',
        },
      })

      // Nominatim lookup returns an array
      if (
        !response.data ||
        !Array.isArray(response.data) ||
        response.data.length === 0
      ) {
        console.error('No results found from Nominatim lookup')
        return null
      }

      console.log(
        `Nominatim lookup successful, got ${response.data.length} results`,
      )
      return response.data[0]
    } catch (error) {
      console.error('Error getting place details from Nominatim:', error)
      return null
    }
  }

  /**
   * Get autocomplete suggestions for a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of autocomplete suggestions
   */
  async getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
    },
  ): Promise<any[]> {
    this.ensureInitialized()

    const { radius = 50000 } = options || {}

    const apiUrl = this.buildApiUrl()
    const params: Record<string, any> = {
      q: query,
      format: 'json',
      limit: 10,
      email: this.config.email,
      addressdetails: 1,
      extratags: 1,
      namedetails: 1,
      'accept-language': 'en',
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      params['viewbox'] = this.createViewbox(
        lat,
        lng,
        radius ? radius / 1000 : 10,
      )
      params['bounded'] = 1
    }

    try {
      console.log(`Calling Nominatim autocomplete API with params:`, params)
      const response = await axios.get(apiUrl, {
        params,
        headers: {
          'User-Agent': 'Parchment/1.0',
        },
      })
      console.log(
        `Received ${
          response.data?.length || 0
        } results from Nominatim autocomplete`,
      )
      return response.data || []
    } catch (error) {
      console.error('Error getting Nominatim autocomplete suggestions:', error)
      return []
    }
  }
}
