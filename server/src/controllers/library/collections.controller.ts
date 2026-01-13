import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as collectionsService from '../../services/library/collections.service'
import * as encryptedPointsService from '../../services/library/encrypted-points.service'

const collectionsRouter = new Elysia({ prefix: '/collections' })
  .use(requireAuth)

  // Get all collections for the authenticated user
  .get(
    '/',
    async ({ user }) => {
      return await collectionsService.getCollections(user.id)
    },
    {
      detail: {
        tags: ['Library'],
        summary: 'Get all collections',
      },
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
      detail: {
        tags: ['Library'],
        summary: 'Create a new collection',
      },
    },
  )

  // Get the default collection (previously bookmarks)
  .get(
    '/default',
    async ({ user }) => {
      const defaultCollection =
        await collectionsService.ensureDefaultCollection(user.id)

      const bookmarks = await collectionsService.getBookmarksInCollection(
        defaultCollection.id,
        user.id,
      )

      return {
        ...defaultCollection,
        bookmarks,
      }
    },
    {
      detail: {
        tags: ['Library'],
        summary: 'Get the default collection',
      },
    },
  )

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
      detail: {
        tags: ['Library'],
        summary: 'Get a collection by ID',
      },
    },
  )

  // Update an existing collection
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
      detail: {
        tags: ['Library'],
        summary: 'Update a collection',
      },
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
      detail: {
        tags: ['Library'],
        summary: 'Delete a collection',
      },
    },
  )

  // Toggle sensitive mode for a collection
  .put(
    '/:id/sensitive',
    async ({ params: { id }, body, user, set }) => {
      const updated = await encryptedPointsService.setCollectionSensitive(
        id,
        user.id,
        body.isSensitive,
      )
      if (!updated) {
        set.status = 404
        return { error: 'Collection not found' }
      }
      return { success: true, isSensitive: body.isSensitive }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        isSensitive: t.Boolean(),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Toggle sensitive mode for a collection',
      },
    },
  )

  // Get encrypted points in a collection
  .get(
    '/:id/encrypted-points',
    async ({ params: { id }, user }) => {
      const points =
        await encryptedPointsService.getEncryptedPointsInCollection(id, user.id)
      return { points }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Get encrypted points in a collection',
      },
    },
  )

  // Create encrypted point in a collection
  .post(
    '/:id/encrypted-points',
    async ({ params: { id }, body, user, set }) => {
      try {
        const point = await encryptedPointsService.createEncryptedPoint({
          collectionId: id,
          userId: user.id,
          encryptedData: body.encryptedData,
          nonce: body.nonce,
        })
        return point
      } catch (err) {
        set.status = 400
        return { error: (err as Error).message }
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        encryptedData: t.String(),
        nonce: t.String(),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Create an encrypted point',
      },
    },
  )

  // Update an encrypted point
  .put(
    '/:id/encrypted-points/:pointId',
    async ({ params, body, user, set }) => {
      const point = await encryptedPointsService.updateEncryptedPoint(
        params.pointId,
        user.id,
        body.encryptedData,
        body.nonce,
      )
      if (!point) {
        set.status = 404
        return { error: 'Point not found' }
      }
      return point
    },
    {
      params: t.Object({
        id: t.String(),
        pointId: t.String(),
      }),
      body: t.Object({
        encryptedData: t.String(),
        nonce: t.String(),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Update an encrypted point',
      },
    },
  )

  // Delete an encrypted point
  .delete(
    '/:id/encrypted-points/:pointId',
    async ({ params, user, set }) => {
      const deleted = await encryptedPointsService.deleteEncryptedPoint(
        params.pointId,
        user.id,
      )
      if (!deleted) {
        set.status = 404
        return { error: 'Point not found' }
      }
      set.status = 204
    },
    {
      params: t.Object({
        id: t.String(),
        pointId: t.String(),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Delete an encrypted point',
      },
    },
  )

export default collectionsRouter
