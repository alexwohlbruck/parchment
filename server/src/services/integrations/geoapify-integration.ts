import axios from 'axios'
import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  SearchCategoryCapability,
  MapBounds,
} from '../../types/integration.types'
import { Place } from '../../types/place.types'
import { GeoapifyAdapter } from './adapters/geoapify-adapter'
import { getGeoapifyCategory } from './mappings/geoapify-preset-mapping'

export interface GeoapifyConfig extends IntegrationConfig {
  apiKey: string
}

export class GeoapifyIntegration implements Integration<GeoapifyConfig> {
  private initialized = false
  private adapter = new GeoapifyAdapter()
  protected config: GeoapifyConfig = { apiKey: '' }
  private baseUrl = 'https://api.geoapify.com/v2/places'

  readonly integrationId = IntegrationId.GEOAPIFY
  readonly capabilityIds = [IntegrationCapabilityId.SEARCH_CATEGORY]
  readonly capabilities = {
    searchCategory: {
      searchByCategory: this.searchByCategory.bind(this),
    } as SearchCategoryCapability,
  }

  initialize(config: GeoapifyConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API Key is required')
    }

    this.config = { ...config }
    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  async testConnection(config: GeoapifyConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API Key is required',
      }
    }

    // TODO: Validate connection with test request

    return { success: true }
  }

  validateConfig(config: GeoapifyConfig): boolean {
    return !!(config.apiKey && typeof config.apiKey === 'string')
  }

  async searchByCategory(
    presetId: string,
    bounds: MapBounds,
    options?: { limit?: number },
  ): Promise<Place[]> {
    this.ensureInitialized()

    const category = this.mapPresetToGeoapifyCategory(presetId)
    if (!category) {
      return []
    }

    try {
      const params: any = {
        categories: category,
        limit: options?.limit || 100,
        apiKey: this.config.apiKey,
      }

      params.filter = `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`

      const response = await axios.get(this.baseUrl, { params })

      if (!response.data.features) {
        return []
      }

      return response.data.features.map((feature: any) =>
        this.adapter.adaptPlaceDetails(feature),
      )
    } catch (error) {
      console.error('Error searching Geoapify places:', error)
      return []
    }
  }

  private mapPresetToGeoapifyCategory(presetId: string): string | null {
    return getGeoapifyCategory(presetId)
  }
}
