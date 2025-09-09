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

export interface GeoapifyConfig extends IntegrationConfig {
  apiKey: string
}

export class GeoapifyIntegration implements Integration<GeoapifyConfig> {
  private initialized = false
  private adapter = new GeoapifyAdapter()
  protected config: GeoapifyConfig = { apiKey: '' }
  private placesBaseUrl = 'https://api.geoapify.com/v2/places'
  private geocodingBaseUrl = 'https://api.geoapify.com/v1/geocode'
  private routingBaseUrl = 'https://api.geoapify.com/v1/routing'

  readonly integrationId = IntegrationId.GEOAPIFY
  readonly capabilityIds = [
    IntegrationCapabilityId.SEARCH_CATEGORY,
    IntegrationCapabilityId.AUTOCOMPLETE,
    IntegrationCapabilityId.GEOCODING,
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
    routing: {
      getRoute: this.getRoute.bind(this),
    } as RoutingCapability,
  }

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
  async reverseGeocode(lat: number, lng: number): Promise<Place[]> {
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
      
      const params: any = {
        waypoints: request.waypoints
          .map(wp => `${wp.coordinate.lat},${wp.coordinate.lng}`)
          .join('|'),
        mode: this.mapTravelModeToGeoapify(request.mode),
        details,
        apiKey: this.config.apiKey,
      }

      // Add vehicle preferences if provided
      if (request.preferences) {
        if (request.preferences.avoidTolls) {
          params.avoid = params.avoid ? `${params.avoid},tolls` : 'tolls'
        }
        if (request.preferences.avoidHighways) {
          params.avoid = params.avoid ? `${params.avoid},highways` : 'highways'
        }
        if (request.preferences.avoidFerries) {
          params.avoid = params.avoid ? `${params.avoid},ferries` : 'ferries'
        }
      }

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
