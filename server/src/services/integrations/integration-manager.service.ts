import {
  IntegrationId,
  IntegrationCapability,
  IntegrationResponse,
  IntegrationCapabilityId,
} from '../../types/integration.types'
import { IntegrationRegistry } from './integration-registry'
import {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
} from './integration.interface'

type CachedIntegration = {
  userId: string | null
  id: string
  integrationId: IntegrationId
  integration: Integration
  capabilities: IntegrationCapability[]
  config: IntegrationConfig
}

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
   * @param userId The user ID, or null for system-wide integrations
   * @param integrationData The integration to initialize
   */
  initializeIntegration(
    userId: string | null,
    integrationData: IntegrationResponse,
  ): void {
    const integrationImpl = this.registry.getIntegration(
      integrationData.integrationId,
    )

    if (!integrationImpl) {
      console.error(
        `Integration implementation for ${integrationData.integrationId} not found`,
      )
      return
    }

    try {
      // Clone the integration to ensure each integration has its own instance
      const integrationInstance = Object.create(
        Object.getPrototypeOf(integrationImpl),
        Object.getOwnPropertyDescriptors(integrationImpl),
      )

      // Initialize the integration with the user's configuration
      integrationInstance.initialize(integrationData.config)

      // Cache the integration
      const cacheKey = userId
        ? `${userId}:${integrationData.id}`
        : `system:${integrationData.id}`
      this.integrationsCache.set(cacheKey, {
        userId,
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
        console.log(
          `Initialized and cached integration ${integrationData.id} for user ${userId}`,
        )
      } else {
        // Update system integrations cache
        if (!this.systemIntegrationsCache.includes(cacheKey)) {
          this.systemIntegrationsCache.push(cacheKey)
        }
        console.log(
          `Initialized and cached system-wide integration ${integrationData.id}`,
        )
      }
    } catch (error) {
      console.error(
        `Failed to initialize integration ${integrationData.id}:`,
        error,
      )
    }
  }

  /**
   * Gets a cached integration by its ID
   * @param userId The user ID, or null for system-wide integrations
   * @param integrationId The integration ID
   * @returns The cached integration, or undefined if not found
   */
  getIntegration(
    userId: string | null,
    integrationId: string,
  ): CachedIntegration | undefined {
    const cacheKey = userId
      ? `${userId}:${integrationId}`
      : `system:${integrationId}`
    const userSpecificIntegration = this.integrationsCache.get(cacheKey)

    if (userSpecificIntegration || userId === null) {
      return userSpecificIntegration
    }

    // If we didn't find a user-specific integration and userId is provided,
    // also check for a system-wide integration
    const systemCacheKey = `system:${integrationId}`
    return this.integrationsCache.get(systemCacheKey)
  }

  /**
   * Gets all integrations for a user, including system-wide integrations
   * @param userId The user ID, or null to get only system-wide integrations
   * @returns Array of all cached integrations for the user
   */
  getUserIntegrations(userId: string | null): CachedIntegration[] {
    if (userId === null) {
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
   * Gets integrations for a user that support a specific capability
   * @param userId The user ID, or null to get only system-wide integrations
   * @param capabilityId The capability ID
   * @returns Array of cached integrations that support the capability
   */
  getUserIntegrationsByCapability(
    userId: string | null,
    capabilityId: string,
  ): CachedIntegration[] {
    return this.getUserIntegrations(userId).filter((integration) =>
      integration.capabilities.some(
        (cap) => cap.id === capabilityId && cap.active,
      ),
    )
  }

  /**
   * Removes an integration from the cache
   * @param userId The user ID, or null for system-wide integrations
   * @param integrationId The integration ID
   */
  removeIntegration(userId: string | null, integrationId: string): void {
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
      console.log(
        `Removed integration ${integrationId} from cache for user ${userId}`,
      )
    } else {
      // Update the system integrations cache
      this.systemIntegrationsCache = this.systemIntegrationsCache.filter(
        (key) => key !== cacheKey,
      )
      console.log(`Removed system-wide integration ${integrationId} from cache`)
    }
  }

  /**
   * Clears all cached integrations for a user
   * @param userId The user ID, or null to clear system-wide integrations
   */
  clearUserIntegrations(userId: string | null): void {
    if (userId) {
      const userIntegrations = this.userIntegrationsCache.get(userId) || []
      for (const cacheKey of userIntegrations) {
        this.integrationsCache.delete(cacheKey)
      }
      this.userIntegrationsCache.delete(userId)
      console.log(`Cleared all integrations from cache for user ${userId}`)
    } else {
      for (const cacheKey of this.systemIntegrationsCache) {
        this.integrationsCache.delete(cacheKey)
      }
      this.systemIntegrationsCache = []
      console.log(`Cleared all system-wide integrations from cache`)
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
   * Get all integrations with a specific capability, regardless of user
   *
   * @param capabilityId The capability to filter by
   * @returns Array of cached integrations with the specified capability
   */
  getIntegrationsByCapability(
    capabilityId: IntegrationCapabilityId,
  ): CachedIntegration[] {
    // For system-wide use, get all integrations from all users that have this capability
    const result: CachedIntegration[] = []

    // Iterate through all cache entries directly
    this.integrationsCache.forEach((cachedIntegration) => {
      // Check if integration has the requested capability
      if (
        cachedIntegration.capabilities.some(
          (cap: IntegrationCapability) => cap.id === capabilityId && cap.active,
        )
      ) {
        result.push(cachedIntegration)
      }
    })

    return result
  }

  /**
   * Get an integration by its source ID (IntegrationId)
   *
   * @param sourceId The integration ID to look for
   * @returns The first cached integration with the specified source ID, or undefined if not found
   */
  getIntegrationBySourceId(sourceId: string): CachedIntegration | undefined {
    // Find the first integration that matches this source ID
    let result: CachedIntegration | undefined

    this.integrationsCache.forEach((cachedIntegration) => {
      if (cachedIntegration.integrationId === sourceId && !result) {
        result = cachedIntegration
      }
    })

    return result
  }
}
