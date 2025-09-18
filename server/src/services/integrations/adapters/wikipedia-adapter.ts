import type {
  Place,
  AttributedValue,
  PlacePhoto,
} from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'

/**
 * Interface for Wikipedia page data
 */
export interface WikipediaPageData {
  pageid: number
  title: string
  extract?: string
  pageimage?: string
  original?: {
    source: string
    width: number
    height: number
  }
  coordinates?: Array<{
    lat: number
    lon: number
    primary?: boolean
  }>
  infobox?: Record<string, string>
  language: string
}

/**
 * Adapter for transforming Wikipedia API data to unified formats
 */
export class WikipediaAdapter {
  placeInfo = {
    adaptPlaceDetails: (
      pageData: WikipediaPageData,
      title: string,
      language: string,
    ): Place => {
      const timestamp = new Date().toISOString()
      const primaryId = `${SOURCE.WIKIPEDIA}/${language}:${title}`

      return {
        id: primaryId,
        externalIds: {
          [SOURCE.WIKIPEDIA]: `${language}:${title}`,
        },
        name: {
          value: this.extractName(pageData, title),
          sourceId: SOURCE.WIKIPEDIA,
          timestamp,
        },
        description: this.extractDescription(pageData),
        placeType: {
          value: this.extractPlaceType(pageData),
          sourceId: SOURCE.WIKIPEDIA,
          timestamp,
        },
        geometry: {
          value: this.extractGeometry(pageData),
          sourceId: SOURCE.WIKIPEDIA,
          timestamp,
        },
        photos: this.extractPhotos(pageData),
        address: null, // Wikipedia doesn't have structured address data
        contactInfo: this.extractContactInfo(pageData),
        openingHours: null, // Wikipedia doesn't have opening hours
        amenities: this.extractAmenities(pageData),
        sources: [
          {
            id: SOURCE.WIKIPEDIA,
            name: 'Wikipedia',
            url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
          },
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }
    },
  }

  /**
   * Extract the primary name from Wikipedia page data
   */
  private extractName(pageData: WikipediaPageData, fallbackTitle: string): string | null {
    // Use the page title, converting underscores to spaces
    return pageData.title || fallbackTitle.replace(/_/g, ' ')
  }

  /**
   * Extract description from Wikipedia page extract
   */
  private extractDescription(pageData: WikipediaPageData): AttributedValue<string> | null {
    if (!pageData.extract) return null

    // Clean up the extract - remove any remaining markup and limit length
    let cleanExtract = pageData.extract
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Limit to reasonable length (around 1000 characters for detailed descriptions)
    if (cleanExtract.length > 1000) {
      cleanExtract = cleanExtract.substring(0, 1000)
      const lastSentenceEnd = Math.max(
        cleanExtract.lastIndexOf('.'),
        cleanExtract.lastIndexOf('!'),
        cleanExtract.lastIndexOf('?')
      )
      if (lastSentenceEnd > 700) {
        cleanExtract = cleanExtract.substring(0, lastSentenceEnd + 1)
      } else {
        cleanExtract += '...'
      }
    }

    return {
      value: cleanExtract,
      sourceId: SOURCE.WIKIPEDIA,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract place type from Wikipedia infobox or page content
   */
  private extractPlaceType(pageData: WikipediaPageData): string {
    if (pageData.infobox) {
      // Try to extract type from common infobox fields
      const typeFields = ['type', 'building_type', 'architectural_style', 'category']
      
      for (const field of typeFields) {
        const value = pageData.infobox[field]
        if (value && typeof value === 'string') {
          return value.toLowerCase()
        }
      }
    }

    // Try to infer from page title patterns
    const title = pageData.title.toLowerCase()
    
    if (title.includes('church') || title.includes('cathedral') || title.includes('chapel')) {
      return 'church'
    }
    if (title.includes('museum')) {
      return 'museum'
    }
    if (title.includes('park') || title.includes('garden')) {
      return 'park'
    }
    if (title.includes('bridge')) {
      return 'bridge'
    }
    if (title.includes('castle') || title.includes('palace')) {
      return 'historic building'
    }
    if (title.includes('square') || title.includes('plaza')) {
      return 'square'
    }
    if (title.includes('station')) {
      return 'transportation'
    }

    return 'place'
  }

  /**
   * Extract geometry from Wikipedia page coordinates
   */
  private extractGeometry(pageData: WikipediaPageData): any {
    if (pageData.coordinates && pageData.coordinates.length > 0) {
      const coord = pageData.coordinates[0]
      return {
        type: 'point' as const,
        center: {
          lat: coord.lat,
          lng: coord.lon,
        },
      }
    }

    return {
      type: 'point' as const,
      center: { lat: 0, lng: 0 },
    }
  }

  /**
   * Extract photos from Wikipedia page data
   */
  private extractPhotos(pageData: WikipediaPageData): AttributedValue<PlacePhoto>[] {
    const photos: AttributedValue<PlacePhoto>[] = []
    const timestamp = new Date().toISOString()

    // Add the main page image if available
    if (pageData.original?.source) {
      photos.push({
        value: {
          url: pageData.original.source,
          sourceId: SOURCE.WIKIPEDIA,
          width: pageData.original.width,
          height: pageData.original.height,
          isPrimary: true,
        },
        sourceId: SOURCE.WIKIPEDIA,
        timestamp,
      })
    }

    return photos
  }

  /**
   * Extract contact information from Wikipedia infobox
   */
  private extractContactInfo(pageData: WikipediaPageData): any {
    const contactInfo = {
      phone: null,
      email: null,
      website: null,
      socials: {} as Record<string, AttributedValue<string>>,
    }

    if (!pageData.infobox) return contactInfo

    const timestamp = new Date().toISOString()

    // Extract website
    const websiteFields = ['website', 'url', 'official_website']
    for (const field of websiteFields) {
      const value = pageData.infobox[field]
      if (value && typeof value === 'string' && value.startsWith('http')) {
        contactInfo.website = {
          value,
          sourceId: SOURCE.WIKIPEDIA,
          timestamp,
        }
        break
      }
    }

    // Extract phone
    const phoneFields = ['phone', 'telephone', 'tel']
    for (const field of phoneFields) {
      const value = pageData.infobox[field]
      if (value && typeof value === 'string') {
        contactInfo.phone = {
          value,
          sourceId: SOURCE.WIKIPEDIA,
          timestamp,
        }
        break
      }
    }

    return contactInfo
  }

  /**
   * Extract amenities from Wikipedia infobox
   */
  private extractAmenities(pageData: WikipediaPageData): Record<string, AttributedValue<string | boolean | number>> {
    const amenities: Record<string, AttributedValue<string | boolean | number>> = {}
    const timestamp = new Date().toISOString()

    if (!pageData.infobox) return amenities

    // Map infobox fields to amenities
    const amenityMappings: Record<string, string> = {
      'established': 'established_date',
      'opened': 'opening_date',
      'built': 'construction_date',
      'architect': 'architect',
      'architectural_style': 'architectural_style',
      'height': 'height',
      'area': 'area',
      'capacity': 'capacity',
      'floors': 'floors',
      'cost': 'construction_cost',
      'material': 'construction_material',
      'owner': 'owner',
      'operator': 'operator',
      'status': 'status',
    }

    for (const [infoboxKey, amenityKey] of Object.entries(amenityMappings)) {
      const value = pageData.infobox[infoboxKey]
      if (value && typeof value === 'string' && value.trim()) {
        // Try to convert to number if it looks like one
        const numericValue = parseFloat(value.replace(/[^\d.-]/g, ''))
        const processedValue = !isNaN(numericValue) && value.match(/^\d/) ? numericValue : value

        amenities[amenityKey] = {
          value: processedValue,
          sourceId: SOURCE.WIKIPEDIA,
          timestamp,
        }
      }
    }

    return amenities
  }
}
