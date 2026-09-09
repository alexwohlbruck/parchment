/**
 * Unit tests for the Axiom observability integration.
 *
 * This one is settings-only — configuring it turns on OTLP export at startup,
 * so `testConnection` is the operator's sole feedback that the credential
 * works. That makes the error mapping the point: an invalid token, a missing
 * dataset and a generic API failure have to read differently, or a typo'd
 * dataset name looks like an auth problem and vice versa.
 *
 * This matters more than usual here: when the Axiom config is wrong, logs
 * silently stop reaching the dashboard rather than failing loudly.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

const realFetch = globalThis.fetch
let fetchResponse: Response | null = null
let fetchError: Error | null = null
const fetchCalls: Array<[string, any]> = []

globalThis.fetch = mock(async (url: any, init?: any) => {
  fetchCalls.push([String(url), init])
  if (fetchError) throw fetchError
  return fetchResponse ?? new Response('{}', { status: 200 })
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

const { AxiomIntegration } = await import('./axiom-integration')

const integration = () => new AxiomIntegration()
const validConfig = { apiToken: 'xaat-token', dataset: 'parchment' }

beforeEach(() => {
  fetchCalls.length = 0
  fetchResponse = null
  fetchError = null
})

describe('configuration', () => {
  test('declares the logging capability', () => {
    expect(integration().capabilityIds).toEqual(['logging'])
  })

  test('requires both a token and a dataset', () => {
    expect(integration().validateConfig(validConfig)).toBe(true)
    expect(
      integration().validateConfig({ apiToken: '', dataset: 'parchment' }),
    ).toBe(false)
    expect(
      integration().validateConfig({ apiToken: 'token', dataset: '' }),
    ).toBe(false)
  })

  test('treats whitespace-only values as missing', () => {
    expect(
      integration().validateConfig({ apiToken: '   ', dataset: 'parchment' }),
    ).toBe(false)
    expect(
      integration().validateConfig({ apiToken: 'token', dataset: '  ' }),
    ).toBe(false)
  })

  test('tolerates an absent config object', () => {
    expect(integration().validateConfig(undefined as any)).toBe(false)
  })

  test('initialize is a no-op — config is read at startup', () => {
    expect(() => integration().initialize(validConfig)).not.toThrow()
  })
})

describe('testConnection', () => {
  test('rejects an incomplete config without a request', async () => {
    const result = await integration().testConnection({
      apiToken: '',
      dataset: '',
    })

    expect(result).toEqual({
      success: false,
      message: 'API token and dataset are required',
    })
    expect(fetchCalls).toHaveLength(0)
  })

  test('probes the dataset endpoint with a bearer token', async () => {
    fetchResponse = new Response('{}', { status: 200 })

    await integration().testConnection(validConfig)

    expect(fetchCalls[0][0]).toBe('https://api.axiom.co/v1/datasets/parchment')
    expect(fetchCalls[0][1].headers.Authorization).toBe('Bearer xaat-token')
  })

  test('URL-encodes a dataset name with special characters', () => {
    fetchResponse = new Response('{}', { status: 200 })

    return integration()
      .testConnection({ ...validConfig, dataset: 'my dataset/v2' })
      .then(() => {
        expect(fetchCalls[0][0]).toContain('my%20dataset%2Fv2')
      })
  })

  test('uses a custom endpoint when supplied', async () => {
    fetchResponse = new Response('{}', { status: 200 })

    await integration().testConnection({
      ...validConfig,
      endpoint: 'https://eu.axiom.test',
    })

    expect(fetchCalls[0][0]).toBe('https://eu.axiom.test/v1/datasets/parchment')
  })

  test('strips a trailing slash from a custom endpoint', async () => {
    // Otherwise the URL would contain a double slash and 404.
    fetchResponse = new Response('{}', { status: 200 })

    await integration().testConnection({
      ...validConfig,
      endpoint: 'https://eu.axiom.test/',
    })

    expect(fetchCalls[0][0]).toBe('https://eu.axiom.test/v1/datasets/parchment')
  })

  test('succeeds on a 200', async () => {
    fetchResponse = new Response('{}', { status: 200 })

    expect(await integration().testConnection(validConfig)).toEqual({
      success: true,
    })
  })

  test('reports an invalid token on 401', async () => {
    fetchResponse = new Response('unauthorized', { status: 401 })

    expect(await integration().testConnection(validConfig)).toEqual({
      success: false,
      message: 'Invalid API token',
    })
  })

  test('names the missing dataset on 404', async () => {
    // Distinct from the auth message so a typo'd name is obvious.
    fetchResponse = new Response('not found', { status: 404 })

    const result = await integration().testConnection(validConfig)

    expect(result.message).toBe('Dataset "parchment" not found')
  })

  test('surfaces the status and body for another API error', async () => {
    fetchResponse = new Response('rate limited', { status: 429 })

    const result = await integration().testConnection(validConfig)

    expect(result.message).toContain('429')
    expect(result.message).toContain('rate limited')
  })

  test('truncates a long error body', async () => {
    fetchResponse = new Response('x'.repeat(1000), { status: 500 })

    const result = await integration().testConnection(validConfig)

    expect(result.message!.length).toBeLessThan(250)
  })

  test('surfaces a network failure message', async () => {
    fetchError = new Error('ENOTFOUND api.axiom.co')

    const result = await integration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'ENOTFOUND api.axiom.co',
    })
  })

  test('handles a non-Error rejection', async () => {
    fetchError = 'something odd' as any

    const result = await integration().testConnection(validConfig)

    expect(result.message).toBe('Connection failed')
  })
})
