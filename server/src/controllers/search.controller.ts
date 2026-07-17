import { Elysia, t } from 'elysia'
import { optionalAuth } from '../middleware/auth.middleware'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'
import * as searchService from '../services/search.service'
import * as brandService from '../services/brand.service'
import { integrationManager } from '../services/integrations'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../types/integration.types'
import { OverpassIntegration } from '../services/integrations/overpass-integration'
import { categoryService } from '../services/category.service'
import { categoryPalette } from '../lib/place-categories'
import { getPresetById, getPresetFields } from '../lib/osm-presets'

const searchRouter = new Elysia({ prefix: '/search' })
  .use(optionalAuth)

  .get(
    '/',
    async ({ query, user, i18n, status, request }) => {
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
        user?.id ?? '',
        {
          query: searchQuery,
          lat: lat ? parseFloat(lat) : undefined,
          lng: lng ? parseFloat(lng) : undefined,
          radius: parseInt(radius.toString()),
          maxResults: parseInt(maxResults.toString()),
          autocomplete: autocomplete === 'true' || autocomplete === true,
        },
        language,
        // Propagate client disconnect (user kept typing) so the upstream
        // Barrelman request is aborted instead of running to completion.
        request.signal,
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

  .post(
    '/route',
    async ({ body, status }) => {
      const { route, ...options } = body

      try {
        const results = await searchService.searchAlongRoute(route, options)

        return {
          route,
          results,
          totalCount: results.length,
          executedAt: new Date().toISOString(),
        }
      } catch (err) {
        console.error('Error executing route search:', err)
        return status(500, {
          message:
            err instanceof Error
              ? err.message
              : 'Failed to execute route search',
        })
      }
    },
    {
      body: t.Object({
        route: t.Object({
          type: t.Literal('LineString'),
          coordinates: t.Array(
            t.Array(t.Number(), { minItems: 2, maxItems: 2 }),
          ),
        }),
        query: t.Optional(t.String()),
        buffer: t.Optional(t.Number({ minimum: 100, maximum: 50000 })),
        categories: t.Optional(t.Array(t.String())),
        tags: t.Optional(t.Record(t.String(), t.String())),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
        semantic: t.Optional(t.Boolean()),
        autocomplete: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Search'],
        summary: 'Search along a route corridor',
      },
    },
  )

  // TODO: Remove client-side category cache. Return category suggestions in search endpoint
  .post(
    '/category',
    async ({ body, status, language }) => {
      const { presetId, bounds, maxResults = 30, offset = 0, sort, filter, tags } = body

      try {
        const results = await searchService.searchByCategory(presetId, {
          bounds,
          limit: maxResults,
          offset,
          sort,
          filter,
          tags,
        })

        const preset = getPresetById(presetId)
        const fieldDefinitions = preset ? getPresetFields(preset, language) : []

        return {
          presetId,
          results,
          fieldDefinitions,
          // No total count: a COUNT over a broad category/wide area is expensive.
          // `hasMore` (a full page came back) drives scroll pagination instead.
          hasMore: results.length >= maxResults,
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
        offset: t.Optional(t.Number({ minimum: 0 })),
        sort: t.Optional(t.Union([
          t.Literal('relevance'),
          t.Literal('distance'),
          t.Literal('name'),
        ])),
        filter: t.Optional(t.Object({
          access: t.Optional(t.Array(t.String())),
          fee: t.Optional(t.Union([t.Literal('yes'), t.Literal('no')])),
          hasHours: t.Optional(t.Boolean()),
        })),
        tags: t.Optional(t.Record(t.String(), t.String())),
      }),
      detail: {
        tags: ['Search'],
        summary: 'Search by category/preset',
      },
    },
  )

  // Browse all locations of a brand. Viewport-first, auto-widening when sparse.
  .post(
    '/brand',
    async ({ body, status, language }) => {
      const { brandKey, brandName, bounds, lat, lng, minResults, maxResults } = body

      try {
        const { brand, results } = await brandService.searchByBrand(brandKey, {
          brandName,
          bounds,
          lat,
          lng,
          minResults,
          maxResults,
          language,
        })

        return {
          brandKey,
          brand,
          results,
          totalCount: results.length,
          executedAt: new Date().toISOString(),
        }
      } catch (err) {
        console.error('Error executing brand search:', err)
        return status(500, {
          message:
            err instanceof Error ? err.message : 'Failed to execute brand search',
        })
      }
    },
    {
      body: t.Object({
        brandKey: t.String({ minLength: 1 }),
        brandName: t.Optional(t.String()),
        bounds: t.Optional(t.Object({
          north: t.Number(),
          south: t.Number(),
          east: t.Number(),
          west: t.Number(),
        })),
        lat: t.Optional(t.Number()),
        lng: t.Optional(t.Number()),
        minResults: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
        maxResults: t.Optional(t.Number({ minimum: 1, maximum: 1000 })),
      }),
      detail: {
        tags: ['Search'],
        summary: 'Search all locations of a brand',
      },
    },
  )

  // Category palette — PlaceCategory definitions with display labels and theme colors.
  // Must be declared before /categories/:categoryId so "palette" is not treated as an ID.
  .get(
    '/categories/palette',
    () => ({ palette: categoryPalette }),
    {
      detail: {
        tags: ['Search'],
        summary: 'Get PlaceCategory definitions (labels + colors)',
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
