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
import type { Place, PlacePhoto } from '../../types/place.types'
import { WikidataAdapter } from './adapters/wikidata-adapter'
import { SOURCE } from '../../lib/constants'

// Get version from package.json
const packageJson = require('../../../package.json')

/**
 * Get proper headers for Wikidata requests to comply with usage policy
 */
function getWikidataHeaders(): Record<string, string> {
  const serverOrigin = process.env.SERVER_ORIGIN!
  
  return {
    'User-Agent': `Parchment/${packageJson.version} (https://github.com/alexwohlbruck/parchment)`,
    'Referer': serverOrigin,
  }
}

export interface WikidataConfig extends IntegrationConfig {
  // Wikidata doesn't require API keys or special configuration
  // This is kept for consistency with other integrations
}

/**
 * Wikidata integration for fetching structured place data
 */
export class WikidataIntegration implements Integration<WikidataConfig> {
  private initialized = false
  private adapter = new WikidataAdapter()
  private config: WikidataConfig = {}

  readonly integrationId = IntegrationId.WIKIDATA
  readonly capabilityIds = [IntegrationCapabilityId.PLACE_INFO]
  readonly capabilities = {
    placeInfo: {
      getPlaceInfo: this.getPlaceInfo.bind(this),
    } as PlaceInfoCapability,
  }
  readonly sources = [SOURCE.WIKIDATA]

  /**
   * Tests the connection with the given configuration
   */
  async testConnection(config: WikidataConfig): Promise<IntegrationTestResult> {
    try {
      // Test with a well-known entity (Earth - Q2)
      const testEntityId = 'Q2'
      const response = await axios.get(
        `https://www.wikidata.org/wiki/Special:EntityData/${testEntityId}.json`,
        {
          headers: {
            ...getWikidataHeaders(),
            'Accept-Language': 'en',
          },
          timeout: 10000,
        }
      )

      if (response.data && response.data.entities && response.data.entities[testEntityId]) {
        return { success: true }
      } else {
        return {
          success: false,
          message: 'Invalid response format from Wikidata API',
        }
      }
    } catch (error: any) {
      console.error('Error testing Wikidata API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to Wikidata API',
      }
    }
  }

  /**
   * Initialize the integration with configuration
   */
  initialize(config: WikidataConfig): void {
    this.config = config
    this.initialized = true
  }

  /**
   * Validates that the configuration has all required fields
   */
  validateConfig(config: WikidataConfig): boolean {
    // Wikidata doesn't require any special configuration
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
   * Get place info by Wikidata Q ID
   * @param id The Wikidata Q ID (e.g., Q156716) or wikidata/Q156716
   * @returns Place details or null if not found
   */
  private async getPlaceInfo(id: string): Promise<Place | null> {
    this.ensureInitialized()

    try {
      // Remove provider prefix if present
      let wikidataId = id
      if (id.startsWith('wikidata/')) {
        wikidataId = id.substring(9)
      }

      // Validate that this looks like a Wikidata Q ID
      if (!wikidataId.match(/^Q\d+$/)) {
        console.error(`Invalid Wikidata ID format: ${wikidataId}`)
        return null
      }

      console.log(`Getting place details from Wikidata for ID: ${wikidataId}`)

      const response = await axios.get(
        `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`,
        {
          headers: {
            ...getWikidataHeaders(),
            'Accept-Language': 'en',
          },
          timeout: 15000,
        }
      )

      if (!response.data?.entities?.[wikidataId]) {
        console.error('No entity found with ID:', wikidataId)
        return null
      }

      const entity = response.data.entities[wikidataId]
      
      // Use the adapter to convert to standardized Place format
      return this.adapter.placeInfo.adaptPlaceDetails(entity, wikidataId)
    } catch (error) {
      console.error('Error fetching place from Wikidata:', error)
      return null
    }
  }

  /**
   * Get Wikidata entity data by Q ID
   * This is a public method that can be used by other integrations
   * @param wikidataId The Wikidata Q ID
   * @param language Optional language preference
   * @returns Raw Wikidata entity data or null if not found
   */
  async getEntityData(wikidataId: string, language: string = 'en'): Promise<any | null> {
    this.ensureInitialized()

    try {
      const response = await axios.get(
        `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`,
        {
          headers: {
            ...getWikidataHeaders(),
            'Accept-Language': language,
          },
          timeout: 15000,
        }
      )

      return response.data?.entities?.[wikidataId] || null
    } catch (error) {
      console.error('Error fetching entity from Wikidata:', error)
      return null
    }
  }

  /**
   * Extract Wikipedia page title from Wikidata entity
   * @param entity Wikidata entity data
   * @param language Language code (e.g., 'en', 'de')
   * @returns Wikipedia page title or null if not found
   */
  extractWikipediaTitle(entity: any, language: string = 'en'): string | null {
    if (!entity?.sitelinks) return null

    const wikipediaKey = `${language}wiki`
    const sitelink = entity.sitelinks[wikipediaKey]
    
    return sitelink?.title || null
  }

  /**
   * Extract Wikimedia Commons category from Wikidata entity
   * @param entity Wikidata entity data
   * @returns Commons category name or null if not found
   */
  extractCommonsCategory(entity: any): string | null {
    if (!entity?.claims) return null

    // P373 is the property for Commons category
    const commonsCategoryClaims = entity.claims['P373']
    if (!commonsCategoryClaims || commonsCategoryClaims.length === 0) return null

    const claim = commonsCategoryClaims[0]
    return claim?.mainsnak?.datavalue?.value || null
  }

  /**
   * Extract Commons gallery from Wikidata entity
   * @param entity Wikidata entity data
   * @returns Commons gallery name or null if not found
   */
  extractCommonsGallery(entity: any): string | null {
    if (!entity?.claims) return null

    // P935 is the property for Commons gallery
    const commonsGalleryClaims = entity.claims['P935']
    if (!commonsGalleryClaims || commonsGalleryClaims.length === 0) return null

    const claim = commonsGalleryClaims[0]
    return claim?.mainsnak?.datavalue?.value || null
  }
}
