/**
 * Unit tests for the credential-only integrations: OpenAQ and NASA FIRMS.
 *
 * These carry no capability implementations — they exist so an operator can
 * store a credential that other services read back through the integration
 * manager. What matters is therefore narrow but real: `validateConfig` must
 * reject an empty credential (otherwise a blank key gets saved and the overlay
 * silently returns nothing), `initialize` must refuse the same, and
 * `testConnection` must distinguish "bad credential" from "provider
 * unreachable" so the settings UI can say something useful.
 *
 * FIRMS is the odd one: it answers HTTP 200 with the text "Invalid MAP_KEY"
 * rather than a 4xx, so the body has to be inspected.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

const realFetch = globalThis.fetch
let fetchResponse: Response | null = null
let fetchError: Error | null = null
const fetchCalls: Array<[string, any]> = []

globalThis.fetch = mock(async (url: any, init?: any) => {
  fetchCalls.push([String(url), init])
  if (fetchError) throw fetchError
  return fetchResponse ?? new Response('ok', { status: 200 })
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

const { OpenAqIntegration } = await import('./openaq-integration')
const { FirmsIntegration } = await import('./firms-integration')

beforeEach(() => {
  fetchCalls.length = 0
  fetchResponse = null
  fetchError = null
})

describe('OpenAqIntegration', () => {
  const integration = () => new OpenAqIntegration()

  test('declares the map-layer capability only', () => {
    expect(integration().capabilityIds).toEqual(['mapLayer'])
    expect(integration().capabilities).toEqual({})
  })

  test('validates that an API key is present', () => {
    expect(integration().validateConfig({ apiKey: 'key' })).toBe(true)
    expect(integration().validateConfig({ apiKey: '' })).toBe(false)
    expect(integration().validateConfig(undefined as any)).toBe(false)
  })

  test('initialize refuses an empty key', () => {
    expect(() => integration().initialize({ apiKey: '' })).toThrow(
      'API Key is required',
    )
  })

  test('initialize accepts a valid key', () => {
    expect(() => integration().initialize({ apiKey: 'key' })).not.toThrow()
  })

  test('testConnection rejects an empty key without a request', async () => {
    const result = await integration().testConnection({ apiKey: '' })

    expect(result.success).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  test('testConnection sends the key as X-API-Key', async () => {
    await integration().testConnection({ apiKey: 'openaq-key' })

    expect(fetchCalls[0][0]).toContain('api.openaq.org')
    expect(fetchCalls[0][1].headers['X-API-Key']).toBe('openaq-key')
  })

  test('testConnection succeeds on a 200', async () => {
    fetchResponse = new Response('{}', { status: 200 })

    expect(await integration().testConnection({ apiKey: 'key' })).toEqual({
      success: true,
    })
  })

  for (const status of [401, 403]) {
    test(`testConnection reports an invalid key on ${status}`, async () => {
      fetchResponse = new Response('nope', { status })

      const result = await integration().testConnection({ apiKey: 'bad' })

      expect(result).toEqual({ success: false, message: 'Invalid API key' })
    })
  }

  test('testConnection distinguishes a provider error from a bad key', async () => {
    fetchResponse = new Response('boom', { status: 500 })

    const result = await integration().testConnection({ apiKey: 'key' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('500')
    expect(result.message).not.toContain('Invalid API key')
  })

  test('testConnection surfaces a network failure message', async () => {
    fetchError = new Error('ENOTFOUND api.openaq.org')

    const result = await integration().testConnection({ apiKey: 'key' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('ENOTFOUND')
  })

  test('testConnection bounds the probe with a timeout', async () => {
    await integration().testConnection({ apiKey: 'key' })

    expect(fetchCalls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})

describe('FirmsIntegration', () => {
  const integration = () => new FirmsIntegration()

  test('declares the map-layer capability only', () => {
    expect(integration().capabilityIds).toEqual(['mapLayer'])
  })

  test('validates that a MAP_KEY is present', () => {
    expect(integration().validateConfig({ apiKey: 'key' })).toBe(true)
    expect(integration().validateConfig({ apiKey: '' })).toBe(false)
  })

  test('initialize refuses an empty MAP_KEY', () => {
    expect(() => integration().initialize({ apiKey: '' })).toThrow(
      'MAP_KEY is required',
    )
  })

  test('testConnection rejects an empty key without a request', async () => {
    const result = await integration().testConnection({ apiKey: '' })

    expect(result.success).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  test('testConnection probes the availability endpoint with the key in the path', async () => {
    fetchResponse = new Response('data', { status: 200 })

    await integration().testConnection({ apiKey: 'firms-key' })

    expect(fetchCalls[0][0]).toContain('/data_availability/csv/firms-key/')
  })

  test('testConnection succeeds on a valid key', async () => {
    fetchResponse = new Response('some,csv,data', { status: 200 })

    expect(await integration().testConnection({ apiKey: 'key' })).toEqual({
      success: true,
    })
  })

  test('testConnection detects "Invalid MAP_KEY" inside a 200 body', async () => {
    // FIRMS answers 200 with an error string rather than a 4xx.
    fetchResponse = new Response('Invalid MAP_KEY.', { status: 200 })

    const result = await integration().testConnection({ apiKey: 'bad' })

    expect(result).toEqual({ success: false, message: 'Invalid MAP_KEY' })
  })

  test('the body check is case-insensitive', async () => {
    fetchResponse = new Response('invalid map_key', { status: 200 })

    expect((await integration().testConnection({ apiKey: 'bad' })).success).toBe(
      false,
    )
  })

  test('testConnection fails on a non-200', async () => {
    fetchResponse = new Response('server error', { status: 503 })

    expect((await integration().testConnection({ apiKey: 'key' })).success).toBe(
      false,
    )
  })

  test('testConnection surfaces a network failure message', async () => {
    fetchError = new Error('ETIMEDOUT')

    const result = await integration().testConnection({ apiKey: 'key' })

    expect(result.message).toContain('ETIMEDOUT')
  })
})
