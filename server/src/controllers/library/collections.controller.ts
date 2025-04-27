import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as libraryService from '../../services/library'

const collectionsRouter = new Elysia({ prefix: '/collections' })
  .use(requireAuth)

  // Get all collections for the authenticated user
  .get('/', async ({ user }) => {
    return await libraryService.getCollections(user.id)
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

      // Fetch associated places
      const places = await libraryService.getPlacesInCollection(id, user.id)

      // Combine and return
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
  .patch(
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
      const deleted = await libraryService.deleteCollection(id, user.id)
      if (!deleted) {
        set.status = 404 // Or appropriate error status
        return { error: 'Collection not found or delete failed' }
      }
      set.status = 204
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
        const added = await libraryService.addPlaceToCollection(
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
        await libraryService.removePlaceFromCollection(placeId, id, user.id)
        set.status = 204
      } catch (err) {
        set.status = 404 // Or appropriate error status for not found/permission issues
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

export default collectionsRouter
