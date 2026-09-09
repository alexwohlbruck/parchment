import axios from 'axios'
import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
} from '../../types/integration.types'
import { IntegrationId, IntegrationCapabilityId } from '../../types/integration.enums'

export type OsmServerOption = 'production' | 'sandbox' | 'custom'

const OSM_SERVERS: Record<string, string> = {
  production: 'https://www.openstreetmap.org',
  sandbox: 'https://master.apis.dev.openstreetmap.org',
}

export interface OpenStreetMapSystemConfig extends IntegrationConfig {
  clientId: string
  clientSecret?: string
  server?: OsmServerOption
  customServerUrl?: string
  redirectUri?: string
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
    return !!config?.clientId?.trim()
  }

  private resolveServerUrl(config: OpenStreetMapSystemConfig): string {
    const server = config.server || 'production'
    if (server === 'custom' && config.customServerUrl) {
      return config.customServerUrl.replace(/\/+$/, '')
    }
    return OSM_SERVERS[server] || OSM_SERVERS.production
  }

  async testConnection(
    config: OpenStreetMapSystemConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Client ID is required',
      }
    }

    const serverUrl = this.resolveServerUrl(config)
    const tokenEndpoint = `${serverUrl}/oauth2/token`

    try {
      // Validate OAuth2 credentials by sending a token request with an
      // intentionally invalid authorization code. If the client ID and
      // secret are correct, the server returns 400 (bad grant). If they
      // are wrong, it returns 401 (unauthorized).
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: '__parchment_test__',
        redirect_uri: config.redirectUri || 'https://localhost',
        client_id: config.clientId,
      })

      if (config.clientSecret) {
        params.set('client_secret', config.clientSecret)
      }

      const response = await axios.post(tokenEndpoint, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true, // Don't throw on any status
      })

      const { status, data } = response
      const errorType = typeof data === 'object' ? data?.error : typeof data === 'string' ? data : ''

      if (status === 401 || status === 403) {
        return {
          success: false,
          message: 'Invalid client ID or client secret',
        }
      }

      // Some OAuth2 implementations return 400 with "invalid_client"
      // instead of 401 for bad credentials
      if (status === 400 && errorType === 'invalid_client') {
        return {
          success: false,
          message: 'Invalid client ID or client secret',
        }
      }

      // 400 with other errors (e.g. "invalid_grant") means the credentials
      // were accepted but the dummy code was (expectedly) rejected — success
      if (status === 400 || status === 200) {
        return { success: true, message: `Connected to ${serverUrl}` }
      }

      return {
        success: false,
        message: `Unexpected response from OSM (HTTP ${status})`,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Cannot reach OSM server at ${serverUrl}: ${error.message}`,
      }
    }
  }

  initialize(config: OpenStreetMapSystemConfig): void {
    // No runtime state to set up — credentials are read on demand by the OAuth controller
  }
}
