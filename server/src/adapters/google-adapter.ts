import type { GooglePlaceDetails } from '../types/place.types'
import type { PlaceDataAdapter } from '../types/adapter.types'
import type {
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
} from '../types/unified-place.types'
import { GOOGLE_MAPS_PHOTO_URL } from '../lib/constants'
import { parseGoogleHours } from '../lib/hours.utils'
import { getTimestamp } from '../services/merge.service'
import { BUSINESS_STATUS, SOURCE } from '../lib/constants'

/**
 * Adapter for transforming Google Places API data to our unified format
 */
export const googleAdapter: PlaceDataAdapter = {
  sourceId: SOURCE.GOOGLE,
  sourceName: 'Google',
  sourceUrl: (data: GooglePlaceDetails) => data.google_maps_uri || '',
  transform: (data: GooglePlaceDetails) => {
    try {
      const transformed: ReturnType<PlaceDataAdapter['transform']> = {
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        amenities: {},
      }

      // Name
      if (data.name) {
        transformed.name = {
          value: data.name,
          sourceId: SOURCE.GOOGLE,
        }
      }

      // Description - from editorial_summary if available
      if (data.editorial_summary?.overview) {
        transformed.description = {
          value: data.editorial_summary.overview,
          sourceId: SOURCE.GOOGLE,
        }
      } else if (data.editorial_summary?.text) {
        // Alternative field name that might be used
        transformed.description = {
          value: data.editorial_summary.text,
          sourceId: SOURCE.GOOGLE,
        }
      }

      // Photos
      if (data.photos?.length) {
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

        if (photos.length > 0) {
          transformed.photos = photos
        }
      }

      // Address
      if (data.formatted_address) {
        const address: Address = {
          formatted: data.formatted_address,
        }

        transformed.address = {
          value: address,
          sourceId: SOURCE.GOOGLE,
        }
      }

      // Opening Hours
      if (data.opening_hours?.weekday_text) {
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

          transformed.openingHours = {
            value: openingHours,
            sourceId: SOURCE.GOOGLE,
          }
        } catch (error) {
          console.error('Error processing Google opening hours:', error)
        }
      }

      // Ratings
      if (data.rating !== undefined) {
        transformed.ratings = {
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

      // Contact info
      transformed.contactInfo = {
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

      // Amenities
      const amenities: Record<string, AttributedValue<string>[]> = {}

      // Add place types as amenities
      if (data.types?.length) {
        data.types.forEach((type) => {
          const key = `type:${type}`
          amenities[key] = [
            {
              value: type,
              sourceId: SOURCE.GOOGLE,
            },
          ]
        })
      }

      // Add scalar amenities
      if (data.price_level) {
        amenities.price_level = [
          {
            value: String(data.price_level),
            sourceId: SOURCE.GOOGLE,
          },
        ]
      }

      if (data.business_status) {
        amenities.business_status = [
          {
            value: data.business_status,
            sourceId: SOURCE.GOOGLE,
          },
        ]
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
          amenities[key] = [
            {
              value: String(value),
              sourceId: SOURCE.GOOGLE,
            },
          ]
        }
      })

      if (Object.keys(amenities).length > 0) {
        transformed.amenities = amenities
      }

      return transformed
    } catch (error) {
      console.error('Error transforming Google Places data:', error)
      return {
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        amenities: {},
      }
    }
  },
}
