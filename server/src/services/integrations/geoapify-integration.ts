import axios from 'axios'
import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  SearchCategoryCapability,
  AutocompleteCapability,
  GeocodingCapability,
  PlaceInfoCapability,
  RoutingCapability,
  MapBounds,
} from '../../types/integration.types'
import { Place } from '../../types/place.types'
import {
  RouteRequest,
  UnifiedRoute,
  TravelMode,
} from '../../types/unified-routing.types'
import {
  GeoapifyAdapter,
  GeoapifyFeature,
  GeoapifyRoutingResponse,
} from './adapters/geoapify-adapter'
import { getGeoapifyCategory } from './mappings/geoapify-preset-mapping'
import { SOURCE } from '../../lib/constants'
import { getLanguageCode } from '../../lib/i18n'

export interface GeoapifyConfig extends IntegrationConfig {
  apiKey: string
}

export class GeoapifyIntegration implements Integration<GeoapifyConfig> {
  private initialized = false
  private adapter = new GeoapifyAdapter()
  protected config: GeoapifyConfig = { apiKey: '' }
  private placesBaseUrl = 'https://api.geoapify.com/v2/places'
  private geocodingBaseUrl = 'https://api.geoapify.com/v1/geocode'
  private placeDetailsBaseUrl = 'https://api.geoapify.com/v2/place-details'
  private routingBaseUrl = 'https://api.geoapify.com/v1/routing'

  readonly integrationId = IntegrationId.GEOAPIFY
  readonly capabilityIds = [
    IntegrationCapabilityId.SEARCH_CATEGORY,
    IntegrationCapabilityId.AUTOCOMPLETE,
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.PLACE_INFO, // Used internally for OSM ID extraction only
    IntegrationCapabilityId.ROUTING,
  ]
  readonly capabilities = {
    searchCategory: {
      searchByCategory: this.searchByCategory.bind(this),
    } as SearchCategoryCapability,
    autocomplete: {
      getAutocomplete: this.getAutocomplete.bind(this),
    } as AutocompleteCapability,
    geocoding: {
      geocode: this.geocode.bind(this),
      reverseGeocode: this.reverseGeocode.bind(this),
    } as GeocodingCapability,
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
    routing: {
      getRoute: this.getRoute.bind(this),
      metadata: {
        supportedPreferences: {
          avoidHighways: true,
          avoidTolls: true,
          avoidFerries: true,
          avoidUnpaved: false,
          avoidHills: false,
          preferHOV: false,
          preferLitPaths: false,
          preferPavedPaths: false,
          safetyVsEfficiency: true, // Maps to route type (balanced/short)
          maxWalkDistance: false, // Only for transit
          maxTransfers: false, // Only for transit
          wheelchairAccessible: false, // Only for transit
        },
        supportedModes: ['driving', 'walking', 'cycling', 'motorcycle'],
        supportedOptimizations: ['time', 'distance', 'balanced'],
        features: {
          alternatives: false,
          traffic: true, // Supports approximated traffic
          elevation: true, // For cycling and walking
          instructions: true,
          matrix: false,
          transit: false,
        },
        limits: {
          maxWaypoints: 50,
          maxAlternatives: 0,
        },
      },
    } as RoutingCapability,
    cacheTtl: {
      searchCategory: { searchByCategory: 4 * 3600 },
      autocomplete: { getAutocomplete: 600 },
      geocoding: { geocode: 4 * 3600, reverseGeocode: 24 * 3600 },
      placeInfo: { getPlaceInfo: 24 * 3600 },
      routing: { getRoute: 24 * 3600 },
    },
  }
  // Note: Empty sources array - Geoapify is not a primary data source
  // It's used for geocoding, search, and routing, but place details come from OSM
  readonly sources: Source[] = []

  initialize(config: GeoapifyConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API Key is required')
    }

    this.config = { ...config }
    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  async testConnection(config: GeoapifyConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API Key is required',
      }
    }

    try {
      // Test the connection with a simple geocoding request
      const url = `${this.geocodingBaseUrl}/search`
      const params = {
        text: 'test',
        limit: 1,
        apiKey: config.apiKey,
      }

      const response = await axios.get(url, { params })
      
      if (response.status === 200 && response.data) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Unexpected response from Geoapify API',
        }
      }
    } catch (error: any) {
      console.error('Error testing Geoapify API:', error)
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to connect to Geoapify API',
      }
    }
  }

  validateConfig(config: GeoapifyConfig): boolean {
    return !!(config.apiKey && typeof config.apiKey === 'string')
  }

  async searchByCategory(
    presetId: string,
    bounds: MapBounds,
    options?: { limit?: number },
  ): Promise<Place[]> {
    this.ensureInitialized()

    const category = this.mapPresetToGeoapifyCategory(presetId)
    if (!category) {
      return []
    }

    try {
      const params: any = {
        categories: category,
        limit: options?.limit || 100,
        apiKey: this.config.apiKey,
      }

      params.filter = `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`

      const response = await axios.get(this.placesBaseUrl, { params })

      if (!response.data.features) {
        return []
      }

      return response.data.features.map((feature: any) =>
        this.adapter.adaptPlaceDetails(feature),
      )
    } catch (error) {
      console.error('Error searching Geoapify places:', error)
      return []
    }
  }

  private mapPresetToGeoapifyCategory(presetId: string): string | null {
    return getGeoapifyCategory(presetId)
  }

  /**
   * Get autocomplete suggestions for a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param options Optional parameters including radius and limit
   * @returns Array of Place objects
   */
  async getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
    },
  ): Promise<Place[]> {
    this.ensureInitialized()

    if (!query || query.length < 2) {
      return []
    }

    try {
      const url = `${this.geocodingBaseUrl}/autocomplete`
      const params: any = {
        text: query,
        limit: options?.limit || 10,
        apiKey: this.config.apiKey,
        format: 'geojson',
      }

      // Add location bias if coordinates are provided
      if (lat !== undefined && lng !== undefined) {
        params.bias = `proximity:${lng},${lat}`

        // Add radius filter if provided
        if (options?.radius) {
          const radiusKm = options.radius / 1000
          params.filter = `circle:${lng},${lat},${radiusKm}`
        }
      }

      const response = await axios.get(url, { params })

      if (!response.data?.features) {
        return []
      }

      return response.data.features.map((feature: GeoapifyFeature) =>
        this.adapter.adaptPlaceDetails(feature),
      )
    } catch (error) {
      console.error('Error getting Geoapify autocomplete:', error)
      return []
    }
  }

  /**
   * Geocode an address to coordinates
   * @param query The address query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @returns Array of geocoded places
   */
  async geocode(
    query: string,
    lat?: number,
    lng?: number,
    _options?: { language?: string },
  ): Promise<Place[]> {
    this.ensureInitialized()

    if (!query) {
      return []
    }

    try {
      const url = `${this.geocodingBaseUrl}/search`
      const params: any = {
        text: query,
        limit: 10,
        apiKey: this.config.apiKey,
        format: 'geojson',
      }

      // Add location bias if coordinates are provided
      if (lat !== undefined && lng !== undefined) {
        params.bias = `proximity:${lng},${lat}`
      }

      const response = await axios.get(url, { params })

      if (!response.data?.features) {
        return []
      }

      return response.data.features.map((feature: GeoapifyFeature) =>
        this.adapter.adaptPlaceDetails(feature),
      )
    } catch (error) {
      console.error('Error geocoding with Geoapify:', error)
      return []
    }
  }

  /**
   * Reverse geocode coordinates to addresses
   * @param lat Latitude
   * @param lng Longitude
   * @returns Array of reverse geocoded places
   */
  async reverseGeocode(
    lat: number,
    lng: number,
    _options?: { language?: string },
  ): Promise<Place[]> {
    this.ensureInitialized()

    try {
      const url = `${this.geocodingBaseUrl}/reverse`
      const params: any = {
        lat,
        lon: lng,
        limit: 10,
        apiKey: this.config.apiKey,
        format: 'geojson',
      }

      const response = await axios.get(url, { params })

      if (!response.data?.features) {
        return []
      }

      return response.data.features.map((feature: GeoapifyFeature) =>
        this.adapter.adaptPlaceDetails(feature),
      )
    } catch (error) {
      console.error('Error reverse geocoding with Geoapify:', error)
      return []
    }
  }

  /**
   * Get place details by Geoapify place ID
   * @param id The Geoapify place ID
   * @returns Place details or null if not found
   */
  async getPlaceInfo(
    id: string,
    _options?: { language?: string },
  ): Promise<Place | null> {
    this.ensureInitialized()

    try {
      const url = `${this.placeDetailsBaseUrl}`
      const params: any = {
        id,
        apiKey: this.config.apiKey,
        format: 'geojson',
      }

      const response = await axios.get(url, { params })

      if (!response.data?.features?.[0]) {
        return null
      }

      return this.adapter.adaptPlaceDetails(response.data.features[0])
    } catch (error) {
      console.error('[Geoapify] Error getting place details:', error)
      return null
    }
  }

  /**
   * Get route using unified request format
   * @param request Unified route request
   * @returns Route information in unified format
   */
  async getRoute(request: RouteRequest): Promise<UnifiedRoute> {
    this.ensureInitialized()

    if (request.waypoints.length < 2) {
      throw new Error('At least 2 waypoints are required for routing')
    }

    try {
      const url = `${this.routingBaseUrl}`
      
      // Determine which details to request based on travel mode
      let details = 'instruction_details,route_details'
      if (request.mode === TravelMode.CYCLING || request.mode === TravelMode.WALKING) {
        details += ',elevation'
      }
      
      const lang = request.language ? getLanguageCode(request.language) : undefined
      const params: any = {
        waypoints: request.waypoints
          .map(wp => `${wp.coordinate.lat},${wp.coordinate.lng}`)
          .join('|'),
        mode: this.mapTravelModeToGeoapify(request.mode),
        details,
        apiKey: this.config.apiKey,
        ...(lang && { lang }),
      }

      // Add routing preferences if provided
      if (request.preferences) {
        const avoidOptions: string[] = []
        
        // Build avoid parameter according to Geoapify API format
        if (request.preferences.avoidTolls) {
          avoidOptions.push('tolls')
        }
        if (request.preferences.avoidHighways) {
          avoidOptions.push('highways')
        }
        if (request.preferences.avoidFerries) {
          avoidOptions.push('ferries')
        }
        
        // Join avoid options with pipe separator as per Geoapify docs
        if (avoidOptions.length > 0) {
          params.avoid = avoidOptions.join('|')
        }
        
        // Map route optimization preference
        // Note: Geoapify doesn't have a direct "safety" option, but we can use:
        // - balanced (default): compromise between time, cost, and distance
        // - short: optimizes by distance (could be considered "safer" as it minimizes exposure)
        // - less_maneuvers: fewer turns (could be considered "safer" for some users)
        if (request.preferences.optimize) {
          if (request.preferences.optimize === 'distance') {
            params.type = 'short'
          } else if (request.preferences.optimize === 'balanced') {
            params.type = 'balanced'
          }
          // 'time' is the default, no need to set type parameter
        }
      }

      console.log('[Geoapify] Routing request params:', {
        waypoints: params.waypoints,
        mode: params.mode,
        avoid: params.avoid,
        type: params.type,
      })

      const response = await axios.get(url, { params })

      if (!response.data) {
        throw new Error('No route data received from Geoapify')
      }


      return this.adapter.routing.adaptRouteResponse(response.data, request)
    } catch (error) {
      throw new Error(
        `Geoapify routing error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  /**
   * Map travel mode to Geoapify routing mode
   */
  private mapTravelModeToGeoapify(mode: TravelMode): string {
    switch (mode) {
      case TravelMode.DRIVING:
        return 'drive'
      case TravelMode.WALKING:
        return 'walk'
      case TravelMode.CYCLING:
        return 'bicycle'
      case TravelMode.MOTORCYCLE:
        return 'motorcycle'
      default:
        throw new Error(`Unsupported travel mode for Geoapify: ${mode}`)
    }
  }
}
