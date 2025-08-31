import { Elysia, t, error } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import i18nMiddleware from '../middleware/i18n.middleware'
import * as searchService from '../services/search.service'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'
import { OverpassIntegration } from '../services/integrations/overpass-integration'
import { categoryService } from '../services/category.service'

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

  // TODO: Remove client-side category cache. Return category suggestions in search endpoint
  .post(
    '/category',
    async ({ body, user, language }) => {
      const { presetId, bounds, maxResults = 100 } = body

      try {
        const results = await searchService.searchByCategory(presetId, {
          bounds,
          limit: maxResults,
        })

        return {
          presetId,
          results,
          totalCount: results.length,
          executedAt: new Date().toISOString(),
        }
      } catch (err) {
        console.error('Error executing category search:', err)
        return error(500, {
          // TODO: Deprecated error function
          message:
            err instanceof Error
              ? err.message
              : 'Failed to execute category search', // TODO: i18n
        })
      }
    },
    {
      body: t.Object({
        presetId: t.String({ minLength: 1 }),
        bounds: t.Object({
          north: t.Number(),
          south: t.Number(),
          east: t.Number(),
          west: t.Number(),
        }),
        maxResults: t.Optional(t.Number({ minimum: 1, maximum: 1000 })),
      }),
    },
  )

  // Categories endpoint for loading OSM presets
  .get(
    '/categories',
    async ({ query, language }) => {
      const { maxResults = 1000 } = query

      try {
        const categories = categoryService.loadCategories(language)
        const limitedCategories = categories.slice(
          0,
          parseInt(maxResults.toString()),
        )

        return {
          categories: limitedCategories,
          totalCount: categories.length,
        }
      } catch (err) {
        console.error('Error loading categories:', err)
        return error(500, {
          message: 'Failed to load categories',
        })
      }
    },
    {
      query: t.Object({
        maxResults: t.Optional(t.Union([t.String(), t.Number()])),
      }),
    },
  )

  // Get a specific category by ID
  .get(
    '/categories/:categoryId',
    async ({ params: { categoryId }, language }) => {
      try {
        const category = categoryService.getCategoryById(categoryId, language)

        if (!category) {
          return error(404, {
            message: 'Category not found',
          })
        }

        return category
      } catch (err) {
        console.error('Error getting category:', err)
        return error(500, {
          message: 'Failed to get category',
        })
      }
    },
    {
      params: t.Object({
        categoryId: t.String(),
      }),
    },
  )

export default searchRouter
