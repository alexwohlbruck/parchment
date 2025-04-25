import { Elysia, t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware.js'
import * as libraryService from '../services/library.service'

const libraryController = new Elysia({ prefix: '/library' })

// ===== Saved Places =====

const placesRouter = new Elysia({ prefix: '/places' })
  .use(requireAuth)

  // Get all saved places for the authenticated user
  .get('/', async ({ user }) => {
    return await libraryService.getSavedPlaces(user.id)
  })

  // Get a single saved place by ID
  .get(
    '/:id',
    async ({ params: { id }, user }) => {
      const place = await libraryService.getSavedPlaceById(id, user.id)
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

  // Get a saved place with its full details
  .get(
    '/:id/details',
    async ({ params: { id }, user }) => {
      const placeWithDetails = await libraryService.getSavedPlaceWithDetails(
        id,
        user.id,
      )
      if (!placeWithDetails) {
        return { error: 'Place not found' }
      }
      return placeWithDetails
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Check if a place is saved by its external ID
  .get(
    '/external/:provider/:externalId',
    async ({ params: { provider, externalId }, user }) => {
      const place = await libraryService.getSavedPlaceByExternalId(
        provider,
        externalId,
        user.id,
      )
      return { isSaved: !!place, place }
    },
    {
      params: t.Object({
        provider: t.String(),
        externalId: t.String(),
      }),
    },
  )

  // Create a new saved place
  .post(
    '/',
    async ({ body, user }) => {
      // Ensure the externalIds contains at least osm
      if (!body.externalIds || !body.externalIds.osm) {
        return { error: 'Missing required OSM ID in externalIds' }
      }

      const createdPlace = await libraryService.createSavedPlace({
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

  // Update an existing saved place
  .patch(
    '/:id',
    async ({ params: { id }, body, user }) => {
      const updated = await libraryService.updateSavedPlace(id, user.id, body)
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
    async ({ params: { id }, user }) => {
      const deleted = await libraryService.unsavePlace(id, user.id)
      if (!deleted) {
        return { error: 'Place not found or delete failed' }
      }
      return { success: true, deleted }
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

// ===== Collections =====

const collectionsRouter = new Elysia({ prefix: '/collections' })
  .use(requireAuth)

  // Get all collections for the authenticated user
  .get('/', async ({ user }) => {
    return await libraryService.getCollections(user.id)
  })

  // Get a single collection by ID
  .get(
    '/:id',
    async ({ params: { id }, user }) => {
      const collection = await libraryService.getCollectionById(id, user.id)
      if (!collection) {
        return { error: 'Collection not found' }
      }
      return collection
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
    async ({ params: { id }, user }) => {
      const deleted = await libraryService.deleteCollection(id, user.id)
      if (!deleted) {
        return { error: 'Collection not found or delete failed' }
      }
      return { success: true, deleted }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get places in a collection
  .get(
    '/:id/places',
    async ({ params: { id }, user }) => {
      const places = await libraryService.getPlacesInCollection(id, user.id)
      return places
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
    async ({ params: { id, placeId }, user }) => {
      try {
        const removed = await libraryService.removePlaceFromCollection(
          placeId,
          id,
          user.id,
        )
        return { success: true, removed }
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

export default libraryController.use(placesRouter).use(collectionsRouter)
