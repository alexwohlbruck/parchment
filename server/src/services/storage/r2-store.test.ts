import { describe, test, expect, afterEach, spyOn } from 'bun:test'
import { createHash } from 'crypto'
import { r2S3Config } from './r2-store'

const TOKEN = 'cfat_example-token'

function respond(routes: Record<string, unknown>) {
  return spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const path = String(input).replace('https://api.cloudflare.com/client/v4', '')
    const result = routes[path]
    return Response.json(
      result === undefined
        ? { success: false, errors: [{ message: 'Invalid API Token' }] }
        : { success: true, result },
    )
  }) as typeof fetch)
}

let fetchSpy: ReturnType<typeof respond> | null = null
afterEach(() => fetchSpy?.mockRestore())

describe('r2S3Config', () => {
  test('derives S3 credentials from an account token', async () => {
    fetchSpy = respond({
      '/accounts': [{ id: 'acct1' }],
      '/accounts/acct1/tokens/verify': { id: 'token-id', status: 'active' },
    })

    expect(await r2S3Config({ apiToken: TOKEN, accountId: '', bucket: 'uploads' })).toEqual({
      endpoint: 'https://acct1.r2.cloudflarestorage.com',
      bucket: 'uploads',
      region: 'auto',
      accessKeyId: 'token-id',
      secretAccessKey: createHash('sha256').update(TOKEN).digest('hex'),
    })
  })

  test('falls back to verifying a user token', async () => {
    fetchSpy = respond({ '/user/tokens/verify': { id: 'user-token-id' } })

    const config = await r2S3Config({ apiToken: TOKEN, accountId: 'acct2', bucket: 'uploads' })

    expect(config.accessKeyId).toBe('user-token-id')
    expect(config.endpoint).toBe('https://acct2.r2.cloudflarestorage.com')
  })

  test('fails clearly when the token is rejected', async () => {
    fetchSpy = respond({})

    await expect(r2S3Config({ apiToken: TOKEN, accountId: 'acct3', bucket: 'b' })).rejects.toThrow(
      'Invalid API Token',
    )
  })
})
