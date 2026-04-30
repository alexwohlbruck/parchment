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

  // ── getPlaceVisitHistory ────────────────────────────────────────────────────

  describe('getPlaceVisitHistory', () => {
    const credentials = {
      endpoint: 'https://dawarich.example.com',
      token: 'tkn',
    }
    const targetLat = 35.21694
    const targetLng = -80.820281

    function visitsPage(visits: any[], totalPages = 1) {
      return Promise.resolve({
        data: visits,
        headers: { 'x-total-pages': String(totalPages) },
      })
    }

    test('returns empty when no visits fall in the bbox', async () => {
      mockAxiosGet.mockImplementationOnce(() => visitsPage([]))
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(0)
      expect(result.recentVisits).toEqual([])
      expect(result.lastVisit).toBeNull()
    })

    test('returns empty when bbox visits all sit outside the radius', async () => {
      // Visit's place coordinates are far from the target — Haversine > 75 m
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          {
            id: 1,
            started_at: '2026-04-26T13:00:00-04:00',
            ended_at: '2026-04-26T13:30:00-04:00',
            place: { id: 99, latitude: 0, longitude: 0 },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(0)
    })

    test('counts visits across all place_ids within the radius (not just the closest)', async () => {
      // Dawarich often splits visits at the same physical spot across
      // multiple place IDs due to GPS drift / re-detection. Both should
      // count toward the total.
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          {
            id: 100,
            started_at: '2026-04-26T13:00:00-04:00',
            ended_at: '2026-04-26T13:30:00-04:00',
            place: { id: 1, latitude: targetLat + 0.00005, longitude: targetLng },
          },
          {
            id: 101,
            started_at: '2026-04-25T10:00:00-04:00',
            ended_at: '2026-04-25T10:15:00-04:00',
            place: { id: 2, latitude: targetLat + 0.0003, longitude: targetLng },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(2)
      expect(result.recentVisits).toHaveLength(2)
    })

    test('excludes visits whose place coordinate falls outside the radius', async () => {
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          // Inside radius
          {
            id: 1,
            started_at: '2026-04-26T13:00:00-04:00',
            ended_at: '2026-04-26T13:30:00-04:00',
            place: { id: 1, latitude: targetLat, longitude: targetLng },
          },
          // ~33m off — inside default 75m radius
          {
            id: 2,
            started_at: '2026-04-25T10:00:00-04:00',
            ended_at: '2026-04-25T10:15:00-04:00',
            place: { id: 2, latitude: targetLat + 0.0003, longitude: targetLng },
          },
          // ~333m off — outside radius (bbox would still hit, but Haversine excludes)
          {
            id: 3,
            started_at: '2026-04-24T08:00:00-04:00',
            ended_at: '2026-04-24T08:45:00-04:00',
            place: { id: 3, latitude: targetLat + 0.003, longitude: targetLng },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(2)
      expect(result.recentVisits[0].id).toBe('dawarich-visit-1')
      expect(result.recentVisits[1].id).toBe('dawarich-visit-2')
    })

    test('caps recent visits at recentLimit but keeps totalVisits accurate', async () => {
      const visits = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        started_at: new Date(Date.now() - i * 86400000).toISOString(),
        ended_at: new Date(Date.now() - i * 86400000 + 600000).toISOString(),
        place: { id: 1, latitude: targetLat, longitude: targetLng },
      }))
      mockAxiosGet.mockImplementationOnce(() => visitsPage(visits))

      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
        recentLimit: 3,
      })
      expect(result.totalVisits).toBe(12)
      expect(result.recentVisits).toHaveLength(3)
    })

    test('computes totalDuration from timestamps in seconds', async () => {
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          {
            id: 1,
            started_at: '2026-04-26T13:00:00Z',
            ended_at: '2026-04-26T13:30:00Z', // 1800s
            place: { id: 1, latitude: targetLat, longitude: targetLng },
          },
          {
            id: 2,
            started_at: '2026-04-25T10:00:00Z',
            ended_at: '2026-04-25T10:10:00Z', // 600s
            place: { id: 1, latitude: targetLat, longitude: targetLng },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalDuration).toBe(2400)
    })

    test('drops visits whose place lacks coordinates', async () => {
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          {
            id: 1,
            started_at: '2026-04-26T13:00:00Z',
            ended_at: '2026-04-26T13:10:00Z',
            place: { id: 1, latitude: null, longitude: null },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(0)
    })

    test('hashes the instance URL on every response', async () => {
      mockAxiosGet.mockImplementationOnce(() => visitsPage([]))
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.source.instanceUrlHash).toMatch(/^[0-9a-f]{16}$/)
      expect(result.source.instanceUrlHash).not.toContain('dawarich')
    })

    test('expands the search radius to fit the supplied OSM bounds', async () => {
      // ~500m × 500m polygon — well outside the default 75m radius.
      // A visit ~250m from center should be counted with bounds, but
      // would have been excluded with the default radius.
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          {
            id: 1,
            started_at: '2026-04-26T13:00:00Z',
            ended_at: '2026-04-26T13:30:00Z',
            place: {
              id: 1,
              latitude: targetLat + 0.00225, // ~250m north
              longitude: targetLng,
            },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
        bounds: {
          minLat: targetLat - 0.00225,
          maxLat: targetLat + 0.00225,
          minLng: targetLng - 0.00275,
          maxLng: targetLng + 0.00275,
        },
      })
      expect(result.totalVisits).toBe(1)
    })

    test('falls back to default radius when bounds are tiny (single OSM node)', async () => {
      // Bounds collapse to a point — half-diagonal is 0; we still want the
      // default 75 m floor so a node-style place isn't shrunk to nothing.
      mockAxiosGet.mockImplementationOnce(() =>
        visitsPage([
          {
            id: 1,
            started_at: '2026-04-26T13:00:00Z',
            ended_at: '2026-04-26T13:30:00Z',
            place: {
              id: 1,
              latitude: targetLat + 0.0003, // ~33m — inside default 75m
              longitude: targetLng,
            },
          },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
        bounds: {
          minLat: targetLat,
          maxLat: targetLat,
          minLng: targetLng,
          maxLng: targetLng,
        },
      })
      expect(result.totalVisits).toBe(1)
    })
  })
})
