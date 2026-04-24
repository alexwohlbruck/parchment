import type {
  Integration,
  IntegrationConfig,
  AutocompleteCapability,
  PlaceInfoCapability,
  GeocodingCapability,
  IntegrationTestResult,
  SearchCapability,
  GoogleMapsConfig,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import { GoogleAdapter } from './adapters/google-adapter'
import { SOURCE } from '../../lib/constants'
import { getLanguageCode } from '../../lib/i18n'

// TODO: Use official Google client SDK for requests

export interface GoogleMapsConfig extends IntegrationConfig {
  apiKey: string
}

export class GoogleMapsIntegration implements Integration<GoogleMapsConfig> {
  private adapter = new GoogleAdapter()
  private config: GoogleMapsConfig = { apiKey: '' }
  private baseUrl = 'https://places.googleapis.com/v1'

  // Integration metadata
  readonly integrationId = IntegrationId.GOOGLE_MAPS

  // TODO: capabilityIds and capabilities are redundant, we should find a way to automatically generate the capability list
  readonly sources = [SOURCE.GOOGLE]
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.SEARCH,
    IntegrationCapabilityId.PLACE_INFO,
    IntegrationCapabilityId.GEOCODING,
  ]
  readonly capabilities = {
    search: {
      searchPlaces: this.searchPlaces.bind(this),
    } as SearchCapability,

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
    config: GoogleMapsConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API Key is required',
      }
    }

    try {
      // Test a simple autocomplete request to validate the API key
      const url = `${this.baseUrl}/places:autocomplete`
      const requestBody = {
        input: 'test',
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.apiKey,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.error) {
        return {
          success: false,
          message:
            data.error.message || 'Invalid API Key or insufficient permissions',
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

  initialize(config: GoogleMapsConfig): void {
    // Never log `config` — it contains the user's third-party API key.
    this.config = config
    if (config.apiKey) {
      this.adapter.setApiKey(config.apiKey)
    }
  }

  validateConfig(config: GoogleMapsConfig): boolean {
    return !!config.apiKey
  }

  /**
   * Get place details by place ID
   * @param placeId The Google Place ID
   * @param options Optional parameters including language
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(
    placeId: string,
    options?: { language?: string },
  ): Promise<Place | null> {
    try {
      console.log('Fetching place details for:', placeId)
      const lang = options?.language ? getLanguageCode(options.language) : undefined
      const url = new URL(`${this.baseUrl}/places/${placeId}`)
      if (lang) url.searchParams.set('languageCode', lang)

      const fieldMask =
        'id,displayName,formattedAddress,addressComponents,internationalPhoneNumber,websiteUri,types,photos,rating,userRatingCount,googleMapsUri,priceLevel,businessStatus,editorialSummary,location,dineIn,takeout,delivery,curbsidePickup,servesBreakfast,servesLunch,servesDinner,servesBeer,servesVegetarianFood,servesCocktails,servesCoffee,outdoorSeating,liveMusic,goodForChildren,goodForGroups,restroom,regularOpeningHours,utcOffsetMinutes'

      console.log(
        'Place Details URL:',
        url.toString().replace(this.config.apiKey, '[API_KEY]'),
      )
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.config.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
      })

      if (!response.ok) {
        console.error(`Google Place Details HTTP error: ${response.status}`)
        if (response.status === 404) {
          console.warn(`Place not found: ${placeId}`)
          return null
        }
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.error) {
        console.error('Google Place Details API error:', data.error)
        return null
      }

      console.log(
        'Place details found for:',
        placeId,
        'with location:',
        !!data.location,
      )
      return this.adapter.placeInfo.adaptPlaceDetails(data)
    } catch (error) {
      console.error('Google place details error:', error)
      return null
    }
  }

  /**
   * Geocode an address to coordinates
   * @param address The address to geocode
   * @param options Optional parameters including language
   * @returns Array of place results
   */
  private async geocode(
    address: string,
    _lat?: number,
    _lng?: number,
    options?: { language?: string },
  ): Promise<Place[]> {
    try {
      // Use the legacy Geocoding API as the new Places API doesn't have direct geocoding
      const url = `https://maps.googleapis.com/maps/api/geocode/json`
      const lang = options?.language ? getLanguageCode(options.language) : undefined
      const params: Record<string, string> = {
        address: address,
        key: this.config.apiKey,
      }
      if (lang) params.language = lang

      const queryString = new URLSearchParams(params).toString()
      const fullUrl = `${url}?${queryString}`

      const response = await fetch(fullUrl)
      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google API error: ${data.status}`)
      }

      return data.results.map((result: any) =>
        this.adapter.placeInfo.adaptPlaceDetails({
          id: result.place_id || '',
          displayName: { text: result.formatted_address || '' },
          formattedAddress: result.formatted_address || '',
          internationalPhoneNumber: '',
          websiteUri: '',
          types: result.types || [],
          photos: [],
          rating: 0,
          userRatingCount: 0,
          regularOpeningHours: undefined,
          editorialSummary: undefined,
          location: result.geometry?.location
            ? {
                latitude: result.geometry.location.lat,
                longitude: result.geometry.location.lng,
              }
            : undefined,
          googleMapsUri: '',
          priceLevel: '',
          businessStatus: '',
          dineIn: false,
          takeout: false,
          delivery: false,
          curbsidePickup: false,
          servesBreakfast: false,
          servesLunch: false,
          servesDinner: false,
          servesBeer: false,
          servesVegetarianFood: false,
          servesCocktails: false,
          servesCoffee: false,
          outdoorSeating: false,
          liveMusic: false,
          goodForChildren: false,
          goodForGroups: false,
          restroom: false,
          utcOffsetMinutes: 0,
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
   * @param options Optional parameters including language
   * @returns Array of place results
   */
  private async reverseGeocode(
    lat: number,
    lng: number,
    options?: { language?: string },
  ): Promise<Place[]> {
    try {
      // Use the legacy Geocoding API as the new Places API doesn't have direct reverse geocoding
      const url = `https://maps.googleapis.com/maps/api/geocode/json`
      const lang = options?.language ? getLanguageCode(options.language) : undefined
      const params: Record<string, string> = {
        latlng: `${lat},${lng}`,
        key: this.config.apiKey,
      }
      if (lang) params.language = lang

      const queryString = new URLSearchParams(params).toString()
      const fullUrl = `${url}?${queryString}`

      const response = await fetch(fullUrl)
      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google API error: ${data.status}`)
      }

      return data.results.map((result: any) =>
        this.adapter.placeInfo.adaptPlaceDetails({
          id: result.place_id || '',
          displayName: { text: result.formatted_address || '' },
          formattedAddress: result.formatted_address || '',
          internationalPhoneNumber: '',
          websiteUri: '',
          types: result.types || [],
          photos: [],
          rating: 0,
          userRatingCount: 0,
          regularOpeningHours: undefined,
          editorialSummary: undefined,
          location: result.geometry?.location
            ? {
                latitude: result.geometry.location.lat,
                longitude: result.geometry.location.lng,
              }
            : undefined,
          googleMapsUri: '',
          priceLevel: '',
          businessStatus: '',
          dineIn: false,
          takeout: false,
          delivery: false,
          curbsidePickup: false,
          servesBreakfast: false,
          servesLunch: false,
          servesDinner: false,
          servesBeer: false,
          servesVegetarianFood: false,
          servesCocktails: false,
          servesCoffee: false,
          outdoorSeating: false,
          liveMusic: false,
          goodForChildren: false,
          goodForGroups: false,
          restroom: false,
          utcOffsetMinutes: 0,
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
      language?: string
    },
  ): Promise<Place[]> {
    if (!this.config.apiKey) {
      console.error('Google Maps API key not configured')
      return []
    }

    try {
      console.log(`Searching Google Places for: "${query}"`)
      const lang = options?.language ? getLanguageCode(options.language) : undefined

      const url = `${this.baseUrl}/places:searchText`
      const requestBody: any = {
        textQuery: query,
        maxResultCount: options?.limit || 20,
        ...(lang && { languageCode: lang }),
      }

      // Add location bias if coordinates are provided
      if (lat && lng) {
        const radius = options?.radius || 50000 // Default 50km radius
        requestBody.locationBias = {
          circle: {
            center: {
              latitude: lat,
              longitude: lng,
            },
            radius: radius,
          },
        }
      }

      const fieldMask =
        'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.types,places.photos,places.rating,places.userRatingCount,places.googleMapsUri,places.priceLevel,places.businessStatus,places.editorialSummary,places.location,places.dineIn,places.takeout,places.delivery,places.curbsidePickup,places.servesBreakfast,places.servesLunch,places.servesDinner,places.servesBeer,places.servesVegetarianFood,places.servesCocktails,places.servesCoffee,places.outdoorSeating,places.liveMusic,places.goodForChildren,places.goodForGroups,places.restroom,places.regularOpeningHours,places.utcOffsetMinutes'

      console.log(
        'Google Places Text Search URL:',
        url.replace(this.config.apiKey, '[API_KEY]'),
      )

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.config.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        console.error(
          `Google Places Text Search HTTP error: ${response.status}`,
        )
        throw new Error(`Google API error: ${response.status}`)
      }

      const data = await response.json()
      if (data.error) {
        console.error('Google Places Text Search API error:', data.error)
        return []
      }

      if (!data.places || data.places.length === 0) {
        console.log('No places found for query:', query)
        return []
      }

      console.log(`Found ${data.places.length} places for query: "${query}"`)

      // Convert results to Place objects using the adapter
      const places = data.places.map((result: any) =>
        this.adapter.placeInfo.adaptPlaceDetails(result),
      )

      return places
    } catch (error) {
      console.error('Google Places Text Search error:', error)
      return []
    }
  }
}
