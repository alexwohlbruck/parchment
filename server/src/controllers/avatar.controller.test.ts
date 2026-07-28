/**
 * Endpoint tests for the avatar controller.
 *
 * Disk and image processing are mocked — what's under test is the upload
 * policy (type allowlist, 2MB ceiling), that the stored file is always keyed by
 * the *caller's* id rather than anything client-supplied, and that the user row
 * is kept in step with the file.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

// ── fs / sharp mocks ──────────────────────────────────────────────────────────

/** Avatar paths that "exist" on disk. */
let existingFiles = new Set<string>()

const existsSync = mock((path: string) => existingFiles.has(path))
const readFile = mock(async (_path: string) => Buffer.from('webp-bytes'))
const unlink = mock(async (_path: string) => undefined)
const mkdir = mock(async (_path: string, _opts?: unknown) => undefined)

mock.module('fs', () => ({ existsSync, default: { existsSync } }))
mock.module('fs/promises', () => ({
  readFile,
  unlink,
  mkdir,
  default: { readFile, unlink, mkdir },
}))

const toFile = mock(async (_path: string) => ({}))
const webp = mock(() => ({ toFile }))
const resize = mock(() => ({ webp }))
const sharp = mock(() => ({ resize }))

mock.module('sharp', () => ({ default: sharp }))

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../middleware/auth.middleware', () => authMockModule())

const avatar = (await import('./avatar.controller')).default
const app = createTestApp(avatar)

/** Send a multipart POST; the harness JSON-encodes bodies, so bypass it here. */
async function postAvatar(file: File) {
  const form = new FormData()
  form.set('file', file)
  const response = await app.handle(
    new Request('http://localhost/users/me/avatar', { method: 'POST', body: form }),
  )
  const text = await response.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    /* non-JSON response */
  }
  return { status: response.status, body }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/html': 'html',
}

/**
 * Build an upload fixture. The filename extension must match the type: Elysia
 * resolves `file.type` from the extension, not from the part's declared
 * Content-Type, so `avatar.png` always arrives as image/png no matter what the
 * client claimed. See the "extension drives the type check" test below.
 */
function imageFile(type: string, size = 1024) {
  return new File([new Uint8Array(size)], `avatar.${EXTENSIONS[type] ?? 'bin'}`, {
    type,
  })
}

beforeEach(() => {
  resetAuth()
  dbMock.reset()
  existingFiles = new Set()
  existsSync.mockClear()
  readFile.mockClear()
  unlink.mockClear()
  mkdir.mockClear()
  sharp.mockClear()
  toFile.mockClear()
})

describe('GET /users/:id/avatar', () => {
  test('serves the stored webp with a revalidating cache header', async () => {
    existingFiles.add(
      (await import('path')).resolve(
        __dirname,
        '../../data/uploads/avatars',
        `${TEST_USER.id}.webp`,
      ),
    )

    const res = await req(app).get(`/users/${TEST_USER.id}/avatar`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=3600, must-revalidate',
    )
  })

  test('404s when the user has no avatar on disk', async () => {
    const res = await req(app).get('/users/no-avatar/avatar')

    expect(res.status).toBe(404)
    expect(readFile).not.toHaveBeenCalled()
  })

  test('is public — avatars render for signed-out viewers', async () => {
    setAuthUser(null)

    const res = await req(app).get('/users/nobody/avatar')

    // 404 (no file), not 401 — the route has no guard.
    expect(res.status).toBe(404)
  })
})

describe('POST /users/me/avatar', () => {
  test('rejects an unauthenticated upload', async () => {
    setAuthUser(null)

    const res = await postAvatar(imageFile('image/png'))

    expect(res.status).toBe(401)
    expect(toFile).not.toHaveBeenCalled()
  })

  test('accepts a PNG and returns the avatar URL', async () => {
    const res = await postAvatar(imageFile('image/png'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ picture: `/users/${TEST_USER.id}/avatar` })
  })

  test('normalizes the upload to a 256px webp', async () => {
    await postAvatar(imageFile('image/jpeg'))

    expect(resize).toHaveBeenCalledWith(256, 256, { fit: 'cover' })
    expect(webp).toHaveBeenCalledWith({ quality: 85 })
  })

  test('writes the file under the caller’s own id', async () => {
    await postAvatar(imageFile('image/webp'))

    expect(String(toFile.mock.calls[0][0])).toContain(`${TEST_USER.id}.webp`)
  })

  test('records the picture URL on the user row', async () => {
    await postAvatar(imageFile('image/png'))

    expect(dbMock.updated[0]).toMatchObject({
      picture: `/users/${TEST_USER.id}/avatar`,
    })
  })

  test('creates the avatars directory when it is missing', async () => {
    await postAvatar(imageFile('image/png'))

    expect(mkdir).toHaveBeenCalled()
  })

  for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html']) {
    test(`rejects ${type}`, async () => {
      const res = await postAvatar(imageFile(type))

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('File must be JPEG, PNG, or WebP')
      expect(toFile).not.toHaveBeenCalled()
    })
  }

  test('rejects a file over 2MB', async () => {
    const res = await postAvatar(imageFile('image/png', 2 * 1024 * 1024 + 1))

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('File must be under 2MB')
    expect(toFile).not.toHaveBeenCalled()
  })

  test('accepts a file exactly at the 2MB ceiling', async () => {
    const res = await postAvatar(imageFile('image/png', 2 * 1024 * 1024))

    expect(res.status).toBe(200)
  })

  test('does not touch the user row when the upload is rejected', async () => {
    await postAvatar(imageFile('image/gif'))

    expect(dbMock.updateCount).toBe(0)
  })

  test('the extension, not the declared Content-Type, drives the type check', async () => {
    // Elysia derives file.type from the filename, so a PDF renamed .png clears
    // the allowlist. Image decoding is what actually rejects it — see below.
    const disguised = new File([new Uint8Array(16)], 'payload.png', {
      type: 'application/pdf',
    })

    const res = await postAvatar(disguised)

    expect(res.status).toBe(200)
  })

  test('a file that is not really an image fails during decoding', async () => {
    // The real backstop for a disguised upload: sharp refuses to decode it.
    toFile.mockRejectedValueOnce(new Error('Input buffer contains unsupported image format'))

    const res = await postAvatar(imageFile('image/png'))

    expect(res.status).toBe(500)
    expect(dbMock.updateCount).toBe(0)
  })
})

describe('DELETE /users/me/avatar', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).delete('/users/me/avatar')

    expect(res.status).toBe(401)
    expect(unlink).not.toHaveBeenCalled()
  })

  test('removes the file and clears the picture column', async () => {
    const { resolve } = await import('path')
    existingFiles.add(
      resolve(__dirname, '../../data/uploads/avatars', `${TEST_USER.id}.webp`),
    )

    const res = await req(app).delete('/users/me/avatar')

    expect(res.status).toBe(204)
    expect(unlink).toHaveBeenCalled()
    expect(dbMock.updated[0]).toMatchObject({ picture: null })
  })

  test('still clears the column when no file was on disk', async () => {
    const res = await req(app).delete('/users/me/avatar')

    expect(res.status).toBe(204)
    expect(unlink).not.toHaveBeenCalled()
    expect(dbMock.updated[0]).toMatchObject({ picture: null })
  })
})
