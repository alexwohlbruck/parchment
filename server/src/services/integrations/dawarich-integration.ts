import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationId,
  Integration,
} from '../../types/integration.types'

/**
 * Dawarich — self-hosted location-history service.
 *
 * Phase-1 plumbing only: the integration definition + form + encrypted-config
 * storage round-trip exist end-to-end, but no capabilities are exposed. Users
 * can configure + disconnect Dawarich; they can't yet fetch points/visits or
 * render location history. Capabilities will land in subsequent PRs.
 *
 * Because the config (URL + API token for a self-hosted instance) is sensitive
 * and the server never needs to call Dawarich on a schedule, this integration
 * only supports `scheme: 'user-e2ee'`. The config is encrypted client-side and
 * stored as an opaque personal-blob — the server never sees cleartext.
 */
export interface DawarichConfig extends IntegrationConfig {
  url: string
  apiToken: string
}

export class DawarichIntegration implements Integration<DawarichConfig> {
  readonly integrationId = IntegrationId.DAWARICH
  readonly capabilityIds = []
  readonly capabilities = {}

  protected config: DawarichConfig = { url: '', apiToken: '' }

  initialize(config: DawarichConfig): void {
    // No-op. Phase-1 has no capabilities, so nothing to wire up at init time.
    // When a capability method ships, populate `this.config` here and guard
    // calls with an `ensureInitialized()` check like other integrations do.
    this.config = { ...config }
  }

  async testConnection(
    _config: DawarichConfig,
  ): Promise<IntegrationTestResult> {
    // Stub. The real connection test would require picking an endpoint to hit
    // (e.g. a /api/status probe), and that decision is deferred with the rest
    // of Dawarich's capabilities. Returning success keeps the form's
    // "test before save" UX working until a real probe lands.
    return { success: true }
  }

  validateConfig(config: DawarichConfig): boolean {
    return Boolean(
      config &&
        typeof config.url === 'string' &&
        config.url.length > 0 &&
        typeof config.apiToken === 'string' &&
        config.apiToken.length > 0,
    )
  }
}
