import type { Integration, IntegrationConfig } from '../types/integration.types'

/**
 * Initialize an integration with connection testing
 * Tests the connection first, then initializes if successful
 * @param integration The integration to initialize
 * @param config The configuration to use
 * @throws Error if validation fails or connection test fails
 */
export async function initializeWithTest(
  integration: Integration,
  config: IntegrationConfig,
): Promise<void> {
  if (!integration.validateConfig(config)) {
    throw new Error(
      `Invalid configuration for ${integration.integrationId} integration`,
    )
  }

  const testResult = await integration.testConnection(config)
  if (!testResult.success) {
    throw new Error(
      `Connection test failed for ${integration.integrationId}: ${testResult.message}`,
    )
  }

  integration.initialize(config)
}
