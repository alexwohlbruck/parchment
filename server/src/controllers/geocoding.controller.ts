import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { integrationManager } from '../services/integrations'
import { IntegrationCapabilityId } from '../types/integration.types'

const geocodingRouter = new Elysia({ prefix: '/geocoding' })
  .use(requireAuth)

  /**
   * Forward geocoding: Convert an address/query to coordinates
   * GET /geocoding/forward?query=<address>&lat=<lat>&lng=<lng>&limit=<limit>
   */
  .get(
    '/forward',
    async ({ query, user, status, t }) => {
      const { query: searchQuery, lat, lng, limit = 10 } = query

      if (!searchQuery || searchQuery.trim().length === 0) {
        return status(400, {
          message: t('errors.geocoding.queryRequired'),
        })
      }

      try {
        // Get the highest priority geocoding integration
        const geocodingIntegrations =
          integrationManager.getConfiguredIntegrationsByCapability(
            IntegrationCapabilityId.GEOCODING,
          )

        if (geocodingIntegrations.length === 0) {
          return status(503, {
            message: t('errors.geocoding.serviceUnavailable'),
          })
        }

        // Use the first (highest priority) integration
        const integrationRecord = geocodingIntegrations[0]
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)

        if (!integration || !integration.capabilities.geocoding) {
          return status(503, {
            message: t('errors.integration.notConfigured'),
          })
        }

        // Call the geocoding capability
        const results = await integration.capabilities.geocoding.geocode(
          searchQuery,
          lat ? parseFloat(lat) : undefined,
          lng ? parseFloat(lng) : undefined,
        )

        // Limit results
        const limitedResults = results.slice(0, parseInt(limit.toString()))

        return {
          query: searchQuery,
          results: limitedResults,
          count: limitedResults.length,
          integration: integrationRecord.integrationId,
        }
      } catch (err) {
        console.error('Error performing forward geocoding:', err)
        return status(500, {
          message:
            err instanceof Error ? err.message : 'Failed to perform geocoding',
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
          'Convert an address or location query into geographic coordinates. Optionally provide lat/lng for location bias.',
      },
    },
  )

  /**
   * Reverse geocoding: Convert coordinates to an address
   * GET /geocoding/reverse?lat=<lat>&lng=<lng>&limit=<limit>
   */
  .get(
    '/reverse',
    async ({ query, user, status, t }) => {
      const { lat, lng, limit = 10 } = query

      if (lat === undefined || lng === undefined) {
        return status(400, {
          message: t('errors.geocoding.coordinatesRequired'),
        })
      }

      try {
        // Parse coordinates
        const latitude = parseFloat(lat)
        const longitude = parseFloat(lng)

        if (isNaN(latitude) || isNaN(longitude)) {
          return status(400, {
            message: t('errors.validation.invalidCoordinates'),
          })
        }

        // Validate coordinate ranges
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

        // Get the highest priority geocoding integration
        const geocodingIntegrations =
          integrationManager.getConfiguredIntegrationsByCapability(
            IntegrationCapabilityId.GEOCODING,
          )

        if (geocodingIntegrations.length === 0) {
          return status(503, {
            message: t('errors.geocoding.serviceUnavailable'),
          })
        }

        // Use the first (highest priority) integration
        const integrationRecord = geocodingIntegrations[0]
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)

        if (!integration || !integration.capabilities.geocoding) {
          return status(503, {
            message: t('errors.integration.notConfigured'),
          })
        }

        // Call the reverse geocoding capability
        const results = await integration.capabilities.geocoding.reverseGeocode(
          latitude,
          longitude,
        )

        // Limit results
        const limitedResults = results.slice(0, parseInt(limit.toString()))

        return {
          coordinates: {
            lat: latitude,
            lng: longitude,
          },
          results: limitedResults,
          count: limitedResults.length,
          integration: integrationRecord.integrationId,
        }
      } catch (err) {
        console.error('Error performing reverse geocoding:', err)
        return status(500, {
          message:
            err instanceof Error
              ? err.message
              : 'Failed to perform reverse geocoding',
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
          'Convert geographic coordinates (latitude and longitude) into a human-readable address.',
      },
    },
  )

export default geocodingRouter
