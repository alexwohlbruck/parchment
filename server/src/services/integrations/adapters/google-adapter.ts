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
  id: string
  displayName?: {
    text: string
    languageCode?: string
  }
  formattedAddress?: string
  addressComponents?: {
    longText: string
    shortText: string
    types: string[]
  }[]
  internationalPhoneNumber?: string
  websiteUri?: string
  types?: string[]
  photos?: {
    name: string
    widthPx: number
    heightPx: number
    authorAttributions: {
      displayName: string
      uri: string
      photoUri: string
    }[]
  }[]
  rating?: number
  userRatingCount?: number
  regularOpeningHours?: {
    openNow?: boolean
    periods?: {
      open: { day: number; hour: number; minute: number }
      close: { day: number; hour: number; minute: number }
    }[]
    weekdayDescriptions?: string[]
  }
  // Editorial summary with place description
  editorialSummary?: {
    text?: string
    languageCode?: string
  }
  // Location/geometry data
  location?: {
    latitude: number
    longitude: number
  }
  googleMapsUri?: string
  priceLevel?: string
  businessStatus?: string
  dineIn?: boolean
  takeout?: boolean
  delivery?: boolean
  curbsidePickup?: boolean
  servesBreakfast?: boolean
  servesLunch?: boolean
  servesDinner?: boolean
  servesBeer?: boolean
  servesVegetarianFood?: boolean
  servesCocktails?: boolean
  servesCoffee?: boolean
  outdoorSeating?: boolean
  liveMusic?: boolean
  goodForChildren?: boolean
  goodForGroups?: boolean
  restroom?: boolean
  utcOffsetMinutes?: number
}

export interface AutocompletePrediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
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

  // Capability-specific adapters
  autocomplete = {
    adaptPrediction: (
      prediction: AutocompletePrediction,
      id?: string,
    ): Place => {
      // Use the new ID format: source/providerId
      const primaryId = id || `${SOURCE.GOOGLE}/${prediction.placeId}`

      // For autocomplete predictions, we don't have actual coordinates
      const lat = 0
      const lng = 0

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.GOOGLE]: prediction.placeId,
        },
        name: {
          value: prediction.mainText,
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
        address: prediction.secondaryText
          ? {
              value: { formatted: prediction.secondaryText },
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
    },
  }

  placeInfo = {
    adaptPlaceDetails: (data: GooglePlaceDetails, id?: string): Place => {
      console.log('data', data)
      // Use the new ID format: source/providerId
      const primaryId = id || `${SOURCE.GOOGLE}/${data.id}`

      // Generate Google Maps URL if not provided
      let googleMapsUrl = data.googleMapsUri || ''
      if (!googleMapsUrl && data.id) {
        googleMapsUrl = `https://maps.google.com/?place_id=${data.id}`
      }

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.GOOGLE]: data.id,
        },
        name: {
          value: data.displayName?.text || null,
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
              lat: data.location?.latitude || 0,
              lng: data.location?.longitude || 0,
            },
          },
          sourceId: SOURCE.GOOGLE,
        },
        photos: this.extractPhotos(data),
        address: this.extractAddress(data),
        contactInfo: {
          phone: data.internationalPhoneNumber
            ? {
                value: data.internationalPhoneNumber,
                sourceId: SOURCE.GOOGLE,
              }
            : null,
          email: null,
          website: data.websiteUri
            ? {
                value: data.websiteUri,
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
            url: googleMapsUrl,
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
        if (!p.name) return

        const photoId = p.name.split('/').pop()
        if (!photoId) return

        const url = `${GOOGLE_MAPS_PHOTO_URL}?maxwidth=200&photo_reference=${photoId}&key=${this.apiKey}`
        photos.push({
          value: {
            url,
            sourceId: SOURCE.GOOGLE,
            isPrimary: index === 0, // Only mark the first photo as primary
            width: p.widthPx,
            height: p.heightPx,
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
    if (!data.formattedAddress && !data.addressComponents) return null

    const address: Address = {
      formatted: data.formattedAddress,
    }

    if (data.addressComponents) {
      for (const component of data.addressComponents) {
        const types = component.types
        const longText = component.longText
        const shortText = component.shortText

        if (types.includes('street_number')) {
          address.street1 =
            longText + (address.street1 ? ' ' + address.street1 : '')
        } else if (types.includes('route')) {
          address.street1 =
            (address.street1 ? address.street1 + ' ' : '') + longText
        } else if (types.includes('subpremise')) {
          address.street2 = longText
        } else if (types.includes('neighborhood')) {
          address.neighborhood = longText
        } else if (types.includes('locality')) {
          address.locality = longText
        } else if (types.includes('administrative_area_level_1')) {
          address.region = longText
        } else if (types.includes('postal_code')) {
          address.postalCode = longText
        } else if (types.includes('country')) {
          address.country = longText
          address.countryCode = shortText
        }
      }
    }

    return {
      value: address,
      sourceId: SOURCE.GOOGLE,
    }
  }

  /**
   * Extract address from autocomplete prediction data
   */
  private extractAddressFromPrediction(
    prediction: any,
    fallbackFormatted: string,
  ): AttributedValue<Address> | null {
    // Check if we have addressComponents directly in the prediction
    if (prediction.addressComponents) {
      return this.extractAddress({
        formattedAddress: fallbackFormatted,
        addressComponents: prediction.addressComponents,
      } as GooglePlaceDetails)
    }

    // Check if we have enriched place details with address components
    if (prediction.details?.addressComponents) {
      return this.extractAddress({
        formattedAddress:
          prediction.details.formattedAddress || fallbackFormatted,
        addressComponents: prediction.details.addressComponents,
      } as GooglePlaceDetails)
    }

    // Fallback to formatted address only
    if (fallbackFormatted) {
      return {
        value: { formatted: fallbackFormatted },
        sourceId: SOURCE.GOOGLE,
      }
    }

    return null
  }

  /**
   * Extract opening hours from Google place data
   */
  private extractOpeningHours(
    data: GooglePlaceDetails,
  ): AttributedValue<OpeningHours> | null {
    if (!data.regularOpeningHours?.weekdayDescriptions) return null

    try {
      const hoursText = data.regularOpeningHours.weekdayDescriptions.join('; ')
      const regularHours = parseGoogleHours(hoursText)

      const openingHours: OpeningHours = {
        regularHours,
        isOpen24_7: false,
        isPermanentlyClosed:
          data.businessStatus === BUSINESS_STATUS.CLOSED_PERMANENTLY,
        isTemporarilyClosed:
          data.businessStatus === BUSINESS_STATUS.CLOSED_TEMPORARILY,
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
    if (data.priceLevel) {
      amenities.price_level = String(data.priceLevel)
    }

    if (data.businessStatus) {
      amenities.business_status = data.businessStatus
    }

    // Add UTC offset information
    if (data.utcOffsetMinutes !== undefined) {
      amenities.utc_offset_minutes = String(data.utcOffsetMinutes)
    }

    // Add boolean amenities
    const booleanAmenities: Record<string, boolean | undefined> = {
      dine_in: data.dineIn,
      takeout: data.takeout,
      delivery: data.delivery,
      curbside_pickup: data.curbsidePickup,
      serves_breakfast: data.servesBreakfast,
      serves_lunch: data.servesLunch,
      serves_dinner: data.servesDinner,
      serves_beer: data.servesBeer,
      serves_cocktails: data.servesCocktails,
      serves_vegetarian_food: data.servesVegetarianFood,
      serves_coffee: data.servesCoffee,
      outdoor_seating: data.outdoorSeating,
      live_music: data.liveMusic,
      good_for_children: data.goodForChildren,
      good_for_groups: data.goodForGroups,
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
        value: data.userRatingCount || 0,
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
    if (!data.editorialSummary?.text) return undefined

    return {
      value: data.editorialSummary.text,
      sourceId: SOURCE.GOOGLE,
    }
  }

  // Additional adapter methods for other capabilities
}
