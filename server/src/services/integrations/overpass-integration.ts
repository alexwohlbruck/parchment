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
import {
  UnifiedPlace,
  PlaceGeometry,
  AttributedValue,
} from '../../types/unified-place.types'
import { SOURCE } from '../../lib/constants'
import { getPlaceType } from '../../lib/place.utils'
import { parseOpeningHoursForUnifiedFormat } from '../../lib/place.utils'

/**
 * Overpass API integration for OpenStreetMap data
 */
export class OverpassIntegration extends BaseIntegration {
  readonly integrationId = IntegrationId.OVERPASS
  readonly capabilities = [IntegrationCapabilityId.PLACE_INFO]
  readonly sources = [SOURCE.OSM]

  protected config: {
    host: string
  } = {
    host: 'https://overpass.kumi.systems/api/interpreter',
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
      // Build a simple test query to check if the API is responsive
      const testQuery = `[out:json];node(123456);out;`

      // Test connection by making a request to the Overpass API
      const response = await axios.post(
        config.host,
        new URLSearchParams({ data: testQuery }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      )

      // Check if we got a valid response with 'elements' property
      if (response.data && Array.isArray(response.data.elements)) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Invalid response format from Overpass API',
        }
      }
    } catch (error: any) {
      console.error('Error testing Overpass API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Overpass API',
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
   * Build a query for fetching a place by ID
   * @param id The OSM ID in format type/id (e.g., node/123456)
   * @returns Overpass QL query string
   */
  private buildPlaceQuery(id: string): string {
    const [type, rawId] = id.includes('/') ? id.split('/') : [null, id]
    return `[out:json][timeout:60];
      ${type}(${rawId});
      out body geom meta;
      >;
      out body meta;`
  }

  /**
   * Build a query for searching places by name and location
   * @param query Search query string
   * @param lat Optional latitude for location bias
   * @param lon Optional longitude for location bias
   * @param radius Search radius in meters
   * @returns Overpass QL query string
   */
  private buildSearchQuery(
    query: string,
    lat?: number,
    lon?: number,
    radius: number = 1000,
  ): string {
    // Clean the query by removing special characters and quotes
    const cleanQuery = query.replace(/["']/g, '').trim()

    // If we have coordinates, search within the given radius
    const locationFilter =
      lat && lon ? `around:${radius},${lat},${lon}` : 'global'

    return `[out:json][timeout:90];
      (
        // Search by name
        node["name"~"${cleanQuery}", i](${locationFilter});
        way["name"~"${cleanQuery}", i](${locationFilter});
        relation["name"~"${cleanQuery}", i](${locationFilter});
        
        // Search by brand name
        node["brand:name"~"${cleanQuery}", i](${locationFilter});
        way["brand:name"~"${cleanQuery}", i](${locationFilter});
        relation["brand:name"~"${cleanQuery}", i](${locationFilter});
        
        // Search by operator name
        node["operator"~"${cleanQuery}", i](${locationFilter});
        way["operator"~"${cleanQuery}", i](${locationFilter});
        relation["operator"~"${cleanQuery}", i](${locationFilter});
      );
      out body geom meta;
      >;
      out body meta qt;`
  }

  /**
   * Calculate the center point of a place
   * @param place OSM place object
   * @returns Center coordinates or null if not determinable
   */
  private calculatePlaceCenter(
    place: any,
  ): { lat: number; lon: number } | null {
    // If the API provides a center, use it
    if (place.center) {
      return place.center
    }

    // For nodes, use their coordinates
    if (place.type === 'node' && place.lat && place.lon) {
      return { lat: place.lat, lon: place.lon }
    }

    // For ways and relations with geometry, calculate centroid
    if (place.geometry && place.geometry.length > 0) {
      let sumLat = 0
      let sumLon = 0
      const nodes = place.geometry

      for (const node of nodes) {
        sumLat += node.lat
        sumLon += node.lon
      }

      return {
        lat: sumLat / nodes.length,
        lon: sumLon / nodes.length,
      }
    }

    // For ways and relations with bounds but no geometry, use bounds center
    if (place.bounds) {
      return {
        lat: (place.bounds.minlat + place.bounds.maxlat) / 2,
        lon: (place.bounds.minlon + place.bounds.maxlon) / 2,
      }
    }

    return null
  }

  /**
   * Get place details by OSM ID
   * @param id The OSM ID in format type/id (e.g., node/123456)
   * @returns Place details or null if not found
   */
  async getPlaceDetails(id: string): Promise<any | null> {
    this.ensureInitialized()

    try {
      console.log(`Getting place details from Overpass for ID: ${id}`)

      // Remove provider prefix if present
      let osmId = id
      if (osmId.startsWith('overpass/') || osmId.startsWith('osm/')) {
        osmId = osmId.substring(osmId.indexOf('/') + 1)
      }

      const query = this.buildPlaceQuery(osmId)

      const response = await axios.post(
        this.config.host,
        new URLSearchParams({ data: query }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      )

      if (!response.data.elements || response.data.elements.length === 0) {
        console.error('No place found with ID:', id)
        return null
      }

      // The first element should be our place
      const place = response.data.elements[0]
      const center = this.calculatePlaceCenter(place)
      if (center) {
        place.center = center
      }

      return place
    } catch (error) {
      console.error('Error fetching place from Overpass:', error)
      return null
    }
  }

  /**
   * Search for places matching a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of place results
   */
  async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<any[]> {
    this.ensureInitialized()

    try {
      console.log(`Searching Overpass for "${query}"`)

      const overpassQuery = this.buildSearchQuery(query, lat, lng, radius)

      const response = await axios.post(
        this.config.host,
        new URLSearchParams({ data: overpassQuery }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      )

      if (!response.data.elements) {
        return []
      }

      // Process and return the elements
      const places = response.data.elements.map((element: any) => {
        // Add center if not already present
        if (!element.center) {
          const center = this.calculatePlaceCenter(element)
          if (center) {
            element.center = center
          }
        }
        return element
      })

      return places
    } catch (error) {
      console.error('Error searching places with Overpass:', error)
      return []
    }
  }

  /**
   * Extract address from OSM tags
   * @param tags OSM tags object
   * @returns Formatted address object
   */
  private extractOsmAddress(
    tags: Record<string, string | undefined>,
  ): { value: any; sourceId: string } | null {
    if (!tags) return null

    const street = tags['addr:street']
    const houseNumber = tags['addr:housenumber']
    const city = tags['addr:city']
    const state = tags['addr:state']
    const postcode = tags['addr:postcode']
    const country = tags['addr:country']

    // If we don't have any address components, return null
    if (!street && !city && !postcode && !country) {
      return null
    }

    // Build formatted address string
    const parts = []
    if (street && houseNumber) {
      parts.push(`${houseNumber} ${street}`)
    } else if (street) {
      parts.push(street)
    }

    if (city) {
      parts.push(city)
    }

    if (state && postcode) {
      parts.push(`${state} ${postcode}`)
    } else if (state) {
      parts.push(state)
    } else if (postcode) {
      parts.push(postcode)
    }

    if (country) {
      parts.push(country)
    }

    return {
      value: {
        street1:
          street && houseNumber ? `${houseNumber} ${street}` : street || null,
        street2: null,
        neighborhood: tags['addr:suburb'] || null,
        locality: city || tags['addr:town'] || tags['addr:village'] || null,
        region: state || tags['addr:county'] || null,
        postalCode: postcode || null,
        country: country || null,
        countryCode: tags['addr:country']
          ? tags['addr:country'].toUpperCase()
          : null,
        formatted: parts.join(', '),
      },
      sourceId: SOURCE.OSM,
    }
  }

  /**
   * Extract contact information from OSM tags
   * @param tags OSM tags object
   * @returns Contact information
   */
  private extractContactInfo(tags: Record<string, string | undefined>) {
    const contactInfo: Record<string, AttributedValue<string>> = {}

    // Phone
    if (tags.phone || tags['contact:phone']) {
      contactInfo.phone = {
        value: tags.phone || tags['contact:phone'] || '',
        sourceId: SOURCE.OSM,
      }
    }

    // Email
    if (tags.email || tags['contact:email']) {
      contactInfo.email = {
        value: tags.email || tags['contact:email'] || '',
        sourceId: SOURCE.OSM,
      }
    }

    // Website
    if (tags.website || tags['contact:website'] || tags.url) {
      contactInfo.website = {
        value: tags.website || tags['contact:website'] || tags.url || '',
        sourceId: SOURCE.OSM,
      }
    }

    const socials: Record<string, AttributedValue<string>> = {}

    // Social media
    const socialPlatforms = [
      'facebook',
      'instagram',
      'twitter',
      'linkedin',
      'youtube',
      'tiktok',
    ]

    for (const platform of socialPlatforms) {
      const value = tags[platform] || tags[`contact:${platform}`]
      if (value) {
        socials[platform] = {
          value,
          sourceId: SOURCE.OSM,
        }
      }
    }

    return { contactInfo, socials }
  }

  /**
   * Extract opening hours from OSM tags
   * @param tags OSM tags object
   * @returns Opening hours object
   */
  private extractOpeningHours(tags: Record<string, string | undefined>) {
    if (!tags || !tags.opening_hours) return null

    const openingHours = tags.opening_hours
    const isOpen24_7 = openingHours.includes('24/7')

    return {
      value: {
        regularHours: parseOpeningHoursForUnifiedFormat(openingHours) || [],
        isOpen24_7,
        isPermanentlyClosed: tags.disused === 'yes' || tags.abandoned === 'yes',
        isTemporarilyClosed: tags.opening_hours === 'closed',
        rawText: openingHours,
      },
      sourceId: SOURCE.OSM,
    }
  }

  /**
   * Extract amenities from OSM tags
   * @param tags OSM tags object
   * @returns Amenities object
   */
  private extractAmenities(tags: Record<string, string | undefined>) {
    const amenities: Record<string, AttributedValue<boolean | string>[]> = {}

    // Common amenity flags in OSM
    const amenityFlags = [
      'wheelchair',
      'toilets',
      'wifi',
      'internet_access',
      'outdoor_seating',
      'smoking',
      'takeaway',
      'delivery',
      'drive_through',
      'reservation',
      'air_conditioning',
      'payment:credit_cards',
      'payment:debit_cards',
      'payment:cash',
    ]

    for (const flag of amenityFlags) {
      const value = tags[flag]
      if (value) {
        // Convert 'yes'/'no' to boolean, otherwise keep as string
        const boolValue =
          value === 'yes' ? true : value === 'no' ? false : value
        amenities[flag] = [
          {
            value: boolValue,
            sourceId: SOURCE.OSM,
          },
        ]
      }
    }

    return amenities
  }

  /**
   * Create a unified place object from OSM place data
   * @param osmPlace OSM place data
   * @param id Optional ID string
   * @returns UnifiedPlace object
   */
  createUnifiedPlace(osmPlace: any, id?: string): UnifiedPlace {
    if (!osmPlace) {
      throw new Error('OSM place data is null or undefined')
    }

    // Generate a unique ID if not provided
    const placeId =
      id || `${this.integrationId}/${osmPlace.id || this.generateRandomId()}`

    // Extract the OSM ID
    let osmId = osmPlace.id ? `${osmPlace.type}/${osmPlace.id}` : null

    // Create external IDs object
    const externalIds: Record<string, string> = {}
    if (osmId) {
      externalIds[SOURCE.OSM] = osmId
    }
    externalIds[SOURCE.OVERPASS] = placeId

    // Get place name
    const name =
      osmPlace.tags?.name || osmPlace.tags?.['brand:name'] || 'Unknown place'

    // Determine place type
    const placeType = getPlaceType(osmPlace.tags || {})

    // Create geometry object
    let geometry: PlaceGeometry

    if (osmPlace.center) {
      geometry = {
        type: osmPlace.type === 'node' ? 'point' : 'polygon',
        center: {
          lat: osmPlace.center.lat,
          lng: osmPlace.center.lon,
        },
      }
    } else if (osmPlace.lat && osmPlace.lon) {
      geometry = {
        type: 'point',
        center: {
          lat: osmPlace.lat,
          lng: osmPlace.lon,
        },
      }
    } else {
      // Fallback geometry
      geometry = {
        type: 'point',
        center: {
          lat: 0,
          lng: 0,
        },
      }
    }

    // Add bounds if available
    if (osmPlace.bounds) {
      geometry.bounds = {
        minLat: osmPlace.bounds.minlat,
        minLng: osmPlace.bounds.minlon,
        maxLat: osmPlace.bounds.maxlat,
        maxLng: osmPlace.bounds.maxlon,
      }
    }

    // Add nodes if available (for polygons)
    if (osmPlace.geometry && Array.isArray(osmPlace.geometry)) {
      geometry.nodes = osmPlace.geometry.map((node: any) => ({
        lat: node.lat,
        lng: node.lon,
      }))
    }

    // Extract address
    const address = this.extractOsmAddress(osmPlace.tags || {})

    // Extract contact info
    const { contactInfo, socials } = this.extractContactInfo(
      osmPlace.tags || {},
    )

    // Extract opening hours
    const openingHours = this.extractOpeningHours(osmPlace.tags || {})

    // Extract amenities
    const amenities = this.extractAmenities(osmPlace.tags || {})

    // Create the unified place object
    const unifiedPlace: UnifiedPlace = {
      id: placeId,
      externalIds,
      name,
      placeType,
      geometry,
      photos: [],
      address: address ? address.value : null,
      contactInfo: {
        phone: contactInfo.phone || null,
        email: contactInfo.email || null,
        website: contactInfo.website || null,
        socials: socials || {},
      },
      openingHours: openingHours ? openingHours.value : null,
      amenities: {},
      sources: [
        {
          id: SOURCE.OSM,
          name: 'OpenStreetMap',
          url: `https://www.openstreetmap.org/${osmPlace.type}/${osmPlace.id}`,
          updated: osmPlace.timestamp,
          updatedBy: osmPlace.user,
        },
      ],
      lastUpdated: osmPlace.timestamp || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }

    return unifiedPlace
  }
}
