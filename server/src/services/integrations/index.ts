import { IntegrationManagerService } from './integration-manager.service'

// Create a singleton instance of the IntegrationManagerService
export const integrationManager = new IntegrationManagerService()

// Re-export types and interfaces
export * from './integration.interface'
export * from './base-integration'
export * from './integration-registry'
export * from './integration-manager.service'
