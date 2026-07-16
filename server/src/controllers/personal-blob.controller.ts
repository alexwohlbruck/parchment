import Elysia, { t } from 'elysia'
import { permissions } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'
import {
  getPersonalBlob,
  putPersonalBlob,
  deletePersonalBlob,
  listPersonalBlobTypes,
} from '../services/personal-blob.service'

/**
 * Personal-blob storage.
 *
 * Opaque container for client-encrypted data keyed by blobType.
 * The server doesn't know or care what's inside.
 */
const app = new Elysia()

const ALLOWED_TYPE_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/

app.use(permissions(PermissionId.LIBRARY_READ)).get(
  '/me/blobs',
  async ({ user }) => {
    const rows = await listPersonalBlobTypes(user.id)
    return { blobs: rows }
  },
  {
    detail: {
      tags: ['PersonalBlob'],
      description:
        'List every personal-blob type the caller has stored, plus its ' +
        'current kmVersion. Used by the client-side rotation orchestrator.',
    },
  },
)

app.use(permissions(PermissionId.LIBRARY_READ)).get(
  '/me/blobs/:type',
  async ({ user, params: { type }, status }) => {
    if (!ALLOWED_TYPE_PATTERN.test(type)) {
      return status(400, { message: 'Invalid blob type' })
    }
    const blob = await getPersonalBlob(user.id, type)
    // A personal blob is a singleton-per-user slot; "not stored yet" is an
    // empty slot, not a missing resource. Return 204 (No Content) so clients
    // (and the network tab) don't treat a fresh/never-synced blob as an error.
    if (!blob) return status(204)
    return blob
  },
  {
    params: t.Object({ type: t.String() }),
    detail: {
      tags: ['PersonalBlob'],
      description:
        'Get a client-encrypted personal blob by type. Returns 204 (No ' +
        'Content) when the caller has no blob of that type yet.',
    },
  },
)

app.use(permissions(PermissionId.LIBRARY_WRITE)).put(
  '/me/blobs/:type',
  async ({ user, params: { type }, body, status }) => {
    if (!ALLOWED_TYPE_PATTERN.test(type)) {
      return status(400, { message: 'Invalid blob type' })
    }
    await putPersonalBlob(user.id, type, {
      encryptedBlob: body.encryptedBlob,
      nonce: body.nonce ?? '',
      kmVersion: body.kmVersion ?? 1,
    })
    return { success: true }
  },
  {
    params: t.Object({ type: t.String() }),
    body: t.Object({
      encryptedBlob: t.String(),
      nonce: t.Optional(t.String()),
      kmVersion: t.Optional(t.Number()),
    }),
    detail: {
      tags: ['PersonalBlob'],
      description: 'Upsert a client-encrypted personal blob by type',
    },
  },
)

app.use(permissions(PermissionId.LIBRARY_WRITE)).delete(
  '/me/blobs/:type',
  async ({ user, params: { type }, status }) => {
    if (!ALLOWED_TYPE_PATTERN.test(type)) {
      return status(400, { message: 'Invalid blob type' })
    }
    await deletePersonalBlob(user.id, type)
    return { success: true }
  },
  {
    params: t.Object({ type: t.String() }),
    detail: {
      tags: ['PersonalBlob'],
      description: 'Delete a client-encrypted personal blob by type',
    },
  },
)

export default app
