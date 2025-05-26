import axios from 'axios'
import {
  IntegrationDefinition,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { BaseIntegration } from './base-integration'
import { Place, PlaceGeometry, OpeningHours } from '../../types/place.types'
import { SOURCE } from '../../lib/constants'

/**
 * Nominatim integration
 */
export class NominatimIntegration extends BaseIntegration {
  readonly integrationId = IntegrationId.NOMINATIM
  readonly capabilities = [
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.AUTOCOMPLETE,
  ]
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
  override initialize(config: IntegrationConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Host is required')
    }

    this.config = {
      host: config.host,
      email: config.email,
    }

    super.initialize(config)
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
      format: 'json',
      limit: 10,
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
    radius?: number,
  ): Promise<any[]> {
    this.ensureInitialized()

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

  /**
   * Create a unified place object from Nominatim place data
   * @param nominatimPlace Nominatim place data
   * @param placeId Place ID string
   * @returns Place object
   */
  createUnifiedPlace(nominatimPlace: any, placeId: string): Place {
    if (!nominatimPlace) {
      throw new Error('Nominatim place data is null or undefined')
    }

    // Extract the ID (clean it if it has a prefix)
    let id = placeId
    if (!id.includes('/')) {
      // If no OSM type is included, we need to use the osm_type and osm_id
      if (nominatimPlace.osm_type && nominatimPlace.osm_id) {
        const osmType = nominatimPlace.osm_type.toLowerCase()
        id = `${osmType}/${nominatimPlace.osm_id}`
      }
    }

    // Create external IDs object
    const externalIds: Record<string, string> = {
      nominatim: id,
    }

    // Add OSM ID if available
    if (nominatimPlace.osm_type && nominatimPlace.osm_id) {
      const osmType = nominatimPlace.osm_type.toLowerCase()
      externalIds[SOURCE.OSM] = `${osmType}/${nominatimPlace.osm_id}`
    }

    // Extract place name - try different possible fields
    const name =
      nominatimPlace.namedetails?.name ||
      nominatimPlace.name ||
      nominatimPlace.display_name ||
      'Unknown place'

    // Determine place type
    let placeType = 'unknown'
    if (nominatimPlace.type && nominatimPlace.category) {
      placeType = `${nominatimPlace.category}/${nominatimPlace.type}`
    } else if (nominatimPlace.type) {
      placeType = nominatimPlace.type
    } else if (nominatimPlace.category) {
      placeType = nominatimPlace.category
    }

    // Create geometry object
    const geometry: PlaceGeometry = {
      type: 'point' as const,
      center: {
        lat: parseFloat(nominatimPlace.lat) || 0,
        lng: parseFloat(nominatimPlace.lon) || 0,
      },
    }

    // Create address object
    const address = nominatimPlace.address
      ? {
          formatted: nominatimPlace.display_name || null,
          street:
            nominatimPlace.address.road ||
            nominatimPlace.address.street ||
            null,
          houseNumber: nominatimPlace.address.house_number || null,
          neighborhood:
            nominatimPlace.address.neighbourhood ||
            nominatimPlace.address.suburb ||
            null,
          locality:
            nominatimPlace.address.city ||
            nominatimPlace.address.town ||
            nominatimPlace.address.village ||
            nominatimPlace.address.hamlet ||
            null,
          region:
            nominatimPlace.address.state ||
            nominatimPlace.address.county ||
            null,
          postalCode: nominatimPlace.address.postcode || null,
          country: nominatimPlace.address.country || null,
          countryCode: nominatimPlace.address.country_code
            ? nominatimPlace.address.country_code.toUpperCase()
            : null,
        }
      : null

    // Get website and phone from extratags
    const website =
      nominatimPlace.extratags?.website ||
      nominatimPlace.extratags?.['contact:website'] ||
      null

    const phone =
      nominatimPlace.extratags?.phone ||
      nominatimPlace.extratags?.['contact:phone'] ||
      null

    // Create contact info object
    const contactInfo = {
      phone: phone,
      email: nominatimPlace.extratags?.['contact:email'] || null,
      website: website,
      socials: {},
    }

    // Extract opening hours if available
    let openingHours: OpeningHours | null = null
    if (nominatimPlace.extratags?.opening_hours) {
      openingHours = {
        regularHours: [],
        isOpen24_7: nominatimPlace.extratags.opening_hours.includes('24/7'),
        isPermanentlyClosed: false,
        isTemporarilyClosed: false,
        holidayHours: {},
        rawText: nominatimPlace.extratags.opening_hours,
      }
    }

    // Extract amenities from extratags
    const amenities: Record<string, boolean> = {}
    if (nominatimPlace.extratags) {
      const amenityFlags = [
        'wheelchair',
        'toilets',
        'internet_access',
        'outdoor_seating',
        'smoking',
        'takeaway',
        'delivery',
        'drive_through',
        'reservation',
      ]

      for (const flag of amenityFlags) {
        if (nominatimPlace.extratags[flag]) {
          // Convert 'yes'/'no' to boolean
          amenities[flag] = nominatimPlace.extratags[flag] === 'yes'
        }
      }
    }

    const unifiedPlace: Place = {
      id,
      externalIds,
      name,
      placeType,
      geometry,
      address,
      contactInfo,
      openingHours,
      amenities,
      photos: [],
      sources: [
        {
          id: this.integrationId,
          name: this.getDisplayName(),
          url: '',
        },
      ],
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }

    return unifiedPlace
  }
}
