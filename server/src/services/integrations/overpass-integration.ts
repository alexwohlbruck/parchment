import axios from 'axios'
import type {
  Integration,
  IntegrationConfig,
  PlaceInfoCapability,
  IntegrationTestResult,
  SearchCapability,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import { OverpassAdapter } from './adapters/overpass-adapter'
import { SOURCE } from '../../lib/constants'
import { calculateOSMCenter } from '../../util/geometry-conversion'

// TODO: Remove overpass integration
// TODO: Overpass is designed for OSM editors to edit the map, not for backend search

export interface OverpassConfig extends IntegrationConfig {
  host: string
}

/**
 * Overpass API integration for OpenStreetMap data
 */
export class OverpassIntegration implements Integration<OverpassConfig> {
  private adapter = new OverpassAdapter()
  private config: OverpassConfig = { host: '' }

  // Integration metadata
  readonly integrationId = IntegrationId.OVERPASS
  readonly sources = [SOURCE.OSM]
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.SEARCH,
    IntegrationCapabilityId.PLACE_INFO,
  ]
  readonly capabilities = {
    search: {
      searchPlaces: this.searchPlaces.bind(this),
    } as SearchCapability,
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
  }

  // Integration interface methods
  async testConnection(config: OverpassConfig): Promise<IntegrationTestResult> {
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

  initialize(config: OverpassConfig): void {
    console.log(
      'Overpass Integration - initialize called with config:',
      JSON.stringify(config, null, 2),
    )
    this.config = config
  }

  validateConfig(config: OverpassConfig): boolean {
    return Boolean(config && config.host)
  }

  /**
   * Get place details by OSM ID
   * @param id The OSM ID in format type/id (e.g., node/123456)
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(id: string): Promise<Place | null> {
    if (!this.config.host) {
      console.error('Overpass integration not properly configured')
      return null
    }

    try {
      console.log(`Getting place details from Overpass for ID: ${id}`)

      // Remove provider prefix if present
      if (id.startsWith('osm/')) {
        id = id.substring(id.indexOf('/') + 1)
      }

      const query = this.buildPlaceQuery(id)

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
      const center = calculateOSMCenter(place)
      if (center) {
        place.center = { lat: center.lat, lon: center.lng }
      }

      // Use the adapter to convert to standardized Place format
      return this.adapter.placeInfo.adaptPlaceDetails(place)
    } catch (error) {
      console.error('Error fetching place from Overpass:', error)
      return null
    }
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
    if (!this.config.host) {
      console.error('Overpass integration not properly configured')
      return []
    }

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
        if (!element.center) {
          const center = calculateOSMCenter(element)
          if (center) {
            element.center = { lat: center.lat, lon: center.lng }
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
   * Execute a raw Overpass query and return the results as Places
   * @param query The raw Overpass QL query string
   * @param maxResults Maximum number of results to return
   * @returns Array of Place objects
   */
  async executeRawQuery(query: string, maxResults: number): Promise<Place[]> {
    if (!this.config.host) {
      throw new Error('Overpass integration host not configured')
    }

    console.log(`Executing Overpass query: ${query.substring(0, 100)}...`)

    try {
      const response = await axios.post(
        this.config.host,
        new URLSearchParams({ data: query }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        },
      )

      if (!response.data?.elements) {
        return []
      }

      const elements = response.data.elements.slice(0, maxResults)
      console.log(`Overpass query returned ${elements.length} elements`)

      const places: Place[] = []

      for (const element of elements) {
        try {
          const center = calculateOSMCenter(element)
          if (center) {
            element.center = { lat: center.lat, lon: center.lng }
          }

          const place = this.adapter.placeInfo.adaptPlaceDetails(element)
          if (place) {
            places.push(place)
          }
        } catch (error) {
          console.error('Error converting Overpass element to Place:', error)
        }
      }

      return places
    } catch (error) {
      console.error('Error executing Overpass query:', error)
      throw new Error(
        `Failed to execute Overpass query: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }
}
