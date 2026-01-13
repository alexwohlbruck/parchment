import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { cors as corsConfig, swagger as swaggerConfig } from './config'
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
  federation as federationController,
  friends as friendsController,
  sharing as sharingController,
  location as locationController,
} from './controllers'
import { initializeIntegrations } from './services/integration.service'
import { initI18n } from './lib/i18n'
import { initializeOsmPresets } from './lib/osm-presets'

const app = new Elysia()

app.use(cors(corsConfig))
app.use(swagger(swaggerConfig))

app.use(healthCheckController)
app.use(authController)
app.use(userController)
app.use(directionsController)
app.use(placeController)
app.use(proxyController)
app.use(libraryController)
app.use(integrationsController)
app.use(searchController)
app.use(federationController)
app.use(friendsController)
app.use(sharingController)
app.use(locationController)

app.onError(({ code }) => {
  if (code === 'NOT_FOUND') return 'Route not found :(' // TODO: i18n, proper error
})

// In development with host networking, bind to all interfaces
const hostname =
  process.env.NODE_ENV === 'development' ? '0.0.0.0' : 'localhost'
const port = process.env.PORT || 5000

app.listen({
  hostname,
  port,
})

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)

// Initialize services asynchronously
async function initialize() {
  try {
    await initI18n()
    console.log('✅ i18n initialized')

    initializeOsmPresets()

    await initializeIntegrations()
    console.log('✅ Integrations initialized')
  } catch (error) {
    console.error('❌ Failed to initialize services:', error)
  }
}

initialize()
