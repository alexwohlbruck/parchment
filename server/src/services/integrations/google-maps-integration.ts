import type {
  Integration,
  AutocompleteCapability,
  PlaceInfoCapability,
  GeocodingCapability,
  IntegrationConfig,
  IntegrationTestResult,
  SearchCapability,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import { GoogleAdapter } from './adapters/google-adapter'
import { SOURCE } from '../../lib/constants'

// TODO: Use official Google Maps API for requests

export class GoogleMapsIntegration implements Integration {
  private adapter = new GoogleAdapter()
  private baseUrl = 'https://maps.googleapis.com/maps/api'
  private config: IntegrationConfig = {}

  // Integration metadata
  readonly integrationId = IntegrationId.GOOGLE_MAPS

  // TODO: capabilityIds and capabilities are redundant, we should find a way to automatically generate the capability list
  readonly sources = [SOURCE.GOOGLE]
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.SEARCH,
    IntegrationCapabilityId.AUTOCOMPLETE,
    IntegrationCapabilityId.PLACE_INFO,
    IntegrationCapabilityId.GEOCODING,
  ]
  readonly capabilities = {
    search: {
      searchPlaces: this.searchPlaces.bind(this),
    } as SearchCapability,

    autocomplete: {
      getAutocomplete: this.getAutocomplete.bind(this),
    } as AutocompleteCapability,

    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,

    geocoding: {
      geocode: this.geocode.bind(this),
      reverseGeocode: this.reverseGeocode.bind(this),
    } as GeocodingCapability,
  }

  // Integration interface methods
  async testConnection(
    config: IntegrationConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API Key is required',
      }
    }

    try {
      // Test a simple autocomplete request to validate the API key
      const url = new URL(`${this.baseUrl}/place/autocomplete/json`)
      url.searchParams.set('input', 'test')
      url.searchParams.set('key', config.apiKey)

      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.status === 'REQUEST_DENIED') {
        return {
          success: false,
          message: 'Invalid API Key or insufficient permissions',
        }
      }

      return { success: true }
    } catch (error: any) {
      console.error('Error testing Google Maps API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Google Maps API',
      }
    }
  }

  initialize(config: IntegrationConfig): void {
    console.log(
      'Google Maps Integration - initialize called with config:',
      JSON.stringify(config, null, 2),
    )
    this.config = config

    // Set the API key on the adapter for photo URLs
    if (config.apiKey) {
      console.log('Setting API key on adapter:', config.apiKey)
      this.adapter.setApiKey(config.apiKey)
    } else {
      console.log('No API key found in config')
    }
  }

  validateConfig(config: IntegrationConfig): boolean {
    return !!config.apiKey
  }

  /**
   * Get autocomplete suggestions for a query
   * @param query Search query string
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of place suggestions
   */
  private async getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
    },
  ): Promise<Place[]> {
    if (!this.config.apiKey || !lat || !lng) {
      return []
    }
    const { radius = 50000 } = options || {}

    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        query,
      )}&location=${lat},${lng}&radius=${radius}&key=${this.config.apiKey}`

      const response = await fetch(url)
      const data = await response.json()

      if (data.status !== 'OK') {
        return []
      }

      if (!data.predictions || data.predictions.length === 0) {
        return []
      }

      const enrichedPredictions = await Promise.all(
        data.predictions.map(async (prediction: any) => {
          try {
            const url = new URL(`${this.baseUrl}/place/details/json`)

            url.searchParams.set('place_id', prediction.place_id)
            url.searchParams.set('key', this.config.apiKey)
            url.searchParams.set(
              'fields',
              'place_id,name,geometry,formatted_address,types',
            )

            const response = await fetch(url.toString())
            if (!response.ok) {
              throw new Error(`HTTP error: ${response.status}`)
            }

            const data = await response.json()
            if (data.status !== 'OK') {
              throw new Error(`API error: ${data.status}`)
            }

            const placeDetails = data.result
            return { ...prediction, details: placeDetails }
          } catch (error) {
            return prediction
          }
        }),
      )

      const places = enrichedPredictions.map((prediction) =>
        this.adapter.autocomplete.adaptPrediction(prediction),
      )

      return places
    } catch (error) {
      return []
    }
  }

  /**
   * Get place details by place ID
   * @param placeId The Google Place ID
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(placeId: string): Promise<Place | null> {
    try {
      console.log('Fetching place details for:', placeId)
      const url = new URL(`${this.baseUrl}/place/details/json`)
      url.searchParams.set('place_id', placeId)
      url.searchParams.set('key', this.config.apiKey)
      url.searchParams.set(
        'fields',
        'place_id,name,formatted_address,formatted_phone_number,website,types,photos,rating,user_ratings_total,opening_hours,editorial_summary,geometry,price_level,business_status,dine_in,takeout,delivery,curbside_pickup,serves_breakfast,serves_lunch,serves_dinner,serves_beer,utc_offset',
      )

      console.log(
        'Place Details URL:',
        url.toString().replace(this.config.apiKey, '[API_KEY]'),
      )
      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`Google Place Details HTTP error: ${response.status}`)
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      console.log('Place Details API response status:', data.status)
      if (data.status !== 'OK') {
        if (data.status === 'INVALID_REQUEST') {
          console.warn(`Invalid place ID: ${placeId}`)
          console.warn('Full API response:', JSON.stringify(data, null, 2))
          return null
        }
        throw new Error(`Google API error: ${data.status}`)
      }

      console.log(
        'Place details found for:',
        placeId,
        'with geometry:',
        !!data.result?.geometry,
      )
      return this.adapter.placeInfo.adaptPlaceDetails(data.result)
    } catch (error) {
      console.error('Google place details error:', error)
      return null
    }
  }

  /**
   * Geocode an address to coordinates
   * @param address The address to geocode
   * @returns Array of place results
   */
  private async geocode(address: string): Promise<Place[]> {
    try {
      const url = new URL(`${this.baseUrl}/geocode/json`)
      url.searchParams.set('address', address)
      url.searchParams.set('key', this.config.apiKey)

      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google API error: ${data.status}`)
      }

      return data.results.map((result: any) =>
        this.adapter.placeInfo.adaptPlaceDetails({
          place_id: result.place_id || '',
          name: result.formatted_address || '',
          formatted_address: result.formatted_address || '',
          formatted_phone_number: '',
          website: '',
          types: result.types || [],
          photos: [],
          rating: 0,
          user_ratings_total: 0,
          opening_hours: undefined,
          editorial_summary: undefined,
          geometry: result.geometry,
          google_maps_uri: '',
          price_level: '',
          business_status: '',
          dine_in: false,
          takeout: false,
          delivery: false,
          curbside_pickup: false,
          serves_breakfast: false,
          serves_lunch: false,
          serves_dinner: false,
          serves_beer: false,
          outdoor_seating: false,
          live_music: false,
          good_for_children: false,
          good_for_groups: false,
          utc_offset: 0,
        }),
      )
    } catch (error) {
      console.error('Google geocoding error:', error)
      return []
    }
  }

  /**
   * Reverse geocode coordinates to places
   * @param lat Latitude
   * @param lng Longitude
   * @returns Array of place results
   */
  private async reverseGeocode(lat: number, lng: number): Promise<Place[]> {
    try {
      const url = new URL(`${this.baseUrl}/geocode/json`)
      url.searchParams.set('latlng', `${lat},${lng}`)
      url.searchParams.set('key', this.config.apiKey)

      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google API error: ${data.status}`)
      }

      return data.results.map((result: any) =>
        this.adapter.placeInfo.adaptPlaceDetails({
          place_id: result.place_id || '',
          name: result.formatted_address || '',
          formatted_address: result.formatted_address || '',
          formatted_phone_number: '',
          website: '',
          types: result.types || [],
          photos: [],
          rating: 0,
          user_ratings_total: 0,
          opening_hours: undefined,
          editorial_summary: undefined,
          geometry: result.geometry,
          google_maps_uri: '',
          price_level: '',
          business_status: '',
          dine_in: false,
          takeout: false,
          delivery: false,
          curbside_pickup: false,
          serves_breakfast: false,
          serves_lunch: false,
          serves_dinner: false,
          serves_beer: false,
          outdoor_seating: false,
          live_music: false,
          good_for_children: false,
          good_for_groups: false,
          utc_offset: 0,
        }),
      )
    } catch (error) {
      console.error('Google reverse geocoding error:', error)
      return []
    }
  }

  /**
   * Search for places using Google Places API Text Search
   * @param query Search query string
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param options Optional search options
   * @returns Array of place results
   */
  private async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    options?: {
      radius?: number
      limit?: number
    },
  ): Promise<Place[]> {
    if (!this.config.apiKey) {
      console.error('Google Maps API key not configured')
      return []
    }

    try {
      console.log(`Searching Google Places for: "${query}"`)

      const url = new URL(`${this.baseUrl}/place/textsearch/json`)
      url.searchParams.set('query', query)
      url.searchParams.set('key', this.config.apiKey)

      // Add location bias if coordinates are provided
      if (lat && lng) {
        const radius = options?.radius || 50000 // Default 50km radius
        url.searchParams.set('location', `${lat},${lng}`)
        url.searchParams.set('radius', radius.toString())
      }

      // Set page size limit if provided
      if (options?.limit) {
        // Google Places API doesn't have a direct limit parameter, but we can control this in post-processing
        // The API returns up to 20 results per request by default
      }

      console.log(
        'Google Places Text Search URL:',
        url.toString().replace(this.config.apiKey, '[API_KEY]'),
      )

      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(
          `Google Places Text Search HTTP error: ${response.status}`,
        )
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      console.log('Google Places Text Search API response status:', data.status)

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.error('Google Places Text Search API error:', data.status)
        if (data.error_message) {
          console.error('Error message:', data.error_message)
        }
        return []
      }

      if (!data.results || data.results.length === 0) {
        console.log('No places found for query:', query)
        return []
      }

      console.log(`Found ${data.results.length} places for query: "${query}"`)

      // Convert results to Place objects using the adapter
      let places = data.results.map((result: any) =>
        this.adapter.placeInfo.adaptPlaceDetails(result),
      )

      // Apply limit if specified
      if (options?.limit && places.length > options.limit) {
        places = places.slice(0, options.limit)
      }

      return places
    } catch (error) {
      console.error('Google Places Text Search error:', error)
      return []
    }
  }
}
