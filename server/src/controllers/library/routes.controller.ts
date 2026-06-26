import { Elysia, t } from 'elysia'
import { permissions } from '../../middleware/auth.middleware.js'
import { PermissionId } from '../../types/auth.types'
import * as routesService from '../../services/library/routes.service'

const routesRouter = new Elysia({ prefix: '/routes' })
  .use(permissions(PermissionId.LIBRARY_WRITE))

  // All custom routes owned by the authenticated user.
  .get(
    '/',
    async ({ user }) => {
      return await routesService.getRoutes(user.id)
    },
    {
      detail: { tags: ['Library'], summary: 'Get all custom routes' },
    },
  )

  // Create a route. Two-step like collections: this mints the row (so the
  // client knows the id to derive the per-route metadata/content key), then
  // the client PUTs the encrypted metadata + body.
  .post(
    '/',
    async ({ body, user }) => {
      return await routesService.createRoute({ ...body, userId: user.id })
    },
    {
      body: t.Object({
        mode: t.Optional(
          t.Union([
            t.Literal('walking'),
            t.Literal('cycling'),
            t.Literal('driving'),
          ]),
        ),
        scheme: t.Optional(
          t.Union([t.Literal('server-key'), t.Literal('user-e2ee')]),
        ),
        isPublic: t.Optional(t.Boolean()),
      }),
      detail: { tags: ['Library'], summary: 'Create a custom route' },
    },
  )

  .get(
    '/:id',
    async ({ params: { id }, user, set }) => {
      const route = await routesService.getRouteById(id, user.id)
      if (!route) {
        set.status = 404
        return { error: 'Route not found' }
      }
      return route
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Library'], summary: 'Get a custom route by ID' },
    },
  )

  // Update metadata envelope, mode, body/stats (server-key) or encrypted
  // body (user-e2ee), or isPublic. Owner-only.
  .put(
    '/:id',
    async ({ params: { id }, body, user, set }) => {
      const updated = await routesService.updateRoute(id, user.id, body)
      if (!updated) {
        set.status = 404
        return { error: 'Route not found or update failed' }
      }
      return updated
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        mode: t.Optional(
          t.Union([
            t.Literal('walking'),
            t.Literal('cycling'),
            t.Literal('driving'),
          ]),
        ),
        isPublic: t.Optional(t.Boolean()),
        metadataEncrypted: t.Optional(t.String()),
        metadataKeyVersion: t.Optional(t.Number()),
        // jsonb body for server-key routes
        body: t.Optional(t.Nullable(t.Any())),
        distance: t.Optional(t.Nullable(t.Number())),
        duration: t.Optional(t.Nullable(t.Number())),
        elevationGain: t.Optional(t.Nullable(t.Number())),
        elevationLoss: t.Optional(t.Nullable(t.Number())),
        // encrypted body for user-e2ee routes
        bodyEncrypted: t.Optional(t.Nullable(t.String())),
        bodyNonce: t.Optional(t.Nullable(t.String())),
      }),
      detail: { tags: ['Library'], summary: 'Update a custom route' },
    },
  )

  .delete(
    '/:id',
    async ({ params: { id }, user, set }) => {
      const deleted = await routesService.deleteRoute(id, user.id)
      if (!deleted) {
        set.status = 404
        return { error: 'Route not found or delete failed' }
      }
      set.status = 204
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Library'], summary: 'Delete a custom route' },
    },
  )

  // Mint a public-link token. Owner-only, server-key only.
  .post(
    '/:id/public-link',
    async ({ params: { id }, user, set }) => {
      try {
        const result = await routesService.createPublicLink(id, user.id)
        if (!result) {
          set.status = 404
          return { error: 'Route not found' }
        }
        return result
      } catch (err) {
        if (err instanceof routesService.PublicLinkNotAllowedOnE2eeError) {
          set.status = 400
          return { error: err.message }
        }
        throw err
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Library'], summary: 'Mint a public link for a route' },
    },
  )

  .delete(
    '/:id/public-link',
    async ({ params: { id }, user, set }) => {
      const revoked = await routesService.revokePublicLink(id, user.id)
      if (!revoked) {
        set.status = 404
        return { error: 'Route not found' }
      }
      set.status = 204
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Library'], summary: 'Revoke a route public link' },
    },
  )

export default routesRouter
