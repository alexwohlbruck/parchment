/**
 * Upload policy only: image processing and storage are covered by avatar.service.test.ts.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const PICTURE = 'https://cdn.test/avatars/u/abc.webp'
const setAvatar = mock(async (_userId: string, _image: Uint8Array) => PICTURE)
const removeAvatar = mock(async (_userId: string) => undefined)

mock.module('../services/avatar.service', () => ({ setAvatar, removeAvatar }))
mock.module('../middleware/auth.middleware', () => authMockModule())

const avatar = (await import('./avatar.controller')).default
const app = createTestApp(avatar)

/** The harness JSON-encodes bodies, so multipart goes through app.handle directly. */
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

/** Elysia derives `file.type` from the filename extension, so the name must match the type. */
function imageFile(type: string, size = 1024) {
  return new File([new Uint8Array(size)], `avatar.${EXTENSIONS[type] ?? 'bin'}`, { type })
}

beforeEach(() => {
  resetAuth()
  setAvatar.mockClear()
  removeAvatar.mockClear()
})

describe('POST /users/me/avatar', () => {
  test('rejects an unauthenticated upload', async () => {
    setAuthUser(null)

    const res = await postAvatar(imageFile('image/png'))

    expect(res.status).toBe(401)
    expect(setAvatar).not.toHaveBeenCalled()
  })

  test('stores the upload for the caller and returns the new URL', async () => {
    const res = await postAvatar(imageFile('image/jpeg'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ picture: PICTURE })
    expect(setAvatar.mock.calls[0][0]).toBe(TEST_USER.id)
  })

  for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html']) {
    test(`rejects ${type}`, async () => {
      const res = await postAvatar(imageFile(type))

      expect(res.status).toBe(400)
      expect(res.body.message).toBe('File must be JPEG, PNG, or WebP')
      expect(setAvatar).not.toHaveBeenCalled()
    })
  }

  test('rejects a file over 2MB', async () => {
    const res = await postAvatar(imageFile('image/png', 2 * 1024 * 1024 + 1))

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('File must be under 2MB')
  })

  test('accepts a file exactly at the 2MB ceiling', async () => {
    const res = await postAvatar(imageFile('image/png', 2 * 1024 * 1024))

    expect(res.status).toBe(200)
  })

  test('a file that fails to decode is a server error', async () => {
    setAvatar.mockRejectedValueOnce(new Error('Input buffer contains unsupported image format'))

    const res = await postAvatar(imageFile('image/png'))

    expect(res.status).toBe(500)
  })
})

describe('DELETE /users/me/avatar', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).delete('/users/me/avatar')

    expect(res.status).toBe(401)
    expect(removeAvatar).not.toHaveBeenCalled()
  })

  test('removes the caller’s avatar', async () => {
    const res = await req(app).delete('/users/me/avatar')

    expect(res.status).toBe(204)
    expect(removeAvatar).toHaveBeenCalledWith(TEST_USER.id)
  })
})
