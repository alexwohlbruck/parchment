import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as libraryService from '../../services/library'

const collectionsRouter = new Elysia({ prefix: '/collections' })
  .use(requireAuth)

  // Get all collections for the authenticated user
  .get('/', async ({ user }) => {
    return await libraryService.getCollections(user.id)
  })

  // Get the default collection (previously bookmarks)
  .get('/default', async ({ user }) => {
    const defaultCollection = await libraryService.ensureDefaultCollection(
      user.id,
    )

    const places = await libraryService.getPlacesInCollection(
      defaultCollection.id,
      user.id,
    )

    return {
      ...defaultCollection,
      places,
    }
  })

  // Get a single collection by ID
  .get(
    '/:id',
    async ({ params: { id }, user, set }) => {
      const collection = await libraryService.getCollectionById(id, user.id)
      if (!collection) {
        set.status = 404
        return { error: 'Collection not found' }
      }

      const places = await libraryService.getPlacesInCollection(id, user.id)

      return {
        ...collection,
        places,
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Create a new collection
  .post(
    '/',
    async ({ body, user }) => {
      const createdCollection = await libraryService.createCollection({
        ...body,
        userId: user.id,
      })

      return createdCollection
    },
    {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        iconColor: t.Optional(t.String()),
        isPublic: t.Optional(t.Boolean()),
      }),
    },
  )

  // Update an existing collection
  // TODO: Change to patch. Elysia CORS is rejecting PATCH requests for some reason.
  .put(
    '/:id',
    async ({ params: { id }, body, user }) => {
      const updated = await libraryService.updateCollection(id, user.id, body)
      if (!updated) {
        return { error: 'Collection not found or update failed' }
      }
      return updated
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        iconColor: t.Optional(t.String()),
        isPublic: t.Optional(t.Boolean()),
      }),
    },
  )

  // Delete a collection
  .delete(
    '/:id',
    async ({ params: { id }, user, set }) => {
      try {
        const deleted = await libraryService.deleteCollection(id, user.id)
        if (!deleted) {
          set.status = 404
          return { error: 'Collection not found or delete failed' }
        }
        set.status = 204
      } catch (err) {
        set.status = 400
        return { error: (err as Error).message }
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Add a place to a collection
  .post(
    '/:id/places/:placeId',
    async ({ params: { id, placeId }, user }) => {
      try {
        const added = await libraryService.saveToCollection(
          placeId,
          id,
          user.id,
        )
        return { success: true, added }
      } catch (err) {
        return { error: (err as Error).message }
      }
    },
    {
      params: t.Object({
        id: t.String(),
        placeId: t.String(),
      }),
    },
  )

  // Remove a place from a collection
  .delete(
    '/:id/places/:placeId',
    async ({ params: { id, placeId }, user, set }) => {
      try {
        await libraryService.removeFromCollection(placeId, id, user.id)
        set.status = 204
      } catch (err) {
        set.status = 404
        return { error: (err as Error).message }
      }
    },
    {
      params: t.Object({
        id: t.String(),
        placeId: t.String(),
      }),
    },
  )

  // Update a place in a collection (previously updateBookmark)
  .put(
    '/:id/places/:placeId',
    async ({ params: { id, placeId }, body, user, set }) => {
      try {
        const updated = await libraryService.updateBookmarkInCollection(
          placeId,
          id,
          user.id,
          body,
        )
        if (!updated) {
          set.status = 404
          return { error: 'Place not found or update failed' }
        }
        return updated
      } catch (err) {
        set.status = 404
        return { error: (err as Error).message }
      }
    },
    {
      params: t.Object({
        id: t.String(),
        placeId: t.String(),
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

export default collectionsRouter
