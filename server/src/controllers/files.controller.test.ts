import { describe, test, expect, mock } from 'bun:test'
import { createTestApp, req } from '../test/app'

const stored = new Map([
  ['avatars/u1/abc.webp', new Blob([new Uint8Array([1, 2])], { type: 'image/webp' })],
  ['private/u1/secret', new Blob(['secret'], { type: 'text/plain' })],
])

mock.module('../services/storage/storage.service', () => ({
  blobStore: { get: async (key: string) => stored.get(key) ?? null },
  isPublicKey: (key: string) => key.startsWith('avatars/') && !key.includes('..'),
}))

const files = (await import('./files.controller')).default
const app = createTestApp(files)

describe('GET /files/*', () => {
  test('serves a public file as immutable', async () => {
    const res = await req(app).get('/files/avatars/u1/abc.webp')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  test('404s for a missing key', async () => {
    expect((await req(app).get('/files/avatars/u1/none.webp')).status).toBe(404)
  })

  test('never serves keys outside the public prefixes', async () => {
    expect((await req(app).get('/files/private/u1/secret')).status).toBe(404)
  })
})
