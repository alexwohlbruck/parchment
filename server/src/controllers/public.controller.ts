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
import * as canvasesService from '../services/library/canvases.service'
import { makeIpRateLimit } from '../middleware/rate-limit.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'

const publicController = new Elysia({ prefix: '/public' })
  .use(i18nPlugin)
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
    async ({ params: { token }, set, t }) => {
      const result = await collectionsService.getPublicCollectionByToken(token)
      if (!result) {
        set.status = 404
        return { error: t('errors.notFound.resource') }
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
    async ({ params: { token }, set, t }) => {
      const route = await routesService.getPublicRouteByToken(token)
      if (!route) {
        set.status = 404
        return { error: t('errors.notFound.resource') }
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
  /**
   * GET /public/canvases/:token
   *
   * Resolve a public-link token to a canvas. Server-key only — a private
   * canvas has no readable name or layer stack to render, and refuses to
   * carry a link in the first place. 404 when the token doesn't match.
   */
  .get(
    '/canvases/:token',
    async ({ params: { token }, set, t }) => {
      const canvas = await canvasesService.getPublicCanvasByToken(token)
      if (!canvas) {
        set.status = 404
        return { error: t('errors.notFound.resource') }
      }
      return {
        canvas: {
          id: canvas.id,
          userId: canvas.userId,
          scheme: canvas.scheme,
          name: canvas.name,
          description: canvas.description,
          icon: canvas.icon,
          iconColor: canvas.iconColor,
          body: canvas.body,
          publicRole: canvas.publicRole,
          createdAt: canvas.createdAt,
          updatedAt: canvas.updatedAt,
        },
      }
    },
    {
      params: t.Object({ token: t.String() }),
      detail: {
        tags: ['Public'],
        summary: 'Resolve a public-link token to a canvas',
      },
    },
  )


export default publicController
