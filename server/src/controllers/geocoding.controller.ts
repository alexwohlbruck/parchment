import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { forwardGeocode, reverseGeocode } from '../services/geocoding.service'
import { logError } from '../lib/logger'
import { i18nPlugin } from '../lib/i18n/plugin'

const geocodingRouter = new Elysia({ prefix: '/geocoding' })
  .use(i18nPlugin)
  .use(requireAuth)

  /**
   * Forward geocoding: Convert an address/query to coordinates
   * GET /geocoding/forward?query=<address>&lat=<lat>&lng=<lng>&limit=<limit>
   */
  .get(
    '/forward',
    async ({ query, status, t }) => {
      const { query: searchQuery, lat, lng, limit = 10 } = query

      if (!searchQuery || searchQuery.trim().length === 0) {
        return status(400, {
          message: t('errors.geocoding.queryRequired'),
        })
      }

      try {
        const { results, integrationId } = await forwardGeocode(
          searchQuery,
          lat ? parseFloat(lat) : undefined,
          lng ? parseFloat(lng) : undefined,
        )

        if (!integrationId) {
          return status(503, {
            message: t('errors.geocoding.serviceUnavailable'),
          })
        }

        const limitedResults = results.slice(0, parseInt(limit.toString()))

        return {
          query: searchQuery,
          results: limitedResults,
          count: limitedResults.length,
          integration: integrationId,
        }
      } catch (err) {
        logError('Error performing forward geocoding', err)
        return status(500, {
          message:
            err instanceof Error ? err.message : t('errors.geocoding.forwardFailed'),
        })
      }
    },
    {
      query: t.Object({
        query: t.String({ minLength: 1 }),
        lat: t.Optional(t.String()),
        lng: t.Optional(t.String()),
        limit: t.Optional(t.Union([t.String(), t.Number()])),
      }),
      detail: {
        tags: ['Geocoding'],
        summary: 'Forward geocode an address to coordinates',
        description:
          'Convert an address or location query into geographic coordinates. Optionally provide lat/lng for location bias. Served by the highest-priority configured geocoding integration, falling back to the next when one is unavailable or has no coverage.',
      },
    },
  )

  /**
   * Reverse geocoding: Convert coordinates to an address
   * GET /geocoding/reverse?lat=<lat>&lng=<lng>&limit=<limit>
   */
  .get(
    '/reverse',
    async ({ query, status, t }) => {
      const { lat, lng, limit = 10 } = query

      if (lat === undefined || lng === undefined) {
        return status(400, {
          message: t('errors.geocoding.coordinatesRequired'),
        })
      }

      try {
        const latitude = parseFloat(lat)
        const longitude = parseFloat(lng)

        if (isNaN(latitude) || isNaN(longitude)) {
          return status(400, {
            message: t('errors.validation.invalidCoordinates'),
          })
        }

        if (latitude < -90 || latitude > 90) {
          return status(400, {
            message: t('errors.validation.latitudeRange'),
          })
        }

        if (longitude < -180 || longitude > 180) {
          return status(400, {
            message: t('errors.validation.longitudeRange'),
          })
        }

        const { results, integrationId } = await reverseGeocode(
          latitude,
          longitude,
        )

        if (!integrationId) {
          return status(503, {
            message: t('errors.geocoding.serviceUnavailable'),
          })
        }

        const limitedResults = results.slice(0, parseInt(limit.toString()))

        return {
          coordinates: {
            lat: latitude,
            lng: longitude,
          },
          results: limitedResults,
          count: limitedResults.length,
          integration: integrationId,
        }
      } catch (err) {
        logError('Error performing reverse geocoding', err)
        return status(500, {
          message:
            err instanceof Error
              ? err.message
              : t('errors.geocoding.reverseFailed'),
        })
      }
    },
    {
      query: t.Object({
        lat: t.String(),
        lng: t.String(),
        limit: t.Optional(t.Union([t.String(), t.Number()])),
      }),
      detail: {
        tags: ['Geocoding'],
        summary: 'Reverse geocode coordinates to an address',
        description:
          'Convert geographic coordinates (latitude and longitude) into a human-readable address. Served by the highest-priority configured geocoding integration, falling back to the next when one is unavailable or has no coverage.',
      },
    },
  )

export default geocodingRouter
