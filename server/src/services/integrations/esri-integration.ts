import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

export interface EsriConfig extends IntegrationConfig {
  apiKey: string
}

export const ESRI_TILE_HOST = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services'

/**
 * Esri basemap tiles through ArcGIS Location Platform. A key holder: the tile
 * proxy reads the key and attaches it server-side, so it never reaches the
 * browser. Powers the Esri World Imagery source of the satellite map.
 */
export class EsriIntegration implements Integration<EsriConfig> {
  readonly integrationId = IntegrationId.ESRI
  readonly capabilityIds: IntegrationCapabilityId[] = [IntegrationCapabilityId.MAP_LAYER]
  readonly capabilities = {}

  protected config: EsriConfig = { apiKey: '' }

  initialize(config: EsriConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API key is required')
    }
    this.config = { apiKey: config.apiKey }
  }

  validateConfig(config: EsriConfig): boolean {
    return Boolean(config && config.apiKey)
  }

  async testConnection(config: EsriConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Invalid configuration: API key is required' }
    }
    try {
      const res = await fetch(
        `${ESRI_TILE_HOST}/World_Imagery/MapServer/tile/0/0/0?token=${encodeURIComponent(config.apiKey)}`,
        { signal: AbortSignal.timeout(8_000) },
      )
      // A rejected key still answers 200, with a JSON error body instead of an image.
      if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
        return { success: false, message: 'Invalid API key, or it lacks the Basemaps privilege' }
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error?.message || 'Failed to connect to ArcGIS' }
    }
  }
}
