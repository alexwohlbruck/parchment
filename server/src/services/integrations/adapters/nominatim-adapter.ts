import type {
  Place,
  PlaceGeometry,
  Address,
  AttributedValue,
  OpeningHours,
} from '../../../types/place.types'
import { getPlaceType } from '../../../lib/place.utils'
import { SOURCE } from '../../../lib/constants'
import { parseOpeningHoursForUnifiedFormat } from '../../../lib/place.utils'

/**
 * Interface for Nominatim lookup response object
 */
export interface NominatimLookupResult {
  place_id: number
  licence: string
  osm_type: 'node' | 'way' | 'relation'
  osm_id: number
  boundingbox: [string, string, string, string] // [min_lat, max_lat, min_lon, max_lon]
  lat: string
  lon: string
  display_name: string
  class: string
  type: string
  importance: number
  address?: {
    [key: string]: string
  }
  extratags?: {
    [key: string]: string
  }
  namedetails?: {
    [key: string]: string
  }
}

/**
 * Adapter for transforming Nominatim API data to unified formats
 */
export class NominatimAdapter {
  placeInfo = {
    adaptPlaceDetails: (data: NominatimLookupResult, id?: string): Place => {
      const osmId = `${data.osm_type}/${data.osm_id}`
      const primaryId = id || `${SOURCE.OSM}/${osmId}`
      const timestamp = new Date().toISOString()

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.OSM]: osmId,
        },
        name: {
          value: this.extractName(data),
          sourceId: SOURCE.OSM,
          timestamp,
        },
        description: this.extractDescription(data.extratags),
        placeType: {
          value: getPlaceType({ [data.class]: data.type }) || data.type || 'unknown',
          sourceId: SOURCE.OSM,
          timestamp,
        },
        geometry: {
          value: this.extractGeometry(data),
          sourceId: SOURCE.OSM,
          timestamp,
        },
        photos: [], // Nominatim doesn't provide photos
        address: this.extractAddress(data.address),
        contactInfo: this.extractContactInfo(data.extratags),
        openingHours: this.extractOpeningHours(data.extratags),
        amenities: this.extractAmenities(data),
        sources: [
          {
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: `https://www.openstreetmap.org/${data.osm_type}/${data.osm_id}`,
          },
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }
    },
  }

  /**
   * Extract the name from Nominatim data
   */
  private extractName(data: NominatimLookupResult): string | null {
    // Try namedetails first for language variants
    if (data.namedetails) {
      return (
        data.namedetails.name ||
        data.namedetails['name:en'] ||
        data.namedetails.brand ||
        Object.values(data.namedetails)[0] ||
        null
      )
    }

    // Try extratags
    if (data.extratags) {
      return (
        data.extratags.name ||
        data.extratags['name:en'] ||
        data.extratags.brand ||
        null
      )
    }

    // Fallback to extracting from display_name (first part before comma)
    if (data.display_name) {
      const firstPart = data.display_name.split(',')[0]?.trim()
      return firstPart || null
    }

    return null
  }

  /**
   * Extract description from extratags
   */
  private extractDescription(
    extratags?: Record<string, string>,
  ): AttributedValue<string> | null {
    if (!extratags) return null

    const description =
      extratags.description ||
      extratags['description:en'] ||
      extratags.note ||
      extratags.comment ||
      null

    if (!description) return null

    return {
      value: description,
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract geometry from Nominatim data
   */
  private extractGeometry(data: NominatimLookupResult): PlaceGeometry {
    const lat = parseFloat(data.lat)
    const lng = parseFloat(data.lon)
    
    const geometry: PlaceGeometry = {
      type: 'point',
      center: { lat, lng },
    }

    // Add bounding box if available
    if (data.boundingbox && data.boundingbox.length === 4) {
      const [minLat, maxLat, minLng, maxLng] = data.boundingbox.map(parseFloat)
      geometry.bounds = {
        minLat,
        minLng,
        maxLat,
        maxLng,
      }
    }

    return geometry
  }

  /**
   * Extract address from Nominatim address breakdown
   */
  private extractAddress(
    address?: Record<string, string>,
  ): AttributedValue<Address> | null {
    if (!address) return null

    const addressObj: Address = {}

    // Map Nominatim address fields to our Address interface
    if (address.house_number && address.road) {
      addressObj.street1 = `${address.house_number} ${address.road}`
    } else if (address.road) {
      addressObj.street1 = address.road
    }

    addressObj.neighborhood = address.suburb || address.neighbourhood
    addressObj.locality = 
      address.city || 
      address.town || 
      address.village || 
      address.municipality
    addressObj.region = 
      address.state || 
      address.county || 
      address.province
    addressObj.postalCode = address.postcode
    addressObj.country = address.country
    addressObj.countryCode = address.country_code?.toUpperCase()

    // Use display_name as formatted address fallback
    if (Object.keys(addressObj).length === 0) {
      return null
    }

    return {
      value: addressObj,
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract contact information from extratags
   */
  private extractContactInfo(extratags?: Record<string, string>): {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  } {
    const timestamp = new Date().toISOString()
    const contactInfo = {
      phone: null as AttributedValue<string> | null,
      email: null as AttributedValue<string> | null,
      website: null as AttributedValue<string> | null,
      socials: {} as Record<string, AttributedValue<string>>,
    }

    if (!extratags) return contactInfo

    // Phone
    if (extratags.phone || extratags['contact:phone']) {
      contactInfo.phone = {
        value: extratags.phone || extratags['contact:phone'],
        sourceId: SOURCE.OSM,
        timestamp,
      }
    }

    // Email
    if (extratags.email || extratags['contact:email']) {
      contactInfo.email = {
        value: extratags.email || extratags['contact:email'],
        sourceId: SOURCE.OSM,
        timestamp,
      }
    }

    // Website
    if (extratags.website || extratags['contact:website'] || extratags.url) {
      contactInfo.website = {
        value: extratags.website || extratags['contact:website'] || extratags.url,
        sourceId: SOURCE.OSM,
        timestamp,
      }
    }

    // Social media
    const socialPlatforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube']
    for (const platform of socialPlatforms) {
      const value = extratags[platform] || extratags[`contact:${platform}`]
      if (value) {
        contactInfo.socials[platform] = {
          value,
          sourceId: SOURCE.OSM,
          timestamp,
        }
      }
    }

    return contactInfo
  }

  /**
   * Extract opening hours from extratags
   */
  private extractOpeningHours(
    extratags?: Record<string, string>,
  ): AttributedValue<OpeningHours> | null {
    if (!extratags || !extratags.opening_hours) return null

    const openingHours = extratags.opening_hours
    const isOpen24_7 = openingHours.includes('24/7')

    return {
      value: {
        regularHours: parseOpeningHoursForUnifiedFormat(openingHours) || [],
        isOpen24_7,
        isPermanentlyClosed: extratags.disused === 'yes' || extratags.abandoned === 'yes',
        isTemporarilyClosed: openingHours === 'closed',
        rawText: openingHours,
      },
      sourceId: SOURCE.OSM,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract amenities from Nominatim data
   */
  private extractAmenities(data: NominatimLookupResult): Record<string, any> {
    const amenities: Record<string, any> = {}

    // Add place classification
    if (data.class && data.type) {
      amenities[`type:${data.class}`] = data.type
    }

    // Add extratags as amenities
    if (data.extratags) {
      for (const [key, value] of Object.entries(data.extratags)) {
        // Skip fields already processed elsewhere
        if (!['name', 'phone', 'email', 'website', 'opening_hours', 'description'].includes(key)) {
          amenities[key] = value
        }
      }
    }

    return amenities
  }
}
