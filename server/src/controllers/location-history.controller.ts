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

/**
 * GET /location-history/place
 *
 * "You've been here N times" — visit-history aggregate at a coordinate,
 * surfaced on the place-detail page. Same e2ee passthrough pattern as the
 * main timeline endpoint above.
 */
locationHistoryRouter.use(requireIntegrationCredentials).get(
  '/place',
  async ({ integrationCredentials, query, status, t }) => {
    const lat = Number.parseFloat(query.lat)
    const lng = Number.parseFloat(query.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return status(400, {
        message: t('errors.locationHistory.coordinatesRequired'),
      })
    }

    const radius = query.radius ? Number.parseFloat(query.radius) : undefined
    const recentLimit = query.recentLimit
      ? Number.parseInt(query.recentLimit, 10)
      : undefined

    // bounds: all four corners must be valid finite numbers, otherwise drop
    // the bounds entirely (don't pass a half-formed bbox to the integration).
    let bounds:
      | { minLat: number; minLng: number; maxLat: number; maxLng: number }
      | undefined
    if (query.minLat && query.minLng && query.maxLat && query.maxLng) {
      const minLat = Number.parseFloat(query.minLat)
      const minLng = Number.parseFloat(query.minLng)
      const maxLat = Number.parseFloat(query.maxLat)
      const maxLng = Number.parseFloat(query.maxLng)
      if (
        Number.isFinite(minLat) &&
        Number.isFinite(minLng) &&
        Number.isFinite(maxLat) &&
        Number.isFinite(maxLng) &&
        minLat <= maxLat &&
        minLng <= maxLng
      ) {
        bounds = { minLat, minLng, maxLat, maxLng }
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

      return await integration.capabilities.locationHistory.getPlaceVisitHistory(
        integrationCredentials,
        {
          lat,
          lng,
          ...(bounds ? { bounds } : {}),
          ...(radius !== undefined && Number.isFinite(radius) ? { radius } : {}),
          ...(recentLimit !== undefined && Number.isFinite(recentLimit)
            ? { recentLimit }
            : {}),
        },
      )
    } catch (err: any) {
      logger.error(
        {
          err: {
            message: err?.message,
            code: err?.code,
            status: err?.response?.status,
          },
        },
        'place-visit-history fetch failed',
      )
      return status(502, { message: t('errors.integration.failed') })
    }
  },
  {
    query: t.Object({
      lat: t.String(),
      lng: t.String(),
      minLat: t.Optional(t.String()),
      minLng: t.Optional(t.String()),
      maxLat: t.Optional(t.String()),
      maxLng: t.Optional(t.String()),
      radius: t.Optional(t.String()),
      recentLimit: t.Optional(t.String()),
    }),
  },
)

export default locationHistoryRouter
