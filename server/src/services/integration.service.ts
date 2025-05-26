import { db } from '../db'
import { eq, and, isNull, or } from 'drizzle-orm'
import { generateId } from '../util'
import { integrations, IntegrationRecord } from '../schema/integrations.schema'
import {
  IntegrationCapability,
  IntegrationCapabilityId,
  IntegrationDefinition,
  IntegrationId,
  IntegrationResponse,
  TestIntegrationResponse,
} from '../types/integration.types'
import { integrationManager } from './integrations'
import { users } from '../schema/users.schema'

// Available integration definitions
const availableIntegrations: IntegrationDefinition[] = [
  {
    id: IntegrationId.GOOGLE_MAPS,
    name: 'Google Maps',
    description: 'Comprehensive mapping and location services',
    color: '#4285F4',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.GOOGLE_MAPS,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'googleMapsSchema',
  },
  {
    id: IntegrationId.PELIAS,
    name: 'Pelias',
    description: 'Open-source geocoding and search',
    color: '#7EBC6F',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(IntegrationId.PELIAS)
    },
    paid: false,
    cloud: false,
    configSchema: 'peliasSchema',
  },
  {
    id: IntegrationId.OVERPASS,
    name: 'Overpass API',
    description: 'OpenStreetMap data filtering and retrieval',
    color: '#7EBC6F',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.OVERPASS,
      )
    },
    paid: false,
    cloud: false,
    configSchema: 'overpassSchema',
  },
  {
    id: IntegrationId.GRAPHHOPPER,
    name: 'GraphHopper',
    description: 'Fast and efficient routing engine',
    color: '#2E7D32',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.GRAPHHOPPER,
      )
    },
    paid: false,
    cloud: false,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.YELP,
    name: 'Yelp',
    description: 'Local business reviews and ratings',
    color: '#D32323',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(IntegrationId.YELP)
    },
    paid: true,
    cloud: true,
    configSchema: 'oauthConfigSchema',
  },
  {
    id: IntegrationId.OPENTABLE,
    name: 'OpenTable',
    description: 'Restaurant discovery and reservations',
    color: '#222222',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.OPENTABLE,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.FOURSQUARE,
    name: 'Foursquare',
    description: 'Location-based social network',
    color: '#F94877',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.FOURSQUARE,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'oauthConfigSchema',
  },
  {
    id: IntegrationId.MAPILLARY,
    name: 'Mapillary',
    description: 'Street-level imagery platform',
    color: '#2B2B2B',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.MAPILLARY,
      )
    },
    paid: false,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.NOMINATIM,
    name: 'Nominatim',
    description: 'Open-source geocoding and reverse geocoding',
    color: '#7EBC6F',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.NOMINATIM,
      )
    },
    paid: false,
    cloud: false,
    configSchema: 'nominatimSchema',
  },
  {
    id: IntegrationId.TRIPADVISOR,
    name: 'TripAdvisor',
    description: 'Travel reviews and recommendations',
    color: '#34E0A1',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.TRIPADVISOR,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
  {
    id: IntegrationId.GEOAPIFY,
    name: 'Geoapify',
    description: 'Geocoding, routing, and place data',
    color: '#FF5A5F',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.GEOAPIFY,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
  },
]

export async function initializeIntegrations() {
  await getConfiguredIntegrations(null)

  const allUsers = await db.select().from(users)

  for (const user of allUsers) {
    await getConfiguredIntegrations(user.id)
  }
}

// Helper functions
function parseIntegrationData(
  integrationRecord: IntegrationRecord,
): IntegrationResponse {
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
  userId: string | null,
): Promise<IntegrationResponse[]> {
  let userIntegrations

  if (userId === null) {
    // Get system-wide integrations (where userId is null)
    userIntegrations = await db
      .select()
      .from(integrations)
      .where(isNull(integrations.userId))
  } else {
    // Get user-specific integrations
    userIntegrations = await db
      .select()
      .from(integrations)
      .where(eq(integrations.userId, userId))
  }

  const parsedIntegrations = userIntegrations.map(parseIntegrationData)

  parsedIntegrations.forEach((integration) => {
    integrationManager.initializeIntegration(userId, integration)
  })

  return parsedIntegrations
}

export async function getAvailableIntegrationsForUser(
  userId: string,
): Promise<IntegrationDefinition[]> {
  // Get both system-wide and user-specific integrations
  const userIntegrations = await db
    .select()
    .from(integrations)
    .where(or(eq(integrations.userId, userId), isNull(integrations.userId)))

  const configuredIds = new Set(userIntegrations.map((i) => i.integrationId))

  return availableIntegrations.filter(
    (integration) => !configuredIds.has(integration.id),
  )
}

export async function getIntegration(
  id: string,
  userId: string | null,
): Promise<IntegrationResponse | null> {
  let result

  if (userId) {
    result = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.userId, userId)))

    if (result.length === 0) {
      // If not found, check for system-wide integration
      result = await db
        .select()
        .from(integrations)
        .where(and(eq(integrations.id, id), isNull(integrations.userId)))
    }
  } else {
    result = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, id), isNull(integrations.userId)))
  }

  if (result.length === 0) {
    return null
  }

  const integration = parseIntegrationData(result[0])

  // Initialize and cache the integration
  integrationManager.initializeIntegration(userId, integration)

  return integration
}

export async function createIntegration(
  userId: string | null,
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

  const testResult = await integrationManager.testIntegration(
    integrationId,
    config,
  )

  if (!testResult.success) {
    throw new Error(
      testResult.message || `Failed to test integration: ${integrationId}`,
    )
  }

  const capabilities =
    customCapabilities ||
    integrationDef.capabilities.map((id) => ({
      id,
      active: true,
    }))

  const cleanedConfig = cleanConfig(config)

  const values: any = {
    id: generateId(),
    integrationId,
    capabilities: JSON.stringify(capabilities),
    config: JSON.stringify(cleanedConfig),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  if (userId !== null) {
    values.userId = userId
  }

  const result = await db.insert(integrations).values(values).returning()

  const newIntegration = parseIntegrationData(result[0])

  integrationManager.initializeIntegration(userId, newIntegration)

  return newIntegration
}

export async function updateIntegration(
  id: string,
  userId: string | null,
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

  if (updates.config) {
    const testResult = await integrationManager.testIntegration(
      currentIntegration.integrationId,
      updates.config,
    )

    if (!testResult.success) {
      throw new Error(
        testResult.message || 'Failed to test updated configuration',
      )
    }

    updateData.config = JSON.stringify(cleanConfig(updates.config))
  }

  if (updates.capabilities) {
    updateData.capabilities = JSON.stringify(updates.capabilities)
  }

  if (Object.keys(updateData).length <= 1) {
    throw new Error('No updates provided')
  }

  let whereCondition
  if (userId !== null) {
    whereCondition = and(
      eq(integrations.id, id),
      eq(integrations.userId, userId),
    )
  } else {
    whereCondition = and(eq(integrations.id, id), isNull(integrations.userId))
  }

  await db.update(integrations).set(updateData).where(whereCondition)

  const updatedIntegration = await getIntegration(id, userId)
  if (!updatedIntegration) {
    throw new Error('Failed to retrieve updated integration')
  }

  integrationManager.initializeIntegration(userId, updatedIntegration)

  return updatedIntegration
}

export async function deleteIntegration(
  id: string,
  userId: string | null,
): Promise<void> {
  // Build the where condition based on userId
  let whereCondition
  if (userId !== null) {
    whereCondition = and(
      eq(integrations.id, id),
      eq(integrations.userId, userId),
    )
  } else {
    whereCondition = and(eq(integrations.id, id), isNull(integrations.userId))
  }

  const result = await db.select().from(integrations).where(whereCondition)

  if (result.length === 0) {
    throw new Error(`Integration with ID ${id} not found`)
  }

  await db.delete(integrations).where(eq(integrations.id, id))

  integrationManager.removeIntegration(userId, id)
}

export async function testIntegrationConfig(
  integrationId: IntegrationId,
  config: Record<string, any>,
): Promise<TestIntegrationResponse> {
  return integrationManager.testIntegration(integrationId, config)
}

export function getIntegrationDefinition(
  integrationId: IntegrationId,
): IntegrationDefinition | undefined {
  return availableIntegrations.find((i) => i.id === integrationId)
}

export function getAvailableIntegrations(): IntegrationDefinition[] {
  return availableIntegrations
}
