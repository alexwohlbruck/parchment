import { db } from '../db'
import { eq, and, isNull, or } from 'drizzle-orm'
import { generateId } from '../util'
import {
  integrations,
  IntegrationRecord,
  IntegrationRow,
  IntegrationScheme,
} from '../schema/integrations.schema'
import { encryptedUserBlobs } from '../schema/personal-blobs.schema'
import {
  IntegrationCapability,
  IntegrationDefinition,
  IntegrationId,
  IntegrationScope,
  IntegrationTestResult,
} from '../types/integration.types'
import { integrationManager } from './integrations'
import { users } from '../schema/users.schema'
import {
  encryptIntegrationConfig,
  decryptIntegrationConfig,
} from '../lib/integration-encryption'
import { logger } from '../lib/logger'
import { getPersonalBlobsByTypePrefix } from './personal-blob.service'

// Personal-blob type namespace for user-e2ee integration configs.
// Shape: 'integration-config:<integrationId>' — e.g. 'integration-config:dawarich'.
export const INTEGRATION_CONFIG_BLOB_PREFIX = 'integration-config:'
export const integrationConfigBlobType = (integrationId: string) =>
  `${INTEGRATION_CONFIG_BLOB_PREFIX}${integrationId}`

/**
 * Thrown when a create would violate the (userId, integrationId, scheme)
 * uniqueness constraint. The controller maps this to HTTP 409.
 */
export class IntegrationSchemeConflictError extends Error {
  readonly integrationId: string
  readonly scheme: IntegrationScheme
  constructor(integrationId: string, scheme: IntegrationScheme) {
    super(
      `Integration ${integrationId} is already configured with scheme ${scheme}`,
    )
    this.name = 'IntegrationSchemeConflictError'
    this.integrationId = integrationId
    this.scheme = scheme
  }
}

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
    publicFields: ['accessToken'],
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
  // TODO: Add dynamic API and access key management to Barrelman,
  // with a UI to create, rotate, and revoke keys.
  {
    id: IntegrationId.BARRELMAN,
    name: 'Barrelman',
    description: 'OSM geospatial engine — search, tiles, spatial queries, routing',
    color: '#1A73A7',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.BARRELMAN,
      )
    },
    paid: false,
    cloud: false,
    configSchema: 'barrelmanSchema',
    publicFields: ['host', 'tileKey'],
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
  {
    id: IntegrationId.VALHALLA,
    name: 'Valhalla',
    description: 'Open-source routing engine for multimodal navigation',
    color: '#1976D2',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.VALHALLA,
      )
    },
    paid: false,
    cloud: false,
    configSchema: 'valhallaSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.GRAPHHOPPER,
    name: 'GraphHopper',
    description: 'Fast and efficient routing engine with custom models',
    color: '#F7941E',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.GRAPHHOPPER,
      )
    },
    paid: false, // Can be self-hosted (free) or use API (paid)
    cloud: false, // Supports both self-hosted and cloud
    configSchema: 'graphhopperSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.MAPILLARY,
    name: 'Mapillary',
    description: 'Street-level imagery platform',
    color: '#05CB63',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.MAPILLARY,
      )
    },
    paid: false,
    cloud: true,
    configSchema: 'mapillarySchema',
    publicFields: ['accessToken'],
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.TRANSITLAND,
    name: 'Transitland',
    description: 'Transit routes tiles and APIs',
    color: '#0EA5E9',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.TRANSITLAND,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'transitlandSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.GEOAPIFY,
    name: 'Geoapify',
    description: 'Places and location services',
    color: '#FF6B35',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.GEOAPIFY,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'geoapifySchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.WIKIDATA,
    name: 'Wikidata',
    description: 'Structured knowledge base for enriching place information',
    color: '#339966',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.WIKIDATA,
      )
    },
    paid: false,
    cloud: true,
    configSchema: 'wikidataSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.WIKIPEDIA,
    name: 'Wikipedia',
    description: 'Free encyclopedia content and place descriptions',
    color: '#888',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.WIKIPEDIA,
      )
    },
    paid: false,
    cloud: true,
    configSchema: 'wikipediaSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.WIKIMEDIA,
    name: 'Wikimedia Commons',
    description: 'Free media repository for place images',
    color: '#006699',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.WIKIMEDIA,
      )
    },
    paid: false,
    cloud: true,
    configSchema: 'wikimediaSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.OPENWEATHERMAP,
    name: 'OpenWeatherMap',
    description: 'Weather data and air quality information',
    color: '#EB6E4B',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.OPENWEATHERMAP,
      )
    },
    paid: true,
    cloud: true,
    configSchema: 'apiKeySchema',
    publicFields: ['apiKey'],
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.AXIOM,
    name: 'Axiom',
    description:
      'Send server logs and traces to Axiom for debugging and monitoring. Optional; leave unset for logs to stdout only.',
    color: '#888',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(IntegrationId.AXIOM)
    },
    paid: false,
    cloud: true,
    configSchema: 'axiomSchema',
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.OPENSTREETMAP,
    name: 'OpenStreetMap',
    description:
      'Configure OSM OAuth application credentials for user authentication',
    color: '#7EBC6F',
    capabilities: [],
    paid: false,
    cloud: true,
    configSchema: 'openstreetmapSystemSchema',
    resolvePublicConfig: (config) => {
      const server = config.server || 'production'
      const OSM_SERVERS: Record<string, string> = {
        production: 'https://www.openstreetmap.org',
        sandbox: 'https://master.apis.dev.openstreetmap.org',
      }
      let serverUrl: string
      if (server === 'custom' && config.customServerUrl) {
        serverUrl = config.customServerUrl.replace(/\/+$/, '')
      } else {
        serverUrl = OSM_SERVERS[server] || OSM_SERVERS.production
      }
      return { serverUrl }
    },
    scope: [IntegrationScope.SYSTEM],
  },
  {
    id: IntegrationId.OPENSTREETMAP_ACCOUNT,
    name: 'OpenStreetMap Account',
    description:
      'Connect your OSM account to add notes, comments, and make quick edits',
    color: '#7EBC6F',
    get capabilities() {
      return integrationManager.getIntegrationCapabilities(
        IntegrationId.OPENSTREETMAP_ACCOUNT,
      )
    },
    paid: false,
    cloud: true,
    configSchema: 'openstreetmapOAuthSchema',
    publicFields: [
      'osmDisplayName',
      'osmProfileImageUrl',
      'osmAccountCreated',
      'osmChangesetCount',
      'osmTraceCount',
    ],
    authType: 'oauth2',
    scope: [IntegrationScope.USER],
    requiresSystemIntegration: IntegrationId.OPENSTREETMAP,
  },
]

export async function initializeIntegrations() {
  console.log('Initializing integrations on server startup...')

  try {
    // Get system-wide integrations first (where userId is null)
    const systemIntegrations = await getConfiguredIntegrations()
    console.log(`Found ${systemIntegrations.length} system integrations`)
    console.log(
      'System integrations:',
      systemIntegrations.map((i) => i.integrationId),
    )

    // Initialize system integrations in parallel
    const systemResults = await Promise.allSettled(
      systemIntegrations.map((integration) => {
        console.log(
          `Initializing system integration: ${integration.integrationId}`,
        )
        return integrationManager.initializeIntegration(undefined, integration)
      }),
    )
    for (let i = 0; i < systemResults.length; i++) {
      const result = systemResults[i]
      if (result.status === 'rejected') {
        console.error(
          `Failed to initialize system integration ${systemIntegrations[i].integrationId}:`,
          result.reason,
        )
      }
    }

    // Get all users
    const allUsers = await db.select().from(users)
    console.log(`Found ${allUsers.length} users`)

    // Initialize user-specific integrations in parallel
    const userResults = await Promise.allSettled(
      allUsers.map(async (user) => {
        const userIntegrations = await getConfiguredIntegrations(user.id)
        // user-e2ee configs aren't visible server-side; there's no adapter
        // to initialize. They hydrate in the client store on sign-in.
        const serverKeyIntegrations = userIntegrations.filter(
          (i) => i.scheme === 'server-key',
        )
        console.log(
          `Found ${serverKeyIntegrations.length} server-key integrations for user ${user.id}` +
            (userIntegrations.length !== serverKeyIntegrations.length
              ? ` (+${userIntegrations.length - serverKeyIntegrations.length} user-e2ee skipped)`
              : ''),
        )

        const results = await Promise.allSettled(
          serverKeyIntegrations.map((integration) => {
            console.log(
              `Initializing user integration: ${integration.integrationId} for user ${user.id}`,
            )
            return integrationManager.initializeIntegration(
              user.id,
              integration,
            )
          }),
        )
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          if (result.status === 'rejected') {
            console.error(
              `Failed to initialize integration ${serverKeyIntegrations[i].integrationId} for user ${user.id}:`,
              result.reason,
            )
          }
        }
      }),
    )
    for (let i = 0; i < userResults.length; i++) {
      const result = userResults[i]
      if (result.status === 'rejected') {
        console.error(
          `Failed to get integrations for user ${allUsers[i].id}:`,
          result.reason,
        )
      }
    }

    console.log('Integration initialization completed')
  } catch (error) {
    console.error('Failed to initialize integrations:', error)
    throw error
  }
}

// Helper functions

// Track integration-ids we've already warned about this process so startup
// logs don't repeat the same "unreadable row" error per row.
const unreadableRowsWarned = new Set<string>()

function warnUnreadableIntegration(row: IntegrationRow): void {
  const key = row.id
  if (unreadableRowsWarned.has(key)) return
  unreadableRowsWarned.add(key)
  logger.warn(
    {
      integrationId: row.integrationId,
      id: row.id,
      keyVersion: row.configKeyVersion,
    },
    'Integration config is unreadable — encrypted under a key the server ' +
      'no longer has. Usually means PARCHMENT_INTEGRATION_ENCRYPTION_KEY ' +
      'changed or was ephemeral. Delete the row (DELETE FROM integrations ' +
      'WHERE id = …) and reconfigure through the UI.',
  )
}

/**
 * Decrypt a raw DB row's config ciphertext + parse capabilities into an
 * in-memory `IntegrationRecord` with cleartext config.
 *
 * The DB column stores ciphertext only; this function is the single read-
 * path choke point. The returned `config` must NEVER be persisted or
 * logged — it holds third-party credentials.
 *
 * Returns null if the row cannot be decrypted (e.g., the encryption key
 * changed). Callers that just wrote the row (create/update) should treat
 * null as an invariant violation; read-path callers filter nulls out.
 */
export function parseIntegrationData(
  row: IntegrationRow,
): IntegrationRecord | null {
  // For user-e2ee rows the server never sees cleartext. The config lives in
  // encrypted_user_blobs and is decrypted client-side. We return `config: {}`
  // here; the controller attaches `encryptedConfig` for the client.
  let cleanedConfig: Record<string, any>
  if (row.scheme === 'user-e2ee') {
    cleanedConfig = {}
  } else {
    let config: Record<string, any>
    try {
      config = decryptIntegrationConfig({
        ciphertext: row.configCiphertext!,
        nonce: row.configNonce!,
        keyVersion: row.configKeyVersion,
      }) as Record<string, any>
    } catch {
      warnUnreadableIntegration(row)
      return null
    }
    cleanedConfig = cleanConfig(config)
  }

  let capabilities: IntegrationCapability[]
  try {
    capabilities = JSON.parse(row.capabilities as any)
  } catch (error) {
    logger.error(
      { integrationId: row.integrationId, id: row.id, err: error },
      'Failed to parse integration capabilities',
    )
    capabilities = []
  }

  return {
    id: row.id,
    userId: row.userId,
    integrationId: row.integrationId as IntegrationId,
    scheme: row.scheme,
    capabilities,
    config: cleanedConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

  // Filter out unreadable rows (e.g. encryption key changed) so callers
  // never see half-initialized records. The dropped rows are already
  // logged by parseIntegrationData via warnUnreadableIntegration.
  const records = userIntegrations
    .map(parseIntegrationData)
    .filter((r): r is IntegrationRecord => r !== null)

  // For user-e2ee rows, attach the encrypted blob in one batched fetch so the
  // client can decrypt it locally. Only runs when the caller is authenticated
  // (system-scope fetches don't have a user to look up blobs for).
  if (userId && records.some((r) => r.scheme === 'user-e2ee')) {
    const blobs = await getPersonalBlobsByTypePrefix(
      userId,
      INTEGRATION_CONFIG_BLOB_PREFIX,
    )
    const byType = new Map(blobs.map((b) => [b.blobType, b.encryptedBlob]))
    for (const rec of records) {
      if (rec.scheme !== 'user-e2ee') continue
      const blobType = integrationConfigBlobType(rec.integrationId)
      const ciphertext = byType.get(blobType)
      if (ciphertext) rec.encryptedConfig = ciphertext
    }
  }

  return records
}

export async function getAvailableIntegrations(): Promise<
  IntegrationDefinition[]
> {
  return availableIntegrations
}

/**
 * Extract only the public fields from an integration's config,
 * based on the `publicFields` list in its definition.
 * If the definition provides a `resolvePublicConfig` callback,
 * it takes precedence over the raw field list.
 * Returns an empty object when the definition has no public fields.
 */
export function extractPublicConfig(
  config: Record<string, any>,
  definition: IntegrationDefinition | undefined,
): Record<string, any> {
  if (!definition) return {}

  // Use custom resolver if provided
  if (definition.resolvePublicConfig) {
    return definition.resolvePublicConfig(config)
  }

  if (!definition.publicFields?.length) return {}
  const result: Record<string, any> = {}
  for (const key of definition.publicFields) {
    if (key in config) {
      result[key] = config[key]
    }
  }
  return result
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
  scheme: IntegrationScheme = 'server-key',
): Promise<IntegrationRecord> {
  const integrationDef = availableIntegrations.find(
    (integration) => integration.id === integrationId,
  )

  if (!integrationDef) {
    throw new Error(`Integration with ID ${integrationId} not found`)
  }

  const supportedSchemes: IntegrationScheme[] =
    integrationDef.supportedSchemes ?? ['server-key']
  if (!supportedSchemes.includes(scheme)) {
    throw new Error(
      `Integration ${integrationId} does not support scheme ${scheme}`,
    )
  }

  if (scheme === 'user-e2ee') {
    if (!userId) {
      throw new Error(
        'Scheme user-e2ee requires a user — system-scope integrations must use server-key',
      )
    }
    if (config && Object.keys(config).length > 0) {
      // Server never sees e2ee config. The client posts the metadata row, then
      // uploads the encrypted blob via PUT /me/blobs/integration-config:<id>.
      throw new Error(
        'Scheme user-e2ee must be created with no config — post the encrypted blob separately',
      )
    }
  }

  // Only server-key creates run through the connection-test path. E2EE configs
  // aren't visible server-side; the client handles validation before saving.
  if (scheme === 'server-key') {
    const testResult = await integrationManager.testIntegration(
      integrationId,
      config,
    )
    if (!testResult.success) {
      throw new Error(
        testResult.message || `Failed to test integration: ${integrationId}`,
      )
    }
  }

  const capabilities =
    customCapabilities ||
    integrationDef.capabilities.map((id) => ({
      id,
      active: true,
    }))

  const values: any = {
    id: generateId(),
    integrationId,
    scheme,
    capabilities: JSON.stringify(capabilities),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  if (scheme === 'server-key') {
    const cleanedConfig = cleanConfig(config)
    const encrypted = encryptIntegrationConfig(cleanedConfig)
    values.configCiphertext = encrypted.ciphertext
    values.configNonce = encrypted.nonce
    values.configKeyVersion = encrypted.keyVersion
  }
  // user-e2ee: configCiphertext/configNonce stay NULL; configKeyVersion keeps
  // its column default (1) and is meaningless for this scheme.

  if (userId) {
    values.userId = userId
  }

  let result
  try {
    result = await db.insert(integrations).values(values).returning()
  } catch (err: any) {
    // Postgres unique_violation = 23505. Postgres.js surfaces it on .code;
    // drizzle may wrap via .cause depending on the driver. Check both.
    const code = err?.code ?? err?.cause?.code
    if (code === '23505') {
      throw new IntegrationSchemeConflictError(integrationId, scheme)
    }
    throw err
  }

  const newIntegration = parseIntegrationData(result[0])
  if (!newIntegration) {
    // We just wrote this row — if decrypt fails, the KMS key is gone mid-flight.
    throw new Error(
      'Integration written but could not be decrypted — check that PARCHMENT_INTEGRATION_ENCRYPTION_KEY is stable',
    )
  }

  // Only server-key rows feed the adapter cache; e2ee configs aren't visible
  // server-side and have no adapter to initialize.
  if (scheme === 'server-key') {
    await integrationManager.initializeIntegration(userId, newIntegration)
  }

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
    if (currentIntegration.scheme === 'user-e2ee') {
      // E2EE configs are re-encrypted on the client and uploaded via
      // PUT /me/blobs/integration-config:<id>. The integrations row holds
      // only metadata; config updates through this endpoint would fan out
      // into two writes the server can't keep consistent.
      throw new Error(
        'Scheme user-e2ee configs must be updated via PUT /me/blobs',
      )
    }

    const testResult = await integrationManager.testIntegration(
      currentIntegration.integrationId,
      updates.config,
    )

    if (!testResult.success) {
      throw new Error(
        testResult.message || 'Failed to test updated configuration',
      )
    }

    const encrypted = encryptIntegrationConfig(cleanConfig(updates.config))
    updateData.configCiphertext = encrypted.ciphertext
    updateData.configNonce = encrypted.nonce
    updateData.configKeyVersion = encrypted.keyVersion
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

  if (updatedIntegration.scheme === 'server-key') {
    await integrationManager.initializeIntegration(userId, updatedIntegration)
  }

  return updatedIntegration
}

/**
 * Find all configured integrations that depend on the given integration ID
 * via `requiresSystemIntegration`. Returns records across all users.
 */
export async function getDependentIntegrations(
  integrationId: IntegrationId,
): Promise<IntegrationRecord[]> {
  // Find definitions that depend on this integration
  const dependentDefinitions = availableIntegrations.filter(
    (def) => def.requiresSystemIntegration === integrationId,
  )
  if (dependentDefinitions.length === 0) return []

  const dependentIds = dependentDefinitions.map((def) => def.id)

  // Find all configured instances of those dependent definitions
  const allIntegrations = await db.select().from(integrations)
  return allIntegrations
    .filter((record) =>
      dependentIds.includes(record.integrationId as IntegrationId),
    )
    .map(parseIntegrationData)
    .filter((r): r is IntegrationRecord => r !== null)
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

  const row = result[0]
  // `record` may be null if the row can't be decrypted — that's fine, we're
  // about to delete it. Fall back to the raw integrationId from the row.
  const record = parseIntegrationData(row)
  const integrationIdForCascade = (record?.integrationId ??
    row.integrationId) as IntegrationId

  // Cascade-delete dependent integrations (e.g. user OSM accounts when
  // the system OSM integration is removed)
  const dependents = await getDependentIntegrations(integrationIdForCascade)
  for (const dep of dependents) {
    await db.delete(integrations).where(eq(integrations.id, dep.id))
    integrationManager.removeIntegration(dep.userId ?? undefined, dep.id)
  }

  if (row.scheme === 'user-e2ee' && row.userId) {
    // Atomically clear both the metadata row and the personal-blob ciphertext.
    // A partial delete would leave an orphan blob only the client could GC.
    const blobType = integrationConfigBlobType(row.integrationId)
    await db.transaction(async (tx) => {
      await tx.delete(integrations).where(whereCondition!)
      await tx
        .delete(encryptedUserBlobs)
        .where(
          and(
            eq(encryptedUserBlobs.userId, row.userId!),
            eq(encryptedUserBlobs.blobType, blobType),
          ),
        )
    })
  } else {
    await db.delete(integrations).where(whereCondition)
  }

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
