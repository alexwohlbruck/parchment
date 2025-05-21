import axios from 'axios'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { BaseIntegration } from './base-integration'
import {
  IntegrationConfig,
  IntegrationTestResult,
} from './integration.interface'
import { UnifiedPlace } from '../../types/unified-place.types'
import { getTimestamp } from '../../services/merge.service'

/**
 * Nominatim integration
 */
export class NominatimIntegration extends BaseIntegration {
  readonly integrationId = IntegrationId.NOMINATIM
  readonly capabilities = [
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.AUTOCOMPLETE,
  ]

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
   * Override createUnifiedPlace to properly handle Nominatim response format
   */
  createUnifiedPlace(providerData: any, id?: string): UnifiedPlace {
    try {
      // Ensure required data is present
      if (!providerData || !providerData.osm_id) {
        return super.createUnifiedPlace(providerData, id)
      }

      // Extract location coordinates
      const lat = parseFloat(providerData.lat || 0)
      const lng = parseFloat(providerData.lon || 0)

      // Create a unique ID
      const placeId = id || `${this.integrationId}/${providerData.osm_id}`

      // Get name from namedetails or display_name
      let name = ''
      if (providerData.namedetails && providerData.namedetails.name) {
        name = providerData.namedetails.name
      } else if (providerData.display_name) {
        // Only use the first part of display_name as the name (before the first comma)
        const firstPart = providerData.display_name.split(',')[0]
        name = firstPart.trim()
      } else {
        name = 'Unnamed Place'
      }

      // Create structured address from addressdetails
      const address: {
        street1?: string
        street2?: string
        neighborhood?: string
        locality?: string
        region?: string
        postalCode?: string
        country?: string
        countryCode?: string
        formatted?: string
      } = {}

      // Extract address components from the addressdetails object
      if (providerData.address) {
        const addr = providerData.address

        // Build street1 from house_number and road/street
        if (addr.house_number || addr.road || addr.street) {
          address.street1 = [addr.house_number, addr.road || addr.street]
            .filter(Boolean)
            .join(' ')
        }

        address.neighborhood = addr.neighbourhood || addr.suburb || undefined
        address.locality = addr.city || addr.town || addr.village || undefined
        address.region = addr.state || addr.county || undefined
        address.postalCode = addr.postcode || undefined
        address.country = addr.country || undefined
        address.countryCode = addr.country_code
          ? addr.country_code.toUpperCase()
          : undefined
      }

      // Create a formatted address that doesn't include the place name
      const addressParts = []
      if (address.street1) addressParts.push(address.street1)
      if (address.street2) addressParts.push(address.street2)
      if (address.neighborhood) addressParts.push(address.neighborhood)
      if (address.locality) addressParts.push(address.locality)
      if (address.region) addressParts.push(address.region)
      if (address.postalCode) addressParts.push(address.postalCode)
      if (address.country) addressParts.push(address.country)

      if (addressParts.length > 0) {
        address.formatted = addressParts.join(', ')
      }

      // Create the unified place
      return {
        id: placeId,
        externalIds: { [this.integrationId]: providerData.osm_id.toString() },
        name: name,
        placeType: providerData.type || providerData.class || 'unknown',
        geometry: {
          type: 'point',
          center: { lat, lng },
        },
        photos: [],
        address: Object.keys(address).length > 0 ? address : null,
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        amenities: {},
        sources: [
          {
            id: this.integrationId,
            name: this.getDisplayName(),
            url: '',
          },
        ],
        lastUpdated: getTimestamp(),
        createdAt: getTimestamp(),
      }
    } catch (error) {
      console.error('Error creating unified place from Nominatim data:', error)
      return super.createUnifiedPlace(providerData, id)
    }
  }
}
