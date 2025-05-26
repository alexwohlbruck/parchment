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
  // New fields
  google_maps_uri: string
  price_level: string
  business_status: string
  dine_in: boolean
  takeout: boolean
  delivery: boolean
  curbside_pickup: boolean
  serves_breakfast: boolean
  serves_lunch: boolean
  serves_dinner: boolean
  serves_beer: boolean
  serves_vegetarian: boolean
  serves_cocktails: boolean
  serves_coffee: boolean
  outdoor_seating: boolean
  live_music: boolean
  good_for_children: boolean
  good_for_groups: boolean
  restroom: boolean
  utc_offset: number
}

// Access environment variables - define missing type
declare const process: {
  env: {
    GOOGLE_MAPS_API_KEY: string
    [key: string]: string | undefined
  }
}

/**
 * Adapter for transforming Google Maps API data to unified formats
 */
export class GoogleAdapter {
  /**
   * Transforms Google Places API data to our unified place format
   */
  adaptPlace(data: GooglePlaceDetails, id?: string): Place {
    return {
      id: id || `${SOURCE.GOOGLE}/${data.place_id}`,
      externalIds: { [SOURCE.GOOGLE]: data.place_id },
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
          type: 'point',
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

        const url = `${GOOGLE_MAPS_PHOTO_URL}?maxwidth=800&photo_reference=${photoId}&key=${process.env.GOOGLE_MAPS_API_KEY}`
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
      serves_vegetarian: data.serves_vegetarian,
      serves_cocktails: data.serves_cocktails,
      serves_coffee: data.serves_coffee,
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

  // TODO: Remove this and user regular adapter function
  /**
   * Transform autocomplete predictions to a standard format
   */
  adaptAutocompletePrediction(prediction: any): any {
    try {
      if (!prediction) {
        throw new Error('Invalid prediction data')
      }

      // Use a fallback place_id if not provided
      if (!prediction.place_id) {
        console.warn('Google prediction missing place_id:', prediction)
      }

      // Extract the place name (removing it from the description to create a better formatted address)
      const placeName =
        prediction.structured_formatting?.main_text ||
        prediction.description?.split(',')[0] ||
        'Unknown Place'

      // Extract address components from the description
      // Format: "[Place Name], [Street], [City], [State/Province], [Country]"
      const descriptionParts =
        prediction.description?.split(',').map((part: string) => part.trim()) ||
        []

      // Remove the place name from the description since it's already in the name field
      // This helps avoid redundancy in address formatting
      if (descriptionParts.length > 0) {
        descriptionParts.shift() // Remove the first part (place name)
      }

      // Create a cleaner formatted address without the place name
      const formattedAddress = descriptionParts.join(', ')

      // Try to determine location from the prediction data
      // Google Places API doesn't include coordinate data in autocomplete predictions
      // But we'll extract a location bias from the request to help with deduplication
      let lat = prediction.structured_formatting?.location?.lat || 0
      let lng = prediction.structured_formatting?.location?.lng || 0

      // If we have a location from the structured_formatting, use it
      if (prediction.lat !== undefined && prediction.lng !== undefined) {
        lat = prediction.lat
        lng = prediction.lng
      }

      return {
        id:
          prediction.place_id ||
          `${SOURCE.GOOGLE}/place_${Math.floor(Math.random() * 1000000)}`,
        name: placeName,
        description: formattedAddress,
        types: prediction.types || ['establishment'],
        source: SOURCE.GOOGLE,
        placeId: prediction.place_id,
        geometry: {
          lat: lat,
          lng: lng,
        },
        // Provide structured address data similar to Pelias
        addressDetails: {
          formatted: formattedAddress,
          // We don't have detailed address components from Google autocomplete
          // but we'll provide what we have for consistency with Pelias
          street: descriptionParts[0] || null,
          locality: descriptionParts[1] || null,
          region: descriptionParts[2] || null,
          country: descriptionParts[3] || null,
        },
      }
    } catch (error) {
      console.error('Error adapting Google autocomplete prediction:', error)
      return {
        id: `${SOURCE.GOOGLE}/unknown_${Math.floor(Math.random() * 1000000)}`,
        name:
          prediction?.structured_formatting?.main_text ||
          prediction?.description?.split(',')[0] ||
          'Unknown Place',
        description: prediction?.description || 'No description available',
        types: ['unknown'],
        source: SOURCE.GOOGLE,
        geometry: {
          lat: 0,
          lng: 0,
        },
      }
    }
  }

  // Additional adapter methods for other capabilities
}
