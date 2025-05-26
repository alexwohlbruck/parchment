import {
  IntegrationId,
  IntegrationCapabilityId,
} from '../../types/integration.types'
import { Integration } from '../../types/integration.types'
import { GoogleMapsIntegration } from './google-maps-integration'
import { PeliasIntegration } from './pelias-integration'
import { NominatimIntegration } from './nominatim-integration'
import { OverpassIntegration } from './overpass-integration'

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

  /**
   * Get all registered integrations
   * @returns Array of all registered integrations
   */
  getAllIntegrations(): Integration[] {
    return Array.from(this.integrations.values())
  }

  /**
   * Get all integrations that support a specific capability
   * @param capability The capability to filter by
   * @returns Array of integrations that support the capability
   */
  getIntegrationsByCapability(
    capability: IntegrationCapabilityId,
  ): Integration[] {
    return this.getAllIntegrations().filter((integration) =>
      integration.capabilities.includes(capability),
    )
  }
}
