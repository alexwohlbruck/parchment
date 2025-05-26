import {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  IntegrationCapabilities,
} from '../../types/integration.types'
import type {
  Place,
  PlacePhoto,
  SourceReference,
} from '../../types/place.types'
import { Source } from '../../lib/constants'

/**
 * Abstract base class for integrations with common implementations
 */
export abstract class BaseIntegration implements Integration {
  /**
   * The integration ID that this integration implements
   */
  abstract readonly integrationId: IntegrationId

  /**
   * The capability IDs this integration provides
   */
  abstract readonly capabilityIds: IntegrationCapabilityId[]

  /**
   * The capability implementations this integration provides
   */
  abstract readonly capabilities: IntegrationCapabilities

  /**
   * The data sources this integration can access
   */
  abstract readonly sources: Source[]

  /**
   * The current configuration for this integration
   */
  protected config: IntegrationConfig = {}

  /**
   * Whether the integration has been initialized
   */
  private initialized = false

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  abstract testConnection(
    config: IntegrationConfig,
  ): Promise<IntegrationTestResult>

  /**
   * Initializes the integration with the given configuration
   * @param config The configuration to use
   */
  initialize(config: IntegrationConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error(
        `Invalid configuration for ${this.integrationId} integration`,
      )
    }

    this.config = { ...config }
    this.initialized = true
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  abstract validateConfig(config: IntegrationConfig): boolean

  /**
   * Ensures the integration has been initialized before performing operations
   * @throws Error if the integration has not been initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  /**
   * Extract photos from provider data
   * @param providerData Provider-specific place data
   * @returns Array of PlacePhoto objects
   */
  protected extractPhotos(providerData: any): PlacePhoto[] {
    // Default implementation
    if (!providerData.photos) {
      return []
    }

    // Handle array of photos
    if (Array.isArray(providerData.photos)) {
      return providerData.photos.map((photo: any) => ({
        url: photo.url || photo.photo_reference || '',
        sourceId: this.integrationId,
        isPrimary: true,
      }))
    }

    // Handle single photo
    if (providerData.photo || providerData.image) {
      const photoUrl = providerData.photo || providerData.image
      return [
        {
          url: photoUrl,
          sourceId: this.integrationId,
          isPrimary: true,
        },
      ]
    }

    return []
  }

  /**
   * Extract address data from provider data
   * @param providerData Provider-specific place data
   * @returns Address object or null
   */
  protected extractAddress(providerData: any): any {
    // Default implementation
    if (!providerData.address) {
      return providerData.formatted_address
        ? { formatted: providerData.formatted_address }
        : null
    }

    // If address is a string
    if (typeof providerData.address === 'string') {
      return {
        formatted: providerData.address,
      }
    }

    // If address is an object
    return {
      formatted: providerData.address.formatted || '',
      street1: providerData.address.street || providerData.address.street1,
      street2: providerData.address.street2,
      neighborhood: providerData.address.neighborhood,
      locality: providerData.address.city || providerData.address.locality,
      region: providerData.address.state || providerData.address.region,
      postalCode:
        providerData.address.postalCode || providerData.address.zipCode,
      country: providerData.address.country,
      countryCode: providerData.address.countryCode,
    }
  }

  /**
   * Create a source reference
   * @param providerData Provider-specific place data
   * @returns SourceReference object
   */
  protected createSourceReference(providerData: any): SourceReference {
    return {
      id: this.integrationId,
      name: this.getDisplayName(),
      url: providerData.url || '',
    }
  }

  /**
   * Get a human-readable display name for this integration
   * @returns Display name
   */
  protected getDisplayName(): string {
    // Convert from kebab-case to Title Case
    return this.integrationId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  /**
   * Generate a random ID
   * @returns Random string ID
   */
  protected generateRandomId(): string {
    return Math.random().toString(36).substring(2, 15)
  }

  /**
   * Search for places matching a query
   * This is a base implementation that returns an empty array
   * Integrations supporting the PLACE_INFO or GEOCODING capabilities should override this
   *
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of place results
   */
  async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<any[]> {
    console.warn(`searchPlaces not implemented for ${this.integrationId}`)
    return []
  }

  /**
   * Get autocomplete suggestions for a query
   * This is a base implementation that returns an empty array
   * Integrations supporting the PLACE_INFO or GEOCODING capabilities should override this
   *
   * @param query The search query
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   * @param radius Optional radius in meters for location bias
   * @returns Array of autocomplete suggestions
   */
  async getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    radius?: number,
  ): Promise<any[]> {
    console.warn(`getAutocomplete not implemented for ${this.integrationId}`)
    return []
  }

  /**
   * Get place details by provider-specific ID
   * This is a base implementation that returns null
   * Integrations supporting the PLACE_INFO capability should override this
   *
   * @param id The provider-specific ID of the place
   * @returns Provider-specific place data or null if not found
   */
  async getPlaceDetails(id: string): Promise<any | null> {
    console.warn(`getPlaceDetails not implemented for ${this.integrationId}`)
    return null
  }
}
