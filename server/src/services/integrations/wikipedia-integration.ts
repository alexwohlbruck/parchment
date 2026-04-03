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
import { WikipediaAdapter } from './adapters/wikipedia-adapter'
import { SOURCE } from '../../lib/constants'

// Get version from package.json
const packageJson = require('../../../package.json')

/**
 * Get proper headers for Wikipedia requests to comply with usage policy
 */
function getWikipediaHeaders(): Record<string, string> {
  const serverOrigin = process.env.SERVER_ORIGIN!
  
  return {
    'User-Agent': `Parchment/${packageJson.version} (https://github.com/alexwohlbruck/parchment)`,
    'Referer': serverOrigin,
  }
}

export interface WikipediaConfig extends IntegrationConfig {
  // Wikipedia doesn't require API keys, but we keep this for consistency
}

/**
 * Wikipedia integration for fetching article summaries and infobox data
 */
export class WikipediaIntegration implements Integration<WikipediaConfig> {
  private initialized = false
  private adapter = new WikipediaAdapter()
  private config: WikipediaConfig = {}

  readonly integrationId = IntegrationId.WIKIPEDIA
  readonly capabilityIds = [IntegrationCapabilityId.PLACE_INFO]
  readonly capabilities = {
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
    cacheTtl: {
      placeInfo: { getPlaceInfo: 12 * 3600 },
    },
  }
  readonly sources = [SOURCE.WIKIPEDIA]

  /**
   * Tests the connection with the given configuration
   */
  async testConnection(config: WikipediaConfig): Promise<IntegrationTestResult> {
    try {
      // Test with a well-known article (Earth)
      const testTitle = 'Earth'
      const response = await axios.get(
        'https://en.wikipedia.org/w/api.php',
        {
          params: {
            action: 'query',
            format: 'json',
            prop: 'extracts',
            titles: testTitle,
            exintro: true,
            explaintext: true,
            exsectionformat: 'plain',
          },
          headers: getWikipediaHeaders(),
          timeout: 10000,
        }
      )

      if (response.data && response.data.query && response.data.query.pages) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Invalid response format from Wikipedia API',
        }
      }
    } catch (error: any) {
      console.error('Error testing Wikipedia API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Wikipedia API',
      }
    }
  }

  /**
   * Initialize the integration with configuration
   */
  initialize(config: WikipediaConfig): void {
    this.config = config
    this.initialized = true
  }

  /**
   * Validates that the configuration has all required fields
   */
  validateConfig(config: WikipediaConfig): boolean {
    // Wikipedia doesn't require any special configuration
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
   * Get place info by Wikipedia page title and language
   * @param id The identifier in format "lang:PageTitle" (e.g., "en:Pariser_Platz") or "wikipedia/lang:PageTitle"
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(
    id: string,
    _options?: { language?: string },
  ): Promise<Place | null> {
    this.ensureInitialized()

    try {
      // Remove provider prefix if present
      let pageInfo = id
      if (id.startsWith('wikipedia/')) {
        pageInfo = id.substring(10)
      }

      // Parse language and title
      const [language, ...titleParts] = pageInfo.split(':')
      const title = titleParts.join(':')

      if (!language || !title) {
        console.error(`Invalid Wikipedia page identifier: ${pageInfo}`)
        return null
      }

      console.log(`Getting place details from Wikipedia for page: ${language}:${title}`)

      const pageData = await this.getPageData(title, language)
      if (!pageData) return null

      // Use the adapter to convert to standardized Place format
      return this.adapter.placeInfo.adaptPlaceDetails(pageData, title, language)
    } catch (error) {
      console.error('Error fetching place from Wikipedia:', error)
      return null
    }
  }

  /**
   * Get Wikipedia page data including extract and infobox
   * @param title Wikipedia page title
   * @param language Language code (e.g., 'en', 'de')
   * @returns Page data or null if not found
   */
  async getPageData(title: string, language: string = 'en'): Promise<any | null> {
    this.ensureInitialized()

    try {
      const baseUrl = `https://${language}.wikipedia.org/w/api.php`
      
      // First, get the page extract (summary)
      const extractResponse = await axios.get(baseUrl, {
        params: {
          action: 'query',
          format: 'json',
          prop: 'extracts|pageimages|coordinates',
          titles: title,
          exintro: true,
          explaintext: true,
          exsectionformat: 'plain',
          piprop: 'original',
          coprop: 'lat|lon',
        },
        headers: getWikipediaHeaders(),
        timeout: 15000,
      })

      const pages = extractResponse.data?.query?.pages
      if (!pages) return null

      const pageId = Object.keys(pages)[0]
      const page = pages[pageId]

      if (!page || page.missing !== undefined) {
        console.error(`Wikipedia page not found: ${language}:${title}`)
        return null
      }

      // Try to get infobox data using the wikitext parser
      let infoboxData = null
      try {
        const wikitextResponse = await axios.get(baseUrl, {
          params: {
            action: 'query',
            format: 'json',
            prop: 'revisions',
            titles: title,
            rvprop: 'content',
            rvslots: 'main',
          },
          headers: getWikipediaHeaders(),
          timeout: 15000,
        })

        const revisions = wikitextResponse.data?.query?.pages?.[pageId]?.revisions
        if (revisions && revisions.length > 0) {
          const wikitext = revisions[0]?.slots?.main?.['*']
          if (wikitext) {
            infoboxData = this.parseInfoboxFromWikitext(wikitext)
          }
        }
      } catch (error) {
        console.warn('Failed to get infobox data for Wikipedia page:', title, error)
      }

      return {
        ...page,
        infobox: infoboxData,
        language,
      }
    } catch (error) {
      console.error('Error fetching Wikipedia page data:', error)
      return null
    }
  }

  /**
   * Extract infobox data from Wikipedia wikitext
   * This is a simplified parser - for production use, consider using a proper wikitext parser
   */
  private parseInfoboxFromWikitext(wikitext: string): Record<string, string> | null {
    const infobox: Record<string, string> = {}
    
    try {
      // Look for infobox templates
      const infoboxRegex = /\{\{[Ii]nfobox[^}]*?\|(.*?)\}\}/s
      const match = wikitext.match(infoboxRegex)
      
      if (!match) return null

      const infoboxContent = match[1]
      
      // Parse key-value pairs
      const lines = infoboxContent.split('\n')
      
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (trimmedLine.includes('=')) {
          const [key, ...valueParts] = trimmedLine.split('=')
          const value = valueParts.join('=').trim()
          
          if (key && value) {
            const cleanKey = key.trim().replace(/^\|/, '')
            const cleanValue = value
              .replace(/\[\[([^|\]]+)\|?[^\]]*\]\]/g, '$1') // Remove wiki links
              .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
              .replace(/<[^>]+>/g, '') // Remove HTML tags
              .trim()
            
            if (cleanKey && cleanValue) {
              infobox[cleanKey] = cleanValue
            }
          }
        }
      }
      
      return Object.keys(infobox).length > 0 ? infobox : null
    } catch (error) {
      console.warn('Error parsing infobox:', error)
      return null
    }
  }

  /**
   * Get page summary by title
   * @param title Wikipedia page title
   * @param language Language code
   * @returns Page summary or null if not found
   */
  async getPageSummary(title: string, language: string = 'en'): Promise<string | null> {
    const pageData = await this.getPageData(title, language)
    return pageData?.extract || null
  }

  /**
   * Get page coordinates
   * @param title Wikipedia page title
   * @param language Language code
   * @returns Coordinates {lat, lng} or null if not found
   */
  async getPageCoordinates(title: string, language: string = 'en'): Promise<{lat: number, lng: number} | null> {
    const pageData = await this.getPageData(title, language)
    
    if (pageData?.coordinates && pageData.coordinates.length > 0) {
      const coord = pageData.coordinates[0]
      return {
        lat: coord.lat,
        lng: coord.lon,
      }
    }
    
    return null
  }
}
