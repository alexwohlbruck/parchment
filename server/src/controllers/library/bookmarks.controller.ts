import { Elysia, t } from 'elysia'
import { requireAuth } from '../../middleware/auth.middleware'
import * as bookmarksService from '../../services/library/bookmarks.service'

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

      try {
        const createdBookmark = await bookmarksService.createBookmark(
          {
            ...body,
            userId: user.id,
          },
          body.collectionIds,
          user.id,
        )
        set.status = 201
        return createdBookmark
      } catch (error) {
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
        collectionIds: t.Optional(t.Array(t.String())),
      }),
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
    },
  )

export default bookmarksRouter
