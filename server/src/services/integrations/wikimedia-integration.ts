import axios from 'axios'
import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  PlaceInfoCapability,
} from '../../types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import type { Place } from '../../types/place.types'
import { WikimediaAdapter } from './adapters/wikimedia-adapter'
import { SOURCE } from '../../lib/constants'

// Get version from package.json
const packageJson = require('../../../package.json')

/**
 * Get proper headers for Wikimedia requests to comply with usage policy
 */
function getWikimediaHeaders(): Record<string, string> {
  const serverOrigin = process.env.SERVER_ORIGIN!
  
  return {
    'User-Agent': `Parchment/${packageJson.version} (https://github.com/alexwohlbruck/parchment)`,
    'Referer': serverOrigin,
  }
}

export interface WikimediaConfig extends IntegrationConfig {
  // Wikimedia Commons doesn't require API keys, but we keep this for consistency
}

/**
 * Wikimedia Commons integration for fetching place-related images
 */
export class WikimediaIntegration implements Integration<WikimediaConfig> {
  private initialized = false
  private adapter = new WikimediaAdapter()
  private config: WikimediaConfig = {}

  readonly integrationId = IntegrationId.WIKIMEDIA
  readonly capabilityIds = [IntegrationCapabilityId.PLACE_INFO]
  readonly capabilities = {
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
  }
  readonly sources = [SOURCE.WIKIMEDIA]

  /**
   * Tests the connection with the given configuration
   */
  async testConnection(config: WikimediaConfig): Promise<IntegrationTestResult> {
    try {
      // Test with a well-known category
      const testCategory = 'Category:Featured_pictures'
      const response = await axios.get(
        'https://commons.wikimedia.org/w/api.php',
        {
          params: {
            action: 'query',
            format: 'json',
            generator: 'categorymembers',
            gcmtitle: testCategory,
            gcmtype: 'file',
            gcmlimit: 1,
            prop: 'imageinfo',
            iiprop: 'url',
          },
          headers: getWikimediaHeaders(),
          timeout: 10000,
        }
      )

      if (response.data && response.data.query) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Invalid response format from Wikimedia Commons API',
        }
      }
    } catch (error: any) {
      console.error('Error testing Wikimedia Commons API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Wikimedia Commons API',
      }
    }
  }

  /**
   * Initialize the integration with configuration
   */
  initialize(config: WikimediaConfig): void {
    this.config = config
    this.initialized = true
  }

  /**
   * Validates that the configuration has all required fields
   */
  validateConfig(config: WikimediaConfig): boolean {
    // Wikimedia Commons doesn't require any special configuration
    return true
  }

  /**
   * Ensures the integration has been initialized before performing operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  /**
   * Get place info by extracting images from Wikimedia Commons
   * This method expects the ID to contain category or gallery information
   * @param id The identifier containing category/gallery info (e.g., "category:PariserPlatz" or "gallery:PariserPlatz")
   * @returns Place with images or null if not found
   */
  private async getPlaceInfo(
    id: string,
    _options?: { language?: string },
  ): Promise<Place | null> {
    this.ensureInitialized()

    try {
      // Parse the ID to extract category or gallery information
      const { type, name } = this.parseWikimediaId(id)
      if (!name) return null

      const images = await this.getImagesByTypeAndName(type, name, 10)
      if (images.length === 0) return null

      // Create a minimal place object with just the images
      const timestamp = new Date().toISOString()
      return {
        id: `${SOURCE.WIKIMEDIA}/${id}`,
        externalIds: {
          [SOURCE.WIKIMEDIA]: id,
        },
        name: {
          value: name,
          sourceId: SOURCE.WIKIMEDIA,
          timestamp,
        },
        description: null,
        placeType: {
          value: 'place',
          sourceId: SOURCE.WIKIMEDIA,
          timestamp,
        },
        geometry: {
          value: {
            type: 'point' as const,
            center: { lat: 0, lng: 0 },
          },
          sourceId: SOURCE.WIKIMEDIA,
          timestamp,
        },
        photos: images.map((img, index) => ({
          value: {
            ...img,
            isPrimary: index === 0,
          },
          sourceId: SOURCE.WIKIMEDIA,
          timestamp,
        })),
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
            id: SOURCE.WIKIMEDIA,
            name: 'Wikimedia Commons',
            url: `https://commons.wikimedia.org/wiki/${type}:${encodeURIComponent(name)}`,
          },
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }
    } catch (error) {
      console.error('Error fetching place from Wikimedia Commons:', error)
      return null
    }
  }

  /**
   * Parse Wikimedia ID to extract type and name
   * @param id The Wikimedia ID (e.g., "category:PariserPlatz" or "gallery:PariserPlatz")
   * @returns Object with type and name
   */
  private parseWikimediaId(id: string): { type: 'category' | 'gallery' | null, name: string | null } {
    // Remove provider prefix if present
    let cleanId = id
    if (id.startsWith('wikimedia/')) {
      cleanId = id.substring(10)
    }

    const [type, ...nameParts] = cleanId.split(':')
    const name = nameParts.join(':')

    if (type === 'category' || type === 'gallery') {
      return { type, name }
    }

    return { type: null, name: null }
  }

  /**
   * Get images by type and name
   * @param type Either 'category' or 'gallery'
   * @param name The category or gallery name
   * @param limit Maximum number of images
   * @returns Array of image data
   */
  async getImagesByTypeAndName(
    type: 'category' | 'gallery',
    name: string,
    limit: number = 10
  ): Promise<any[]> {
    if (type === 'category') {
      return await this.getImagesByCategory(name, limit)
    } else if (type === 'gallery') {
      return await this.getImagesByGallery(name, limit)
    }
    return []
  }

  /**
   * Get imagery for a place by category or coordinates
   * @param lat Latitude
   * @param lng Longitude  
   * @param options Additional options including category name
   * @returns Array of image URLs and metadata
   */
  async getImagery(
    lat: number,
    lng: number,
    options?: {
      category?: string
      gallery?: string
      limit?: number
    }
  ): Promise<any[]> {
    this.ensureInitialized()

    try {
      const limit = options?.limit || 10

      // If we have a specific category, search by category
      if (options?.category) {
        return await this.getImagesByCategory(options.category, limit)
      }

      // If we have a gallery, search by gallery
      if (options?.gallery) {
        return await this.getImagesByGallery(options.gallery, limit)
      }

      // TODO: Implement geographic search by coordinates
      // This would require using a geographic search API or service
      console.warn('Geographic image search not yet implemented for Wikimedia Commons')
      return []
    } catch (error) {
      console.error('Error fetching imagery from Wikimedia Commons:', error)
      return []
    }
  }

  /**
   * Get images from a Wikimedia Commons category
   * @param categoryName Category name (without "Category:" prefix)
   * @param limit Maximum number of images to return
   * @returns Array of image data
   */
  async getImagesByCategory(categoryName: string, limit: number = 10): Promise<any[]> {
    this.ensureInitialized()

    try {
      console.log(`Getting images from Wikimedia Commons category: ${categoryName}`)

      // Ensure category has proper prefix
      const fullCategoryName = categoryName.startsWith('Category:') 
        ? categoryName 
        : `Category:${categoryName}`

      const response = await axios.get(
        'https://commons.wikimedia.org/w/api.php',
        {
          params: {
            action: 'query',
            format: 'json',
            generator: 'categorymembers',
            gcmtitle: fullCategoryName,
            gcmtype: 'file',
            gcmlimit: limit,
            prop: 'imageinfo',
            iiprop: 'url|size|mime|extmetadata',
            iiurlwidth: 800, // Get thumbnail of reasonable size
          },
          headers: getWikimediaHeaders(),
          timeout: 15000,
        }
      )

      if (!response.data?.query?.pages) {
        console.warn(`No images found in category: ${categoryName}`)
        return []
      }

      const pages = response.data.query.pages
      const images = Object.values(pages).map((page: any) => {
        const imageInfo = page.imageinfo?.[0]
        if (!imageInfo) return null

        return this.adapter.adaptImageData(page, imageInfo)
      }).filter(Boolean)

      return images
    } catch (error) {
      console.error('Error fetching images from Wikimedia Commons category:', error)
      return []
    }
  }

  /**
   * Get images from a Wikimedia Commons gallery
   * @param galleryName Gallery name
   * @param limit Maximum number of images to return
   * @returns Array of image data
   */
  async getImagesByGallery(galleryName: string, limit: number = 10): Promise<any[]> {
    this.ensureInitialized()

    try {
      console.log(`Getting images from Wikimedia Commons gallery: ${galleryName}`)

      // For galleries, we need to get the gallery page content and parse it
      const galleryPageResponse = await axios.get(
        'https://commons.wikimedia.org/w/api.php',
        {
          params: {
            action: 'query',
            format: 'json',
            prop: 'revisions',
            titles: galleryName,
            rvprop: 'content',
            rvslots: 'main',
          },
          headers: getWikimediaHeaders(),
          timeout: 15000,
        }
      )

      const pages = galleryPageResponse.data?.query?.pages
      if (!pages) return []

      const pageId = Object.keys(pages)[0]
      const page = pages[pageId]
      const content = page?.revisions?.[0]?.slots?.main?.['*']

      if (!content) return []

      // Parse file names from gallery content
      const fileNames = this.parseFileNamesFromGallery(content)
      if (fileNames.length === 0) return []

      // Get image info for the parsed file names
      const limitedFileNames = fileNames.slice(0, limit)
      const titles = limitedFileNames.map(name => `File:${name}`).join('|')

      const imageResponse = await axios.get(
        'https://commons.wikimedia.org/w/api.php',
        {
          params: {
            action: 'query',
            format: 'json',
            titles,
            prop: 'imageinfo',
            iiprop: 'url|size|mime|extmetadata',
            iiurlwidth: 800,
          },
          headers: getWikimediaHeaders(),
          timeout: 15000,
        }
      )

      if (!imageResponse.data?.query?.pages) return []

      const imagePages = imageResponse.data.query.pages
      const images = Object.values(imagePages).map((page: any) => {
        const imageInfo = page.imageinfo?.[0]
        if (!imageInfo) return null

        return this.adapter.adaptImageData(page, imageInfo)
      }).filter(Boolean)

      return images
    } catch (error) {
      console.error('Error fetching images from Wikimedia Commons gallery:', error)
      return []
    }
  }

  /**
   * Parse file names from gallery wikitext content
   * This is a simplified parser - for production use, consider using a proper wikitext parser
   */
  private parseFileNamesFromGallery(content: string): string[] {
    const fileNames: string[] = []
    
    try {
      // Look for File: references in the content
      const fileRegex = /(?:File|Image):([^|\]\n]+)/gi
      let match

      while ((match = fileRegex.exec(content)) !== null) {
        const fileName = match[1].trim()
        if (fileName && !fileNames.includes(fileName)) {
          fileNames.push(fileName)
        }
      }

      return fileNames
    } catch (error) {
      console.warn('Error parsing gallery content:', error)
      return []
    }
  }

  /**
   * Search for images by text query
   * @param query Search query
   * @param limit Maximum number of results
   * @returns Array of image data
   */
  async searchImages(query: string, limit: number = 10): Promise<any[]> {
    this.ensureInitialized()

    try {
      console.log(`Searching Wikimedia Commons for images: ${query}`)

      const response = await axios.get(
        'https://commons.wikimedia.org/w/api.php',
        {
          params: {
            action: 'query',
            format: 'json',
            generator: 'search',
            gsrsearch: `filetype:bitmap ${query}`,
            gsrnamespace: 6, // File namespace
            gsrlimit: limit,
            prop: 'imageinfo',
            iiprop: 'url|size|mime|extmetadata',
            iiurlwidth: 800,
          },
          headers: getWikimediaHeaders(),
          timeout: 15000,
        }
      )

      if (!response.data?.query?.pages) return []

      const pages = response.data.query.pages
      const images = Object.values(pages).map((page: any) => {
        const imageInfo = page.imageinfo?.[0]
        if (!imageInfo) return null

        return this.adapter.adaptImageData(page, imageInfo)
      }).filter(Boolean)

      return images
    } catch (error) {
      console.error('Error searching Wikimedia Commons images:', error)
      return []
    }
  }
}
