import type { GooglePlaceDetails } from '../../../types/place.types'
import type {
  UnifiedPlace,
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
} from '../../../types/unified-place.types'
import {
  GOOGLE_MAPS_PHOTO_URL,
  BUSINESS_STATUS,
  SOURCE,
} from '../../../lib/constants'
import { parseGoogleHours } from '../../../lib/hours.utils'
import { getTimestamp } from '../../../services/merge.service'

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
  adaptPlace(data: GooglePlaceDetails, id?: string): UnifiedPlace {
    try {
      // Create a base unified place
      const unifiedPlace: UnifiedPlace = {
        id: id || `${SOURCE.GOOGLE}/${data.place_id}`,
        externalIds: { [SOURCE.GOOGLE]: data.place_id },
        name: data.name || 'Unnamed Place',
        placeType: data.types?.[0] || 'unknown',
        geometry: {
          type: 'point',
          center: {
            lat: data.geometry?.location?.lat || 0,
            lng: data.geometry?.location?.lng || 0,
          },
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
        openingHours: this.extractOpeningHours(data)
          ? this.extractOpeningHours(data)?.value || null
          : null,
        amenities: this.extractAmenities(data),
        ratings: this.extractRatings(data),
        description: this.extractDescription(data)?.value,
        sources: [
          {
            id: SOURCE.GOOGLE,
            name: 'Google',
            url: data.google_maps_uri || '',
          },
        ],
        lastUpdated: getTimestamp(),
        createdAt: getTimestamp(),
      }

      return unifiedPlace
    } catch (error) {
      console.error('Error adapting Google place data:', error)

      // Return minimal valid place data
      return {
        id: id || `${SOURCE.GOOGLE}/${data.place_id || 'unknown'}`,
        externalIds: { [SOURCE.GOOGLE]: data.place_id || 'unknown' },
        name: data.name || 'Unnamed Place',
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
        lastUpdated: getTimestamp(),
        createdAt: getTimestamp(),
      }
    }
  }

  /**
   * Extract photos from Google place data
   */
  private extractPhotos(data: GooglePlaceDetails): PlacePhoto[] {
    if (!data.photos?.length) return []

    const photos: PlacePhoto[] = []

    try {
      data.photos.forEach((p, index) => {
        // Skip photos with missing data
        if (!p.photo_reference) return

        const photoId = p.photo_reference.split('/').pop()
        if (!photoId) return

        const url = `${GOOGLE_MAPS_PHOTO_URL}?maxwidth=800&photo_reference=${photoId}&key=${process.env.GOOGLE_MAPS_API_KEY}`
        photos.push({
          url,
          sourceId: SOURCE.GOOGLE,
          isPrimary: index === 0, // Only mark the first photo as primary
          width: p.width,
          height: p.height,
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
  private extractAddress(data: GooglePlaceDetails): Address | null {
    if (!data.formatted_address) return null

    return {
      formatted: data.formatted_address,
    }
  }

  /**
   * Extract contact info from Google place data
   */
  private extractContactInfo(data: GooglePlaceDetails): {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  } {
    return {
      phone: data.formatted_phone_number
        ? {
            value: data.formatted_phone_number,
            sourceId: SOURCE.GOOGLE,
          }
        : null,
      email: null, // Google doesn't provide email
      website: data.website
        ? {
            value: data.website,
            sourceId: SOURCE.GOOGLE,
          }
        : null,
      socials: {}, // Google doesn't provide social media links
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
