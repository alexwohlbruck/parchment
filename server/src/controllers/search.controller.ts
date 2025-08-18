import { Elysia, t, error } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import i18nMiddleware from '../middleware/i18n.middleware'
import * as searchService from '../services/search.service'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'
import type { Place } from '../types/place.types'
import { calculateOSMCenter } from '../util/geometry-conversion'
import { OverpassIntegration } from '../services/integrations/overpass-integration'

const searchRouter = new Elysia({ prefix: '/search' })
  .use(requireAuth)
  .use(i18nMiddleware)

  .get(
    '/',
    async ({ query, user, language }) => {
      const {
        q: searchQuery = '',
        lat,
        lng,
        radius = 10000,
        maxResults = 50,
        autocomplete = false,
      } = query

      const searchResults = await searchService.search(
        user.id,
        {
          query: searchQuery,
          lat: lat ? parseFloat(lat) : undefined,
          lng: lng ? parseFloat(lng) : undefined,
          radius: parseInt(radius.toString()),
          maxResults: parseInt(maxResults.toString()),
          autocomplete: autocomplete === 'true' || autocomplete === true,
        },
        language,
      )

      return searchResults
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        lat: t.Optional(t.String()),
        lng: t.Optional(t.String()),
        radius: t.Optional(t.Union([t.String(), t.Number()])),
        maxResults: t.Optional(t.Union([t.String(), t.Number()])),
        autocomplete: t.Optional(t.Union([t.String(), t.Boolean()])),
      }),
    },
  )

  .get(
    '/categories',
    async ({ language, query }) => {
      const { loadCategories } = await import('../services/category.service')

      const { maxResults = 1000 } = query

      const categories = loadCategories(language)
      const limitedCategories = categories.slice(
        0,
        parseInt(maxResults.toString()),
      )

      return {
        categories: limitedCategories,
        totalCount: categories.length,
        language,
      }
    },
    {
      query: t.Object({
        maxResults: t.Optional(t.Union([t.String(), t.Number()])),
      }),
    },
  )

  .get(
    '/categories/:categoryId',
    async ({ params, language }) => {
      const { categoryId } = params

      const category = await searchService.getCategoryDetails(
        categoryId,
        language,
      )

      if (!category) {
        return { error: 'Category not found' }
      }

      return category
    },
    {
      params: t.Object({
        categoryId: t.String(),
      }),
    },
  )

  .post(
    '/advanced',
    async ({ body, user, language }) => {
      const { query, maxResults = 100 } = body

      const overpassIntegration =
        integrationManager.getConfiguredIntegrationForSource(
          'osm',
          IntegrationCapabilityId.SEARCH,
        )

      if (!overpassIntegration) {
        return error(503, {
          message: 'Overpass integration is not configured.',
        })
      }

      const integration =
        integrationManager.getCachedIntegrationInstance(overpassIntegration)

      if (
        !integration ||
        integration.integrationId !== IntegrationId.OVERPASS
      ) {
        return error(503, {
          message: 'Overpass integration is not available',
        })
      }

      try {
        const results = await (
          integration as OverpassIntegration
        ).executeRawQuery(query, maxResults)

        return {
          query,
          results,
          totalCount: results.length,
          executedAt: new Date().toISOString(),
        }
      } catch (err) {
        console.error('Error executing Overpass query:', err)
        return error(500, {
          message:
            err instanceof Error
              ? err.message
              : 'Failed to execute Overpass query',
        })
      }
    },
    {
      body: t.Object({
        query: t.String({ minLength: 1 }),
        maxResults: t.Optional(t.Number({ minimum: 1, maximum: 1000 })),
      }),
    },
  )

export default searchRouter
