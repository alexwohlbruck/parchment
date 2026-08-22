import { Elysia, t } from 'elysia'
import { permissions } from '../../middleware/auth.middleware.js'
import { PermissionId } from '../../types/auth.types'
import * as canvasesService from '../../services/library/canvases.service'
import { i18nPlugin } from '../../lib/i18n/plugin'

/**
 * Canvases — user-built maps made of stacked layers.
 *
 * Shaped like the routes controller: create mints an empty row so the client
 * can derive its per-canvas encryption keys, then PUT writes the encrypted
 * metadata and the body (cleartext for `server-key`, an envelope string for
 * `user-e2ee`).
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
        metadataEncrypted: t.Optional(t.String()),
        metadataKeyVersion: t.Optional(t.Number()),
        // The body is a document, not a queried structure — see the schema
        // header. Validating its shape here would only duplicate the client's
        // own types and go stale the first time a layer kind is added.
        body: t.Optional(t.Union([t.Any(), t.Null()])),
        bodyEncrypted: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      detail: { tags: ['Library'], summary: 'Update a canvas' },
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
