import { Elysia, t, error } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import i18nMiddleware from '../middleware/i18n.middleware'
import { integrationManager } from '../services/integrations'
import { IntegrationCapabilityId } from '../types/integration.types'

const geocodingRouter = new Elysia({ prefix: '/geocoding' })
  .use(requireAuth)
  .use(i18nMiddleware)

  /**
   * Forward geocoding: Convert an address/query to coordinates
   * GET /geocoding/forward?query=<address>&lat=<lat>&lng=<lng>&limit=<limit>
   */
  .get(
    '/forward',
    async ({ query, user }) => {
      const { query: searchQuery, lat, lng, limit = 10 } = query

      if (!searchQuery || searchQuery.trim().length === 0) {
        return error(400, {
          message: 'Query parameter is required',
        })
      }

      try {
        // Get the highest priority geocoding integration
        const geocodingIntegrations =
          integrationManager.getConfiguredIntegrationsByCapability(
            IntegrationCapabilityId.GEOCODING,
          )

        if (geocodingIntegrations.length === 0) {
          return error(503, {
            message: 'No geocoding service is currently available',
          })
        }

        // Use the first (highest priority) integration
        const integrationRecord = geocodingIntegrations[0]
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)

        if (!integration || !integration.capabilities.geocoding) {
          return error(503, {
            message: 'Geocoding service is not properly configured',
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
        return error(500, {
          message:
            err instanceof Error
              ? err.message
              : 'Failed to perform geocoding',
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
    async ({ query, user }) => {
      const { lat, lng, limit = 10 } = query

      if (!lat || !lng) {
        return error(400, {
          message: 'Both lat and lng parameters are required',
        })
      }

      try {
        // Parse coordinates
        const latitude = parseFloat(lat)
        const longitude = parseFloat(lng)

        if (isNaN(latitude) || isNaN(longitude)) {
          return error(400, {
            message: 'Invalid lat or lng values',
          })
        }

        // Validate coordinate ranges
        if (latitude < -90 || latitude > 90) {
          return error(400, {
            message: 'Latitude must be between -90 and 90',
          })
        }

        if (longitude < -180 || longitude > 180) {
          return error(400, {
            message: 'Longitude must be between -180 and 180',
          })
        }

        // Get the highest priority geocoding integration
        const geocodingIntegrations =
          integrationManager.getConfiguredIntegrationsByCapability(
            IntegrationCapabilityId.GEOCODING,
          )

        if (geocodingIntegrations.length === 0) {
          return error(503, {
            message: 'No geocoding service is currently available',
          })
        }

        // Use the first (highest priority) integration
        const integrationRecord = geocodingIntegrations[0]
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)

        if (!integration || !integration.capabilities.geocoding) {
          return error(503, {
            message: 'Geocoding service is not properly configured',
          })
        }

        // Call the reverse geocoding capability
        const results =
          await integration.capabilities.geocoding.reverseGeocode(
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
        return error(500, {
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
