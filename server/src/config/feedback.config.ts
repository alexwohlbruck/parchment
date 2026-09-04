import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.enums'
import type { QuackbackConfig } from '../services/integrations/quackback-integration'

export interface FeedbackConfig {
  url: string
  apiKey: string
}

/**
 * Resolve the Quackback connection from the system integration an admin
 * configured under Settings → Integrations. Returns null when feedback has not
 * been set up, which is what hides the in-app entry points.
 */
export function getFeedbackConfig(): FeedbackConfig | null {
  const record = integrationManager
    .getConfiguredIntegrations()
    .find(i => i.integrationId === IntegrationId.QUACKBACK)

  const config = record?.config as QuackbackConfig | undefined
  if (!config?.url?.trim() || !config?.apiKey?.trim()) return null

  return {
    url: config.url.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey.trim(),
  }
}

export function isFeedbackConfigured(): boolean {
  return getFeedbackConfig() !== null
}
