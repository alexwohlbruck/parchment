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

// Define available integrations
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

/**
 * Get all configured integrations for a user
 */
export async function getConfiguredIntegrations(
  userId: string,
): Promise<IntegrationResponse[]> {
  const userIntegrations = await db
    .select()
    .from(integrations)
    .where(eq(integrations.userId, userId))

  // Format the configured integrations for response
  return userIntegrations.map((integration) => {
    const parsedConfig = JSON.parse(integration.config as string)
    // Remove capabilities from config if they exist there
    if (parsedConfig.capabilities) {
      delete parsedConfig.capabilities
    }

    return {
      id: integration.id,
      integrationId: integration.integrationId as IntegrationId,
      capabilities: JSON.parse(
        integration.capabilities as string,
      ) as IntegrationCapability[],
      config: parsedConfig,
    }
  })
}

/**
 * Get all available integrations (excluding those the user has already configured)
 */
export async function getAvailableIntegrationsForUser(
  userId: string,
): Promise<IntegrationDefinition[]> {
  const userIntegrations = await db
    .select()
    .from(integrations)
    .where(eq(integrations.userId, userId))

  // Get the IDs of integrations that the user has already configured
  const configuredIds = new Set(userIntegrations.map((i) => i.integrationId))

  // Filter out integrations that the user has already configured
  return availableIntegrations.filter(
    (integration) => !configuredIds.has(integration.id),
  )
}

/**
 * Get a specific integration by ID
 */
export async function getIntegration(
  id: string,
  userId: string,
): Promise<IntegrationResponse | null> {
  const result = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.userId, userId)))

  if (result.length === 0) return null

  const integration = result[0]
  const parsedConfig = JSON.parse(integration.config as string)

  // Remove capabilities from config if they exist there
  if (parsedConfig.capabilities) {
    delete parsedConfig.capabilities
  }

  return {
    id: integration.id,
    integrationId: integration.integrationId as IntegrationId,
    capabilities: JSON.parse(
      integration.capabilities as string,
    ) as IntegrationCapability[],
    config: parsedConfig,
  }
}

/**
 * Create a new integration configuration
 */
export async function createIntegration(
  userId: string,
  integrationId: IntegrationId,
  config: Record<string, any>,
): Promise<IntegrationResponse> {
  // Find the integration definition
  const integrationDef = availableIntegrations.find(
    (integration) => integration.id === integrationId,
  )

  if (!integrationDef) {
    throw new Error(`Integration with ID ${integrationId} not found`)
  }

  // Test the configuration
  await testIntegrationConfig(integrationId, config)

  // Create capabilities with all set to active
  const capabilities: IntegrationCapability[] = integrationDef.capabilities.map(
    (id) => ({
      id,
      active: true,
    }),
  )

  // Remove capabilities from config if they exist there
  const cleanedConfig = { ...config }
  if (cleanedConfig.capabilities) {
    delete cleanedConfig.capabilities
  }

  // Create the integration
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

  return {
    id: result[0].id,
    integrationId: integrationId,
    capabilities: capabilities,
    config: cleanedConfig,
  }
}

/**
 * Update an existing integration configuration
 */
export async function updateIntegration(
  id: string,
  userId: string,
  updates: {
    config?: Record<string, any>
    capabilities?: IntegrationCapability[]
  },
): Promise<IntegrationResponse> {
  // Find the integration
  const currentIntegration = await getIntegration(id, userId)

  if (!currentIntegration) {
    throw new Error('Integration not found')
  }

  // Prepare update data
  const updateData: Record<string, any> = {}
  const now = new Date()

  // Update config if provided
  if (updates.config) {
    // Make sure we don't store capabilities in the config object
    const configUpdate = { ...updates.config }
    if (configUpdate.capabilities) {
      delete configUpdate.capabilities
    }
    updateData.config = JSON.stringify(configUpdate)
  }

  // Update capabilities if provided
  if (updates.capabilities) {
    updateData.capabilities = JSON.stringify(updates.capabilities)
  }

  updateData.updatedAt = now

  // Only perform update if there are fields to update
  if (Object.keys(updateData).length === 0) {
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

  return {
    id: updatedIntegration.id,
    integrationId: updatedIntegration.integrationId as IntegrationId,
    capabilities: updatedIntegration.capabilities,
    config: updatedIntegration.config,
  }
}

/**
 * Delete an integration configuration
 */
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

/**
 * Test an integration configuration
 */
export async function testIntegrationConfig(
  integrationId: IntegrationId,
  config: Record<string, any>,
): Promise<TestIntegrationResponse> {
  // For now, we'll simulate a test by just validating that required fields exist
  // In a real implementation, you would make API calls to the service to verify the credentials

  switch (integrationId) {
    case IntegrationId.GOOGLE_MAPS:
      if (!config.apiKey) {
        return { success: false, message: 'API Key is required' }
      }
      // Here you would actually test the Google Maps API key
      break

    case IntegrationId.PELIAS:
      if (!config.host || !config.apiKey) {
        return { success: false, message: 'Host and API Key are required' }
      }
      // Test the Pelias connection
      break

    case IntegrationId.NOMINATIM:
      if (!config.host || !config.email) {
        return { success: false, message: 'Host and email are required' }
      }
      // Test the Nominatim connection
      break

    // Add cases for other integrations

    default:
      // For most integrations, just check if apiKey exists
      if (!config.apiKey) {
        return { success: false, message: 'API Key is required' }
      }
  }

  return { success: true }
}

/**
 * Get an integration definition by ID
 */
export function getIntegrationDefinition(
  integrationId: IntegrationId,
): IntegrationDefinition | undefined {
  return availableIntegrations.find((i) => i.id === integrationId)
}

/**
 * Get all available integration definitions
 */
export function getAvailableIntegrations(): IntegrationDefinition[] {
  return [...availableIntegrations]
}
