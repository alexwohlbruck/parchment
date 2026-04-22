import { getObservabilityConfig } from './services/observability.config'
import { initOtel } from './lib/otel'
import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { i18next } from 'elysia-i18next'
import { cors as corsConfig, swagger as swaggerConfig } from './config'
import { logger } from './lib/logger'
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
  osmOAuth as osmOAuthController,
  notes as notesController,
  personalBlob as personalBlobController,
  wrappedMasterKeys as wrappedMasterKeysController,
  deviceTransfer as deviceTransferController,
  deviceWrapSecrets as deviceWrapSecretsController,
} from './controllers'
import { initializeIntegrations } from './services/integration.service'
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
  app.use(osmOAuthController)
  app.use(notesController)
  app.use(personalBlobController)
  app.use(wrappedMasterKeysController)
  app.use(deviceTransferController)
  app.use(deviceWrapSecretsController)

  app.onError(({ code, error }) => {
    if (code === 'NOT_FOUND') return 'Route not found :(' // TODO: i18n, proper error
    logger.error({ err: error, code }, 'Request error')
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
    await syncPermissionsAndRoles()
    logger.info('Permissions and roles synced')
    initializeOsmPresets()
    await initializeIntegrations()
    logger.info('Integrations initialized')
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize services')
  }
}

main().catch((err) => {
  logger.error({ err }, 'Unhandled error in main')
  process.exit(1)
})
