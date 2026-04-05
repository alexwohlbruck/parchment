import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
} from '../../types/integration.types'
import { IntegrationId, IntegrationCapabilityId } from '../../types/integration.enums'

export interface OpenStreetMapSystemConfig extends IntegrationConfig {
  clientId: string
  clientSecret: string
}

/**
 * System-scoped OpenStreetMap integration.
 * Stores the OAuth2 application credentials (client ID + secret) that the
 * server needs to run the user-facing OSM OAuth flow.
 * No runtime capabilities — this is configuration-only.
 */
export class OpenStreetMapSystemIntegration
  implements Integration<OpenStreetMapSystemConfig>
{
  readonly integrationId = IntegrationId.OPENSTREETMAP
  readonly capabilityIds: IntegrationCapabilityId[] = []
  readonly capabilities: IntegrationCapabilities = {}

  validateConfig(config: OpenStreetMapSystemConfig): boolean {
    return !!(config?.clientId?.trim() && config?.clientSecret?.trim())
  }

  async testConnection(
    config: OpenStreetMapSystemConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Client ID and Client Secret are required',
      }
    }
    // OAuth app credentials can't be validated without a full user flow,
    // so we just confirm the fields are present.
    return { success: true }
  }

  initialize(config: OpenStreetMapSystemConfig): void {
    // No runtime state to set up — credentials are read on demand by the OAuth controller
  }
}
