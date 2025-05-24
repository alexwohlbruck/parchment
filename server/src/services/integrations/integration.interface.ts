// TODO: Move this to the types folder

import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { UnifiedPlace } from '../../types/unified-place.types'
import { Source } from '../../lib/constants'

export interface IntegrationTestResult {
  success: boolean
  message?: string
}

export interface IntegrationConfig {
  [key: string]: any
}

/**
 * Base interface that all integrations must implement
 */
export interface Integration {
  /**
   * The integration ID that this integration implements
   */
  readonly integrationId: IntegrationId

  /**
   * The capabilities this integration provides
   */
  readonly capabilities: IntegrationCapabilityId[]

  /**
   * The data sources this integration can access
   */
  readonly sources: Source[]

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  testConnection(config: IntegrationConfig): Promise<IntegrationTestResult>

  /**
   * Initializes the integration with the given configuration
   * @param config The configuration to use
   */
  initialize(config: IntegrationConfig): void

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: IntegrationConfig): boolean

  /**
   * Creates a UnifiedPlace from provider-specific place data
   * @param providerData The provider-specific place data
   * @param id Optional ID for the place
   * @returns A UnifiedPlace object
   */
  createUnifiedPlace(providerData: any, id?: string): UnifiedPlace

  /**
   * Search for places matching a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of place results
   */
  searchPlaces?(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<any[]>

  /**
   * Get autocomplete suggestions for a query
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of autocomplete suggestions
   */
  getAutocomplete?(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<any[]>

  /**
   * Get place details by provider-specific ID
   * @param id The provider-specific ID of the place
   * @returns Provider-specific place data or null if not found
   */
  getPlaceDetails?(id: string): Promise<any | null>
}
