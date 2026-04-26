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

export default publicController
