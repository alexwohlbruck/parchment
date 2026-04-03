import md5 from 'md5'
import type {
  Integration,
  IntegrationConfig,
  IntegrationCapabilities,
} from '../../types/integration.types'
import type { IntegrationId } from '../../types/integration.enums'
import { getTtl } from './cache-config'
import { cacheService } from './index'

function generateCacheKey(
  integrationId: string,
  capabilityName: string,
  methodName: string,
  args: any[],
): string {
  const argsHash = md5(JSON.stringify(args))
  return `parchment:cache:${integrationId}:${capabilityName}:${methodName}:${argsHash}`
}

/**
 * Creates a proxy that wraps an integration's capability methods with caching.
 * The proxy intercepts property access on `capabilities` and wraps each method
 * with cache-aside logic using the TTLs defined in the integration's cacheTtl config.
 */
export function createCachedIntegrationProxy(
  integration: Integration<IntegrationConfig>,
  integrationId: IntegrationId,
): Integration<IntegrationConfig> {
  return new Proxy(integration, {
    get(target, prop, receiver) {
      if (prop !== 'capabilities') {
        return Reflect.get(target, prop, receiver)
      }

      // Return a proxy over the capabilities object
      return new Proxy(target.capabilities, {
        get(capTarget, capName, capReceiver) {
          const capValue = Reflect.get(capTarget, capName, capReceiver)
          if (typeof capName !== 'string' || capName === 'cacheTtl' || !capValue || typeof capValue !== 'object') {
            return capValue
          }

          // Return a proxy over the individual capability (e.g., placeInfo, search)
          return new Proxy(capValue, {
            get(methodTarget, methodName, methodReceiver) {
              const method = Reflect.get(methodTarget, methodName, methodReceiver)
              if (typeof method !== 'function') {
                return method
              }

              const capNameStr = capName as string
              const methodNameStr = methodName as string

              // Return a wrapped function that checks cache first
              return (...args: any[]) => {
                const ttl = getTtl(target, capNameStr, methodNameStr)

                // TTL of 0 = skip caching
                if (ttl <= 0) {
                  return method.apply(methodTarget, args)
                }

                const key = generateCacheKey(integrationId, capNameStr, methodNameStr, args)
                return cacheService.getOrFetch(key, ttl, () =>
                  method.apply(methodTarget, args),
                )
              }
            },
          })
        },
      })
    },
  })
}
