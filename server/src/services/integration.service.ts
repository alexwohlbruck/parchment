import { db } from '../db'
import { eq, and, isNull, or } from 'drizzle-orm'
import { generateId } from '../util'
import { integrations, IntegrationRecord } from '../schema/integrations.schema'
import {
  IntegrationCapability,
  IntegrationConfig,
  IntegrationDefinition,
  IntegrationId,
  IntegrationScope,
  IntegrationTestResult,
} from '../types/integration.types'
import { integrationManager } from './integrations'
import { users } from '../schema/users.schema'

// Available integration definitions
const availableIntegrations: IntegrationDefinition[] = [
  {
    id: IntegrationId.MAPBOX,
    name: 'Mapbox',
    description: 'Interactive maps, geocoding, and navigation',
    color: '#4264FB',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(IntegrationId.MAPBOX)
    },
    paid: true,
    cloud: true,
    configSchema: 'mapboxSchema',
    public: true,
    scope: [IntegrationScope.SYSTEM],
  },
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
    scope: [IntegrationScope.SYSTEM],
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
    scope: [IntegrationScope.SYSTEM],
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
    scope: [IntegrationScope.SYSTEM],
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
    scope: [IntegrationScope.SYSTEM],
  },
  // {
  //   id: IntegrationId.GRAPHHOPPER,
  //   name: 'GraphHopper',
  //   description: 'Fast and efficient routing engine',
  //   color: '#2E7D32',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(
  //       IntegrationId.GRAPHHOPPER,
  //     )
  //   },
  //   paid: false,
  //   cloud: false,
  //   configSchema: 'apiKeySchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
  // {
  //   id: IntegrationId.YELP,
  //   name: 'Yelp',
  //   description: 'Local business reviews and ratings',
  //   color: '#D32323',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(IntegrationId.YELP)
  //   },
  //   paid: true,
  //   cloud: true,
  //   configSchema: 'oauthConfigSchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
  // {
  //   id: IntegrationId.OPENTABLE,
  //   name: 'OpenTable',
  //   description: 'Restaurant discovery and reservations',
  //   color: '#222222',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(
  //       IntegrationId.OPENTABLE,
  //     )
  //   },
  //   paid: true,
  //   cloud: true,
  //   configSchema: 'apiKeySchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
  // {
  //   id: IntegrationId.FOURSQUARE,
  //   name: 'Foursquare',
  //   description: 'Location-based social network',
  //   color: '#F94877',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(
  //       IntegrationId.FOURSQUARE,
  //     )
  //   },
  //   paid: true,
  //   cloud: true,
  //   configSchema: 'oauthConfigSchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
  // {
  //   id: IntegrationId.MAPILLARY,
  //   name: 'Mapillary',
  //   description: 'Street-level imagery platform',
  //   color: '#2B2B2B',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(
  //       IntegrationId.MAPILLARY,
  //     )
  //   },
  //   paid: false,
  //   cloud: true,
  //   configSchema: 'apiKeySchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
  // {
  //   id: IntegrationId.TRIPADVISOR,
  //   name: 'TripAdvisor',
  //   description: 'Travel reviews and recommendations',
  //   color: '#34E0A1',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(
  //       IntegrationId.TRIPADVISOR,
  //     )
  //   },
  //   paid: true,
  //   cloud: true,
  //   configSchema: 'apiKeySchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
  // {
  //   id: IntegrationId.GEOAPIFY,
  //   name: 'Geoapify',
  //   description: 'Geocoding, routing, and place data',
  //   color: '#FF5A5F',
  //   get capabilities() {
  //     return integrationManager.getIntegrationCapabilities(
  //       IntegrationId.GEOAPIFY,
  //     )
  //   },
  //   paid: true,
  //   cloud: true,
  //   configSchema: 'apiKeySchema',
  //   scope: [IntegrationScope.SYSTEM],
  // },
]

export async function initializeIntegrations() {
  await getConfiguredIntegrations()

  const allUsers = await db.select().from(users)
  const promises: { userId: string; integrations: IntegrationRecord[] }[] = []

  for (const user of allUsers) {
    promises.push({
      userId: user.id,
      integrations: await getConfiguredIntegrations(user.id),
    })
  }

  const results = await Promise.all(promises)

  for (const result of results) {
    await Promise.all(
      result.integrations.map((integration) =>
        integrationManager.initializeIntegration(result.userId, integration),
      ),
    )
  }
}

// Helper functions
export function parseIntegrationData(
  record: IntegrationRecord,
): IntegrationRecord {
  let config: Record<string, any>

  try {
    config = JSON.parse(record.config)
  } catch (error) {
    console.error('Failed to parse integration config:', error)
    config = {}
  }

  const cleanedConfig = cleanConfig(config)

  let capabilities: IntegrationCapability[]
  try {
    capabilities = JSON.parse(record.capabilities)
  } catch (error) {
    console.error('Failed to parse integration capabilities:', error)
    capabilities = []
  }

  return {
    id: record.id,
    integrationId: record.integrationId as IntegrationId,
    capabilities,
    config: cleanedConfig,
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
  userId?: string,
): Promise<IntegrationRecord[]> {
  // TODO: When initializing system integrations, we need to check for any capabilities that have been added or removed during development. If an existing integration gains a capability in an update, it will not reflect in the db, we need to run migration.

  let userIntegrations

  if (!userId) {
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

  return userIntegrations.map(parseIntegrationData)
}

export async function getAvailableIntegrations(): Promise<
  IntegrationDefinition[]
> {
  return availableIntegrations
}

export async function getPublicIntegrations(): Promise<any[]> {
  // Get system-wide integrations only (public integrations are typically system-wide)
  const systemIntegrations = await getConfiguredIntegrations()

  // Filter to only include public integrations
  const publicIntegrations = systemIntegrations.filter((integration) => {
    const definition = availableIntegrations.find(
      (def) => def.id === integration.integrationId,
    )
    return definition?.public === true
  })

  // Return integrations with their config exposed (since they're public)
  return publicIntegrations.map((integration) => ({
    id: integration.id,
    integrationId: integration.integrationId,
    config: integration.config,
    capabilities: integration.capabilities, // Include capabilities for client-side filtering
  }))
}

export async function getIntegration(
  id: string,
  userId?: string,
): Promise<IntegrationRecord | null> {
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

  return parseIntegrationData(result[0])
}

export async function createIntegration(
  userId: string | undefined,
  integrationId: IntegrationId,
  config: Record<string, any>,
  customCapabilities?: IntegrationCapability[],
): Promise<IntegrationRecord> {
  const integrationDef = availableIntegrations.find(
    (integration) => integration.id === integrationId,
  )

  if (!integrationDef) {
    throw new Error(`Integration with ID ${integrationId} not found`)
  }

  const testResult = await integrationManager.testIntegration(
    integrationId,
    config as IntegrationConfig,
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

  if (userId) {
    values.userId = userId
  }

  const result = await db.insert(integrations).values(values).returning()

  const newIntegration = parseIntegrationData(result[0])

  await integrationManager.initializeIntegration(userId, newIntegration)

  return newIntegration
}

export async function updateIntegration(
  id: string,
  userId: string | undefined,
  updates: {
    config?: Record<string, any>
    capabilities?: IntegrationCapability[]
  },
): Promise<IntegrationRecord> {
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
  if (userId) {
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

  await integrationManager.initializeIntegration(userId, updatedIntegration)

  return updatedIntegration
}

export async function deleteIntegration(
  id: string,
  userId?: string,
): Promise<void> {
  // Build the where condition based on userId
  let whereCondition
  if (userId) {
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
): Promise<IntegrationTestResult> {
  return integrationManager.testIntegration(integrationId, config)
}

export function getIntegrationDefinition(
  integrationId: IntegrationId,
): IntegrationDefinition | undefined {
  return availableIntegrations.find((i) => i.id === integrationId)
}
