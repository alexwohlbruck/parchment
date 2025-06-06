import {
  IntegrationDefinition,
  IntegrationConfig,
  IntegrationTestResult,
  CachedIntegration,
  IntegrationCapabilityId,
  IntegrationId,
  IntegrationCapability,
  IntegrationResponse,
  Integration,
} from '../../types/integration.types'
import { IntegrationRegistry } from './integration-registry'
import { Source, SOURCE, SOURCE_PRIORITIES } from '../../lib/constants'
import { initializeWithTest } from '../../lib/integration.utils'

/**
 * Service for managing integrations and their configurations
 */
export class IntegrationManagerService {
  private registry: IntegrationRegistry
  private integrationsCache: Map<string, CachedIntegration> = new Map()
  private userIntegrationsCache: Map<string, string[]> = new Map()
  private systemIntegrationsCache: string[] = []

  constructor() {
    this.registry = new IntegrationRegistry()
  }

  /**
   * Tests an integration configuration
   * @param integrationId The integration ID
   * @param config The configuration to test
   * @returns The test result
   */
  async testIntegration(
    integrationId: IntegrationId,
    config: IntegrationConfig,
  ): Promise<IntegrationTestResult> {
    const integration = this.registry.getIntegration(integrationId)

    if (!integration) {
      return {
        success: false,
        message: `Integration with ID ${integrationId} not found`,
      }
    }

    return integration.testConnection(config)
  }

  /**
   * Initializes and caches an integration
   * @param userId The user ID, or undefined for system-wide integrations
   * @param integrationData The integration to initialize
   */
  async initializeIntegration(
    userId: string | undefined,
    integrationData: IntegrationResponse,
  ): Promise<void> {
    const integrationImpl = this.registry.getIntegration(
      integrationData.integrationId,
    )

    if (!integrationImpl) {
      return
    }

    // Clone the integration to ensure each integration has its own instance
    const integrationInstance = this.cloneIntegration(integrationImpl)

    // Initialize the integration with connection testing
    await initializeWithTest(integrationInstance, integrationData.config)

    // Cache the integration
    const cacheKey = userId
      ? `${userId}:${integrationData.id}`
      : `system:${integrationData.id}`
    this.integrationsCache.set(cacheKey, {
      userId: userId ?? null,
      id: integrationData.id,
      integrationId: integrationData.integrationId,
      integration: integrationInstance,
      capabilities: integrationData.capabilities,
      config: integrationData.config,
    })

    // Update the appropriate integrations cache
    if (userId) {
      // Update user's integrations cache
      const userIntegrations = this.userIntegrationsCache.get(userId) || []
      if (!userIntegrations.includes(cacheKey)) {
        userIntegrations.push(cacheKey)
        this.userIntegrationsCache.set(userId, userIntegrations)
      }
    } else {
      // Update system integrations cache
      if (!this.systemIntegrationsCache.includes(cacheKey)) {
        this.systemIntegrationsCache.push(cacheKey)
      }
    }
  }

  /**
   * Gets a cached integration by its ID
   * @param userId The user ID, or undefined for system-wide integrations
   * @param integrationId The integration ID
   * @returns The cached integration, or undefined if not found
   */
  getIntegration(
    userId: string | undefined,
    integrationId: string,
  ): CachedIntegration | undefined {
    const cacheKey = userId
      ? `${userId}:${integrationId}`
      : `system:${integrationId}`
    const userSpecificIntegration = this.integrationsCache.get(cacheKey)

    if (userSpecificIntegration || !userId) {
      return userSpecificIntegration
    }

    // If we didn't find a user-specific integration and userId is provided,
    // also check for a system-wide integration
    const systemCacheKey = `system:${integrationId}`
    return this.integrationsCache.get(systemCacheKey)
  }

  /**
   * Gets a configured integration that supports a specific data source and capability
   * @param sourceId The source ID (e.g., SOURCE.GOOGLE, SOURCE.OSM)
   * @param capabilityId The capability ID that the integration must support
   * @returns The best matching cached integration, or undefined if not found
   */
  getConfiguredIntegrationForSource(
    sourceId: Source,
    capabilityId: IntegrationCapabilityId,
  ): CachedIntegration | undefined {
    const integrations =
      this.getConfiguredIntegrationsByCapability(capabilityId)

    const compatibleIntegrations = integrations.filter((integration) =>
      integration.integration.sources?.includes(sourceId),
    )

    // Return the first compatible integration
    return compatibleIntegrations.length ? compatibleIntegrations[0] : undefined
  }

  /**
   * Gets configured integrations, optionally for a specific user
   * @param userId The user ID, or undefined to get only system-wide integrations
   * @returns Array of cached integrations (system-wide only if userId is undefined, both user-specific and system-wide if userId provided)
   */
  getConfiguredIntegrations(userId?: string): CachedIntegration[] {
    if (!userId) {
      // Return only system-wide integrations
      return this.systemIntegrationsCache
        .map((cacheKey) => this.integrationsCache.get(cacheKey))
        .filter(
          (integration) => integration !== undefined,
        ) as CachedIntegration[]
    }

    // Get user-specific integrations
    const userIntegrations = this.userIntegrationsCache.get(userId) || []
    const userSpecificIntegrations = userIntegrations
      .map((cacheKey) => this.integrationsCache.get(cacheKey))
      .filter((integration) => integration !== undefined) as CachedIntegration[]

    // Get system-wide integrations
    const systemIntegrations = this.systemIntegrationsCache
      .map((cacheKey) => this.integrationsCache.get(cacheKey))
      .filter((integration) => integration !== undefined) as CachedIntegration[]

    // Return both user-specific and system-wide integrations
    return [...userSpecificIntegrations, ...systemIntegrations]
  }

  /**
   * Removes an integration from the cache
   * @param userId The user ID, or undefined for system-wide integrations
   * @param integrationId The integration ID
   */
  removeIntegration(userId: string | undefined, integrationId: string): void {
    const cacheKey = userId
      ? `${userId}:${integrationId}`
      : `system:${integrationId}`
    this.integrationsCache.delete(cacheKey)

    if (userId) {
      // Update the user's integrations cache
      const userIntegrations = this.userIntegrationsCache.get(userId) || []
      const updatedIntegrations = userIntegrations.filter(
        (key) => key !== cacheKey,
      )
      this.userIntegrationsCache.set(userId, updatedIntegrations)
    } else {
      // Update the system integrations cache
      this.systemIntegrationsCache = this.systemIntegrationsCache.filter(
        (key) => key !== cacheKey,
      )
    }
  }

  /**
   * Clears all cached integrations for a user
   * @param userId The user ID, or undefined to clear system-wide integrations
   */
  clearUserIntegrations(userId?: string): void {
    if (userId) {
      const userIntegrations = this.userIntegrationsCache.get(userId) || []
      for (const cacheKey of userIntegrations) {
        this.integrationsCache.delete(cacheKey)
      }
      this.userIntegrationsCache.delete(userId)
    } else {
      for (const cacheKey of this.systemIntegrationsCache) {
        this.integrationsCache.delete(cacheKey)
      }
      this.systemIntegrationsCache = []
    }
  }

  /**
   * Returns the integration registry
   * @returns The integration registry
   */
  getIntegrationRegistry(): IntegrationRegistry {
    return this.registry
  }

  /**
   * Get all configured integrations with a specific capability, regardless of user
   *
   * @param capabilityId The capability to filter by
   * @returns Array of cached integrations with the specified capability
   */
  getConfiguredIntegrationsByCapability(
    capabilityId: IntegrationCapabilityId,
  ): CachedIntegration[] {
    const result: CachedIntegration[] = []

    for (const [cacheKey, cachedIntegration] of this.integrationsCache) {
      const hasCapability = cachedIntegration.capabilities.some(
        (cap) => cap.id === capabilityId && cap.active,
      )

      if (hasCapability) {
        result.push(cachedIntegration)
      }
    }

    return result
  }

  /**
   * Gets the capabilities supported by an integration
   * @param integrationId The integration ID
   * @returns Array of capability IDs supported by the integration
   */
  getIntegrationCapabilities(
    integrationId: IntegrationId,
  ): IntegrationCapabilityId[] {
    const integration = this.registry.getIntegration(integrationId)
    if (!integration) {
      console.warn(`Integration with ID ${integrationId} not found`)
      return []
    }
    return integration.capabilityIds
  }

  private cloneIntegration(integration: Integration): Integration {
    // Create a new instance using the constructor
    const IntegrationClass = integration.constructor as new () => Integration
    const clonedIntegration = new IntegrationClass()

    // Don't initialize here - let the caller handle initialization with the correct config
    return clonedIntegration
  }
}
