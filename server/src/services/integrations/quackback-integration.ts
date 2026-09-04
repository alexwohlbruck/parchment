import axios from 'axios'
import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
} from '../../types/integration.types'
import { IntegrationId, IntegrationCapabilityId } from '../../types/integration.enums'

export interface QuackbackConfig extends IntegrationConfig {
  url: string
  apiKey: string
}

/**
 * System-scoped Quackback integration — the backend for the in-app feedback
 * form. Stores the instance URL and API key an admin pastes in; the feedback
 * module reads them to file posts on a user's behalf.
 * No runtime capabilities — this is configuration-only.
 */
export class QuackbackIntegration implements Integration<QuackbackConfig> {
  readonly integrationId = IntegrationId.QUACKBACK
  readonly capabilityIds: IntegrationCapabilityId[] = []
  readonly capabilities: IntegrationCapabilities = {}

  initialize(config: QuackbackConfig): void {
    // No runtime state to set up — the feedback module reads the credentials
    // on demand so an admin can change them without a restart.
  }

  validateConfig(config: QuackbackConfig): boolean {
    return !!(config?.url?.trim() && config?.apiKey?.trim())
  }

  async testConnection(config: QuackbackConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return { success: false, message: 'Instance URL and API key are required' }
    }

    const url = config.url.trim().replace(/\/+$/, '')

    try {
      // Listing boards is the cheapest authenticated read, and it doubles as a
      // check that the key can see something worth filing feedback against.
      const { data } = await axios.get(`${url}/api/v1/boards`, {
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        timeout: 10_000,
      })

      const boards = data?.data ?? []
      if (boards.length === 0) {
        return {
          success: false,
          message: 'Connected, but no boards exist yet — create one in Quackback first',
        }
      }

      return {
        success: true,
        message: `Connected — ${boards.length} board${boards.length === 1 ? '' : 's'} available`,
      }
    } catch (error: any) {
      const status = error?.response?.status
      if (status === 401 || status === 403) {
        return { success: false, message: 'Invalid API key' }
      }
      return {
        success: false,
        message: error?.message || 'Could not reach the Quackback instance',
      }
    }
  }
}
