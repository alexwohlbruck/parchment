import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const calls: { method: string; url: string; body?: unknown }[] = []
let matches: unknown[] = []
const realFetch = globalThis.fetch

mock.module('../integrations', () => ({
  integrationManager: { getConfiguredIntegrations: () => [] },
}))

const { getProviderMatch, setProviderMatch, deleteProviderMatch } = await import('./provider-matches.service')

beforeEach(() => {
  process.env.BARRELMAN_HOST = 'http://barrelman.test'
  process.env.BARRELMAN_API_KEY = 'service'
  calls.length = 0
  matches = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method!, url, body: init.body ? JSON.parse(init.body as string) : undefined })
    if (init.method === 'DELETE') return new Response(null, { status: 404 })
    return Response.json(init.method === 'GET' ? { matches } : {})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.BARRELMAN_HOST
  delete process.env.BARRELMAN_API_KEY
})

describe('provider match store', () => {
  test('reads the stored match for any provider', async () => {
    matches = [{ provider: 'liteapi', providerPlaceId: 'lp-1', confirmed: false, updatedAt: '' }]
    expect(await getProviderMatch('osm', 'node/4176535246', 'liteapi')).toEqual({ providerPlaceId: 'lp-1', confirmed: false, label: null })
    expect(await getProviderMatch('osm', 'node/4176535246', 'resy')).toBeNull()
    expect(calls[0].url).toBe('http://barrelman.test/place/node/4176535246/matches')
  })

  test('saves a match for any provider through Barrelman', async () => {
    expect(await setProviderMatch('osm', 'way/7', 'opentable', { providerPlaceId: 'ot-9', confirmed: false })).toBe(true)
    expect(calls).toEqual([
      { method: 'PUT', url: 'http://barrelman.test/place/way/7/matches/opentable', body: { providerPlaceId: 'ot-9', confirmed: false } },
    ])
  })

  test('reads and writes a listing’s display name', async () => {
    matches = [{ provider: 'google_hotels', providerPlaceId: 'ChoIp8', confirmed: true, label: 'EVEN Hotel Brooklyn by IHG', updatedAt: '' }]
    expect((await getProviderMatch('osm', 'way/575449026', 'google_hotels'))?.label).toBe('EVEN Hotel Brooklyn by IHG')
    await setProviderMatch('osm', 'way/575449026', 'google_hotels', { providerPlaceId: 'ChoIp8', confirmed: true, label: 'EVEN Hotel' })
    expect(calls.at(-1)?.body).toEqual({ providerPlaceId: 'ChoIp8', confirmed: true, label: 'EVEN Hotel' })
  })

  test('leaves the stored name alone when a write gives none', async () => {
    await setProviderMatch('osm', 'way/7', 'foursquare', { providerPlaceId: 'x', confirmed: false })
    expect(calls.at(-1)?.body).not.toHaveProperty('label')
  })

  test('stores nothing for places Barrelman cannot key', async () => {
    expect(await setProviderMatch('google', 'ChIJ1', 'foursquare', { providerPlaceId: 'x', confirmed: false })).toBe(false)
    expect(await getProviderMatch('osm', 'intersection/1', 'google')).toBeNull()
    expect(calls).toEqual([])
  })

  test('forgetting a match that is already gone is not an error', async () => {
    await deleteProviderMatch('osm', 'node/1', 'google')
    expect(calls[0].method).toBe('DELETE')
  })
})
