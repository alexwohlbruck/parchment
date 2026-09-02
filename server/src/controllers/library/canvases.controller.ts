import { Elysia, t } from 'elysia'
import { permissions } from '../../middleware/auth.middleware.js'
import { PermissionId } from '../../types/auth.types'
import * as canvasesService from '../../services/library/canvases.service'
import { i18nPlugin } from '../../lib/i18n/plugin'

/**
 * Canvases — user-built maps made of stacked layers.
 *
 * Shaped like the routes controller: create mints an empty row so the client
 * can derive its per-canvas encryption keys, then PUT writes the record. What
 * that record looks like depends on the scheme — cleartext columns for
 * `server-key`, envelopes for `user-e2ee` — and `change-scheme` moves a canvas
 * between the two atomically.
 */
const canvasesRouter = new Elysia({ prefix: '/canvases' })
  .use(i18nPlugin)
  .use(permissions(PermissionId.LIBRARY_WRITE))

  .get(
    '/',
    async ({ user }) => {
      return await canvasesService.getCanvases(user.id)
    },
    {
      detail: { tags: ['Library'], summary: 'Get all canvases' },
    },
  )

  .post(
    '/',
    async ({ body, user }) => {
      return await canvasesService.createCanvas({ ...body, userId: user.id })
    },
    {
      body: t.Object({
        scheme: t.Optional(
          t.Union([t.Literal('server-key'), t.Literal('user-e2ee')]),
        ),
        isPublic: t.Optional(t.Boolean()),
      }),
      detail: { tags: ['Library'], summary: 'Create a canvas' },
    },
  )

  .get(
    '/:id',
    async ({ params: { id }, user, set, t }) => {
      const canvas = await canvasesService.getCanvasById(id, user.id)
      if (!canvas) {
        set.status = 404
        return { error: t('errors.library.canvasNotFound') }
      }
      return canvas
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Library'], summary: 'Get a canvas by ID' },
    },
  )

  .put(
    '/:id',
    async ({ params: { id }, body, user, set, t }) => {
      const updated = await canvasesService.updateCanvas(id, user.id, body)
      if (!updated) {
        set.status = 404
        return { error: t('errors.library.canvasNotFound') }
      }
      return updated
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        isPublic: t.Optional(t.Boolean()),
        // server-key metadata. Nullable so a scheme switch can clear it.
        name: t.Optional(t.Union([t.String(), t.Null()])),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        icon: t.Optional(t.Union([t.String(), t.Null()])),
        iconColor: t.Optional(t.Union([t.String(), t.Null()])),
        // The body is a document, not a queried structure — see the schema
        // header. Validating its shape here would only duplicate the client's
        // own types and go stale the first time a layer kind is added.
        body: t.Optional(t.Union([t.Any(), t.Null()])),
        metadataEncrypted: t.Optional(t.Union([t.String(), t.Null()])),
        metadataKeyVersion: t.Optional(t.Number()),
        bodyEncrypted: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: {
        tags: ['Library'],
        summary: 'Update a canvas',
        description:
          'Returns the canvas without its body: a canvas saves itself as it ' +
          'is edited, and the document it has just sent is the one thing the ' +
          'client already holds. Read it back with GET /canvases/:id.',
      },
    },
  )

  // Move a canvas between encryption schemes. The client re-packages the
  // whole record under the target scheme — it holds the only keys — and the
  // server swaps it in atomically. Owner only.
  .post(
    '/:id/change-scheme',
    async ({ params: { id }, body, user, set, t }) => {
      try {
        const updated = await canvasesService.changeCanvasScheme({
          canvasId: id,
          userId: user.id,
          ...body,
        })
        if (!updated) {
          set.status = 404
          return { error: t('errors.library.canvasNotFound') }
        }
        return updated
      } catch (err) {
        if (err instanceof canvasesService.SchemeAlreadySetError) {
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
        name: t.Optional(t.Union([t.String(), t.Null()])),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        icon: t.Optional(t.Union([t.String(), t.Null()])),
        iconColor: t.Optional(t.Union([t.String(), t.Null()])),
        body: t.Optional(t.Union([t.Any(), t.Null()])),
        metadataEncrypted: t.Optional(t.Union([t.String(), t.Null()])),
        metadataKeyVersion: t.Optional(t.Number()),
        bodyEncrypted: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: { tags: ['Library'], summary: 'Change a canvas encryption scheme' },
    },
  )

  // Public links. Server-key only — see the service.
  .post(
    '/:id/public-link',
    async ({ params: { id }, user, set, t }) => {
      try {
        const link = await canvasesService.createPublicLink(id, user.id)
        if (!link) {
          set.status = 404
          return { error: t('errors.library.canvasNotFound') }
        }
        return link
      } catch (err) {
        if (err instanceof canvasesService.PublicLinkNotAllowedOnE2eeError) {
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
        summary: 'Create a public link for a canvas',
      },
    },
  )

  .delete(
    '/:id/public-link',
    async ({ params: { id }, user, set, t }) => {
      const revoked = await canvasesService.revokePublicLink(id, user.id)
      if (!revoked) {
        set.status = 404
        return { error: t('errors.library.canvasNotFound') }
      }
      return { success: true }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Library'],
        summary: 'Revoke a canvas public link',
      },
    },
  )

  .delete(
    '/:id',
    async ({ params: { id }, user, set, t }) => {
      const deleted = await canvasesService.deleteCanvas(id, user.id)
      if (!deleted) {
        set.status = 404
        return { error: t('errors.library.canvasNotFound') }
      }
      return { success: true }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Library'], summary: 'Delete a canvas' },
    },
  )

export default canvasesRouter
