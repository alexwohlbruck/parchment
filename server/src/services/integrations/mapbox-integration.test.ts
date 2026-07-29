/**
 * Unit tests for the Mapbox integration.
 *
 * Mapbox is a credential holder for the map engine, so `testConnection` is the
 * only behaviour. Its quirk: the token-validation endpoint answers HTTP 200
 * for a token that exists but is revoked or scoped wrong — the real verdict is
 * the `code` field in the body, which must equal `TokenValid`. Trusting the
 * status alone would tell an operator their dead token is fine.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

const realFetch = globalThis.fetch
let fetchResponse: Response | null = null
let fetchError: Error | null = null
const fetchCalls: string[] = []

globalThis.fetch = mock(async (url: any) => {
  fetchCalls.push(String(url))
  if (fetchError) throw fetchError
  return fetchResponse ?? new Response('{}', { status: 200 })
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { MapboxIntegration } = await import('./mapbox-integration')

const integration = () => new MapboxIntegration()
const validConfig = { accessToken: 'pk.test-token' }

/** Mapbox's token endpoint body. */
const tokenBody = (code: string) =>
  new Response(JSON.stringify({ code }), { status: 200 })

beforeEach(() => {
  fetchCalls.length = 0
  fetchResponse = null
  fetchError = null
})

describe('configuration', () => {
  test('declares the map-engine capability', () => {
    expect(integration().capabilityIds).toEqual(['mapEngine'])
  })

  test('requires an access token', () => {
    expect(integration().validateConfig(validConfig)).toBe(true)
    expect(integration().validateConfig({ accessToken: '' })).toBe(false)
    expect(integration().validateConfig(undefined as any)).toBe(false)
  })

  test('initialize refuses an empty token', () => {
    expect(() => integration().initialize({ accessToken: '' })).toThrow(
      'Access token is required',
    )
  })

  test('initialize accepts a valid token', () => {
    expect(() => integration().initialize(validConfig)).not.toThrow()
  })
})

describe('testConnection', () => {
  test('rejects an empty token without a request', async () => {
    const result = await integration().testConnection({ accessToken: '' })

    expect(result.success).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  test('probes the token endpoint with the token', async () => {
    fetchResponse = tokenBody('TokenValid')

    await integration().testConnection(validConfig)

    expect(fetchCalls[0]).toBe(
      'https://api.mapbox.com/tokens/v2?access_token=pk.test-token',
    )
  })

  test('succeeds only when the body reports TokenValid', async () => {
    fetchResponse = tokenBody('TokenValid')

    expect(await integration().testConnection(validConfig)).toEqual({
      success: true,
    })
  })

  test('fails on a 200 whose body does not say TokenValid', async () => {
    // A revoked or wrongly-scoped token still answers 200 here.
    fetchResponse = tokenBody('TokenMalformed')

    const result = await integration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Access token is not valid',
    })
  })

  test('fails on a 200 with no code field at all', async () => {
    fetchResponse = new Response('{}', { status: 200 })

    expect((await integration().testConnection(validConfig)).success).toBe(false)
  })

  test('fails on a non-200 response', async () => {
    fetchResponse = new Response('unauthorized', { status: 401 })

    const result = await integration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Invalid access token or API error',
    })
  })

  test('surfaces a network failure message', async () => {
    fetchError = new Error('ENOTFOUND api.mapbox.com')

    const result = await integration().testConnection(validConfig)

    expect(result.success).toBe(false)
    expect(result.message).toContain('ENOTFOUND')
  })

  test('falls back to a generic message for an error with none', async () => {
    fetchError = new Error('')

    const result = await integration().testConnection(validConfig)

    expect(result.message).toBe('Failed to connect to Mapbox API')
  })
})
