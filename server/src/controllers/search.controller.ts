import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import * as searchService from '../services/search.service'

// TODO: Merge with place controller. These both "look up" places.
const searchRouter = new Elysia({ prefix: '/search' })
  .use(requireAuth)

  // Unified search endpoint
  .get(
    '/',
    async ({ query, user }) => {
      const {
        q: searchQuery = '',
        lat,
        lng,
        radius = 10000,
        maxResults = 50,
        autocomplete = false,
      } = query

      const searchResults = await searchService.search(user.id, {
        query: searchQuery,
        lat: lat ? parseFloat(lat) : undefined,
        lng: lng ? parseFloat(lng) : undefined,
        radius: parseInt(radius.toString()),
        maxResults: parseInt(maxResults.toString()),
        autocomplete: autocomplete === 'true' || autocomplete === true,
      })

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

export default searchRouter
