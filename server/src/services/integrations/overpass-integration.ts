import axios from 'axios'
import type {
  Integration,
  IntegrationConfig,
  PlaceInfoCapability,
  IntegrationTestResult,
  SearchCapability,
  SearchCategoryCapability,
  MapBounds,
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
    IntegrationCapabilityId.SEARCH_CATEGORY,
    IntegrationCapabilityId.PLACE_INFO,
  ]
  readonly capabilities = {
    searchCategory: {
      searchByCategory: this.searchByCategory.bind(this),
    } as SearchCategoryCapability,
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
    cacheTtl: {
      searchCategory: { searchByCategory: 4 * 3600 },
    },
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
   * @param options Optional parameters including language
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(
    id: string,
    _options?: { language?: string },
  ): Promise<Place | null> {
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

  async searchByCategory(
    presetId: string,
    bounds?: MapBounds,
    options?: { limit?: number },
  ): Promise<Place[]> {
    if (!this.config.host) {
      console.error('Overpass integration not properly configured')
      return []
    }

    const tags = this.mapPresetToOsmTags(presetId)
    if (!tags) {
      return []
    }

    try {
      const query = this.buildCategoryQuery(tags, bounds, options?.limit)
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

      const elements = response.data.elements.slice(0, options?.limit || 100)
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
      console.error('Error executing Overpass category query:', error)
      return []
    }
  }

  private mapPresetToOsmTags(presetId: string): Record<string, string> | null {
    // Convert preset ID to OSM tags
    // This will be expanded with proper mapping using OSM tagging schema
    const [key, value] = presetId.split('/')
    if (!key || !value) {
      return null
    }

    return { [key]: value }
  }

  private buildCategoryQuery(
    tags: Record<string, string>,
    bounds: MapBounds,
    maxResults = 100,
  ): string {
    const tagFilters = Object.entries(tags)
      .map(([key, value]) => `["${key}"="${value}"]`)
      .join('')

    let locationFilter = ''

    locationFilter = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east})`

    return `[out:json][timeout:90];
      (
        node${tagFilters}${locationFilter};
        way${tagFilters}${locationFilter};
        relation${tagFilters}${locationFilter};
      );
      out body geom ${maxResults};
      >;
      out body meta qt;`.trim()
  }

  /**
   * Search for POIs matching given preset IDs within an OSM area (way or relation).
   *
   * Strategy (in order of preference):
   * 1. Bounding box query — fast, reliable, no Overpass area pre-computation needed.
   *    Slightly less precise (bbox corners may extend outside the real polygon).
   * 2. Overpass `area()` query — exact polygon containment, but requires the Overpass
   *    server to have pre-computed the area object, and public servers often time out.
   *
   * @param osmId - OSM ID in format "way/123" or "relation/456"
   * @param presetIds - Array of OSM preset IDs like ["amenity/parking", "amenity/cafe"]
   * @param options - Optional limit (default 30) and optional bounding box
   * @returns Array of Place objects found within the area
   */
  async searchByCategoryInArea(
    osmId: string,
    presetIds: string[],
    options?: {
      limit?: number
      bbox?: { south: number; west: number; north: number; east: number }
    },
  ): Promise<Place[]> {
    if (!this.config.host) {
      console.error('Overpass integration not properly configured')
      return []
    }

    // Build tag filter lines for all preset IDs
    const tagSets = presetIds
      .map((pid) => this.mapPresetToOsmTags(pid))
      .filter(Boolean) as Record<string, string>[]

    if (!tagSets.length) return []

    const maxResults = options?.limit || 30

    // Prefer bbox query — much faster and doesn't require Overpass area pre-computation
    if (options?.bbox) {
      return this.searchByCategoryInBbox(tagSets, options.bbox, maxResults, osmId)
    }

    // Fall back to area() query when no bbox available
    const [osmType, rawId] = osmId.split('/')
    const numericId = parseInt(rawId, 10)
    if (!numericId || (osmType !== 'way' && osmType !== 'relation')) {
      console.debug(`🚫 [Overpass/Area] Cannot create area from ${osmId} (only way/relation supported)`)
      return []
    }

    // Convert to Overpass area ID
    // Relations: 3600000000 + id, Ways: 2400000000 + id
    const areaId = osmType === 'relation'
      ? 3600000000 + numericId
      : 2400000000 + numericId

    const unionLines = tagSets.flatMap((tags) => {
      const tagFilters = Object.entries(tags)
        .map(([key, value]) => `["${key}"="${value}"]`)
        .join('')
      return [
        `node${tagFilters}(area.searchArea);`,
        `way${tagFilters}(area.searchArea);`,
      ]
    })

    const query = `[out:json][timeout:60];
      area(id:${areaId})->.searchArea;
      (
        ${unionLines.join('\n        ')}
      );
      out body geom ${maxResults};`.trim()

    try {
      console.debug(`🌐 [Overpass/Area] Searching within area ${osmId} for ${presetIds.length} categories`)
      const response = await axios.post(
        this.config.host,
        new URLSearchParams({ data: query }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        },
      )

      if (!response.data?.elements) return []
      return this.elementsToPlaces(response.data.elements.slice(0, maxResults))
    } catch (error) {
      console.error(`❌ [Overpass/Area] Error executing area query for ${osmId}:`, error)
      return []
    }
  }

  /**
   * Query POIs within a bounding box using a standard Overpass bbox filter.
   * Fast and reliable — preferred over area() queries.
   */
  private async searchByCategoryInBbox(
    tagSets: Record<string, string>[],
    bbox: { south: number; west: number; north: number; east: number },
    maxResults: number,
    osmId: string,
  ): Promise<Place[]> {
    const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`

    const unionLines = tagSets.flatMap((tags) => {
      const tagFilters = Object.entries(tags)
        .map(([key, value]) => `["${key}"="${value}"]`)
        .join('')
      return [
        `node${tagFilters}(${bboxStr});`,
        `way${tagFilters}(${bboxStr});`,
      ]
    })

    const query = `[out:json][timeout:30];
      (
        ${unionLines.join('\n        ')}
      );
      out body geom ${maxResults};`.trim()

    try {
      console.debug(`🌐 [Overpass/Bbox] Searching within bbox of ${osmId} for ${tagSets.length} categories`)
      const response = await axios.post(
        this.config.host,
        new URLSearchParams({ data: query }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        },
      )

      if (!response.data?.elements) return []
      const places = this.elementsToPlaces(response.data.elements.slice(0, maxResults))
      console.debug(`✅ [Overpass/Bbox] Found ${places.length} places within ${osmId}`)
      return places
    } catch (error) {
      console.error(`❌ [Overpass/Bbox] Error executing bbox query for ${osmId}:`, error)
      return []
    }
  }

  /**
   * Find all OSM areas spatially containing a given coordinate using is_in().
   * Returns named, "interesting" containers (parks, campuses, malls, etc.) ordered
   * from smallest (most specific) to largest — ideal for parent/admin strategy.
   *
   * This works purely on spatial containment, so it finds parents even when there
   * is no explicit OSM relation membership (e.g. a playground inside a park way).
   */
  async findContainingAreas(
    lat: number,
    lng: number,
  ): Promise<Array<{ id: string; name: string; placeType: string; tags: Record<string, string> }>> {
    if (!this.config.host) return []

    // is_in returns the smallest areas first (innermost to outermost)
    const query = `[out:json][timeout:30];
      is_in(${lat},${lng})->.a;
      (
        way(pivot.a);
        relation(pivot.a);
      );
      out tags 30;`.trim()

    try {
      const response = await axios.post(
        this.config.host,
        new URLSearchParams({ data: query }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        },
      )

      if (!response.data?.elements) return []

      const INTERESTING_KEYS = new Set(['leisure', 'amenity', 'shop', 'tourism', 'building', 'aeroway'])
      const INTERESTING_LANDUSE = new Set(['commercial', 'retail', 'residential', 'industrial', 'education', 'military', 'religious'])

      return (response.data.elements as any[])
        .filter((el) => {
          const tags: Record<string, string> = el.tags || {}
          if (!tags.name) return false // must be named to be useful
          // Skip pure admin boundaries
          if (tags.boundary === 'administrative' || tags.admin_level) return false
          const hasInterestingKey = Object.keys(tags).some((k) => INTERESTING_KEYS.has(k as any) && tags[k])
          const isInterestingLanduse = !!(tags.landuse && INTERESTING_LANDUSE.has(tags.landuse))
          return hasInterestingKey || isInterestingLanduse
        })
        .map((el) => {
          const tags: Record<string, string> = el.tags || {}
          const placeType = this.deriveContainerType(tags)
          return {
            id: `${el.type}/${el.id}`,
            name: tags.name,
            placeType,
            tags,
          }
        })
    } catch (error) {
      console.error('❌ [Overpass/IsIn] Error fetching containing areas:', error)
      return []
    }
  }

  /** Derive a human-readable place type label from OSM tags. */
  private deriveContainerType(tags: Record<string, string>): string {
    // Aeroway / aviation
    if (tags.aeroway === 'aerodrome') return 'Airport'
    if (tags.aeroway === 'terminal') return 'Airport Terminal'
    if (tags.aeroway === 'concourse') return 'Concourse'
    if (tags.aeroway === 'hangar') return 'Hangar'
    // Leisure
    if (tags.leisure === 'park') return 'Park'
    if (tags.leisure === 'nature_reserve') return 'Nature Reserve'
    if (tags.leisure === 'sports_centre') return 'Sports Centre'
    if (tags.leisure === 'stadium') return 'Stadium'
    if (tags.leisure === 'golf_course') return 'Golf Course'
    if (tags.leisure === 'marina') return 'Marina'
    // Amenity
    if (tags.amenity === 'university') return 'University'
    if (tags.amenity === 'college') return 'College'
    if (tags.amenity === 'school') return 'School'
    if (tags.amenity === 'hospital') return 'Hospital'
    if (tags.amenity === 'marketplace') return 'Marketplace'
    if (tags.amenity === 'theatre') return 'Theatre'
    if (tags.amenity === 'cinema') return 'Cinema'
    // Shop
    if (tags.shop === 'mall') return 'Shopping Mall'
    if (tags.shop === 'supermarket') return 'Supermarket'
    // Tourism
    if (tags.tourism === 'theme_park') return 'Theme Park'
    if (tags.tourism === 'attraction') return 'Attraction'
    if (tags.tourism === 'zoo') return 'Zoo'
    // Building — specific first, generic last
    if (tags.building === 'university') return 'University Building'
    if (tags.building === 'hospital') return 'Hospital Building'
    if (tags.building === 'apartments') return 'Apartment Building'
    if (tags.building === 'commercial') return 'Commercial Building'
    if (tags.building === 'office') return 'Office Building'
    if (tags.building === 'retail') return 'Retail Building'
    if (tags.building === 'school') return 'School Building'
    if (tags.building === 'terminal') return 'Terminal'
    if (tags.building && tags.building !== 'yes') {
      return tags.building.charAt(0).toUpperCase() + tags.building.slice(1).replace(/_/g, ' ')
    }
    // Landuse
    if (tags.landuse === 'residential') return 'Residential Area'
    if (tags.landuse === 'commercial') return 'Commercial Area'
    if (tags.landuse === 'retail') return 'Retail Area'
    if (tags.landuse === 'education') return 'Educational Campus'
    if (tags.landuse === 'industrial') return 'Industrial Area'
    if (tags.landuse === 'military') return 'Military Area'
    // Generic fallbacks — avoid returning raw "yes" values
    const raw = tags.amenity || tags.leisure || tags.aeroway || tags.shop || tags.tourism || tags.landuse
    if (raw && raw !== 'yes') return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ')
    if (tags.building) return 'Building'
    return 'Area'
  }

  /**
   * Convert raw Overpass elements to Place objects.
   */
  private elementsToPlaces(elements: any[]): Place[] {
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
  }
}
