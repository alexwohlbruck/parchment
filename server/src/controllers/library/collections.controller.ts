import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as collectionsService from '../../services/library/collections.service'
import * as encryptedPointsService from '../../services/library/encrypted-points.service'
import * as sharingService from '../../services/sharing.service'

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

  // Collections the caller has been granted access to by someone else.
  // Owner is somebody else; the returned `role` tells the client whether
  // write actions should be enabled in the UI.
  .get(
    '/shared-with-me',
    async ({ user }) => {
      const items = await collectionsService.getSharedCollections(user.id)
      return items
    },
    {
      detail: {
        tags: ['Library'],
        summary: 'List collections shared to the caller',
      },
    },
  )

  // Get a single collection by ID. Returns the row with an extra `role`
  // field of 'owner' | 'editor' | 'viewer' — clients use it to gate write
  // UI. Responds 404 when the caller neither owns nor has an active share.
  .get(
    '/:id',
    async ({ params: { id }, user, set }) => {
      const collection = await collectionsService.getAccessibleCollection(
        id,
        user.id,
      )
      if (!collection) {
        set.status = 404
        return { error: 'Collection not found' }
      }

      // Bookmarks live on the owning user's rows — use the owner's id when
      // the caller is a recipient so the join finds the plaintext rows.
      // For user-e2ee collections bookmarks is empty (encrypted_points is
      // the storage); the client fetches those separately.
      const bookmarks = await collectionsService.getBookmarksInCollection(
        id,
        collection.userId,
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
  // Owner or editor may write; viewers get 403.
  .put(
    '/:id',
    async ({ params: { id }, body, user, set }) => {
      try {
        const role = await sharingService.requireWriteAccessToCollection(
          user.id,
          id,
        )
        // Only the owner can flip the `isPublic` flag — that's a privilege
        // bit, not a content edit. Editors can update the encrypted
        // metadata envelope only.
        const updates =
          role === 'owner' ? body : { ...body, isPublic: undefined }
        const updated = await collectionsService.updateCollection(
          id,
          // Always pass the collection's true owner id so the WHERE clause
          // finds the row — the role check above guarantees the caller is
          // allowed to write.
          role === 'owner' ? user.id : (await collectionsService
            .getAccessibleCollection(id, user.id))!.userId,
          updates,
        )
        if (!updated) {
          set.status = 404
          return { error: 'Collection not found or update failed' }
        }
        return updated
      } catch (err) {
        if (err instanceof sharingService.CollectionAccessDeniedError) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        if (err instanceof sharingService.InsufficientRoleError) {
          set.status = 403
          return { error: 'Viewer role cannot update this collection' }
        }
        throw err
      }
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
          expectedUpdatedAt: body.expectedUpdatedAt,
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
        if (err instanceof collectionsService.CollectionVersionConflictError) {
          set.status = 409
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
        expectedUpdatedAt: t.Optional(t.String()),
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

  // Create encrypted point in a collection. Editor or owner only.
  .post(
    '/:id/encrypted-points',
    async ({ params: { id }, body, user, set }) => {
      try {
        await sharingService.requireWriteAccessToCollection(user.id, id)
        const point = await encryptedPointsService.createEncryptedPoint({
          collectionId: id,
          // Point rows are written under the collection owner's id so the
          // existing owner-scoped reads still join correctly when an editor
          // is the one creating the row.
          userId: (await collectionsService.getAccessibleCollection(
            id,
            user.id,
          ))!.userId,
          encryptedData: body.encryptedData,
          nonce: body.nonce,
        })
        return point
      } catch (err) {
        if (err instanceof sharingService.CollectionAccessDeniedError) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        if (err instanceof sharingService.InsufficientRoleError) {
          set.status = 403
          return { error: 'Viewer role cannot add encrypted points' }
        }
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

  // Update an encrypted point. Editor or owner only.
  .put(
    '/:id/encrypted-points/:pointId',
    async ({ params, body, user, set }) => {
      try {
        await sharingService.requireWriteAccessToCollection(user.id, params.id)
        const ownerId = (await collectionsService.getAccessibleCollection(
          params.id,
          user.id,
        ))!.userId
        const point = await encryptedPointsService.updateEncryptedPoint(
          params.pointId,
          ownerId,
          body.encryptedData,
          body.nonce,
        )
        if (!point) {
          set.status = 404
          return { error: 'Point not found' }
        }
        return point
      } catch (err) {
        if (err instanceof sharingService.CollectionAccessDeniedError) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        if (err instanceof sharingService.InsufficientRoleError) {
          set.status = 403
          return { error: 'Viewer role cannot update encrypted points' }
        }
        throw err
      }
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

  // Delete an encrypted point. Editor or owner only.
  .delete(
    '/:id/encrypted-points/:pointId',
    async ({ params, user, set }) => {
      try {
        await sharingService.requireWriteAccessToCollection(user.id, params.id)
        const ownerId = (await collectionsService.getAccessibleCollection(
          params.id,
          user.id,
        ))!.userId
        const deleted = await encryptedPointsService.deleteEncryptedPoint(
          params.pointId,
          ownerId,
        )
        if (!deleted) {
          set.status = 404
          return { error: 'Point not found' }
        }
        set.status = 204
      } catch (err) {
        if (err instanceof sharingService.CollectionAccessDeniedError) {
          set.status = 404
          return { error: 'Collection not found' }
        }
        if (err instanceof sharingService.InsufficientRoleError) {
          set.status = 403
          return { error: 'Viewer role cannot delete encrypted points' }
        }
        throw err
      }
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
