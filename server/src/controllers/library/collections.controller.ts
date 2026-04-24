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

  // Create a new collection. Metadata (name/description/icon/iconColor)
  // is E2EE — client encrypts locally, server only stores the envelope.
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
        metadataEncrypted: t.String(),
        metadataKeyVersion: t.Optional(t.Number()),
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

  // Update an existing collection. Accepts the encrypted metadata
  // envelope (replaces whatever was there) and/or the `isPublic` flag.
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
        metadataEncrypted: t.Optional(t.String()),
        metadataKeyVersion: t.Optional(t.Number()),
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

  // Change a collection's encryption scheme atomically. The client
  // packages the whole migration (re-encrypted or decrypted point set
  // under the new scheme + rewrapped share envelopes + new metadata
  // envelope) and the server applies it in one transaction. Owner only.
  .post(
    '/:id/change-scheme',
    async ({ params: { id }, body, user, set }) => {
      try {
        const updated = await collectionsService.changeCollectionScheme({
          collectionId: id,
          userId: user.id,
          targetScheme: body.targetScheme,
          newMetadataEncrypted: body.newMetadataEncrypted,
          newMetadataKeyVersion: body.newMetadataKeyVersion,
          newEncryptedPoints: body.newEncryptedPoints,
          newBookmarks: body.newBookmarks,
          updatedShareEnvelopes: body.updatedShareEnvelopes,
        })
        if (!updated) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        return updated
      } catch (err) {
        if (err instanceof collectionsService.SchemeAlreadySetError) {
          set.status = 400
          return { error: err.message }
        }
        throw err
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        targetScheme: t.Union([
          t.Literal('server-key'),
          t.Literal('user-e2ee'),
        ]),
        newMetadataEncrypted: t.String(),
        newMetadataKeyVersion: t.Number(),
        newEncryptedPoints: t.Optional(
          t.Array(
            t.Object({
              id: t.Optional(t.String()),
              encryptedData: t.String(),
              nonce: t.String(),
            }),
          ),
        ),
        newBookmarks: t.Optional(
          t.Array(
            t.Object({
              id: t.Optional(t.String()),
              externalIds: t.Record(t.String(), t.String()),
              name: t.String(),
              address: t.Optional(t.Nullable(t.String())),
              lat: t.Number(),
              lng: t.Number(),
              icon: t.Optional(t.String()),
              iconColor: t.Optional(t.String()),
              presetType: t.Optional(t.Nullable(t.String())),
            }),
          ),
        ),
        updatedShareEnvelopes: t.Array(
          t.Object({
            recipientHandle: t.String(),
            encryptedData: t.String(),
            nonce: t.String(),
          }),
        ),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Change a collection\'s encryption scheme',
      },
    },
  )

  // Rotate the collection's encryption key. Atomic transaction that
  // swaps metadata + every encrypted point + every remaining share's
  // rewrapped envelope, and deletes revoked recipients' shares. Owner
  // only. See `rotateCollectionKey` in the service for the full contract.
  //
  // The client stages the whole rotation under a fresh key before
  // calling this endpoint — the server never touches plaintext.
  .post(
    '/:id/rotate-key',
    async ({ params: { id }, body, user, set }) => {
      try {
        const updated = await collectionsService.rotateCollectionKey({
          collectionId: id,
          userId: user.id,
          newMetadataEncrypted: body.newMetadataEncrypted,
          newMetadataKeyVersion: body.newMetadataKeyVersion,
          newEncryptedPoints: body.newEncryptedPoints,
          updatedShareEnvelopes: body.updatedShareEnvelopes,
          revokeRecipientHandles: body.revokeRecipientHandles,
        })
        if (!updated) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        return updated
      } catch (err) {
        if (err instanceof collectionsService.RotationVersionError) {
          set.status = 400
          return { error: err.message }
        }
        throw err
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        newMetadataEncrypted: t.String(),
        newMetadataKeyVersion: t.Number(),
        newEncryptedPoints: t.Array(
          t.Object({
            id: t.Optional(t.String()),
            encryptedData: t.String(),
            nonce: t.String(),
          }),
        ),
        updatedShareEnvelopes: t.Array(
          t.Object({
            recipientHandle: t.String(),
            encryptedData: t.String(),
            nonce: t.String(),
          }),
        ),
        revokeRecipientHandles: t.Array(t.String()),
      }),
      detail: {
        tags: ['Library'],
        summary:
          'Rotate the collection key: re-encrypt content, rewrap remaining shares, drop revoked',
      },
    },
  )

  // Mint a public-link token on a collection. Owner only, server-key
  // only. Returns the token on success; 400 for user-e2ee; 404 if the
  // caller doesn't own the collection.
  .post(
    '/:id/public-link',
    async ({ params: { id }, user, set }) => {
      try {
        const result = await collectionsService.createPublicLink(id, user.id)
        if (!result) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        return result
      } catch (err) {
        if (err instanceof collectionsService.PublicLinkNotAllowedOnE2eeError) {
          set.status = 400
          return { error: err.message }
        }
        throw err
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Library'],
        summary: 'Mint a public-link token for this collection',
      },
    },
  )

  // Revoke the public-link token. Owner only. Idempotent: 204 even if
  // no token was set.
  .delete(
    '/:id/public-link',
    async ({ params: { id }, user, set }) => {
      const revoked = await collectionsService.revokePublicLink(id, user.id)
      if (!revoked) {
        set.status = 404
        return { error: 'Collection not found' }
      }
      set.status = 204
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Library'],
        summary: 'Revoke the public-link token for this collection',
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
