import axios from 'axios'
import {
  IntegrationDefinition,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { BaseIntegration } from './base-integration'
import { Place, Address } from '../../types/place.types'
import { SOURCE } from '../../lib/constants'
import { PeliasAdapter, PeliasFeature } from './adapters/pelias-adapter'

// TODO: Check all SOURCE.PELIAS and SOURCE.OSM references. Idk what to do with these yet. Pelias can use various sources.

/**
 * Pelias integration
 */
export class PeliasIntegration extends BaseIntegration {
  readonly integrationId = IntegrationId.PELIAS
  readonly capabilities = [
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.AUTOCOMPLETE,
  ]
  readonly sources = [SOURCE.OSM, SOURCE.OPENADDRESSES]

  private adapter: PeliasAdapter

  constructor() {
    super()
    this.adapter = new PeliasAdapter()
  }

  // TODO: Always use adapter for this. Rename to adaptPlace. Apply to all integrations.
  /**
   * Creates a Place from Pelias data
   * @param providerData The Pelias data
   * @param id Optional ID for the place
   * @returns A Place object
   */
  createUnifiedPlace(providerData: any, id?: string): Place {
    // If this is an autocomplete result (already transformed by adaptAutocompletePrediction)
    if (
      providerData &&
      providerData.source === SOURCE.OSM &&
      typeof providerData.geometry?.lat !== 'undefined' &&
      typeof providerData.geometry?.lng !== 'undefined'
    ) {
      // Create address object using the addressDetails if available
      let address: Address | null = null

      // First try to use the structured address details if available
      if (providerData.addressDetails) {
        const details = providerData.addressDetails
        address = {}

        // Use the pre-formatted address if available from the adapter
        if (details.formatted) {
          address.formatted = details.formatted
        }

        if (details.housenumber && details.street) {
          address.street1 = `${details.housenumber} ${details.street}`
        } else if (details.street) {
          address.street1 = details.street
        }

        if (details.neighbourhood) {
          address.neighborhood = details.neighbourhood
        }

        if (details.locality) {
          address.locality = details.locality
        }

        if (details.region) {
          address.region = details.region
        }

        if (details.country) {
          address.country = details.country
        }

        if (details.postalcode) {
          address.postalCode = details.postalcode
        }

        // If there are no address components other than the formatted address,
        // and formatted address is also missing, set address to null
        if (
          Object.keys(address).length === 0 ||
          (Object.keys(address).length === 1 && !address.formatted)
        ) {
          address = null
        }
      }

      // Determine the correct provider ID for the external ID
      // If the ID contains "way/", "node/", or "relation/", it's from OSM
      const isOsmId =
        providerData.id &&
        (providerData.id.includes('way/') ||
          providerData.id.includes('node/') ||
          providerData.id.includes('relation/'))

      const sourceIdForExternalId = isOsmId ? SOURCE.OSM : SOURCE.PELIAS

      // For OSM IDs, use the full ID (e.g., "way/123456")
      // For Pelias IDs, extract just the ID part
      const externalIdValue = isOsmId
        ? providerData.id
        : providerData.id?.split('/')[1] || 'unknown'

      // Create a Place from an autocomplete prediction
      return {
        id: providerData.id || `${SOURCE.PELIAS}/unknown`,
        externalIds: {
          [sourceIdForExternalId]: externalIdValue,
        },
        name: providerData.name || 'Unnamed Place',
        placeType: (providerData.types && providerData.types[0]) || 'unknown',
        geometry: {
          type: 'point',
          center: {
            lat: providerData.geometry.lat,
            lng: providerData.geometry.lng,
          },
        },
        photos: [],
        address,
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
            id: SOURCE.PELIAS,
            name: 'Pelias',
            url: '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    }

    // Otherwise use the normal adapter for full feature data
    return this.adapter.adaptPlace(providerData, id)
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
  validateConfig(config: IntegrationConfig): boolean {
    return Boolean(config && config.host)
  }

  /**
   * Builds the Pelias API URL from the configuration
   * @param config The configuration to use
   * @returns The complete API URL
   */
  private buildApiUrl(config: IntegrationConfig = this.config): string {
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
    radius?: number,
  ) {
    this.ensureInitialized()

    const apiUrl = this.buildApiUrl()
    const params: Record<string, any> = {
      text: query,
      size: 10,
    }

    // Add API key if available
    if (this.config.apiKey) {
      params['api_key'] = this.config.apiKey
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      params['focus.point.lat'] = lat
      params['focus.point.lon'] = lng

      // We can optionally restrict the search radius with boundary.circle
      if (radius) {
        params['boundary.circle.lat'] = lat
        params['boundary.circle.lon'] = lng
        // Radius is already in kilometers for Pelias
        params['boundary.circle.radius'] = radius
      }
    }

    const response = await axios.get(apiUrl, { params })
    const features = response.data.features || []

    // Use the adapter to transform each feature
    return features.map((feature: PeliasFeature) =>
      this.adapter.adaptPlace(feature),
    )
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

    // Use the autocomplete endpoint
    const host = this.config.host.endsWith('/')
      ? this.config.host.slice(0, -1)
      : this.config.host
    const apiUrl = `${host}/v1/autocomplete`

    const params: Record<string, any> = {
      text: query,
      size: 10,
    }

    // Add API key if available
    if (this.config.apiKey) {
      params['api_key'] = this.config.apiKey
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      params['focus.point.lat'] = lat
      params['focus.point.lon'] = lng

      // We can optionally restrict the search radius with boundary.circle
      if (radius) {
        params['boundary.circle.lat'] = lat
        params['boundary.circle.lon'] = lng
        // Convert radius from meters to kilometers for Pelias
        params['boundary.circle.radius'] = radius / 1000
      }
    }

    try {
      console.log(`Calling Pelias autocomplete API with params:`, params)
      const response = await axios.get(apiUrl, { params })

      // Debug the raw response
      console.log(
        `Pelias raw response structure:`,
        Object.keys(response.data).length
          ? Object.keys(response.data)
          : 'Empty response',
      )

      if (response.data.features && response.data.features.length > 0) {
        console.log(
          'First feature sample:',
          JSON.stringify(response.data.features[0], null, 2),
        )
      } else {
        console.log('No features returned from Pelias')
      }

      console.log(
        `Received ${
          response.data.features?.length || 0
        } results from Pelias autocomplete`,
      )

      // Use the adapter to transform each feature
      const transformed = (response.data.features || []).map(
        (feature: PeliasFeature) => {
          const result = this.adapter.adaptAutocompletePrediction(feature)
          console.log('Transformed feature:', JSON.stringify(result, null, 2))
          return result
        },
      )

      return transformed
    } catch (error) {
      console.error('Error getting Pelias autocomplete suggestions:', error)
      return []
    }
  }

  /**
   * Get place details by Pelias ID
   * @param id The place ID
   * @returns Place details or null if not found
   */
  async getPlaceDetails(id: string): Promise<any | null> {
    this.ensureInitialized()

    try {
      console.log(`Getting place details from Pelias for ID: ${id}`)

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

      console.log(`Parsed OSM ID: type=${osmType}, id=${osmIdValue}`)

      // Build the query for Pelias
      const apiUrl = `${this.config.host}/v1/place`

      // Search parameters
      const params: Record<string, any> = {
        ids: `openstreetmap:${osmType}:${osmIdValue}`,
      }

      console.log(`Calling Pelias place API with params:`, params)

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
        console.error('No results found from Pelias')
        return null
      }

      console.log(
        `Pelias lookup successful, got ${response.data.features.length} results`,
      )
      return response.data.features[0]
    } catch (error) {
      console.error('Error getting place details from Pelias:', error)
      return null
    }
  }
}
