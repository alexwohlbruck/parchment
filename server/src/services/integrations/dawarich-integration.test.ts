import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ── Axios mock (must be declared before the integration import) ───────────────
const mockAxiosGet = mock((_url: string, _config?: any) =>
  Promise.resolve({ data: {} }),
)

mock.module('axios', () => ({
  default: {
    get: mockAxiosGet,
    create: () => ({ get: mockAxiosGet }),
  },
}))

import { DawarichIntegration } from './dawarich-integration'

describe('DawarichIntegration', () => {
  let integration: DawarichIntegration

  beforeEach(() => {
    integration = new DawarichIntegration()
    mockAxiosGet.mockClear()
  })

  // ── validateConfig ──────────────────────────────────────────────────────────

  describe('validateConfig', () => {
    test('returns true when url + apiToken provided', () => {
      expect(
        integration.validateConfig({
          url: 'https://dawarich.example.com',
          apiToken: 'abc',
        }),
      ).toBe(true)
    })

    test('returns false when url is empty', () => {
      expect(
        integration.validateConfig({ url: '', apiToken: 'abc' }),
      ).toBe(false)
    })

    test('returns false when apiToken is empty', () => {
      expect(
        integration.validateConfig({
          url: 'https://dawarich.example.com',
          apiToken: '',
        }),
      ).toBe(false)
    })
  })

  // ── testConnection ──────────────────────────────────────────────────────────

  describe('testConnection', () => {
    test('rejects empty config without making a request', async () => {
      const result = await integration.testConnection({
        url: '',
        apiToken: '',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('required')
      expect(mockAxiosGet).not.toHaveBeenCalled()
    })

    test('rejects malformed URL', async () => {
      const result = await integration.testConnection({
        url: 'not a url',
        apiToken: 'abc',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('not a valid')
      expect(mockAxiosGet).not.toHaveBeenCalled()
    })

    test('rejects unsupported protocol', async () => {
      const result = await integration.testConnection({
        url: 'ftp://dawarich.example.com',
        apiToken: 'abc',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('http')
      expect(mockAxiosGet).not.toHaveBeenCalled()
    })

    test('hits /api/v1/stats with Bearer token', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { totalDistanceKm: 0 } })
      await integration.testConnection({
        url: 'https://dawarich.example.com',
        apiToken: 'secret',
      })
      const [url, config] = mockAxiosGet.mock.calls[0]
      expect(url).toBe('https://dawarich.example.com/api/v1/stats')
      expect(config.headers.Authorization).toBe('Bearer secret')
    })

    test('strips path from configured URL when probing', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: {} })
      await integration.testConnection({
        url: 'https://dawarich.example.com/some/path/',
        apiToken: 'secret',
      })
      const [url] = mockAxiosGet.mock.calls[0]
      expect(url).toBe('https://dawarich.example.com/api/v1/stats')
    })

    test('returns success on 2xx', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: {} })
      const result = await integration.testConnection({
        url: 'https://dawarich.example.com',
        apiToken: 'good',
      })
      expect(result.success).toBe(true)
    })

    test('reports "Invalid API token" on 401', async () => {
      const err: any = new Error('401')
      err.response = { status: 401 }
      mockAxiosGet.mockRejectedValueOnce(err)
      const result = await integration.testConnection({
        url: 'https://dawarich.example.com',
        apiToken: 'bad',
      })
      expect(result.success).toBe(false)
      expect(result.message).toBe('Invalid API token')
    })

    test('reports "Invalid API token" on 403', async () => {
      const err: any = new Error('403')
      err.response = { status: 403 }
      mockAxiosGet.mockRejectedValueOnce(err)
      const result = await integration.testConnection({
        url: 'https://dawarich.example.com',
        apiToken: 'bad',
      })
      expect(result.success).toBe(false)
      expect(result.message).toBe('Invalid API token')
    })

    test('reports a Dawarich-specific message on 404', async () => {
      const err: any = new Error('404')
      err.response = { status: 404 }
      mockAxiosGet.mockRejectedValueOnce(err)
      const result = await integration.testConnection({
        url: 'https://example.com',
        apiToken: 'abc',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('Dawarich')
    })

    test('reports timeout when axios aborts', async () => {
      const err: any = new Error('timeout')
      err.code = 'ECONNABORTED'
      mockAxiosGet.mockRejectedValueOnce(err)
      const result = await integration.testConnection({
        url: 'https://dawarich.example.com',
        apiToken: 'abc',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('timed out')
    })

    test('reports unreachable host on DNS / refused', async () => {
      const err: any = new Error('refused')
      err.code = 'ECONNREFUSED'
      mockAxiosGet.mockRejectedValueOnce(err)
      const result = await integration.testConnection({
        url: 'https://nope.example.com',
        apiToken: 'abc',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('reach')
    })

    test('falls through to generic message on unknown error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('boom'))
      const result = await integration.testConnection({
        url: 'https://dawarich.example.com',
        apiToken: 'abc',
      })
      expect(result.success).toBe(false)
      expect(result.message).toContain('boom')
    })
  })
})
