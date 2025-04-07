import type { Place } from '../types/place.types'
import type { PlaceDataAdapter } from '../types/adapter.types'
import type {
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
} from '../types/unified-place.types'
import { parseOsmHours } from '../lib/hours.utils'
import { getTimestamp } from '../services/merge.service'
import { getPlaceType } from '../lib/place.utils'
import {
  UnifiedPlace,
  PlaceGeometry,
  Coordinates,
  OpeningTime,
  SourceReference,
} from '../types/unified-place.types'
import { encode } from 'pluscodes'
import { SOURCE } from '../lib/constants'

/**
 * Adapter for transforming OpenStreetMap data to our unified format
 */
export const osmAdapter: PlaceDataAdapter = {
  sourceId: SOURCE.OSM,
  sourceName: 'OpenStreetMap',
  sourceUrl: (place: Place) =>
    `https://www.openstreetmap.org/${place.type}/${place.id}`,
  transform: (place: Place) => {
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

      if (!place.tags) return transformed

      // Extract OSM metadata for attribution
      const osmUpdatedBy = place.user
      const osmTimestamp = place.timestamp || getTimestamp()

      // Name
      const name = place.tags.name || place.tags['brand:name']
      if (name) {
        transformed.name = {
          value: name,
          sourceId: SOURCE.OSM,
          timestamp: osmTimestamp,
          updatedBy: osmUpdatedBy,
        }
      }

      // Description
      const description = place.tags.description
      if (description) {
        transformed.description = {
          value: description,
          sourceId: SOURCE.OSM,
          timestamp: osmTimestamp,
          updatedBy: osmUpdatedBy,
        }
      }

      // Address
      const address = extractAddress(place.tags)
      if (address) {
        transformed.address = {
          value: address,
          sourceId: SOURCE.OSM,
          timestamp: osmTimestamp,
          updatedBy: osmUpdatedBy,
        }
      }

      // Contact Info
      const contactInfo = extractContactInfo(
        place.tags,
        osmTimestamp,
        osmUpdatedBy,
      )
      transformed.contactInfo = contactInfo

      // Opening Hours
      const openingHours = parseOsmHours(place.tags)
      if (openingHours) {
        transformed.openingHours = {
          value: openingHours,
          sourceId: SOURCE.OSM,
          timestamp: osmTimestamp,
          updatedBy: osmUpdatedBy,
        }
      }

      // Photos
      const photos: PlacePhoto[] = []

      // Handle Wikidata images, if they were merged into the place object
      if (place.image) {
        photos.push({
          url: place.image,
          sourceId: SOURCE.OSM,
          isPrimary: true,
        })
      }

      if (place.brandLogo) {
        photos.push({
          url: place.brandLogo,
          sourceId: SOURCE.OSM,
          isLogo: true,
        })
      }

      if (photos.length > 0) {
        transformed.photos = photos
      }

      // Amenities
      transformed.amenities = extractAmenities(
        place.tags,
        osmTimestamp,
        osmUpdatedBy,
      )

      return transformed
    } catch (error) {
      console.error('Error transforming OSM data:', error)
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

/**
 * Extract address information from OSM tags
 */
function extractAddress(tags: Record<string, string>): Address | null {
  const address: Address = {}

  if (tags['addr:housenumber'] || tags['addr:street']) {
    address.street1 = [tags['addr:housenumber'], tags['addr:street']]
      .filter(Boolean)
      .join(' ')
  }

  address.street2 = tags['addr:unit'] || undefined
  address.locality = tags['addr:city'] || undefined
  address.region = tags['addr:state'] || undefined
  address.postalCode = tags['addr:postcode'] || undefined
  address.country = tags['addr:country'] || undefined
  address.countryCode = tags['addr:country'] || undefined

  // Create formatted address
  const formattedParts = [
    address.street1,
    address.street2,
    address.locality ? `${address.locality}${address.region ? ',' : ''}` : '',
    address.region,
    address.postalCode,
    address.country,
  ].filter(Boolean)

  address.formatted = formattedParts.join(' ')

  // Return null if no address components found
  return Object.keys(address).length > 0 ? address : null
}

/**
 * Extract contact information from OSM tags
 */
function extractContactInfo(
  tags: Record<string, string>,
  timestamp: string,
  updatedBy?: string,
): {
  phone: AttributedValue<string> | null
  email: AttributedValue<string> | null
  website: AttributedValue<string> | null
  socials: Record<string, AttributedValue<string>>
} {
  const contactInfo = {
    phone: null as AttributedValue<string> | null,
    email: null as AttributedValue<string> | null,
    website: null as AttributedValue<string> | null,
    socials: {} as Record<string, AttributedValue<string>>,
  }

  // Phone number
  if (tags.phone) {
    contactInfo.phone = {
      value: tags.phone,
      sourceId: SOURCE.OSM,
      timestamp,
      updatedBy,
    }
  }

  // Email (check both standard and contact: prefix)
  const email = tags.email || tags['contact:email']
  if (email) {
    contactInfo.email = {
      value: email,
      sourceId: SOURCE.OSM,
      timestamp,
      updatedBy,
    }
  }

  // Website
  if (tags.website) {
    contactInfo.website = {
      value: tags.website,
      sourceId: SOURCE.OSM,
      timestamp,
      updatedBy,
    }
  }

  // Social media links
  const socialMap = {
    'contact:facebook': 'facebook',
    'contact:instagram': 'instagram',
    'contact:twitter': 'twitter',
    'contact:linkedin': 'linkedin',
    'contact:youtube': 'youtube',
    'contact:pinterest': 'pinterest',
  }

  for (const [key, platform] of Object.entries(socialMap)) {
    if (tags[key]) {
      contactInfo.socials[platform] = {
        value: tags[key],
        sourceId: SOURCE.OSM,
        timestamp,
        updatedBy,
      }
    }
  }

  return contactInfo
}

/**
 * Extract amenities from OSM tags
 */
function extractAmenities(
  tags: Record<string, string>,
  timestamp: string,
  updatedBy?: string,
): Record<string, AttributedValue<string>[]> {
  const amenities: Record<string, AttributedValue<string>[]> = {}

  // List of common amenity tags to capture
  const knownAmenityTags = [
    'wheelchair',
    'internet_access',
    'smoking',
    'toilets',
    'outdoor_seating',
    'payment:credit_cards',
    'payment:cash',
    'payment:debit_cards',
    'payment:mastercard',
    'payment:visa',
    'payment:amex',
    'delivery',
    'takeaway',
    'drive_through',
    'air_conditioning',
    'wifi',
    'toilets:wheelchair',
    'internet_access:fee',
    'internet_access:ssid',
    'cuisine',
    'diet:vegetarian',
    'diet:vegan',
    'diet:gluten_free',
  ]

  for (const [key, value] of Object.entries(tags)) {
    // Skip address, name, contact, and opening hours tags which are handled separately
    if (
      value &&
      !key.startsWith('addr:') &&
      !['name', 'website', 'phone', 'opening_hours'].includes(key) &&
      (knownAmenityTags.includes(key) || key.includes(':'))
    ) {
      amenities[key] = [
        {
          value: value,
          sourceId: SOURCE.OSM,
          timestamp,
          updatedBy,
        },
      ]
    }
  }

  return amenities
}
