import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as collectionsService from '../../services/library/collections.service'

const collectionsRouter = new Elysia({ prefix: '/collections' })
  .use(requireAuth)

  // Get all collections for the authenticated user
  .get('/', async ({ user }) => {
    return await collectionsService.getCollections(user.id)
  })

  // Get the default collection (previously bookmarks)
  .get('/default', async ({ user }) => {
    const defaultCollection = await collectionsService.ensureDefaultCollection(
      user.id,
    )

    const bookmarks = await collectionsService.getBookmarksInCollection(
      defaultCollection.id,
      user.id,
    )

    return {
      ...defaultCollection,
      bookmarks,
    }
  })

  // Get a single collection by ID
  .get(
    '/:id',
    async ({ params: { id }, user, set }) => {
      const collection = await collectionsService.getCollectionById(id, user.id)
      if (!collection) {
        set.status = 404
        return { error: 'Collection not found' }
      }

      const bookmarks = await collectionsService.getBookmarksInCollection(
        id,
        user.id,
      )

      return {
        ...collection,
        bookmarks,
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
      const createdCollection = await collectionsService.createCollection({
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
      const updated = await collectionsService.updateCollection(
        id,
        user.id,
        body,
      )
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
        const deleted = await collectionsService.deleteCollection(id, user.id)
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

export default collectionsRouter
