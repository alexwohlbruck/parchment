import { db } from '../db'
import { eq, and } from 'drizzle-orm'
import { generateId } from '../util'
import { integrations } from '../schema/integration.schema'
import {
  IntegrationCapability,
  IntegrationCapabilityId,
  IntegrationDefinition,
  IntegrationId,
  IntegrationResponse,
  TestIntegrationResponse,
} from '../types/integration.types'

// Available integration definitions
const availableIntegrations: IntegrationDefinition[] = [
  {
    id: IntegrationId.GOOGLE_MAPS,
    name: 'Google Maps',
    description: 'Comprehensive mapping and location services',
    color: '#4285F4',
    capabilities: [
      IntegrationCapabilityId.ROUTING,
      IntegrationCapabilityId.GEOCODING,
      IntegrationCapabilityId.PLACE_INFO,
      IntegrationCapabilityId.IMAGERY,
    ],
    paid: true,
    cloud: true,
    configSchema: 'googleMapsSchema',
  },
  {
    id: IntegrationId.PELIAS,
    name: 'Pelias',
    description: 'Open-source geocoding and search',
    color: '#7EBC6F',
    capabilities: [IntegrationCapabilityId.GEOCODING],
    paid: false,
    cloud: false,
    configSchema: 'hostConfigSchema',
  },
  {
    id: IntegrationId.GRAPHHOPPER,
    name: 'GraphHopper',
    description: 'Fast and efficient routing engine',
    color: '#2E7D32',
    capabilities: [IntegrationCapabilityId.ROUTING],
    paid: false,
    cloud: false,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.YELP,
    name: 'Yelp',
    description: 'Local business reviews and ratings',
    color: '#D32323',
    capabilities: [IntegrationCapabilityId.PLACE_INFO],
    paid: true,
    cloud: true,
    configSchema: 'oauthConfigSchema',
  },
  {
    id: IntegrationId.OPENTABLE,
    name: 'OpenTable',
    description: 'Restaurant discovery and reservations',
    color: '#222222',
    capabilities: [IntegrationCapabilityId.PLACE_INFO],
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.FOURSQUARE,
    name: 'Foursquare',
    description: 'Location-based social network',
    color: '#F94877',
    capabilities: [IntegrationCapabilityId.PLACE_INFO],
    paid: true,
    cloud: true,
    configSchema: 'oauthConfigSchema',
  },
  {
    id: IntegrationId.MAPILLARY,
    name: 'Mapillary',
    description: 'Street-level imagery platform',
    color: '#2B2B2B',
    capabilities: [IntegrationCapabilityId.IMAGERY],
    paid: false,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.NOMINATIM,
    name: 'Nominatim',
    description: 'Open-source geocoding and reverse geocoding',
    color: '#7EBC6F',
    capabilities: [IntegrationCapabilityId.GEOCODING],
    paid: false,
    cloud: false,
    configSchema: 'nominatimSchema',
  },
  {
    id: IntegrationId.TRIPADVISOR,
    name: 'TripAdvisor',
    description: 'Travel reviews and recommendations',
    color: '#34E0A1',
    capabilities: [IntegrationCapabilityId.PLACE_INFO],
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.GEOAPIFY,
    name: 'Geoapify',
    description: 'Geocoding, routing, and place data',
    color: '#FF5A5F',
    capabilities: [
      IntegrationCapabilityId.GEOCODING,
      IntegrationCapabilityId.ROUTING,
      IntegrationCapabilityId.PLACE_INFO,
    ],
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
]

// Helper functions
function parseIntegrationData(integrationRecord: any): IntegrationResponse {
  const parsedConfig = JSON.parse(integrationRecord.config as string)
  const parsedCapabilities = JSON.parse(
    integrationRecord.capabilities as string,
  ) as IntegrationCapability[]

  // Remove capabilities from config if they exist there
  if (parsedConfig.capabilities) {
    delete parsedConfig.capabilities
  }

  return {
    id: integrationRecord.id,
    integrationId: integrationRecord.integrationId as IntegrationId,
    capabilities: parsedCapabilities,
    config: parsedConfig,
  }
}

function cleanConfig(config: Record<string, any>): Record<string, any> {
  const cleanedConfig = { ...config }

  // Remove capabilities from config
  if (cleanedConfig.capabilities) {
    delete cleanedConfig.capabilities
  }

  // Flatten nested config objects
  if (cleanedConfig.config && typeof cleanedConfig.config === 'object') {
    Object.assign(cleanedConfig, cleanedConfig.config)
    delete cleanedConfig.config
  }

  return cleanedConfig
}

// Service functions
export async function getConfiguredIntegrations(
  userId: string,
): Promise<IntegrationResponse[]> {
  const userIntegrations = await db
    .select()
    .from(integrations)
    .where(eq(integrations.userId, userId))

  return userIntegrations.map(parseIntegrationData)
}

export async function getAvailableIntegrationsForUser(
  userId: string,
): Promise<IntegrationDefinition[]> {
  const userIntegrations = await db
    .select()
    .from(integrations)
    .where(eq(integrations.userId, userId))

  const configuredIds = new Set(userIntegrations.map((i) => i.integrationId))

  return availableIntegrations.filter(
    (integration) => !configuredIds.has(integration.id),
  )
}

export async function getIntegration(
  id: string,
  userId: string,
): Promise<IntegrationResponse | null> {
  const result = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.userId, userId)))

  if (result.length === 0) {
    return null
  }

  return parseIntegrationData(result[0])
}

export async function createIntegration(
  userId: string,
  integrationId: IntegrationId,
  config: Record<string, any>,
  customCapabilities?: IntegrationCapability[],
): Promise<IntegrationResponse> {
  const integrationDef = availableIntegrations.find(
    (integration) => integration.id === integrationId,
  )

  if (!integrationDef) {
    throw new Error(`Integration with ID ${integrationId} not found`)
  }

  // Test the configuration
  await testIntegrationConfig(integrationId, config)

  // Use provided capabilities or create with all active
  const capabilities =
    customCapabilities ||
    integrationDef.capabilities.map((id) => ({
      id,
      active: true,
    }))

  // Clean config by removing capabilities and flattening nested objects
  const cleanedConfig = cleanConfig(config)

  // Insert into database
  const result = await db
    .insert(integrations)
    .values({
      id: generateId(),
      userId,
      integrationId,
      capabilities: JSON.stringify(capabilities),
      config: JSON.stringify(cleanedConfig),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  return parseIntegrationData(result[0])
}

export async function updateIntegration(
  id: string,
  userId: string,
  updates: {
    config?: Record<string, any>
    capabilities?: IntegrationCapability[]
  },
): Promise<IntegrationResponse> {
  const currentIntegration = await getIntegration(id, userId)

  if (!currentIntegration) {
    throw new Error('Integration not found')
  }

  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  }

  // Update config if provided
  if (updates.config) {
    updateData.config = JSON.stringify(cleanConfig(updates.config))
  }

  // Update capabilities if provided
  if (updates.capabilities) {
    updateData.capabilities = JSON.stringify(updates.capabilities)
  }

  // Only perform update if there are fields to update besides updatedAt
  if (Object.keys(updateData).length <= 1) {
    throw new Error('No updates provided')
  }

  // Update the integration
  await db
    .update(integrations)
    .set(updateData)
    .where(and(eq(integrations.id, id), eq(integrations.userId, userId)))

  // Get the updated integration
  const updatedIntegration = await getIntegration(id, userId)
  if (!updatedIntegration) {
    throw new Error('Failed to retrieve updated integration')
  }

  return updatedIntegration
}

export async function deleteIntegration(
  id: string,
  userId: string,
): Promise<void> {
  const result = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.userId, userId)))

  if (result.length === 0) {
    throw new Error(`Integration with ID ${id} not found`)
  }

  await db.delete(integrations).where(eq(integrations.id, id))
}

export async function testIntegrationConfig(
  integrationId: IntegrationId,
  config: Record<string, any>,
): Promise<TestIntegrationResponse> {
  // Validate required credentials based on integration type
  switch (integrationId) {
    case IntegrationId.GOOGLE_MAPS:
      if (!config.apiKey) {
        return { success: false, message: 'API Key is required' }
      }
      break

    case IntegrationId.PELIAS:
      if (!config.host || !config.apiKey) {
        return { success: false, message: 'Host and API Key are required' }
      }
      break

    case IntegrationId.NOMINATIM:
      if (!config.host || !config.email) {
        return { success: false, message: 'Host and email are required' }
      }
      break

    default:
      // Default check for API key
      if (!config.apiKey) {
        return { success: false, message: 'API Key is required' }
      }
  }

  // In a real implementation, API calls would be made to verify credentials
  return { success: true }
}

export function getIntegrationDefinition(
  integrationId: IntegrationId,
): IntegrationDefinition | undefined {
  return availableIntegrations.find((i) => i.id === integrationId)
}

export function getAvailableIntegrations(): IntegrationDefinition[] {
  return [...availableIntegrations]
}
