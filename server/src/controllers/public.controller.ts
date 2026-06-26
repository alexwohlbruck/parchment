/**
 * Public (unauthenticated) controllers.
 *
 * Hosts resolvers for content the owner has explicitly minted a public-
 * link token for. No session, no friendship — just the token and
 * whatever the owner chose to expose via that token's role.
 *
 * Rate-limited per-IP so a leaked token can't be used to mine arbitrary
 * fan-out traffic. The token entropy (32 random bytes) makes the space
 * unguessable; the limit is a defense-in-depth belt on top.
 */

import { Elysia, t } from 'elysia'
import * as collectionsService from '../services/library/collections.service'
import * as routesService from '../services/library/routes.service'
import { makeIpRateLimit } from '../middleware/rate-limit.middleware'

const publicController = new Elysia({ prefix: '/public' })
  .use(
    makeIpRateLimit({
      name: 'public-collection-resolve',
      limit: 120,
      windowMs: 60_000,
    }),
  )
  /**
   * GET /public/collections/:token
   *
   * Resolve a public-link token to the collection + its bookmarks. 404
   * when the token doesn't match (revoked, never existed, or the
   * collection switched to user-e2ee and had its token cleared).
   *
   * Returns only public-safe fields. Owner id is included so the UI can
   * show attribution ("shared by alex@parchment.app") but no
   * server-private metadata leaks.
   */
  .get(
    '/collections/:token',
    async ({ params: { token }, set }) => {
      const result = await collectionsService.getPublicCollectionByToken(token)
      if (!result) {
        set.status = 404
        return { error: 'Not found' }
      }
      const { collection, bookmarks } = result
      return {
        collection: {
          id: collection.id,
          userId: collection.userId,
          scheme: collection.scheme,
          metadataEncrypted: collection.metadataEncrypted,
          metadataKeyVersion: collection.metadataKeyVersion,
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
          publicRole: collection.publicRole,
        },
        bookmarks,
      }
    },
    {
      params: t.Object({ token: t.String() }),
      detail: {
        tags: ['Public'],
        summary: 'Resolve a public-link token to a collection',
      },
    },
  )
  /**
   * GET /public/routes/:token
   *
   * Resolve a public-link token to a custom route. Server-key only — the
   * cleartext `body` (waypoints + geometry + stats) is what the shared view
   * renders. `metadataEncrypted` is passed through like collections; the
   * shared view falls back to a generic title when it can't be decrypted.
   * 404 when the token doesn't match.
   */
  .get(
    '/routes/:token',
    async ({ params: { token }, set }) => {
      const route = await routesService.getPublicRouteByToken(token)
      if (!route) {
        set.status = 404
        return { error: 'Not found' }
      }
      return {
        route: {
          id: route.id,
          userId: route.userId,
          mode: route.mode,
          scheme: route.scheme,
          metadataEncrypted: route.metadataEncrypted,
          metadataKeyVersion: route.metadataKeyVersion,
          body: route.body,
          distance: route.distance,
          duration: route.duration,
          elevationGain: route.elevationGain,
          elevationLoss: route.elevationLoss,
          publicRole: route.publicRole,
          createdAt: route.createdAt,
          updatedAt: route.updatedAt,
        },
      }
    },
    {
      params: t.Object({ token: t.String() }),
      detail: {
        tags: ['Public'],
        summary: 'Resolve a public-link token to a custom route',
      },
    },
  )

export default publicController
