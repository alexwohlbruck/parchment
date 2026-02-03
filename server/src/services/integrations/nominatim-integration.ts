import axios from 'axios'
import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  SearchCapability,
  PlaceInfoCapability,
} from '../../types/integration.types'
import { SOURCE } from '../../lib/constants'
import { NominatimAdapter } from './adapters/nominatim-adapter'
import type { Place } from '../../types/place.types'

// Get version from package.json
const packageJson = require('../../../package.json')


// TODO: Rate limit all nominatim requests to 1 request per second


/**
 * Get proper headers for Nominatim requests to comply with usage policy
 */
function getNominatimHeaders(): Record<string, string> {
  const serverOrigin = process.env.SERVER_ORIGIN!
  
  return {
    'User-Agent': `Parchment/${packageJson.version} (https://github.com/alexwohlbruck/parchment)`,
    'Referer': serverOrigin,
  }
}

// TODO: Is email an optional field?
export interface NominatimConfig extends IntegrationConfig {
  host: string
  // email?: string
}

/**
 * Nominatim integration
 */
export class NominatimIntegration implements Integration<NominatimConfig> {
  private initialized = false
  private adapter = new NominatimAdapter()

  readonly integrationId = IntegrationId.NOMINATIM
  readonly capabilityIds = [
    IntegrationCapabilityId.SEARCH,
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.PLACE_INFO,
  ]
  readonly capabilities = {
    search: {
      searchPlaces: this.searchPlaces.bind(this),
    } as SearchCapability,
    geocoding: {
      geocode: this.searchPlaces.bind(this),
      reverseGeocode: this.reverseGeocode.bind(this),
    },
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
  }
  readonly sources = [SOURCE.OSM]

  protected config: NominatimConfig = {
    host: 'https://nominatim.openstreetmap.org',
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: NominatimConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Host is required')
    }

    this.config = {
      host: config.host,
      // email: config.email,
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
    config: NominatimConfig,
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
        // email: config.email,
      }

      await axios.get(apiUrl, { 
        params,
        headers: getNominatimHeaders()
      })

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
  validateConfig(config: NominatimConfig): boolean {
    return Boolean(config && config.host)
  }

  /**
   * Builds the Nominatim API URL from the configuration
   * @param config The configuration to use
   * @returns The complete API URL
   */
  private buildApiUrl(config: NominatimConfig = this.config): string {
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
  ): Promise<Place[]> {
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
      polygon_geojson: '1', // Request polygon geometry in GeoJSON format
      // email: this.config.email,
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      params['viewbox'] = this.createViewbox(lat, lng, radius)
      params['bounded'] = 1
    }

    const response = await axios.get(apiUrl, { 
      params,
      headers: getNominatimHeaders()
    })
    const results = (response.data || []) as any[]

    if (!Array.isArray(results) || results.length === 0) return []

    // Adapt Nominatim search results to unified Place objects
    return results.map((result) =>
      this.adapter.placeInfo.adaptPlaceDetails(result),
    )
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
   * Reverse geocode coordinates to places
   * @param lat Latitude
   * @param lng Longitude
   * @returns Array of places
   */
  private async reverseGeocode(lat: number, lng: number): Promise<Place[]> {
    this.ensureInitialized()

    const apiUrl = `${
      this.config.host.endsWith('/')
        ? this.config.host.slice(0, -1)
        : this.config.host
    }/reverse`

    const params: Record<string, any> = {
      lat,
      lon: lng,
      format: 'jsonv2',
      addressdetails: 1,
      extratags: 1,
      namedetails: 1,
      'accept-language': 'en', // TODO: i18n
      polygon_geojson: 1,
      // email: this.config.email,
    }

    try {
      const response = await axios.get(apiUrl, { 
        params,
        headers: getNominatimHeaders()
      })
      
      if (!response.data) return []
      
      // Adapt the result to Place format
      return [this.adapter.placeInfo.adaptPlaceDetails(response.data)]
    } catch (error) {
      console.error('Error reverse geocoding with Nominatim:', error)
      return []
    }
  }

  /**
   * Get place info by OSM ID using Nominatim lookup API
   * @param id The OSM ID in format type/id (e.g., node/123456) or just the ID
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(id: string): Promise<Place | null> {
    this.ensureInitialized()

    try {
      // Remove provider prefix if present
      let osmId = id
      if (id.startsWith('osm/')) {
        osmId = id.substring(4)
      }

      // Parse OSM type and ID
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

      // Build the lookup API URL
      const apiUrl = `${
        this.config.host.endsWith('/')
          ? this.config.host.slice(0, -1)
          : this.config.host
      }/lookup`

      // Prepare OSM ID for Nominatim (N/W/R prefix + ID)
      const osmIdFormatted = `${osmType?.charAt(0).toUpperCase() || 'N'}${osmIdValue}`

      const params: Record<string, any> = {
        osm_ids: osmIdFormatted,
        format: 'json',
        addressdetails: 1,
        extratags: 1,
        namedetails: 1,
        'accept-language': 'en',
        polygon_geojson: 1, // Request polygon geometry in GeoJSON format
      }

      const response = await axios.get(apiUrl, {
        params,
        headers: getNominatimHeaders(),
      })

      // Nominatim lookup returns an array
      if (
        !response.data ||
        !Array.isArray(response.data) ||
        response.data.length === 0
      ) {
        return null
      }

      // Use the adapter to convert to standardized Place format
      const result = response.data[0]
      return this.adapter.placeInfo.adaptPlaceDetails(result)
    } catch (error) {
      console.error('Error getting place details from Nominatim:', error)
      return null
    }
  }
}
