import { IntegrationId } from '../../types/integration.types'
import { Integration } from '../../types/integration.types'
import { GoogleMapsIntegration } from './google-maps-integration'
import { PeliasIntegration } from './pelias-integration'
import { NominatimIntegration } from './nominatim-integration'
import { OverpassIntegration } from './overpass-integration'
import { MapboxIntegration } from './mapbox-integration'

/**
 * Registry for all integrations
 */
export class IntegrationRegistry {
  private integrations: Map<IntegrationId, Integration> = new Map()

  constructor() {
    this.registerDefaultIntegrations()
  }

  /**
   * Register all default integrations
   */
  private registerDefaultIntegrations(): void {
    this.registerIntegration(new GoogleMapsIntegration())
    this.registerIntegration(new PeliasIntegration())
    this.registerIntegration(new NominatimIntegration())
    this.registerIntegration(new OverpassIntegration())
    this.registerIntegration(new MapboxIntegration())
  }

  /**
   * Register a new integration
   * @param integration The integration to register
   */
  registerIntegration(integration: Integration): void {
    this.integrations.set(integration.integrationId, integration)
  }

  /**
   * Get an integration by its integration ID
   * @param integrationId The integration ID
   * @returns The integration instance, or undefined if not found
   */
  getIntegration(integrationId: IntegrationId): Integration | undefined {
    return this.integrations.get(integrationId)
  }
}
