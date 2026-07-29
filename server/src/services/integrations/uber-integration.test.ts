/**
 * Unit tests for the Uber integration.
 *
 * Uber uses OAuth2 client-credentials with a long-lived (~30 day) token, so
 * the token cache is the interesting part: it must be reused across calls but
 * refreshed before expiry, with a safety margin — a token that expires
 * mid-request would fail the estimate rather than the auth.
 *
 * Estimates come from two endpoints fetched in parallel. Price is required;
 * the TIME endpoint is best-effort, because a missing ETA still leaves a
 * usable fare card (the adapter defaults it) whereas a missing price does not.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

const realFetch = globalThis.fetch
/** Queued responses, matched in call order. */
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

const { UberIntegration } = await import('./uber-integration')

const validConfig = { clientId: 'uber-id', clientSecret: 'uber-secret' }

const tokenResponse = (over: Partial<any> = {}) =>
  new Response(
    JSON.stringify({ access_token: 'uber-token', expires_in: 2592000, ...over }),
    { status: 200 },
  )

const priceResponse = () =>
  new Response(
    JSON.stringify({
      prices: [
        {
          product_id: 'uberx',
          display_name: 'UberX',
          low_estimate: 12,
          high_estimate: 16,
          currency_code: 'USD',
          duration: 900,
          distance: 5,
        },
      ],
    }),
    { status: 200 },
  )

const timeResponse = () =>
  new Response(
    JSON.stringify({
      times: [{ product_id: 'uberx', display_name: 'UberX', estimate: 240 }],
    }),
    { status: 200 },
  )

const estimateRequest = {
  origin: { lat: 35.2, lng: -80.8 },
  destination: { lat: 35.3, lng: -80.9 },
} as any

/** An initialized integration. */
function configured() {
  const integration = new UberIntegration()
  integration.initialize(validConfig)
  return integration
}

beforeEach(() => {
  responses = []
  fetchCalls.length = 0
})

describe('configuration', () => {
  test('requires both client id and secret', () => {
    const integration = new UberIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(
      integration.validateConfig({ clientId: '', clientSecret: 'x' }),
    ).toBe(false)
    expect(
      integration.validateConfig({ clientId: 'x', clientSecret: '' }),
    ).toBe(false)
  })

  test('treats whitespace-only credentials as missing', () => {
    expect(
      new UberIntegration().validateConfig({
        clientId: '  ',
        clientSecret: 'x',
      }),
    ).toBe(false)
  })

  test('exposes the rideshare-estimate capability', () => {
    const integration = new UberIntegration()

    expect(integration.capabilityIds).toContain('rideshareEstimate')
    expect(
      typeof integration.capabilities.rideshareEstimate!.getRideshareEstimates,
    ).toBe('function')
  })
})

describe('testConnection', () => {
  test('rejects incomplete credentials without a request', async () => {
    const result = await new UberIntegration().testConnection({
      clientId: '',
      clientSecret: '',
    })

    expect(result.success).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  test('succeeds when a token is obtained', async () => {
    responses = [tokenResponse()]

    const result = await new UberIntegration().testConnection(validConfig)

    expect(result.success).toBe(true)
    expect(result.message).toContain('Uber')
  })

  test('requests the client-credentials grant with the estimate scope', async () => {
    responses = [tokenResponse()]

    await new UberIntegration().testConnection(validConfig)

    const body = String(fetchCalls[0][1].body)
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('scope=ride_request.estimate')
    expect(body).toContain('client_id=uber-id')
  })

  test('fails when the token endpoint rejects the credentials', async () => {
    responses = [new Response('unauthorized', { status: 401 })]

    const result = await new UberIntegration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Failed to obtain access token',
    })
  })

  test('surfaces a network failure message', async () => {
    responses = [new Error('ETIMEDOUT')]

    const result = await new UberIntegration().testConnection(validConfig)

    expect(result.success).toBe(false)
    expect(result.message).toBe('ETIMEDOUT')
  })
})

describe('token caching', () => {
  test('reuses the token across estimate calls', async () => {
    const integration = configured()
    responses = [tokenResponse(), priceResponse(), timeResponse()]
    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    responses = [priceResponse(), timeResponse()]
    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    // One auth call total, not two.
    const authCalls = fetchCalls.filter(([url]) => url.includes('oauth'))
    expect(authCalls).toHaveLength(1)
  })

  test('refreshes the token once it has expired', async () => {
    const integration = configured()
    // A token that is already past its lifetime.
    responses = [tokenResponse({ expires_in: 0 }), priceResponse(), timeResponse()]
    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    responses = [tokenResponse(), priceResponse(), timeResponse()]
    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    const authCalls = fetchCalls.filter(([url]) => url.includes('oauth'))
    expect(authCalls).toHaveLength(2)
  })

  test('defaults the token lifetime when the response omits it', async () => {
    const integration = configured()
    responses = [
      tokenResponse({ expires_in: undefined }),
      priceResponse(),
      timeResponse(),
    ]
    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    responses = [priceResponse(), timeResponse()]
    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    const authCalls = fetchCalls.filter(([url]) => url.includes('oauth'))
    expect(authCalls).toHaveLength(1)
  })
})

describe('getRideshareEstimates', () => {
  test('returns adapted products with an expiry', async () => {
    const integration = configured()
    responses = [tokenResponse(), priceResponse(), timeResponse()]

    const result =
      await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
        estimateRequest,
      )

    expect(result.provider).toBe('Uber')
    expect(result.products).toHaveLength(1)
    expect(result.products[0].estimatedPickupTime).toBe(240)
    expect(new Date(result.expiresAt!).getTime()).toBeGreaterThan(Date.now())
  })

  test('sends both endpoints the origin, and the price endpoint the destination', async () => {
    const integration = configured()
    responses = [tokenResponse(), priceResponse(), timeResponse()]

    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    const [priceUrl] = fetchCalls.find(([u]) => u.includes('estimates/price'))!
    const [timeUrl] = fetchCalls.find(([u]) => u.includes('estimates/time'))!
    expect(priceUrl).toContain('start_latitude=35.2')
    expect(priceUrl).toContain('end_longitude=-80.9')
    expect(timeUrl).toContain('start_latitude=35.2')
  })

  test('authenticates every upstream call with the bearer token', async () => {
    const integration = configured()
    responses = [tokenResponse(), priceResponse(), timeResponse()]

    await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
      estimateRequest,
    )

    const priceCall = fetchCalls.find(([u]) => u.includes('estimates/price'))!
    expect(priceCall[1].headers.Authorization).toBe('Bearer uber-token')
  })

  test('throws when authentication fails', async () => {
    const integration = configured()
    responses = [new Response('nope', { status: 401 })]

    await expect(
      integration.capabilities.rideshareEstimate!.getRideshareEstimates(
        estimateRequest,
      ),
    ).rejects.toThrow('failed to authenticate')
  })

  test('throws when the price endpoint fails', async () => {
    const integration = configured()
    responses = [
      tokenResponse(),
      new Response('server error', { status: 500 }),
      timeResponse(),
    ]

    await expect(
      integration.capabilities.rideshareEstimate!.getRideshareEstimates(
        estimateRequest,
      ),
    ).rejects.toThrow('Uber price API: 500')
  })

  test('tolerates a failing time endpoint — the fare card still renders', async () => {
    const integration = configured()
    responses = [
      tokenResponse(),
      priceResponse(),
      new Response('server error', { status: 503 }),
    ]

    const result =
      await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
        estimateRequest,
      )

    expect(result.products).toHaveLength(1)
    // The adapter's default ETA stands in.
    expect(result.products[0].estimatedPickupTime).toBe(300)
  })

  test('handles an empty price list', async () => {
    const integration = configured()
    responses = [
      tokenResponse(),
      new Response(JSON.stringify({}), { status: 200 }),
      timeResponse(),
    ]

    const result =
      await integration.capabilities.rideshareEstimate!.getRideshareEstimates(
        estimateRequest,
      )

    expect(result.products).toEqual([])
  })
})
