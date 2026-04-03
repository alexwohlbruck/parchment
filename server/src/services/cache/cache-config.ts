import type { Integration, IntegrationConfig } from '../../types/integration.types'

/** Default cache TTL in seconds (1 hour) */
export const DEFAULT_CACHE_TTL = 3600

/**
 * Get the cache TTL for a specific integration capability method.
 * Reads from integration.capabilities.cacheTtl, falls back to DEFAULT_CACHE_TTL.
 * Returns 0 if caching is explicitly disabled for this method.
 */
export function getTtl(
  integration: Integration<IntegrationConfig>,
  capabilityName: string,
  methodName: string,
): number {
  const ttlConfig = integration.capabilities.cacheTtl
  if (!ttlConfig) return DEFAULT_CACHE_TTL

  const capabilityTtl = ttlConfig[capabilityName]
  if (!capabilityTtl) return DEFAULT_CACHE_TTL

  const methodTtl = capabilityTtl[methodName]
  if (methodTtl === undefined) return DEFAULT_CACHE_TTL

  return methodTtl
}
