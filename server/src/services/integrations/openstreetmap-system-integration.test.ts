/**
 * Unit tests for the system-scoped OpenStreetMap integration.
 *
 * This holds the OAuth2 application credentials the server needs to run the
 * user-facing OSM flow, so `testConnection` has to verify them WITHOUT a real
 * authorization code. It does that by deliberately sending a bogus code and
 * reading the rejection: a 400 `invalid_grant` means the client credentials
 * were accepted (only the code was bad) → success, while 401/403 or a 400
 * `invalid_client` means the credentials themselves are wrong.
 *
 * Inverting that reading is easy and would tell an operator their working
 * credentials are broken — or worse, that broken ones are fine.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createAxiosMock } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

const { OpenStreetMapSystemIntegration } = await import(
  './openstreetmap-system-integration'
)

const integration = () => new OpenStreetMapSystemIntegration()
const validConfig = { clientId: 'osm-client-id', clientSecret: 'osm-secret' }

/** Build an axios-shaped response; the integration never throws on status. */
const reply = (status: number, data: unknown = {}) => ({ status, data })

beforeEach(() => {
  http.reset()
})

describe('configuration', () => {
  test('is configuration-only — no runtime capabilities', () => {
    expect(integration().capabilityIds).toEqual([])
    expect(integration().capabilities).toEqual({})
  })

  test('requires a client id', () => {
    expect(integration().validateConfig(validConfig)).toBe(true)
    expect(integration().validateConfig({ clientId: '' })).toBe(false)
    expect(integration().validateConfig({ clientId: '   ' })).toBe(false)
    expect(integration().validateConfig(undefined as any)).toBe(false)
  })

  test('a client secret is optional — public clients exist', () => {
    expect(integration().validateConfig({ clientId: 'id' })).toBe(true)
  })

  test('initialize is a no-op', () => {
    expect(() => integration().initialize(validConfig)).not.toThrow()
  })
})

describe('server selection', () => {
  test('defaults to the production OSM server', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection(validConfig)

    expect(http.post.mock.calls[0][0]).toBe(
      'https://www.openstreetmap.org/oauth2/token',
    )
  })

  test('uses the sandbox server when selected', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection({ ...validConfig, server: 'sandbox' })

    expect(http.post.mock.calls[0][0]).toBe(
      'https://master.apis.dev.openstreetmap.org/oauth2/token',
    )
  })

  test('uses a custom server URL', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection({
      ...validConfig,
      server: 'custom',
      customServerUrl: 'https://osm.internal.test',
    })

    expect(http.post.mock.calls[0][0]).toBe(
      'https://osm.internal.test/oauth2/token',
    )
  })

  test('strips trailing slashes from a custom URL', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection({
      ...validConfig,
      server: 'custom',
      customServerUrl: 'https://osm.internal.test///',
    })

    expect(http.post.mock.calls[0][0]).toBe(
      'https://osm.internal.test/oauth2/token',
    )
  })

  test('falls back to production when custom is selected with no URL', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection({ ...validConfig, server: 'custom' })

    expect(http.post.mock.calls[0][0]).toContain('www.openstreetmap.org')
  })
})

describe('credential probe', () => {
  test('rejects an empty client id without a request', async () => {
    const result = await integration().testConnection({ clientId: '' })

    expect(result).toEqual({ success: false, message: 'Client ID is required' })
    expect(http.post).not.toHaveBeenCalled()
  })

  test('sends a deliberately invalid authorization code', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection(validConfig)

    const body = http.post.mock.calls[0][1] as string
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('__parchment_test__')
    expect(body).toContain('client_id=osm-client-id')
  })

  test('includes the client secret when configured', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection(validConfig)

    expect(http.post.mock.calls[0][1]).toContain('client_secret=osm-secret')
  })

  test('omits the secret for a public client', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection({ clientId: 'id' })

    expect(http.post.mock.calls[0][1]).not.toContain('client_secret')
  })

  test('accepts any HTTP status rather than throwing', async () => {
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    await integration().testConnection(validConfig)

    expect(http.post.mock.calls[0][2].validateStatus()).toBe(true)
  })
})

describe('result interpretation', () => {
  test('treats 400 invalid_grant as SUCCESS — the credentials worked', async () => {
    // Only the dummy code was rejected.
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))

    const result = await integration().testConnection(validConfig)

    expect(result.success).toBe(true)
    expect(result.message).toContain('www.openstreetmap.org')
  })

  test('treats a bare 400 as success', async () => {
    http.post.mockResolvedValueOnce(reply(400, {}))

    expect((await integration().testConnection(validConfig)).success).toBe(true)
  })

  test('treats 200 as success', async () => {
    http.post.mockResolvedValueOnce(reply(200, {}))

    expect((await integration().testConnection(validConfig)).success).toBe(true)
  })

  test('treats 400 invalid_client as bad credentials', async () => {
    // Some OAuth2 servers use 400 rather than 401 for this.
    http.post.mockResolvedValueOnce(reply(400, { error: 'invalid_client' }))

    expect(await integration().testConnection(validConfig)).toEqual({
      success: false,
      message: 'Invalid client ID or client secret',
    })
  })

  for (const status of [401, 403]) {
    test(`treats ${status} as bad credentials`, async () => {
      http.post.mockResolvedValueOnce(reply(status, {}))

      const result = await integration().testConnection(validConfig)

      expect(result).toEqual({
        success: false,
        message: 'Invalid client ID or client secret',
      })
    })
  }

  test('reads a string body as the error type', async () => {
    http.post.mockResolvedValueOnce(reply(400, 'invalid_client'))

    expect((await integration().testConnection(validConfig)).success).toBe(false)
  })

  test('reports an unexpected status distinctly', async () => {
    http.post.mockResolvedValueOnce(reply(500, {}))

    const result = await integration().testConnection(validConfig)

    expect(result.success).toBe(false)
    expect(result.message).toContain('HTTP 500')
  })

  test('names the unreachable server on a network failure', async () => {
    http.post.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    const result = await integration().testConnection(validConfig)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Cannot reach OSM server')
    expect(result.message).toContain('ETIMEDOUT')
  })
})
