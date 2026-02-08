import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'
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

  .get(
    '/',
    async ({ query, user, i18n, status }) => {
      const language = i18n?.language ?? DEFAULT_LANGUAGE
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
      detail: {
        tags: ['Search'],
        summary: 'Search for places',
      },
    },
  )

  .post(
    '/advanced',
    async ({ body, status, t }) => {
      const { query, maxResults = 100 } = body

      const overpassIntegration =
        integrationManager.getConfiguredIntegrationForSource(
          'osm',
          IntegrationCapabilityId.SEARCH,
        )

      if (!overpassIntegration) {
        return status(503, {
          message: t('errors.search.overpassNotConfigured'),
        })
      }

      const integration =
        integrationManager.getCachedIntegrationInstance(overpassIntegration)

      if (
        !integration ||
        integration.integrationId !== IntegrationId.OVERPASS
      ) {
        return status(503, {
          message: t('errors.search.overpassNotAvailable'),
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
        return status(500, {
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
      detail: {
        tags: ['Search'],
        summary: 'Execute advanced Overpass query',
      },
    },
  )

  // TODO: Remove client-side category cache. Return category suggestions in search endpoint
  .post(
    '/category',
    async ({ body, status }) => {
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
        return status(500, {
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
      detail: {
        tags: ['Search'],
        summary: 'Search by category/preset',
      },
    },
  )

  // Categories endpoint for loading OSM presets
  .get(
    '/categories',
    async ({ query, language, t, status }) => {
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
        return status(500, {
          message: t('errors.search.categoriesLoadFailed'),
        })
      }
    },
    {
      query: t.Object({
        maxResults: t.Optional(t.Union([t.String(), t.Number()])),
      }),
      detail: {
        tags: ['Search'],
        summary: 'Get all categories/presets',
      },
    },
  )

  // Get a specific category by ID
  .get(
    '/categories/:categoryId',
    async ({ params: { categoryId }, language, t, status }) => {
      try {
        const category = categoryService.getCategoryById(categoryId, language)

        if (!category) {
          return status(404, {
            message: t('errors.notFound.category'),
          })
        }

        return category
      } catch (err) {
        console.error('Error getting category:', err)
        return status(500, {
          message: t('errors.search.categoryFailed'),
        })
      }
    },
    {
      params: t.Object({
        categoryId: t.String(),
      }),
      detail: {
        tags: ['Search'],
        summary: 'Get a specific category by ID',
      },
    },
  )

export default searchRouter
