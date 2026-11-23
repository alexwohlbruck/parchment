/**
 * Upload policy only: image processing and storage are covered by avatar.service.test.ts.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const PICTURE = 'https://cdn.test/avatars/u/abc.webp'
const setAvatar = mock(async (_userId: string, _image: Uint8Array) => PICTURE)
const removeAvatar = mock(async (_userId: string) => undefined)

class UnreadableImageError extends Error {}
mock.module('../services/avatar.service', () => ({ setAvatar, removeAvatar, UnreadableImageError }))
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

const SIGNATURES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/webp': [...new TextEncoder().encode('RIFF\0\0\0\0WEBP')],
  'image/gif': [...new TextEncoder().encode('GIF89a')],
}

/** Elysia derives `file.type` from the filename extension, so the name must match the type. */
function imageFile(type: string, size = 1024, content = type) {
  const bytes = new Uint8Array(size)
  bytes.set(SIGNATURES[content] ?? [])
  return new File([bytes], `avatar.${EXTENSIONS[type] ?? 'bin'}`, { type })
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

  test('judges the type by content, not by name', async () => {
    const res = await postAvatar(imageFile('image/png', 1024, 'image/svg+xml'))

    expect(res.status).toBe(400)
    expect(setAvatar).not.toHaveBeenCalled()
  })

  test('accepts a real image whatever its name says', async () => {
    const res = await postAvatar(imageFile('application/pdf', 1024, 'image/webp'))

    expect(res.status).toBe(200)
  })

  test('rejects a file over 2MB', async () => {
    const res = await postAvatar(imageFile('image/png', 2 * 1024 * 1024 + 1))

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('File must be under 2MB')
  })

  test('accepts a file exactly at the 2MB ceiling', async () => {
    const res = await postAvatar(imageFile('image/png', 2 * 1024 * 1024))

    expect(res.status).toBe(200)
  })

  test('a file that fails to decode is rejected', async () => {
    setAvatar.mockRejectedValueOnce(new UnreadableImageError())

    const res = await postAvatar(imageFile('image/png'))

    expect(res.status).toBe(400)
  })

  test('an unexpected processing failure is a server error', async () => {
    setAvatar.mockRejectedValueOnce(new Error('disk full'))

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
