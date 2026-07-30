/**
 * Endpoint tests for the GBFS controller.
 *
 * Shared mobility availability, served by Barrelman. Authenticated, and served
 * off `/gbfs` — it used to sit under the tile proxy, which it never was.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

let configuredIntegrations: any[] = []

mock.module('../services/integrations', () => ({
  integrationManager: {
    getConfiguredIntegrations: () => configuredIntegrations,
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const gbfs = (await import('./gbfs.controller')).default
const app = createTestApp(gbfs)

const realFetch = globalThis.fetch
let fetchResponses: Response[] = []
const fetchCalls: string[] = []

globalThis.fetch = mock(async (url: any) => {
  fetchCalls.push(String(url))
  return fetchResponses.shift() ?? new Response('{}')
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  resetAuth()
  fetchCalls.length = 0
  fetchResponses = []
  configuredIntegrations = [
    {
      integrationId: 'barrelman',
      config: { host: 'https://barrelman.test', apiKey: 'barrelman-key' },
    },
  ]
})

describe('GET /gbfs/nearby-stations', () => {
  test('is served off a single /gbfs prefix', async () => {
    fetchResponses = [jsonResponse({ stations: [] })]

    const res = await req(app).get('/gbfs/nearby-stations')

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('https://barrelman.test/gbfs/nearby-stations')
  })

  test('is no longer reachable under /proxy', async () => {
    const res = await req(app).get('/proxy/gbfs/nearby-stations')

    expect(res.status).toBe(404)
  })

  test('is never cached — availability is the whole point', async () => {
    fetchResponses = [jsonResponse({ stations: [] })]

    const res = await req(app).get('/gbfs/nearby-stations')

    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/gbfs/nearby-stations')

    expect(res.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })

  test('501s when Barrelman is not configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/gbfs/nearby-stations')

    expect(res.status).toBe(501)
  })
})

describe('GET /gbfs/systems', () => {
  test('is cached for an hour — the catalog barely moves', async () => {
    fetchResponses = [jsonResponse({})]

    const res = await req(app).get('/gbfs/systems')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  test('never echoes the Barrelman API key to the client', async () => {
    fetchResponses = [jsonResponse({ ok: true })]

    const res = await req(app).get('/gbfs/systems')

    expect(JSON.stringify(res.body)).not.toContain('barrelman-key')
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/gbfs/systems')

    expect(res.status).toBe(401)
  })
})
