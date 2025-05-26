import type {
  Integration,
  AutocompleteCapability,
  PlaceInfoCapability,
  GeocodingCapability,
  IntegrationConfig,
  IntegrationTestResult,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import { GoogleAdapter } from './adapters/google-adapter'
import { SOURCE } from '../../lib/constants'

export class GoogleMapsIntegration implements Integration {
  private adapter = new GoogleAdapter()
  private baseUrl = 'https://maps.googleapis.com/maps/api'
  private config: IntegrationConfig = {}

  // Integration metadata
  readonly integrationId = IntegrationId.GOOGLE_MAPS
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.AUTOCOMPLETE,
    IntegrationCapabilityId.PLACE_INFO,
    IntegrationCapabilityId.GEOCODING,
  ]
  readonly sources = [SOURCE.GOOGLE]

  // Capability implementations
  readonly capabilities = {
    autocomplete: {
      getAutocomplete: async (
        query: string,
        lat?: number,
        lng?: number,
        radius?: number,
      ): Promise<Place[]> => {
        console.log('Google getAutocomplete called with:', {
          query,
          lat,
          lng,
          radius,
        })
        console.log('Google config:', {
          hasApiKey: !!this.config.apiKey,
        })

        if (!this.config.apiKey) {
          console.log('No Google API key found in config')
          return []
        }

        if (!lat || !lng) {
          console.log('Missing lat/lng for Google autocomplete')
          return []
        }

        if (!radius) {
          radius = 50000 // Default 50km radius
        }

        try {
          console.log('Making Google API request...')
          const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            query,
          )}&location=${lat},${lng}&radius=${radius}&key=${this.config.apiKey}`

          console.log(
            'Request URL (without API key):',
            url.replace(this.config.apiKey, '[API_KEY]'),
          )

          const response = await fetch(url)
          const data = await response.json()

          console.log('Google API response status:', data.status)
          console.log(
            'Google API predictions count:',
            data.predictions?.length || 0,
          )

          if (data.status !== 'OK') {
            console.error(
              'Google Places API error:',
              data.status,
              data.error_message,
            )
            return []
          }

          if (!data.predictions || data.predictions.length === 0) {
            console.log('No predictions returned from Google API')
            return []
          }

          console.log('Processing Google predictions...')
          const enrichedPredictions = await Promise.all(
            data.predictions.map(async (prediction: any) => {
              try {
                // Try to get basic place details with minimal fields for coordinates
                const placeDetails = await this.getPlaceDetailsMinimal(
                  prediction.place_id,
                )
                return { ...prediction, details: placeDetails }
              } catch (error) {
                console.warn(
                  `Could not fetch details for place ${prediction.place_id}, using prediction only:`,
                  error instanceof Error ? error.message : String(error),
                )
                return prediction
              }
            }),
          )

          console.log('Converting predictions to Place objects...')
          const places = enrichedPredictions.map((prediction) =>
            this.adapter.autocomplete.adaptPrediction(prediction),
          )

          console.log('Returning', places.length, 'Google places')
          return places
        } catch (error) {
          console.error('Error in Google autocomplete:', error)
          return []
        }
      },
    } as AutocompleteCapability,

    placeInfo: {
      getPlaceInfo: async (placeId: string): Promise<Place | null> => {
        try {
          console.log('Fetching place details for:', placeId)
          const url = new URL(`${this.baseUrl}/place/details/json`)
          url.searchParams.set('place_id', placeId)
          url.searchParams.set('key', this.config.apiKey)
          url.searchParams.set(
            'fields',
            'place_id,name,formatted_address,formatted_phone_number,website,types,photos,rating,user_ratings_total,opening_hours,editorial_summary,geometry,price_level,business_status,dine_in,takeout,delivery,curbside_pickup,serves_breakfast,serves_lunch,serves_dinner,serves_beer,serves_wine,restroom,utc_offset',
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
      },
    } as PlaceInfoCapability,

    geocoding: {
      geocode: async (address: string): Promise<Place[]> => {
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
              restroom: false,
              utc_offset: 0,
            }),
          )
        } catch (error) {
          console.error('Google geocoding error:', error)
          return []
        }
      },

      reverseGeocode: async (lat: number, lng: number): Promise<Place[]> => {
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
              restroom: false,
              utc_offset: 0,
            }),
          )
        } catch (error) {
          console.error('Google reverse geocoding error:', error)
          return []
        }
      },
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
    return Boolean(config && config.apiKey)
  }

  createUnifiedPlace(providerData: any, id?: string): Place {
    return this.adapter.adaptPlace(providerData, id)
  }

  // Legacy methods for backward compatibility
  async getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<Place[]> {
    return this.capabilities.autocomplete!.getAutocomplete(
      query,
      lat,
      lng,
      radius,
    )
  }

  async getPlaceDetails(placeId: string): Promise<Place | null> {
    return this.capabilities.placeInfo!.getPlaceInfo(placeId)
  }

  async geocode(address: string): Promise<Place[]> {
    return this.capabilities.geocoding!.geocode(address)
  }

  async reverseGeocode(lat: number, lng: number): Promise<Place[]> {
    return this.capabilities.geocoding!.reverseGeocode(lat, lng)
  }

  /**
   * Fetch minimal place details with only essential fields for coordinates
   * This is used during autocomplete enrichment to avoid field restriction errors
   */
  private async getPlaceDetailsMinimal(placeId: string): Promise<any | null> {
    try {
      const url = new URL(`${this.baseUrl}/place/details/json`)
      url.searchParams.set('place_id', placeId)
      url.searchParams.set('key', this.config.apiKey)
      // Use only the most basic fields to avoid enterprise restrictions
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

      return data.result
    } catch (error) {
      console.warn('Minimal place details fetch failed:', error)
      return null
    }
  }
}
