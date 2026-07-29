/**
 * Unit tests for the Lyft integration.
 *
 * Lyft's OAuth2 differs from Uber's in two ways that are easy to get wrong:
 * credentials go in a **Basic** auth header (base64 `id:secret`) rather than
 * the form body, and the token lifetime defaults to an hour rather than a
 * month — so the cache turns over far more often.
 *
 * As with Uber, the cost endpoint is required while the ETA endpoint is
 * best-effort: a missing ETA still leaves a usable fare card.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

const realFetch = globalThis.fetch
let responses: Array<Response | Error> = []
const fetchCalls: Array<[string, any]> = []

globalThis.fetch = mock(async (url: any, init?: any) => {
  fetchCalls.push([String(url), init])
  const next = responses.shift()
  if (next instanceof Error) throw next
  return next ?? new Response('{}', { status: 200 })
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

const { LyftIntegration } = await import('./lyft-integration')

const validConfig = { clientId: 'lyft-id', clientSecret: 'lyft-secret' }

const tokenResponse = (over: Partial<any> = {}) =>
  new Response(
    JSON.stringify({ access_token: 'lyft-token', expires_in: 3600, ...over }),
    { status: 200 },
  )

const costResponse = () =>
  new Response(
    JSON.stringify({
      cost_estimates: [
        {
          ride_type: 'lyft',
          display_name: 'Lyft',
          estimated_cost_cents_min: 1200,
          estimated_cost_cents_max: 1600,
          currency: 'USD',
          estimated_duration_seconds: 900,
          estimated_distance_miles: 5,
        },
      ],
    }),
    { status: 200 },
  )

const etaResponse = () =>
  new Response(
    JSON.stringify({
      eta_estimates: [
        { ride_type: 'lyft', display_name: 'Lyft', eta_seconds: 180 },
      ],
    }),
    { status: 200 },
  )

const estimateRequest = {
  origin: { lat: 35.2, lng: -80.8 },
  destination: { lat: 35.3, lng: -80.9 },
} as any

function configured() {
  const integration = new LyftIntegration()
  integration.initialize(validConfig)
  return integration
}

const estimates = (integration: any) =>
  integration.capabilities.rideshareEstimate.getRideshareEstimates(
    estimateRequest,
  )

beforeEach(() => {
  responses = []
  fetchCalls.length = 0
})

describe('configuration', () => {
  test('requires both client id and secret', () => {
    const integration = new LyftIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ clientId: '', clientSecret: 'x' })).toBe(
      false,
    )
    expect(integration.validateConfig({ clientId: 'x', clientSecret: ' ' })).toBe(
      false,
    )
  })

  test('exposes the rideshare-estimate capability', () => {
    expect(new LyftIntegration().capabilityIds).toContain('rideshareEstimate')
  })
})

describe('authentication', () => {
  test('sends credentials as a Basic auth header, not in the body', async () => {
    responses = [tokenResponse()]

    await new LyftIntegration().testConnection(validConfig)

    const expected = Buffer.from('lyft-id:lyft-secret').toString('base64')
    expect(fetchCalls[0][1].headers.Authorization).toBe(`Basic ${expected}`)
    expect(String(fetchCalls[0][1].body)).not.toContain('lyft-secret')
  })

  test('requests the client-credentials grant with the public scope', async () => {
    responses = [tokenResponse()]

    await new LyftIntegration().testConnection(validConfig)

    const body = JSON.parse(String(fetchCalls[0][1].body))
    expect(body).toEqual({ grant_type: 'client_credentials', scope: 'public' })
  })

  test('testConnection rejects incomplete credentials without a request', async () => {
    const result = await new LyftIntegration().testConnection({
      clientId: '',
      clientSecret: '',
    })

    expect(result.success).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  test('testConnection succeeds when a token is obtained', async () => {
    responses = [tokenResponse()]

    const result = await new LyftIntegration().testConnection(validConfig)

    expect(result.success).toBe(true)
    expect(result.message).toContain('Lyft')
  })

  test('testConnection fails on rejected credentials', async () => {
    responses = [new Response('unauthorized', { status: 401 })]

    expect(await new LyftIntegration().testConnection(validConfig)).toEqual({
      success: false,
      message: 'Failed to obtain access token',
    })
  })

  test('testConnection surfaces a network failure', async () => {
    responses = [new Error('ECONNRESET')]

    const result = await new LyftIntegration().testConnection(validConfig)

    expect(result.message).toBe('ECONNRESET')
  })
})

describe('token caching', () => {
  test('reuses the token across calls', async () => {
    const integration = configured()
    responses = [tokenResponse(), costResponse(), etaResponse()]
    await estimates(integration)

    responses = [costResponse(), etaResponse()]
    await estimates(integration)

    expect(fetchCalls.filter(([u]) => u.includes('oauth/token'))).toHaveLength(1)
  })

  test('refreshes an expired token', async () => {
    const integration = configured()
    responses = [tokenResponse({ expires_in: 0 }), costResponse(), etaResponse()]
    await estimates(integration)

    responses = [tokenResponse(), costResponse(), etaResponse()]
    await estimates(integration)

    expect(fetchCalls.filter(([u]) => u.includes('oauth/token'))).toHaveLength(2)
  })

  test('defaults to a one-hour lifetime, not Uber’s month', async () => {
    const integration = configured()
    responses = [
      tokenResponse({ expires_in: undefined }),
      costResponse(),
      etaResponse(),
    ]
    await estimates(integration)

    // Still cached well inside an hour.
    responses = [costResponse(), etaResponse()]
    await estimates(integration)

    expect(fetchCalls.filter(([u]) => u.includes('oauth/token'))).toHaveLength(1)
  })
})

describe('getRideshareEstimates', () => {
  test('returns adapted products with an expiry', async () => {
    const integration = configured()
    responses = [tokenResponse(), costResponse(), etaResponse()]

    const result = await estimates(integration)

    expect(result.provider).toBe('Lyft')
    expect(result.products).toHaveLength(1)
    expect(result.products[0].estimatedPickupTime).toBe(180)
    expect(new Date(result.expiresAt!).getTime()).toBeGreaterThan(Date.now())
  })

  test('sends the full route to cost and the origin to eta', async () => {
    const integration = configured()
    responses = [tokenResponse(), costResponse(), etaResponse()]

    await estimates(integration)

    const [costUrl] = fetchCalls.find(([u]) => u.includes('/v1/cost'))!
    const [etaUrl] = fetchCalls.find(([u]) => u.includes('/v1/eta'))!
    expect(costUrl).toContain('start_lat=35.2')
    expect(costUrl).toContain('end_lng=-80.9')
    expect(etaUrl).toContain('lat=35.2')
    expect(etaUrl).not.toContain('end_lat')
  })

  test('authenticates upstream calls with the bearer token', async () => {
    const integration = configured()
    responses = [tokenResponse(), costResponse(), etaResponse()]

    await estimates(integration)

    const costCall = fetchCalls.find(([u]) => u.includes('/v1/cost'))!
    expect(costCall[1].headers.Authorization).toBe('Bearer lyft-token')
  })

  test('throws when authentication fails', async () => {
    const integration = configured()
    responses = [new Response('nope', { status: 401 })]

    await expect(estimates(integration)).rejects.toThrow(
      'failed to authenticate',
    )
  })

  test('throws when the cost endpoint fails', async () => {
    const integration = configured()
    responses = [
      tokenResponse(),
      new Response('error', { status: 500 }),
      etaResponse(),
    ]

    await expect(estimates(integration)).rejects.toThrow('Lyft cost API: 500')
  })

  test('tolerates a failing eta endpoint', async () => {
    const integration = configured()
    responses = [
      tokenResponse(),
      costResponse(),
      new Response('error', { status: 503 }),
    ]

    const result = await estimates(integration)

    expect(result.products).toHaveLength(1)
    expect(result.products[0].estimatedPickupTime).toBe(300)
  })

  test('handles an empty cost list', async () => {
    const integration = configured()
    responses = [
      tokenResponse(),
      new Response('{}', { status: 200 }),
      etaResponse(),
    ]

    expect((await estimates(integration)).products).toEqual([])
  })
})
