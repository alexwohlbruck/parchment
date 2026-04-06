import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.enums'
import type { OpenStreetMapSystemConfig, OsmServerOption } from '../services/integrations/openstreetmap-system-integration'

const OSM_SERVERS: Record<string, string> = {
  production: 'https://www.openstreetmap.org',
  sandbox: 'https://master.apis.dev.openstreetmap.org',
}

export interface OsmConfig {
  server: OsmServerOption
  serverUrl: string
  apiBase: string
  authEndpoint: string
  tokenEndpoint: string
  redirectUri?: string
  clientId: string
  clientSecret?: string
}

/**
 * Resolve the full OSM configuration from the system integration.
 * Throws if the system integration is not configured.
 */
export function getOsmConfig(): OsmConfig {
  const systemIntegrations = integrationManager.getConfiguredIntegrations()
  const osmSystem = systemIntegrations.find(
    (i) => i.integrationId === IntegrationId.OPENSTREETMAP,
  )

  if (!osmSystem) {
    throw new Error(
      'OSM system integration not configured. An admin must configure OpenStreetMap OAuth application credentials.',
    )
  }

  const config = osmSystem.config as OpenStreetMapSystemConfig
  const server: OsmServerOption = config.server || 'production'

  let serverUrl: string
  if (server === 'custom') {
    if (!config.customServerUrl) {
      throw new Error('Custom OSM server URL is required when server is set to "custom".')
    }
    serverUrl = config.customServerUrl.replace(/\/+$/, '')
  } else {
    serverUrl = OSM_SERVERS[server]
  }

  return {
    server,
    serverUrl,
    apiBase: `${serverUrl}/api/0.6`,
    authEndpoint: `${serverUrl}/oauth2/authorize`,
    tokenEndpoint: `${serverUrl}/oauth2/token`,
    redirectUri: config.redirectUri || undefined,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  }
}
