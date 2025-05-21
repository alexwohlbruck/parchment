import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import {
  Integration,
  IntegrationConfig,
  IntegrationTestResult,
} from './integration.interface'
import type {
  UnifiedPlace,
  PlacePhoto,
  SourceReference,
} from '../../types/unified-place.types'
import { getTimestamp } from '../merge.service'

/**
 * Abstract base class for integrations with common implementations
 */
export abstract class BaseIntegration implements Integration {
  /**
   * The integration ID that this integration implements
   */
  abstract readonly integrationId: IntegrationId

  /**
   * The capabilities this integration provides
   */
  abstract readonly capabilities: IntegrationCapabilityId[]

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
        `${this.integrationId} integration has not been initialized`,
      )
    }
  }

  /**
   * Creates a UnifiedPlace from provider-specific place data
   * This is a base implementation that can be overridden by specific integrations
   *
   * @param providerData The provider-specific place data
   * @param id Optional ID for the place (defaults to provider's ID or random)
   * @returns A UnifiedPlace object
   */
  // TODO: Use existing adapters for this
  createUnifiedPlace(providerData: any, id?: string): UnifiedPlace {
    // Generate an ID if none provided
    const placeId =
      id ||
      `${this.integrationId}/${providerData.id || this.generateRandomId()}`

    // Default implementation with minimal fields
    return {
      id: placeId,
      externalIds: { [this.integrationId]: providerData.id || '' },
      name: providerData.name || 'Unnamed Place',
      placeType: providerData.type || providerData.category || 'unknown',
      geometry: providerData.geometry || {
        type: 'point',
        center: {
          lat: providerData.lat || providerData.latitude || 0,
          lng: providerData.lng || providerData.longitude || 0,
        },
      },
      photos: this.extractPhotos(providerData),
      address: this.extractAddress(providerData),
      contactInfo: {
        phone: null,
        email: null,
        website: null,
        socials: {},
      },
      openingHours: null,
      amenities: {},
      sources: [this.createSourceReference(providerData)],
      lastUpdated: getTimestamp(),
      createdAt: getTimestamp(),
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
}
