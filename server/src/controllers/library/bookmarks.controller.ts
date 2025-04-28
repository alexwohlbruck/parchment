import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as libraryService from '../../services/library'

const placesRouter = new Elysia({ prefix: '/places' })
  .use(requireAuth)

  // Get all bookmarks for the authenticated user
  .get('/', async ({ user }) => {
    return await libraryService.getBookmarks(user.id)
  })

  // Get a single bookmark by ID
  .get(
    '/:id',
    async ({ params: { id }, user }) => {
      const place = await libraryService.getBookmarkById(id, user.id)
      if (!place) {
        return { error: 'Place not found' }
      }
      return place
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Create a new bookmark
  .post(
    '/',
    async ({ body, user }) => {
      // Ensure the externalIds contains at least osm
      if (!body.externalIds || !body.externalIds.osm) {
        return { error: 'Missing required OSM ID in externalIds' }
      }

      const createdPlace = await libraryService.createBookmark({
        ...body,
        userId: user.id,
      })

      return createdPlace
    },
    {
      body: t.Object({
        externalIds: t.Record(t.String(), t.String()),
        name: t.String(),
        address: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        iconColor: t.Optional(t.String()),
        presetType: t.Optional(
          t.Union([t.Literal('home'), t.Literal('work'), t.Literal('school')]),
        ),
      }),
    },
  )

  // Update an existing bookmark
  // TODO: Change to patch. Elysia CORS is rejecting PATCH requests for some reason.
  .put(
    '/:id',
    async ({ params: { id }, body, user }) => {
      const updated = await libraryService.updateBookmark(id, user.id, body)
      if (!updated) {
        return { error: 'Place not found or update failed' }
      }
      return updated
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        address: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        iconColor: t.Optional(t.String()),
        presetType: t.Optional(
          t.Union([
            t.Literal('home'),
            t.Literal('work'),
            t.Literal('school'),
            t.Null(),
          ]),
        ),
      }),
    },
  )

  // Unsave place
  .delete(
    '/:id',
    async ({ params: { id }, user, set }) => {
      const deleted = await libraryService.unsavePlace(id, user.id)
      if (!deleted) {
        set.status = 404 // Or appropriate error status
        return { error: 'Place not found or delete failed' }
      }
      set.status = 204
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get collections for a place
  .get(
    '/:id/collections',
    async ({ params: { id }, user }) => {
      const collections = await libraryService.getCollectionsForPlace(
        id,
        user.id,
      )
      return collections
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

export default placesRouter
