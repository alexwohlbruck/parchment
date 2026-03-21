import { getConfiguredIntegrations } from './integration.service'
import { IntegrationId } from '../types/integration.enums'
import type { IntegrationRecord } from '../schema/integrations.schema'

export interface ObservabilityConfig {
  endpoint: string
  headers: string
  serviceName?: string
}

/**
 * Resolves observability (OTLP) config for this server.
 * Precedence: env vars (OTEL_*) > Axiom system integration in DB.
 * Self-hosted users can configure via the Axiom integration in the UI;
 * the main server can use env vars or the same integration.
 */
export async function getObservabilityConfig(): Promise<ObservabilityConfig | null> {
  const fromEnv = getObservabilityConfigFromEnv()
  if (fromEnv) return fromEnv

  const systemIntegrations = await getConfiguredIntegrations()
  const axiom = systemIntegrations.find(
    (i: IntegrationRecord) => i.integrationId === IntegrationId.AXIOM,
  )
  if (!axiom?.config) return null

  const cfg = axiom.config as {
    endpoint?: string
    apiToken?: string
    dataset?: string
  }
  if (!cfg.apiToken?.trim() || !cfg.dataset?.trim()) return null

  const endpoint = (cfg.endpoint ?? 'https://api.axiom.co').replace(/\/$/, '')
  const headers = [
    `Authorization=Bearer ${cfg.apiToken.trim()}`,
    `X-Axiom-Dataset=${cfg.dataset.trim()}`,
  ].join(',')

  return { endpoint, headers, serviceName: process.env.OTEL_SERVICE_NAME ?? undefined }
}

function getObservabilityConfigFromEnv(): ObservabilityConfig | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint?.trim()) return null
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ''
  return {
    endpoint: endpoint.trim(),
    headers,
    serviceName: process.env.OTEL_SERVICE_NAME ?? undefined,
  }
}
