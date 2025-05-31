import type {
  Place,
  AttributedValue,
  Address,
  OpeningHours,
} from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'
import { getPlaceType } from '../../../lib/place.utils'
import { parseOpeningHoursForUnifiedFormat } from '../../../lib/place.utils'

// TODO: Move this type def to a shared types file
export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
  bounds?: {
    minlat: number
    maxlat: number
    minlon: number
    maxlon: number
  }
  center?: { lat: number; lon: number }
}

/**
 * Adapter for transforming Overpass/OSM API data to unified formats
 */
export class OverpassAdapter {
  // Capability-specific adapters
  placeInfo = {
    adaptPlaceDetails: (data: OverpassElement, id?: string): Place => {
      // Use the new ID format: source/providerId
      const osmId = `${data.type}/${data.id}`
      const primaryId = id || `${SOURCE.OSM}/${osmId}`

      // Calculate center if not provided
      const center = this.calculatePlaceCenter(data)

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.OSM]: osmId,
        },
        name: {
          value: this.extractName(data.tags) || 'Unnamed Place',
          sourceId: SOURCE.OSM,
        },
        placeType: {
          value: getPlaceType(data.tags || {}) || 'unknown',
          sourceId: SOURCE.OSM,
        },
        geometry: {
          value: {
            type: 'point' as const,
            center: center || { lat: 0, lng: 0 },
          },
          sourceId: SOURCE.OSM,
        },
        photos: [], // OSM doesn't typically have photos
        address: this.extractOsmAddress(data.tags),
        contactInfo: this.extractContactInfo(data.tags),
        openingHours: this.extractOpeningHours(data.tags),
        amenities: this.extractAmenities(data.tags),
        description: this.extractDescription(data.tags),
        sources: [
          {
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: `https://www.openstreetmap.org/${data.type}/${data.id}`,
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    },
  }

  /**
   * Extract the name from OSM tags
   * @param tags OSM tags object
   * @returns The place name
   */
  private extractName(tags?: Record<string, string>): string | null {
    if (!tags) return null

    // Priority order for name extraction
    return (
      tags.name ||
      tags['name:en'] ||
      tags.brand ||
      tags['brand:name'] ||
      tags.operator ||
      tags.ref ||
      null
    )
  }

  /**
   * Extract description from OSM tags
   * @param tags OSM tags object
   * @returns Description if available
   */
  private extractDescription(
    tags?: Record<string, string>,
  ): AttributedValue<string> | null {
    if (!tags) return null

    const description =
      tags.description ||
      tags['description:en'] ||
      tags.note ||
      tags.comment ||
      null

    if (!description) return null

    return {
      value: description,
      sourceId: SOURCE.OSM,
    }
  }

  /**
   * Calculate the center point of a place
   * @param place OSM place object
   * @returns Center coordinates or null if not determinable
   */
  private calculatePlaceCenter(
    place: OverpassElement,
  ): { lat: number; lng: number } | null {
    // If the API provides a center, use it
    if (place.center) {
      return { lat: place.center.lat, lng: place.center.lon }
    }

    // For nodes, use their coordinates
    if (place.type === 'node' && place.lat && place.lon) {
      return { lat: place.lat, lng: place.lon }
    }

    // For ways and relations with geometry, calculate centroid
    if (place.geometry && place.geometry.length > 0) {
      let sumLat = 0
      let sumLon = 0
      const nodes = place.geometry

      for (const node of nodes) {
        sumLat += node.lat
        sumLon += node.lon
      }

      return {
        lat: sumLat / nodes.length,
        lng: sumLon / nodes.length,
      }
    }

    // For ways and relations with bounds but no geometry, use bounds center
    if (place.bounds) {
      return {
        lat: (place.bounds.minlat + place.bounds.maxlat) / 2,
        lng: (place.bounds.minlon + place.bounds.maxlon) / 2,
      }
    }

    return null
  }

  /**
   * Extract address from OSM tags
   * @param tags OSM tags object
   * @returns Formatted address object
   */
  private extractOsmAddress(
    tags?: Record<string, string>,
  ): AttributedValue<Address> | null {
    if (!tags) return null

    const street = tags['addr:street']
    const houseNumber = tags['addr:housenumber']
    const city = tags['addr:city']
    const state = tags['addr:state']
    const postcode = tags['addr:postcode']
    const country = tags['addr:country']

    // If we don't have any address components, return null
    if (!street && !city && !postcode && !country) {
      return null
    }

    // Build formatted address string
    const parts = []
    if (street && houseNumber) {
      parts.push(`${houseNumber} ${street}`)
    } else if (street) {
      parts.push(street)
    }

    if (city) {
      parts.push(city)
    }

    if (state && postcode) {
      parts.push(`${state} ${postcode}`)
    } else if (state) {
      parts.push(state)
    } else if (postcode) {
      parts.push(postcode)
    }

    if (country) {
      parts.push(country)
    }

    return {
      value: {
        street1:
          street && houseNumber
            ? `${houseNumber} ${street}`
            : street || undefined,
        street2: undefined,
        neighborhood: tags['addr:suburb'] || undefined,
        locality:
          city || tags['addr:town'] || tags['addr:village'] || undefined,
        region: state || tags['addr:county'] || undefined,
        postalCode: postcode || undefined,
        country: country || undefined,
        countryCode: tags['addr:country']
          ? tags['addr:country'].toUpperCase()
          : undefined,
        formatted: parts.join(', '),
      },
      sourceId: SOURCE.OSM,
    }
  }

  /**
   * Extract contact information from OSM tags
   * @param tags OSM tags object
   * @returns Contact information
   */
  private extractContactInfo(tags?: Record<string, string>) {
    const contactInfo: {
      phone: AttributedValue<string> | null
      email: AttributedValue<string> | null
      website: AttributedValue<string> | null
      socials: Record<string, AttributedValue<string>>
    } = {
      phone: null,
      email: null,
      website: null,
      socials: {},
    }

    if (!tags) return contactInfo

    // Phone
    if (tags.phone || tags['contact:phone']) {
      contactInfo.phone = {
        value: tags.phone || tags['contact:phone'] || '',
        sourceId: SOURCE.OSM,
      }
    }

    // Email
    if (tags.email || tags['contact:email']) {
      contactInfo.email = {
        value: tags.email || tags['contact:email'] || '',
        sourceId: SOURCE.OSM,
      }
    }

    // Website
    if (tags.website || tags['contact:website'] || tags.url) {
      contactInfo.website = {
        value: tags.website || tags['contact:website'] || tags.url || '',
        sourceId: SOURCE.OSM,
      }
    }

    // Social media
    const socialPlatforms = [
      'facebook',
      'instagram',
      'twitter',
      'linkedin',
      'youtube',
      'tiktok',
    ]

    for (const platform of socialPlatforms) {
      const value = tags[platform] || tags[`contact:${platform}`]
      if (value) {
        contactInfo.socials[platform] = {
          value,
          sourceId: SOURCE.OSM,
        }
      }
    }

    return contactInfo
  }

  /**
   * Extract opening hours from OSM tags
   * @param tags OSM tags object
   * @returns Opening hours object
   */
  private extractOpeningHours(
    tags?: Record<string, string>,
  ): AttributedValue<OpeningHours> | null {
    if (!tags || !tags.opening_hours) return null

    const openingHours = tags.opening_hours
    const isOpen24_7 = openingHours.includes('24/7')

    return {
      value: {
        regularHours: parseOpeningHoursForUnifiedFormat(openingHours) || [],
        isOpen24_7,
        isPermanentlyClosed: tags.disused === 'yes' || tags.abandoned === 'yes',
        isTemporarilyClosed: tags.opening_hours === 'closed',
        rawText: openingHours,
      },
      sourceId: SOURCE.OSM,
    }
  }

  /**
   * Extract amenities from OSM tags
   * @param tags OSM tags object
   * @returns Amenities object
   */
  private extractAmenities(tags?: Record<string, string>): Record<string, any> {
    const amenities: Record<string, any> = {}

    if (!tags) return amenities

    // Add place types as amenities
    if (tags.amenity) {
      amenities[`type:${tags.amenity}`] = tags.amenity
    }
    if (tags.shop) {
      amenities[`type:${tags.shop}`] = tags.shop
    }
    if (tags.tourism) {
      amenities[`type:${tags.tourism}`] = tags.tourism
    }
    if (tags.leisure) {
      amenities[`type:${tags.leisure}`] = tags.leisure
    }

    // Common amenity flags in OSM
    const amenityFlags = [
      'wheelchair',
      'toilets',
      'wifi',
      'internet_access',
      'outdoor_seating',
      'smoking',
      'takeaway',
      'delivery',
      'drive_through',
      'reservation',
      'air_conditioning',
      'payment:credit_cards',
      'payment:debit_cards',
      'payment:cash',
    ]

    for (const flag of amenityFlags) {
      const value = tags[flag]
      if (value) {
        // Convert 'yes'/'no' to boolean, otherwise keep as string
        const boolValue =
          value === 'yes' ? true : value === 'no' ? false : value
        amenities[flag] = String(boolValue)
      }
    }

    return amenities
  }
}
