import axios from 'axios'
import {
  IntegrationDefinition,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { BaseIntegration } from './base-integration'
import { GOOGLE_PLACES_API_URL, SOURCE } from '../../lib/constants'
import { GoogleAdapter } from './adapters/google-adapter'
import { Place } from '../../types/place.types'

/**
 * Google Maps integration
 */
export class GoogleMapsIntegration extends BaseIntegration {
  readonly integrationId = IntegrationId.GOOGLE_MAPS
  readonly capabilities = [
    IntegrationCapabilityId.ROUTING,
    IntegrationCapabilityId.GEOCODING,
    IntegrationCapabilityId.PLACE_INFO,
    IntegrationCapabilityId.IMAGERY,
    IntegrationCapabilityId.AUTOCOMPLETE,
  ]
  readonly sources = [SOURCE.GOOGLE]

  private adapter: GoogleAdapter

  constructor() {
    super()
    this.adapter = new GoogleAdapter()
  }

  /**
   * Creates a Place from Google place data
   * @param providerData The Google place data
   * @param id Optional ID for the place
   * @returns A Place object
   */
  createUnifiedPlace(providerData: any, id?: string): Place {
    try {
      // Check if this is an autocomplete prediction (transformed by adaptAutocompletePrediction)
      if (
        providerData &&
        providerData.source === SOURCE.GOOGLE &&
        providerData.placeId
      ) {
        // This is an autocomplete prediction
        return {
          id:
            id || providerData.id || `${SOURCE.GOOGLE}/${providerData.placeId}`,
          externalIds: {
            [SOURCE.GOOGLE]:
              providerData.placeId ||
              providerData.id?.replace(`${SOURCE.GOOGLE}/`, '') ||
              'unknown',
          },
          name: providerData.name || 'Unnamed Place',
          placeType: (providerData.types && providerData.types[0]) || 'unknown',
          geometry: {
            type: 'point',
            center: {
              lat: providerData.geometry?.lat || 0,
              lng: providerData.geometry?.lng || 0,
            },
          },
          photos: [],
          address: providerData.description
            ? { formatted: providerData.description }
            : null,
          contactInfo: {
            phone: null,
            email: null,
            website: null,
            socials: {},
          },
          openingHours: null,
          amenities: providerData.types
            ? providerData.types.reduce((acc: any, type: string) => {
                acc[`type:${type}`] = type
                return acc
              }, {})
            : {},
          sources: [
            {
              id: SOURCE.GOOGLE,
              name: 'Google',
              url: '',
            },
          ],
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }
      }

      // Otherwise, it's a regular Google place result
      return this.adapter.adaptPlace(providerData, id)
    } catch (error) {
      console.error('Error creating Place from Google data:', error)

      // Return minimal valid place data
      return {
        id: id || `${SOURCE.GOOGLE}/${providerData?.place_id || 'unknown'}`,
        externalIds: { [SOURCE.GOOGLE]: providerData?.place_id || 'unknown' },
        name: providerData?.name || 'Unnamed Place',
        placeType: 'unknown',
        geometry: {
          type: 'point',
          center: { lat: 0, lng: 0 },
        },
        photos: [],
        address: null,
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
            id: SOURCE.GOOGLE,
            name: 'Google',
            url: '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    }
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
        message: 'Invalid configuration: API Key is required',
      }
    }

    try {
      // Test a simple Places API request to validate the API key
      const testPayload = {
        textQuery: 'Test Query',
        languageCode: 'en',
      }

      await axios.post(`${GOOGLE_PLACES_API_URL}:searchText`, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.apiKey,
          'X-Goog-FieldMask': 'places.id',
        },
      })

      return { success: true }
    } catch (error: any) {
      // Check if the error is related to invalid API key
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 400 || error.response?.status === 403)
      ) {
        return {
          success: false,
          message: 'Invalid API Key or insufficient permissions',
        }
      }

      console.error('Error testing Google Maps API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Google Maps API',
      }
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: IntegrationConfig): boolean {
    return Boolean(config && config.apiKey)
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
    radius: number = 10000,
  ) {
    this.ensureInitialized()

    const requestPayload: any = {
      textQuery: query,
      languageCode: 'en',
      maxResultCount: 10,
    }

    // Add location bias if coordinates are provided
    if (lat !== undefined && lng !== undefined) {
      requestPayload.locationBias = {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: radius,
        },
      }
    }

    const response = await axios.post(
      `${GOOGLE_PLACES_API_URL}:searchText`,
      requestPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.config.apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.types',
        },
      },
    )

    // Use the adapter to transform each result
    return (response.data.places || []).map((place: any) =>
      this.adapter.adaptPlace(place),
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
    radius: number = 10000,
  ) {
    this.ensureInitialized()

    try {
      // Use Places Autocomplete API from legacy API instead of the new Places API v1
      const legacyApiUrl =
        'https://maps.googleapis.com/maps/api/place/autocomplete/json'

      const params: any = {
        input: query,
        key: this.config.apiKey,
        language: 'en',
        types: 'establishment',
      }

      // Add location bias if coordinates are provided
      if (lat !== undefined && lng !== undefined) {
        params.location = `${lat},${lng}`
        params.radius = radius
      }

      console.log(`Calling Google Places Autocomplete API with params:`, {
        ...params,
        key: 'API_KEY_HIDDEN',
      })

      const response = await axios.get(legacyApiUrl, { params })

      console.log(
        `Received ${
          response.data.predictions?.length || 0
        } results from Google Places Autocomplete API`,
      )

      // Use the adapter to transform each prediction
      // Pass the location bias to the adapter to help with deduplication
      return (response.data.predictions || []).map((prediction: any) => {
        // Enhance prediction with location bias info
        const enhancedPrediction = {
          ...prediction,
          // Pass the location bias - this isn't perfect but helps with deduplication
          // Later we can consider using the Place Details API to get exact coordinates
          lat: lat,
          lng: lng,
        }
        return this.adapter.adaptAutocompletePrediction(enhancedPrediction)
      })
    } catch (error) {
      console.error('Error fetching Google autocomplete suggestions:', error)
      return []
    }
  }

  /**
   * Get place details by Google place ID
   * @param placeId The Google place ID
   * @returns Google place data or null if not found
   */
  async getPlaceDetails(placeId: string): Promise<any | null> {
    this.ensureInitialized()

    try {
      console.log(`Fetching Google place by ID: ${placeId}`)

      // Clean up the Place ID by removing any prefixes
      let cleanPlaceId = placeId

      // Strip the 'google/' prefix if it exists
      if (cleanPlaceId.startsWith('google/')) {
        cleanPlaceId = cleanPlaceId.substring(7)
      }

      // Handle potential double-prefixing (e.g., "google/google/ChIJ...")
      if (cleanPlaceId.startsWith('google/')) {
        cleanPlaceId = cleanPlaceId.substring(7)
      }

      console.log(`Making request to get details for place ID: ${cleanPlaceId}`)
      const endpoint = `${GOOGLE_PLACES_API_URL}/${cleanPlaceId}`

      const response = await axios.get(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.config.apiKey,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,internationalPhoneNumber,websiteUri,types,photos,rating,userRatingCount,googleMapsUri,priceLevel,businessStatus,editorialSummary,location,dineIn,takeout,delivery,curbsidePickup,servesBreakfast,servesLunch,servesDinner,servesBeer,servesVegetarianFood,servesCocktails,servesCoffee,outdoorSeating,liveMusic,goodForChildren,goodForGroups,restroom,regularOpeningHours,utcOffsetMinutes',
        },
      })

      if (!response.data || Object.keys(response.data).length === 0) {
        console.error('No place details returned for the given Google Place ID')
        return null
      }

      // Transform the response data into our format
      const transformedPlace = {
        place_id: response.data.id,
        name: response.data.displayName?.text || '',
        formatted_address: response.data.formattedAddress || '',
        formatted_phone_number: response.data.internationalPhoneNumber || '',
        website: response.data.websiteUri || '',
        types: response.data.types || [],
        photos:
          response.data.photos?.map(
            (photo: { name: string; heightPx?: number; widthPx?: number }) => ({
              photo_reference: photo.name,
              height: photo.heightPx || 0,
              width: photo.widthPx || 0,
              html_attributions: [],
            }),
          ) || [],
        rating: response.data.rating || 0,
        user_ratings_total: response.data.userRatingCount || 0,
        google_maps_uri: response.data.googleMapsUri || '',
        price_level: response.data.priceLevel || '',
        business_status: response.data.businessStatus || '',
        editorial_summary: response.data.editorialSummary
          ? {
              language:
                response.data.editorialSummary.languageCode || undefined,
              overview:
                response.data.editorialSummary.text ||
                response.data.editorialSummary.overview ||
                '',
            }
          : undefined,
        geometry: response.data.location
          ? {
              location: {
                lat: response.data.location.latitude,
                lng: response.data.location.longitude,
              },
            }
          : undefined,
        opening_hours: response.data.regularOpeningHours
          ? {
              open_now: response.data.regularOpeningHours.openNow || false,
              periods: response.data.regularOpeningHours.periods || [],
              weekday_text:
                response.data.regularOpeningHours.weekdayDescriptions || [],
            }
          : undefined,
        dine_in: response.data.dineIn || false,
        takeout: response.data.takeout || false,
        delivery: response.data.delivery || false,
        curbside_pickup: response.data.curbsidePickup || false,
        serves_breakfast: response.data.servesBreakfast || false,
        serves_lunch: response.data.servesLunch || false,
        serves_dinner: response.data.servesDinner || false,
        serves_beer: response.data.servesBeer || false,
        serves_vegetarian: response.data.servesVegetarianFood || false,
        serves_cocktails: response.data.servesCocktails || false,
        serves_coffee: response.data.servesCoffee || false,
        outdoor_seating: response.data.outdoorSeating || false,
        live_music: response.data.liveMusic || false,
        good_for_children: response.data.goodForChildren || false,
        good_for_groups: response.data.goodForGroups || false,
        restroom: response.data.restroom || false,
        utc_offset: response.data.utcOffsetMinutes || 0,
      }

      return transformedPlace
    } catch (error) {
      console.error('Error fetching Google place by ID:', error)
      return null
    }
  }
}
