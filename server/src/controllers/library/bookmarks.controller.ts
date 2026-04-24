import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware'
import * as bookmarksService from '../../services/library/bookmarks.service'
import * as sharingService from '../../services/sharing.service'

/**
 * Per-collection write guard. The bookmark controller touches one or more
 * collections in a single request; each must be writable by the caller.
 * Throws the standard sharing-service errors so the catch blocks below can
 * map them uniformly to 403/404 responses.
 */
async function assertCanWriteCollections(userId: string, collectionIds: string[]) {
  for (const cid of collectionIds) {
    await sharingService.requireWriteAccessToCollection(userId, cid)
  }
}

function mapSharingError(
  err: unknown,
  // Elysia's `set` is a wider type than we need here — we only ever
  // mutate `status`. Accept a minimal structural type so the helper is
  // portable across handlers without pulling Elysia's internal types.
  set: { status?: unknown },
): { error: string } | null {
  if (err instanceof sharingService.CollectionAccessDeniedError) {
    set.status = 404
    return { error: 'Collection not found' }
  }
  if (err instanceof sharingService.InsufficientRoleError) {
    set.status = 403
    return { error: 'Viewer role cannot modify this collection' }
  }
  return null
}

const bookmarksRouter = new Elysia({ prefix: '/bookmarks' })
  .use(requireAuth)

  // Create a new bookmark and assign to collections
  .post(
    '/',
    async ({ body, user, set }) => {
      // Ensure the externalIds contains at least osm
      if (!body.externalIds || !body.externalIds.osm) {
        set.status = 400
        return { error: 'Missing required OSM ID in externalIds' }
      }

      if (!body.collectionIds || body.collectionIds.length === 0) {
        set.status = 400
        return { error: 'Missing required collectionIds in body' }
      }

      try {
        await assertCanWriteCollections(user.id, body.collectionIds)
        const createdBookmark = await bookmarksService.createBookmark(
          {
            ...body,
            userId: user.id,
          },
          body.collectionIds,
        )
        set.status = 201
        return createdBookmark
      } catch (error) {
        const mapped = mapSharingError(error, set)
        if (mapped) return mapped
        set.status = 500
        return { error: 'Failed to create bookmark' } // TODO: Improve error handling
      }
    },
    {
      body: t.Object({
        externalIds: t.Record(t.String(), t.String()),
        name: t.String(),
        address: t.Optional(t.String()),
        lat: t.Number(),
        lng: t.Number(),
        icon: t.Optional(t.String()),
        iconColor: t.Optional(t.String()),
        presetType: t.Optional(
          t.Union([t.Literal('home'), t.Literal('work'), t.Literal('school')]),
        ),
        collectionIds: t.Array(t.String()),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Create a new bookmark',
      },
    },
  )

  // Update an existing bookmark (using PUT due to CORS issues with PATCH)
  .put(
    '/:id',
    async ({ params: { id }, body, user, set }) => {
      // Keep validation for empty body if desired, though PUT often implies full replacement
      // However, we are using it for partial updates here.
      if (Object.keys(body).length === 0) {
        set.status = 400
        return { error: 'Request body cannot be empty' }
      }

      try {
        // If the caller is reassigning collections, both the additions AND
        // the removals require editor+ on the respective collections.
        // Without checking the diff, a viewer could send
        // `collectionIds: []` and silently unlink the bookmark from a
        // collection they only have read access to. So: compute the
        // current set, diff against the new set, and gate on the union.
        if (body.collectionIds) {
          const currentIds = (
            await bookmarksService.getCollectionsForBookmark(id, user.id)
          ).map((c) => c.id)
          const newIds = new Set(body.collectionIds)
          const scope = new Set<string>(body.collectionIds)
          for (const cid of currentIds) if (!newIds.has(cid)) scope.add(cid)
          await assertCanWriteCollections(user.id, Array.from(scope))
        }

        const updated = await bookmarksService.updateBookmark(id, user.id, body)

        // Service logic remains the same (handles deletion if orphaned)
        if (updated === undefined) {
          // Service error
          set.status = 404
          return { error: 'Bookmark not found or update failed' }
        } else if (updated === null) {
          // Deleted by service
          set.status = 204
          return
        }

        // Success
        return updated
      } catch (err) {
        const mapped = mapSharingError(err, set)
        if (mapped) return mapped
        throw err
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      // Keep the t.Partial schema, as we are effectively using PUT for partial updates
      body: t.Partial(
        t.Object({
          name: t.String(),
          address: t.Optional(t.String()),
          lat: t.Number(),
          lng: t.Number(),
          icon: t.String(),
          iconColor: t.String(),
          presetType: t.Union([
            t.Literal('home'),
            t.Literal('work'),
            t.Literal('school'),
            t.Null(),
          ]),
          collectionIds: t.Array(t.String()),
        }),
      ),
      detail: {
        tags: ['Library'],
        summary: 'Update a bookmark',
      },
    },
  )

  // DELETE endpoint remains for removing from specific collections (optional, maybe remove later if PATCH covers all cases)
  .delete(
    '/:id',
    async ({ params: { id }, body, user, set }) => {
      if (!body.collectionIds || body.collectionIds.length === 0) {
        set.status = 400
        return { error: 'Missing required collectionIds in body' }
      }
      try {
        await assertCanWriteCollections(user.id, body.collectionIds)
        const success = await bookmarksService.removeBookmarkFromCollections(
          id,
          body.collectionIds,
          user.id,
        )
        if (!success) {
          set.status = 404
          return { error: 'Bookmark not found or removal failed' }
        }
        set.status = 204 // Success, no content
      } catch (error) {
        const mapped = mapSharingError(error, set)
        if (mapped) return mapped
        set.status = 500
        return { error: 'Failed to remove bookmark from collections' }
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        collectionIds: t.Array(t.String()),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Remove bookmark from collections',
      },
    },
  )

  // Get collections for a bookmark
  .get(
    '/:id/collections',
    async ({ params: { id }, user }) => {
      const collections = await bookmarksService.getCollectionsForBookmark(
        id,
        user.id,
      )
      return collections
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Get collections for a bookmark',
      },
    },
  )

export default bookmarksRouter
