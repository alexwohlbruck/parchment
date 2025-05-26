import type {
  Place,
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
} from '../../../types/place.types'
import {
  GOOGLE_MAPS_PHOTO_URL,
  BUSINESS_STATUS,
  SOURCE,
} from '../../../lib/constants'
import { parseGoogleHours } from '../../../lib/hours.utils'

// TODO: Move this type def
export interface GooglePlaceDetails {
  place_id: string
  name: string
  formatted_address: string
  formatted_phone_number: string
  website: string
  types: string[]
  photos: {
    photo_reference: string
    height: number
    width: number
    html_attributions: string[]
  }[]
  rating: number
  user_ratings_total: number
  opening_hours?: {
    open_now?: boolean
    periods?: {
      open: { day: number; time: string }
      close: { day: number; time: string }
    }[]
    weekday_text?: string[]
  }
  // Editorial summary with place description
  editorial_summary?: {
    language?: string
    languageCode?: string
    overview?: string
    text?: string
  }
  // Location/geometry data
  geometry?: {
    location: {
      lat: number
      lng: number
    }
  }
  google_maps_uri?: string
  price_level?: string
  business_status?: string
  dine_in?: boolean
  takeout?: boolean
  delivery?: boolean
  curbside_pickup?: boolean
  serves_breakfast?: boolean
  serves_lunch?: boolean
  serves_dinner?: boolean
  serves_beer?: boolean
  serves_cocktails?: boolean
  outdoor_seating?: boolean
  live_music?: boolean
  good_for_children?: boolean
  good_for_groups?: boolean
  restroom?: boolean
  utc_offset?: number
}

/**
 * Adapter for transforming Google Maps API data to unified formats
 */
export class GoogleAdapter {
  private apiKey: string = ''

  /**
   * Set the API key for this adapter instance
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  /**
   * Legacy method for backward compatibility
   * Transforms Google Places API data to our unified place format
   * Handles both place details and autocomplete predictions
   */
  adaptPlace(data: any, id?: string): Place {
    // Check if this is an autocomplete prediction
    const isAutocompletePrediction =
      data.place_id && data.description && !data.formatted_address

    if (isAutocompletePrediction) {
      return this.autocomplete.adaptPrediction(data, id)
    }

    // Handle as regular place details
    return this.placeInfo.adaptPlaceDetails(data as GooglePlaceDetails, id)
  }

  // Capability-specific adapters
  autocomplete = {
    adaptPrediction: (prediction: any, id?: string): Place => {
      // Extract the place name (removing it from the description to create a better formatted address)
      const placeName =
        prediction.structured_formatting?.main_text ||
        prediction.description?.split(',')[0] ||
        'Unknown Place'

      // Determine the best address to use
      let formattedAddress = ''

      // First priority: Use enriched place details' formatted_address if available
      if (prediction.details?.formatted_address) {
        formattedAddress = prediction.details.formatted_address
      }
      // Second priority: Extract address components from the description
      else {
        const descriptionParts =
          prediction.description
            ?.split(',')
            .map((part: string) => part.trim()) || []

        // Remove the place name from the description since it's already in the name field
        if (descriptionParts.length > 0) {
          descriptionParts.shift() // Remove the first part (place name)
        }

        // Create a cleaner formatted address without the place name
        formattedAddress = descriptionParts.join(', ')
      }

      // For autocomplete predictions, we don't have actual coordinates by default
      // Set to 0,0 to indicate unknown coordinates
      let lat = 0
      let lng = 0

      // Check if we have enriched place details with geometry data
      if (prediction.details?.geometry?.value?.center) {
        lat = prediction.details.geometry.value.center.lat
        lng = prediction.details.geometry.value.center.lng
      }
      // Check if we have minimal place details with direct geometry
      else if (prediction.details?.geometry?.location) {
        lat = prediction.details.geometry.location.lat
        lng = prediction.details.geometry.location.lng
      }
      // Fallback: check if geometry data is directly on the prediction
      else if (prediction.geometry?.location) {
        lat = prediction.geometry.location.lat
        lng = prediction.geometry.location.lng
      }

      // Use the new ID format: source/providerId
      const primaryId = id || `${SOURCE.GOOGLE}/${prediction.place_id}`

      const place = {
        id: primaryId,
        externalIds: {
          [SOURCE.GOOGLE]: prediction.place_id,
        },
        name: {
          value: placeName,
          sourceId: SOURCE.GOOGLE,
        },
        description: null,
        placeType: {
          value: prediction.types?.[0] || 'establishment',
          sourceId: SOURCE.GOOGLE,
        },
        geometry: {
          value: {
            type: 'point' as const,
            center: { lat, lng },
          },
          sourceId: SOURCE.GOOGLE,
        },
        photos: [],
        address: formattedAddress
          ? {
              value: { formatted: formattedAddress },
              sourceId: SOURCE.GOOGLE,
            }
          : null,
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        amenities: prediction.types
          ? prediction.types.reduce((acc: any, type: string) => {
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

      return place
    },
  }

  placeInfo = {
    adaptPlaceDetails: (data: GooglePlaceDetails, id?: string): Place => {
      // Use the new ID format: source/providerId
      const primaryId = id || `${SOURCE.GOOGLE}/${data.place_id}`

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.GOOGLE]: data.place_id,
        },
        name: {
          value: data.name || 'Unnamed Place',
          sourceId: SOURCE.GOOGLE,
        },
        placeType: {
          value: data.types?.[0] || 'unknown',
          sourceId: SOURCE.GOOGLE,
        },
        geometry: {
          value: {
            type: 'point' as const,
            center: {
              lat: data.geometry?.location?.lat || 0,
              lng: data.geometry?.location?.lng || 0,
            },
          },
          sourceId: SOURCE.GOOGLE,
        },
        photos: this.extractPhotos(data),
        address: this.extractAddress(data),
        contactInfo: {
          phone: data.formatted_phone_number
            ? {
                value: data.formatted_phone_number,
                sourceId: SOURCE.GOOGLE,
              }
            : null,
          email: null,
          website: data.website
            ? {
                value: data.website,
                sourceId: SOURCE.GOOGLE,
              }
            : null,
          socials: {},
        },
        openingHours: this.extractOpeningHours(data),
        amenities: this.extractAmenities(data),
        ratings: this.extractRatings(data),
        description: this.extractDescription(data) || null,
        sources: [
          {
            id: SOURCE.GOOGLE,
            name: 'Google',
            url: data.google_maps_uri || '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    },
  }

  /**
   * Extract photos from Google place data
   */
  private extractPhotos(
    data: GooglePlaceDetails,
  ): AttributedValue<PlacePhoto>[] {
    if (!data.photos?.length) return []

    const photos: AttributedValue<PlacePhoto>[] = []

    try {
      data.photos.forEach((p, index) => {
        // Skip photos with missing data
        if (!p.photo_reference) return

        const photoId = p.photo_reference.split('/').pop()
        if (!photoId) return

        const url = `${GOOGLE_MAPS_PHOTO_URL}?maxwidth=800&photo_reference=${photoId}&key=${this.apiKey}`
        photos.push({
          value: {
            url,
            sourceId: SOURCE.GOOGLE,
            isPrimary: index === 0, // Only mark the first photo as primary
            width: p.width,
            height: p.height,
          },
          sourceId: SOURCE.GOOGLE,
        })
      })
    } catch (error) {
      console.error('Error processing Google photos:', error)
    }

    return photos
  }

  /**
   * Extract address from Google place data
   */
  private extractAddress(
    data: GooglePlaceDetails,
  ): AttributedValue<Address> | null {
    if (!data.formatted_address) return null

    return {
      value: {
        formatted: data.formatted_address,
      },
      sourceId: SOURCE.GOOGLE,
    }
  }

  /**
   * Extract opening hours from Google place data
   */
  private extractOpeningHours(
    data: GooglePlaceDetails,
  ): AttributedValue<OpeningHours> | null {
    if (!data.opening_hours?.weekday_text) return null

    try {
      const hoursText = data.opening_hours.weekday_text.join('; ')
      const regularHours = parseGoogleHours(hoursText)

      const openingHours: OpeningHours = {
        regularHours,
        isOpen24_7: false,
        isPermanentlyClosed:
          data.business_status === BUSINESS_STATUS.CLOSED_PERMANENTLY,
        isTemporarilyClosed:
          data.business_status === BUSINESS_STATUS.CLOSED_TEMPORARILY,
        rawText: hoursText,
      }

      return {
        value: openingHours,
        sourceId: SOURCE.GOOGLE,
      }
    } catch (error) {
      console.error('Error processing Google opening hours:', error)
      return null
    }
  }

  /**
   * Extract amenities from Google place data
   */
  private extractAmenities(data: GooglePlaceDetails): Record<string, any> {
    const amenities: Record<string, any> = {}

    // Add place types as amenities
    if (data.types?.length) {
      data.types.forEach((type) => {
        const key = `type:${type}`
        amenities[key] = type
      })
    }

    // Add scalar amenities
    if (data.price_level) {
      amenities.price_level = String(data.price_level)
    }

    if (data.business_status) {
      amenities.business_status = data.business_status
    }

    // Add boolean amenities
    const booleanAmenities: Record<string, boolean | undefined> = {
      dine_in: data.dine_in,
      takeout: data.takeout,
      delivery: data.delivery,
      curbside_pickup: data.curbside_pickup,
      serves_breakfast: data.serves_breakfast,
      serves_lunch: data.serves_lunch,
      serves_dinner: data.serves_dinner,
      serves_beer: data.serves_beer,
      serves_cocktails: data.serves_cocktails ?? false,
      outdoor_seating: data.outdoor_seating,
      live_music: data.live_music,
      good_for_children: data.good_for_children,
      good_for_groups: data.good_for_groups,
      restroom: data.restroom,
    }

    Object.entries(booleanAmenities).forEach(([key, value]) => {
      if (value !== undefined) {
        amenities[key] = String(value)
      }
    })

    return amenities
  }

  /**
   * Extract ratings from Google place data
   */
  private extractRatings(data: GooglePlaceDetails):
    | {
        rating: AttributedValue<number>
        reviewCount: AttributedValue<number>
      }
    | undefined {
    if (data.rating === undefined) return undefined

    return {
      rating: {
        value: Number((data.rating / 5).toFixed(2)), // Normalize to 0-1 scale
        sourceId: SOURCE.GOOGLE,
      },
      reviewCount: {
        value: data.user_ratings_total || 0,
        sourceId: SOURCE.GOOGLE,
      },
    }
  }

  /**
   * Extract description from Google place data
   */
  private extractDescription(
    data: GooglePlaceDetails,
  ): AttributedValue<string> | undefined {
    if (!data.editorial_summary?.overview && !data.editorial_summary?.text)
      return undefined

    return {
      value:
        data.editorial_summary?.overview || data.editorial_summary?.text || '',
      sourceId: SOURCE.GOOGLE,
    }
  }

  // Additional adapter methods for other capabilities
}
