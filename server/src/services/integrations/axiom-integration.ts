import type {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilities,
  LoggingCapability,
} from '../../types/integration.types'
import { IntegrationId, IntegrationCapabilityId } from '../../types/integration.enums'

export interface AxiomConfig extends IntegrationConfig {
  endpoint?: string
  apiToken: string
  dataset: string
}

const DEFAULT_ENDPOINT = 'https://api.axiom.co'

/**
 * Axiom (observability) integration. System-only.
 * Provides the logging capability; configuring it enables OTLP log/trace
 * export to Axiom for this server. Used at startup to configure OpenTelemetry.
 */
export class AxiomIntegration implements Integration<AxiomConfig> {
  readonly integrationId = IntegrationId.AXIOM
  readonly capabilityIds: IntegrationCapabilityId[] = [IntegrationCapabilityId.LOGGING]
  readonly capabilities: IntegrationCapabilities = {
    logging: {} as LoggingCapability,
  }

  validateConfig(config: AxiomConfig): boolean {
    return !!(
      config?.apiToken?.trim() &&
      config?.dataset?.trim()
    )
  }

  async testConnection(config: AxiomConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'API token and dataset are required',
      }
    }
    const endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '')
    try {
      const res = await fetch(`${endpoint}/v1/datasets/${encodeURIComponent(config.dataset)}`, {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
      })
      if (res.ok) return { success: true }
      const body = await res.text()
      return {
        success: false,
        message: res.status === 401
          ? 'Invalid API token'
          : res.status === 404
            ? `Dataset "${config.dataset}" not found`
            : `Axiom API error: ${res.status} ${body.slice(0, 200)}`,
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }

  initialize(_config: AxiomConfig): void {
    // No runtime behavior; config is read at startup in observability.config
  }
}
