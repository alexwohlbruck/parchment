import type {
  Place,
  AttributedValue,
  PlacePhoto,
} from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'

/**
 * Interface for Wikidata entity data
 */
export interface WikidataEntity {
  id: string
  type: 'item'
  labels?: Record<string, { language: string; value: string }>
  descriptions?: Record<string, { language: string; value: string }>
  aliases?: Record<string, Array<{ language: string; value: string }>>
  claims?: Record<string, any[]>
  sitelinks?: Record<string, { site: string; title: string; url?: string }>
}

/**
 * Adapter for transforming Wikidata API data to unified formats
 */
export class WikidataAdapter {
  placeInfo = {
    adaptPlaceDetails: (entity: WikidataEntity, wikidataId: string): Place => {
      const timestamp = new Date().toISOString()
      const primaryId = `${SOURCE.WIKIDATA}/${wikidataId}`
      const photos = this.extractPhotos(entity)

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.WIKIDATA]: wikidataId,
        },
        name: {
          value: this.extractName(entity),
          sourceId: SOURCE.WIKIDATA,
          timestamp,
        },
        description: null, // Don't use Wikidata descriptions - they're too generic
        placeType: {
          value: this.extractPlaceType(entity),
          sourceId: SOURCE.WIKIDATA,
          timestamp,
        },
        geometry: {
          value: this.extractGeometry(entity),
          sourceId: SOURCE.WIKIDATA,
          timestamp,
        },
        photos,
        address: null, // Wikidata doesn't typically have detailed address info
        contactInfo: this.extractContactInfo(entity),
        openingHours: null, // Wikidata doesn't typically have opening hours
        amenities: this.extractAmenities(entity),
        sources: [
          {
            id: SOURCE.WIKIDATA,
            name: 'Wikidata',
            url: `https://www.wikidata.org/entity/${wikidataId}`,
          },
          // Add Wikimedia Commons as a source if photos are present
          ...(photos.length > 0 ? [{
            id: SOURCE.WIKIMEDIA,
            name: 'Wikimedia Commons',
            url: this.getFirstImageCommonsUrl(entity),
          }] : []),
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }
    },
  }

  /**
   * Extract the primary name from Wikidata entity
   */
  private extractName(entity: WikidataEntity): string | null {
    if (!entity.labels) return null

    // Try English first, then any available language
    const label = entity.labels['en'] || Object.values(entity.labels)[0]
    return label?.value || null
  }


  /**
   * Extract place type from Wikidata entity
   */
  private extractPlaceType(entity: WikidataEntity): string {
    if (!entity.claims) return 'place'

    // P31 is "instance of" property
    const instanceOfClaims = entity.claims['P31']
    if (!instanceOfClaims || instanceOfClaims.length === 0) return 'place'

    // Get the first instance of claim
    const claim = instanceOfClaims[0]
    const entityValue = claim?.mainsnak?.datavalue?.value
    
    if (entityValue && entityValue.id) {
      // Map common Wikidata entity types to readable place types
      const typeMapping: Record<string, string> = {
        'Q515': 'city', // city
        'Q532': 'village', // village
        'Q486972': 'settlement', // human settlement
        'Q1549591': 'big city', // big city
        'Q3957': 'town', // town
        'Q5119': 'capital', // capital city
        'Q1637706': 'city with millions of inhabitants', // city with millions of inhabitants
        'Q1093829': 'city with county rights', // city with county rights
        'Q23413': 'castle', // castle
        'Q16970': 'church building', // church building
        'Q33506': 'museum', // museum
        'Q174782': 'square', // square
        'Q12280': 'bridge', // bridge
        'Q41176': 'building', // building
        'Q570116': 'tourist attraction', // tourist attraction
        'Q1548435': 'administrative territorial entity', // administrative territorial entity
      }

      return typeMapping[entityValue.id] || 'place'
    }

    return 'place'
  }

  /**
   * Extract geometry from Wikidata entity
   */
  private extractGeometry(entity: WikidataEntity): any {
    if (!entity.claims) {
      return {
        type: 'point' as const,
        center: { lat: 0, lng: 0 },
      }
    }

    // P625 is "coordinate location" property
    const coordinateClaims = entity.claims['P625']
    if (!coordinateClaims || coordinateClaims.length === 0) {
      return {
        type: 'point' as const,
        center: { lat: 0, lng: 0 },
      }
    }

    const claim = coordinateClaims[0]
    const coordinateValue = claim?.mainsnak?.datavalue?.value

    if (coordinateValue && coordinateValue.latitude && coordinateValue.longitude) {
      return {
        type: 'point' as const,
        center: {
          lat: coordinateValue.latitude,
          lng: coordinateValue.longitude,
        },
      }
    }

    return {
      type: 'point' as const,
      center: { lat: 0, lng: 0 },
    }
  }

  /**
   * Extract photos from Wikidata entity
   */
  private extractPhotos(entity: WikidataEntity): AttributedValue<PlacePhoto>[] {
    const photos: AttributedValue<PlacePhoto>[] = []
    const timestamp = new Date().toISOString()

    if (!entity.claims) return photos

    // P18 is "image" property
    const imageClaims = entity.claims['P18']
    if (!imageClaims || imageClaims.length === 0) return photos

    for (const claim of imageClaims.slice(0, 5)) { // Limit to 5 images
      const imageValue = claim?.mainsnak?.datavalue?.value
      if (imageValue && typeof imageValue === 'string') {
        // Convert Wikimedia filename to URL
        const imageUrl = this.wikimediaFileToUrl(imageValue)
        if (imageUrl) {
          photos.push({
            value: {
              url: imageUrl,
              sourceId: SOURCE.WIKIMEDIA, // Images are hosted on Wikimedia Commons
              isPrimary: photos.length === 0, // First image is primary
            },
            sourceId: SOURCE.WIKIMEDIA, // Images are hosted on Wikimedia Commons
            timestamp,
          })
        }
      }
    }

    return photos
  }

  /**
   * Extract contact information from Wikidata entity
   */
  private extractContactInfo(entity: WikidataEntity): {
    phone: AttributedValue<string> | null
    email: AttributedValue<string> | null
    website: AttributedValue<string> | null
    socials: Record<string, AttributedValue<string>>
  } {
    const contactInfo: {
      phone: AttributedValue<string> | null
      email: AttributedValue<string> | null
      website: AttributedValue<string> | null
      socials: Record<string, AttributedValue<string>>
    } = {
      phone: null,
      email: null,
      website: null,
      socials: {} as Record<string, AttributedValue<string>>,
    }

    if (!entity.claims) return contactInfo

    const timestamp = new Date().toISOString()

    // P856 is "official website" property
    const websiteClaims = entity.claims['P856']
    if (websiteClaims && websiteClaims.length > 0) {
      const websiteValue = websiteClaims[0]?.mainsnak?.datavalue?.value
      if (websiteValue && typeof websiteValue === 'string') {
        contactInfo.website = {
          value: websiteValue,
          sourceId: SOURCE.WIKIDATA,
          timestamp,
        }
      }
    }

    // P1104 is "phone number" property
    const phoneClaims = entity.claims['P1104']
    if (phoneClaims && phoneClaims.length > 0) {
      const phoneValue = phoneClaims[0]?.mainsnak?.datavalue?.value
      if (phoneValue && typeof phoneValue === 'string') {
        contactInfo.phone = {
          value: phoneValue,
          sourceId: SOURCE.WIKIDATA,
          timestamp,
        }
      }
    }

    return contactInfo
  }

  /**
   * Extract amenities/properties from Wikidata entity
   */
  private extractAmenities(entity: WikidataEntity): Record<string, AttributedValue<string | boolean | number>> {
    const amenities: Record<string, AttributedValue<string | boolean | number>> = {}
    const timestamp = new Date().toISOString()

    if (!entity.claims) return amenities

    // Extract some useful properties
    const propertyMappings: Record<string, string> = {
      'P2048': 'height', // height
      'P2049': 'width', // width
      'P571': 'inception', // inception date
      'P17': 'country', // country
      'P131': 'located_in', // located in the administrative territorial entity
      'P84': 'architect', // architect
      'P149': 'architectural_style', // architectural style
    }

    for (const [propertyId, amenityKey] of Object.entries(propertyMappings)) {
      const claims = entity.claims[propertyId]
      if (claims && claims.length > 0) {
        const claim = claims[0]
        const value = claim?.mainsnak?.datavalue?.value

        if (value !== undefined) {
          let processedValue: string | boolean | number

          if (typeof value === 'object' && value.amount) {
            // Quantity value
            processedValue = parseFloat(value.amount)
          } else if (typeof value === 'object' && value.time) {
            // Time value
            processedValue = value.time
          } else if (typeof value === 'object' && value.id) {
            // Entity reference - we'd need another lookup to get the label
            processedValue = value.id
          } else {
            processedValue = String(value)
          }

          amenities[amenityKey] = {
            value: processedValue,
            sourceId: SOURCE.WIKIDATA,
            timestamp,
          }
        }
      }
    }

    return amenities
  }

  /**
   * Get the Commons page URL for the first image
   */
  private getFirstImageCommonsUrl(entity: WikidataEntity): string {
    if (!entity.claims) return 'https://commons.wikimedia.org/'

    // P18 is "image" property
    const imageClaims = entity.claims['P18']
    if (!imageClaims || imageClaims.length === 0) return 'https://commons.wikimedia.org/'

    const firstImageValue = imageClaims[0]?.mainsnak?.datavalue?.value
    if (firstImageValue && typeof firstImageValue === 'string') {
      // Create Commons file page URL
      const encodedFilename = encodeURIComponent(firstImageValue.replace(/ /g, '_'))
      return `https://commons.wikimedia.org/wiki/File:${encodedFilename}`
    }

    return 'https://commons.wikimedia.org/'
  }

  /**
   * Convert Wikimedia Commons filename to direct URL
   */
  private wikimediaFileToUrl(filename: string): string | null {
    try {
      // Remove "File:" prefix if present
      const cleanFilename = filename.replace(/^File:/, '')
      
      // Wikimedia Commons direct URL format
      // We use the thumbnail URL with 800px width for reasonable file sizes
      const encodedFilename = encodeURIComponent(cleanFilename)
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=800`
    } catch (error) {
      console.error('Error converting Wikimedia filename to URL:', error)
      return null
    }
  }
}
