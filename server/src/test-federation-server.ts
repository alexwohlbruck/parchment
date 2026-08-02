/**
 * Minimal bootstrap for federation integration tests.
 *
 * Starts just enough of the server to exercise the federation controller
 * (i18n for translated error messages, CORS, federation routes). Skips the
 * heavy init in src/index.ts (permission seeds, OTEL, integrations). Used
 * only from the federation-e2e.test — not a production entry point.
 */

import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { cors as corsConfig } from './config'
import { i18nPlugin } from './lib/i18n/plugin'
import federationController from './controllers/federation.controller'
import { logger } from './lib/logger'

async function main() {
  const app = new Elysia()
  app.use(cors(corsConfig))
  app.use(i18nPlugin)
  app.use(federationController)

  const port = process.env.PORT ? Number(process.env.PORT) : 5099
  const hostname = process.env.HOST || '127.0.0.1'
  app.listen({ hostname, port })

  logger.info({ hostname, port }, 'Test federation server started')

  // Signal parent that we're ready.
  if (process.send) process.send({ kind: 'ready' })
  else console.log('READY')
}

main().catch((err) => {
  logger.error({ err }, 'Test federation server failed')
  process.exit(1)
})
