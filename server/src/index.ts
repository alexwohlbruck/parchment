process.env.TZ = 'UTC'

import { getObservabilityConfig } from './services/observability.config'
import { initOtel, flushOtel } from './lib/otel'
import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { i18next } from 'elysia-i18next'
import { cors as corsConfig, swagger as swaggerConfig } from './config'
import { logger, logError } from './lib/logger'
import { loggerMiddleware } from './middleware/logger.middleware'
import {
  healthCheck as healthCheckController,
  auth as authController,
  user as userController,
  directions as directionsController,
  place as placeController,
  proxy as proxyController,
  library as libraryController,
  integrations as integrationsController,
  search as searchController,
  geocoding as geocodingController,
  federation as federationController,
  friends as friendsController,
  sharing as sharingController,
  location as locationController,
  weather as weatherController,
  environment as environmentController,
  locationHistory as locationHistoryController,
  osmOAuth as osmOAuthController,
  notes as notesController,
  personalBlob as personalBlobController,
  wrappedMasterKeys as wrappedMasterKeysController,
  deviceTransfer as deviceTransferController,
  deviceWrapSecrets as deviceWrapSecretsController,
  publicController,
  realtime as realtimeController,
  data as dataController,
  subscription as subscriptionController,
  avatar as avatarController,
  vehicles as vehiclesController,
} from './controllers'
import { initializeIntegrations } from './services/integration.service'
import { clearProductCache } from './services/subscription.service'
import { bootstrapRealtime } from './services/realtime/bootstrap'
import { syncPermissionsAndRoles } from './seed/sync-permissions'
import { getI18nInitOptions, detectLanguage } from './lib/i18n'
import { initializeOsmPresets } from './lib/osm-presets'
import { getServerIdentity } from './lib/server-identity'
import { assertIntegrationKeyConfigured } from './lib/integration-encryption'

async function main() {
  // Fail loud at boot if crypto env vars are missing or invalid — an
  // ephemeral value picked up later silently is worse than a hard boot
  // failure. Both calls throw the same descriptive error the lazy paths
  // would have, just earlier.
  try {
    getServerIdentity()
    assertIntegrationKeyConfigured()
  } catch (error) {
    logger.error({ err: error }, 'Crypto env-var check failed at startup')
    process.exit(1)
  }

  try {
    const observabilityConfig = await getObservabilityConfig()
    await initOtel(observabilityConfig)
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize OpenTelemetry')
    process.exit(1)
  }

  // Capture top-level failures that never reach the request middleware so they
  // still land in Axiom. uncaughtException is fatal — flush the OTLP batch
  // before exiting so the record isn't lost in the buffer.
  process.on('uncaughtException', (error) => {
    logError('Uncaught exception', error, { fatal: true })
    flushOtel().finally(() => process.exit(1))
  })
  process.on('unhandledRejection', (reason) => {
    logError('Unhandled promise rejection', reason)
  })

  const app = new Elysia()

  app.use(loggerMiddleware)
  app.use(cors(corsConfig))
  app.use(swagger(swaggerConfig))
  app.use(
    i18next({
      initOptions: getI18nInitOptions(),
      detectLanguage: ({ request }) => {
        const url = new URL(request.url)
        const queryLang = url.searchParams.get('lang') ?? undefined
        const acceptLanguage = request.headers.get('accept-language') ?? undefined
        return detectLanguage(queryLang, acceptLanguage)
      },
    }),
  )

  app.use(healthCheckController)
  app.use(authController)
  app.use(userController)
  app.use(directionsController)
  app.use(placeController)
  app.use(proxyController)
  app.use(libraryController)
  app.use(integrationsController)
  app.use(searchController)
  app.use(geocodingController)
  app.use(federationController)
  app.use(friendsController)
  app.use(sharingController)
  app.use(locationController)
  app.use(weatherController)
  app.use(environmentController)
  app.use(locationHistoryController)
  app.use(osmOAuthController)
  app.use(notesController)
  app.use(personalBlobController)
  app.use(wrappedMasterKeysController)
  app.use(deviceTransferController)
  app.use(deviceWrapSecretsController)
  app.use(publicController)
  app.use(realtimeController)
  app.use(dataController)
  app.use(subscriptionController)
  app.use(avatarController)
  app.use(vehiclesController)

  // Wire realtime subscribers (local WS fanout, and — in Phase 4 —
  // federation forwarding). Must run before the first write path emits.
  bootstrapRealtime()

  app.onError(({ code, error }) => {
    if (code === 'NOT_FOUND') return 'Route not found :(' // TODO: i18n, proper error
    logError('Request error', error, { code })
    return new Response(
      JSON.stringify({ error: 'Internal server error', code }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  })

  // Listen on 0.0.0.0 in production/Docker so the server accepts external connections
  const hostname =
    process.env.NODE_ENV === 'production' || process.env.HOST === '0.0.0.0'
      ? '0.0.0.0'
      : process.env.HOST || 'localhost'
  const port = process.env.PORT || 5000

  app.listen({
    hostname,
    port,
  })

  logger.info(
    { hostname: app.server?.hostname, port: app.server?.port },
    'Server started',
  )

  try {
    logger.debug('i18n configured')
    clearProductCache()
    await syncPermissionsAndRoles()
    logger.info('Permissions and roles synced')
    initializeOsmPresets()
    await initializeIntegrations()
    logger.info('Integrations initialized')
  } catch (error) {
    logError('Failed to initialize services', error)
  }
}

main().catch((err) => {
  logError('Unhandled error in main', err, { fatal: true })
  flushOtel().finally(() => process.exit(1))
})
