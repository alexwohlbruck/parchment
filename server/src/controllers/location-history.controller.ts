import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { requireIntegrationCredentials } from '../middleware/integration-credentials.middleware'
import { logger } from '../lib/logger'

const locationHistoryRouter = new Elysia({ prefix: '/location-history' }).use(
  requireAuth,
)

/**
 * GET /location-history
 *
 * Server-as-passthrough for an `scheme: 'user-e2ee'` integration's location
 * history. The client decrypts its config locally, then forwards the upstream
 * endpoint + token via the `X-Integration-Endpoint` and `X-Integration-Token`
 * headers per request. The server uses them in-memory to call the upstream
 * tracker, runs the response through the integration's adapter, and returns
 * the unified `LocationHistory` shape.
 *
 * Both headers are scrubbed from request logs (see logger.middleware.ts).
 *
 * Dawarich is the only LOCATION_HISTORY provider today. When a second one
 * lands, accept an `integrationId` query param and dispatch by ID.
 */
locationHistoryRouter.use(requireIntegrationCredentials).get(
  '/',
  async ({ integrationCredentials, query, status, t }) => {
    const start = new Date(query.start)
    const end = new Date(query.end)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return status(400, { message: t('errors.locationHistory.rangeRequired') })
    }
    if (start.getTime() >= end.getTime()) {
      return status(400, { message: t('errors.locationHistory.rangeInvalid') })
    }

    let statsRange: { start: Date; end: Date } | undefined
    if (query.statsStart && query.statsEnd) {
      const ss = new Date(query.statsStart)
      const se = new Date(query.statsEnd)
      if (
        !Number.isNaN(ss.getTime()) &&
        !Number.isNaN(se.getTime()) &&
        ss.getTime() < se.getTime()
      ) {
        statsRange = { start: ss, end: se }
      }
    }

    try {
      const { integrationManager } = await import('../services/integrations')
      const { IntegrationId } = await import('../types/integration.enums')
      const integration = integrationManager
        .getIntegrationRegistry()
        .getIntegration(IntegrationId.DAWARICH)

      if (!integration?.capabilities.locationHistory) {
        return status(503, { message: t('errors.integration.unavailable') })
      }

      return await integration.capabilities.locationHistory.getLocationHistory(
        integrationCredentials,
        {
          range: { start, end },
          statsRange,
          timezone: query.timezone,
        },
      )
    } catch (err: any) {
      // Don't surface upstream error details — they may include URL fragments
      // or token fingerprints from the underlying axios error.
      logger.error(
        { err: { message: err?.message, code: err?.code, status: err?.response?.status } },
        'location-history fetch failed',
      )
      return status(502, { message: t('errors.integration.failed') })
    }
  },
  {
    query: t.Object({
      start: t.String(),
      end: t.String(),
      statsStart: t.Optional(t.String()),
      statsEnd: t.Optional(t.String()),
      timezone: t.Optional(t.String()),
    }),
  },
)

export default locationHistoryRouter
