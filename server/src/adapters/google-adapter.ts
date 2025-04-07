import type { GooglePlaceDetails } from '../types/place.types'
import type { PlaceDataAdapter } from '../types/adapter.types'
import { GOOGLE_MAPS_PHOTO_URL } from '../services/external-api.service'
import { parseGoogleHours } from '../lib/hours.utils'

export const googleAdapter: PlaceDataAdapter = {
  sourceId: 'google',
  sourceName: 'Google',
  sourceUrl: (data: GooglePlaceDetails) => data.google_maps_uri,
  transform: (data: GooglePlaceDetails) => {
    const transformed: any = {}

    if (data.name) {
      transformed.name = {
        value: data.name,
        sourceId: 'google',
      }
    }

    if (data.photos?.length) {
      transformed.photos = data.photos.map((p) => {
        const photoId = p.photo_reference.split('/').pop()
        const url = `${GOOGLE_MAPS_PHOTO_URL}?maxwidth=800&photo_reference=${photoId}&key=${process.env.GOOGLE_MAPS_API_KEY}`
        return {
          url,
          sourceId: 'google',
          isPrimary: true,
          width: p.width,
          height: p.height,
        }
      })
    }

    if (data.formatted_address) {
      transformed.address = {
        value: { formatted: data.formatted_address },
        sourceId: 'google',
      }
    }

    if (data.opening_hours?.weekday_text) {
      const regularHours = parseGoogleHours(
        data.opening_hours.weekday_text.join('; '),
      )

      transformed.openingHours = {
        value: {
          regularHours,
          isOpen24_7: false,
          isPermanentlyClosed: data.business_status === 'CLOSED_PERMANENTLY',
          isTemporarilyClosed: data.business_status === 'CLOSED_TEMPORARILY',
          rawText: data.opening_hours.weekday_text.join('; '),
        },
        sourceId: 'google',
      }
    }

    if (data.rating !== undefined) {
      transformed.ratings = {
        rating: {
          value: Number((data.rating / 5).toFixed(2)),
          sourceId: 'google',
          timestamp: new Date().toISOString(),
        },
        reviewCount: {
          value: data.user_ratings_total || 0,
          sourceId: 'google',
          timestamp: new Date().toISOString(),
        },
      }
    }

    transformed.contactInfo = {
      phone: data.formatted_phone_number
        ? {
            value: data.formatted_phone_number,
            sourceId: 'google',
            timestamp: new Date().toISOString(),
          }
        : null,
      email: null,
      website: data.website
        ? {
            value: data.website,
            sourceId: 'google',
            timestamp: new Date().toISOString(),
          }
        : null,
      socials: {},
    }

    // Transform amenities
    const amenities: Record<string, any> = {}

    // Add type-based amenities
    if (data.types?.length) {
      data.types.forEach((type) => {
        amenities[`type:${type}`] = [
          {
            value: type,
            sourceId: 'google',
          },
        ]
      })
    }

    // Add price level if available
    if (data.price_level) {
      amenities.price_level = [
        {
          value: data.price_level,
          sourceId: 'google',
        },
      ]
    }

    // Add business status if available
    if (data.business_status) {
      amenities.business_status = [
        {
          value: data.business_status,
          sourceId: 'google',
        },
      ]
    }

    // Add boolean amenities
    const booleanAmenities = {
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

    // Add boolean amenities that are defined
    Object.entries(booleanAmenities).forEach(([key, value]) => {
      if (value !== undefined) {
        amenities[key] = [
          {
            value,
            sourceId: 'google',
          },
        ]
      }
    })

    transformed.amenities = amenities

    return transformed
  },
}
