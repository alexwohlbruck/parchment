import { IntegrationManagerService } from './integration-manager.service'

// Create a singleton instance of the IntegrationManagerService
export const integrationManager = new IntegrationManagerService()

// Re-export types and interfaces
export * from './integration-manager.service'
export * from './integration-registry'
export * from '../../types/integration.types'
