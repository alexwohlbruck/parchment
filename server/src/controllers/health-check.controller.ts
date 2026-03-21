import Elysia, { t } from 'elysia'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { integrationManager } from '../services/integrations'
import { IntegrationId } from '../types/integration.types'
import { logger } from '../lib/logger'

const packageJson = require('../../package.json')

interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  responseTime?: number
  error?: string
  provider?: string
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  timestamp: string
  uptime: number
  memory: NodeJS.MemoryUsage
  environment: string
}

const app = new Elysia()

app.get('/', async ({ set }) => {
  const startTime = Date.now()
  const response: HealthResponse = {
    status: 'healthy',
    version: packageJson.version,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'unknown'
  }

  let overallHealthy = true
  let hasDegraded = false

  try {
    // Check database connectivity
    const dbStart = Date.now()
    try {
      await db.select().from(users).limit(1)
      // Database is healthy
    } catch (error) {
      overallHealthy = false
    }

    // Check critical external services
    const serviceHealth = await checkCriticalServices()

    // Determine overall status based on service health
    if (serviceHealth.database === 'unhealthy' || serviceHealth.geocoding === 'unhealthy' || serviceHealth.routing === 'unhealthy') {
      overallHealthy = false
    } else if (serviceHealth.database === 'degraded' || serviceHealth.geocoding === 'degraded' || serviceHealth.routing === 'degraded') {
      hasDegraded = true
    }

    if (!overallHealthy) {
      response.status = 'unhealthy'
      set.status = 503 // Service Unavailable
    } else if (hasDegraded) {
      response.status = 'degraded'
      set.status = 207 // Multi-Status
    } else {
      response.status = 'healthy'
      set.status = 200 // OK
    }

  } catch (error) {
    response.status = 'unhealthy'
    set.status = 503
    logger.error({ err: error }, 'Health check error')
  }

  return response
}, {
  detail: {
    tags: ['Health'],
    summary: 'Health Check',
    description: 'Check the health status of the application and its dependencies',
    responses: {
      200: {
        description: 'All services are healthy',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['healthy'] },
                version: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
                uptime: { type: 'number' },
                memory: { type: 'object' },
                environment: { type: 'string' }
              }
            }
          }
        }
      },
      207: {
        description: 'Some services are degraded but application is functional'
      },
      503: {
        description: 'Critical services are unhealthy'
      }
    }
  }
})

/**
 * Check the health of critical external services
 */
async function checkCriticalServices(): Promise<{
  database: 'healthy' | 'degraded' | 'unhealthy'
  geocoding: 'healthy' | 'degraded' | 'unhealthy'
  routing: 'healthy' | 'degraded' | 'unhealthy'
}> {
  const result = {
    database: 'healthy' as const,
    geocoding: 'healthy' as const,
    routing: 'healthy' as const
  }

  // Check geocoding service (try Pelias first, fallback to Nominatim)
  try {
    const geocodingIntegrations = integrationManager.getConfiguredIntegrationsByCapability('geocoding')
    
    if (geocodingIntegrations.length > 0) {
      // Test the first available geocoding integration
      const integration = geocodingIntegrations[0]
      const testResult = await integrationManager.testIntegration(
        integration.integrationId,
        integration.config
      )
      
      result.geocoding = testResult.success ? 'healthy' : 'degraded'
    } else {
      result.geocoding = 'degraded'
    }
  } catch (error) {
    result.geocoding = 'degraded'
  }

  // Check routing service (Valhalla)
  try {
    const routingIntegrations = integrationManager.getConfiguredIntegrationsByCapability('routing')
    
    if (routingIntegrations.length > 0) {
      // Test the first available routing integration
      const integration = routingIntegrations[0]
      const testResult = await integrationManager.testIntegration(
        integration.integrationId,
        integration.config
      )
      
      result.routing = testResult.success ? 'healthy' : 'degraded'
    } else {
      result.routing = 'degraded'
    }
  } catch (error) {
    result.routing = 'degraded'
  }

  return result
}

export default app
