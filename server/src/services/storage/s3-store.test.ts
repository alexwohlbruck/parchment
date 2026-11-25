import { afterAll, describe, expect, test } from 'bun:test'
import { createS3Store } from './s3-store'

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === '/bucket/avatars/1/a.webp') {
      return new Response('webp-bytes', { headers: { 'Content-Type': 'image/webp' } })
    }
    if (pathname === '/bucket/broken') return new Response('nope', { status: 403 })
    return new Response('', { status: 404 })
  },
})
afterAll(() => server.stop())

const store = createS3Store({
  endpoint: server.url.origin,
  bucket: 'bucket',
  region: 'auto',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
})

describe('s3 store get', () => {
  test('returns a blob that can be served with headers', async () => {
    const blob = await store.get('avatars/1/a.webp')
    expect(blob?.type).toBe('image/webp')
    expect(await blob?.text()).toBe('webp-bytes')
    const response = new Response(blob, { headers: { 'Cache-Control': 'immutable' } })
    expect(await response.text()).toBe('webp-bytes')
  })

  test('returns null for a missing key', async () => {
    expect(await store.get('avatars/1/missing.webp')).toBeNull()
  })

  test('throws on other errors', async () => {
    await expect(store.get('broken')).rejects.toThrow('403')
  })
})
