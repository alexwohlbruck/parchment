import { Elysia, t } from 'elysia'
import { permissions } from '../../middleware/auth.middleware'
import { PermissionId } from '../../types/auth.types'
import * as bookmarksService from '../../services/library/bookmarks.service'
import * as sharingService from '../../services/sharing.service'
import { i18nPlugin } from '../../lib/i18n/plugin'
import type { TranslateFn } from '../../lib/i18n/i18n.types'

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
  t: TranslateFn,
): { error: string } | null {
  if (err instanceof sharingService.CollectionAccessDeniedError) {
    set.status = 404
    return { error: t('errors.library.collectionNotFound') }
  }
  if (err instanceof sharingService.InsufficientRoleError) {
    set.status = 403
    return { error: t('errors.library.collectionViewerReadOnly') }
  }
  return null
}

const bookmarksRouter = new Elysia({ prefix: '/bookmarks' })
  .use(i18nPlugin)
  .use(permissions(PermissionId.LIBRARY_WRITE))

  // Create a new bookmark and assign to collections
  .post(
    '/',
    async ({ body, user, set, t }) => {
      if (!body.externalIds || Object.keys(body.externalIds).length === 0) {
        set.status = 400
        return { error: t('errors.library.externalIdsRequired') }
      }

      // An empty collectionIds array is allowed: standalone bookmarks (e.g.
      // frequents) live outside any collection.

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
        const mapped = mapSharingError(error, set, t)
        if (mapped) return mapped
        set.status = 500
        return { error: t('errors.library.bookmarkCreateFailed') } // TODO: Improve error handling
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
        iconPack: t.Optional(
          t.Union([t.Literal('lucide'), t.Literal('maki')]),
        ),
        iconColor: t.Optional(t.String()),
        frequentType: t.Optional(
          t.Union([t.Literal('home'), t.Literal('work'), t.Literal('school'), t.Literal('custom')]),
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
    async ({ params: { id }, body, user, set, t }) => {
      // Keep validation for empty body if desired, though PUT often implies full replacement
      // However, we are using it for partial updates here.
      if (Object.keys(body).length === 0) {
        set.status = 400
        return { error: t('errors.library.emptyBody') }
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
          return { error: t('errors.library.bookmarkUpdateFailed') }
        } else if (updated === null) {
          // Deleted by service
          set.status = 204
          return
        }

        // Success
        return updated
      } catch (err) {
        const mapped = mapSharingError(err, set, t)
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
          // `icon` / `iconPack` / `iconColor` are deliberately absent: they
          // describe the place, not a user preference, and are stamped from
          // the POI when the bookmark is created. Frequents get their look
          // from their `frequentType` at render time, not from these columns.
          frequentType: t.Union([
            t.Literal('home'),
            t.Literal('work'),
            t.Literal('school'), t.Literal('custom'),
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
    async ({ params: { id }, body, user, set, t }) => {
      if (!body.collectionIds || body.collectionIds.length === 0) {
        set.status = 400
        return { error: t('errors.library.collectionIdsRequired') }
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
          return { error: t('errors.library.bookmarkRemoveFailed') }
        }
        set.status = 204 // Success, no content
      } catch (error) {
        const mapped = mapSharingError(error, set, t)
        if (mapped) return mapped
        set.status = 500
        return { error: t('errors.library.bookmarkCollectionsRemoveFailed') }
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

  // Every bookmark the caller owns, each with its `collectionIds`. Hydrates
  // the client's bookmark store on boot and feeds the saved-places map layer.
  .get(
    '/',
    async ({ user }) => {
      return await bookmarksService.getBookmarks(user.id)
    },
    {
      detail: {
        tags: ['Library'],
        summary: "Get all of the caller's bookmarks",
      },
    },
  )

  // Get collections for a bookmark
  // List the caller's frequents (standalone, not in any collection).
  .get(
    '/frequents',
    async ({ user }) => {
      return await bookmarksService.getFrequentBookmarks(user.id)
    },
    {
      detail: {
        tags: ['Library'],
        summary: "Get the caller's frequent bookmarks",
      },
    },
  )

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
