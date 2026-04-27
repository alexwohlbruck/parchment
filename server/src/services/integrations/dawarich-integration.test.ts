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

    function placesPage(places: any[], totalPages = 1) {
      return Promise.resolve({
        data: places,
        headers: { 'x-total-pages': String(totalPages) },
      })
    }
    function visitsPage(visits: any[], totalPages = 1) {
      return Promise.resolve({
        data: visits,
        headers: { 'x-total-pages': String(totalPages) },
      })
    }

    test('returns empty when no nearby place is found within radius', async () => {
      // Far away from target — Haversine > 75 m
      mockAxiosGet.mockImplementationOnce(() =>
        placesPage([
          { id: 1, name: 'Far Place', latitude: 0, longitude: 0, visits_count: 10 },
        ]),
      )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(0)
      expect(result.recentVisits).toEqual([])
    })

    test('matches the closest place within the radius', async () => {
      mockAxiosGet
        .mockImplementationOnce(() =>
          placesPage([
            // 5m off
            { id: 1, name: 'A', latitude: targetLat + 0.00005, longitude: targetLng, visits_count: 7 },
            // 30m off
            { id: 2, name: 'B', latitude: targetLat + 0.0003, longitude: targetLng, visits_count: 3 },
          ]),
        )
        .mockImplementationOnce(() =>
          visitsPage([
            {
              id: 100,
              started_at: '2026-04-26T13:00:00-04:00',
              ended_at: '2026-04-26T13:30:00-04:00',
              place: { id: 1 },
            },
          ]),
        )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      // visits_count from the matched place wins, not the visits-list count
      expect(result.totalVisits).toBe(7)
      expect(result.lastVisit).toContain('2026-04-26')
      expect(result.recentVisits).toHaveLength(1)
    })

    test('filters bbox visits to only the matched place', async () => {
      mockAxiosGet
        .mockImplementationOnce(() =>
          placesPage([
            { id: 1, name: 'Target', latitude: targetLat, longitude: targetLng, visits_count: 5 },
          ]),
        )
        .mockImplementationOnce(() =>
          visitsPage([
            { id: 1, started_at: '2026-04-26T13:00:00-04:00', ended_at: '2026-04-26T13:30:00-04:00', place: { id: 1 } },
            { id: 2, started_at: '2026-04-25T10:00:00-04:00', ended_at: '2026-04-25T10:15:00-04:00', place: { id: 999 } },
            { id: 3, started_at: '2026-04-24T08:00:00-04:00', ended_at: '2026-04-24T08:45:00-04:00', place: { id: 1 } },
          ]),
        )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      // Only place_id=1 visits (2 of 3 returned by the bbox)
      expect(result.recentVisits).toHaveLength(2)
      // Newest first
      expect(result.recentVisits[0].id).toBe('dawarich-visit-1')
      expect(result.recentVisits[1].id).toBe('dawarich-visit-3')
    })

    test('caps recent visits at recentLimit, but totalVisits remains accurate', async () => {
      const places = [
        { id: 1, name: 'P', latitude: targetLat, longitude: targetLng, visits_count: 50 },
      ]
      const visits = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        started_at: new Date(Date.now() - i * 86400000).toISOString(),
        ended_at: new Date(Date.now() - i * 86400000 + 600000).toISOString(),
        place: { id: 1 },
      }))
      mockAxiosGet
        .mockImplementationOnce(() => placesPage(places))
        .mockImplementationOnce(() => visitsPage(visits))

      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
        recentLimit: 3,
      })
      expect(result.totalVisits).toBe(50)
      expect(result.recentVisits).toHaveLength(3)
    })

    test('computes totalDuration from timestamps in seconds', async () => {
      mockAxiosGet
        .mockImplementationOnce(() =>
          placesPage([
            { id: 1, name: 'P', latitude: targetLat, longitude: targetLng, visits_count: 2 },
          ]),
        )
        .mockImplementationOnce(() =>
          visitsPage([
            { id: 1, started_at: '2026-04-26T13:00:00Z', ended_at: '2026-04-26T13:30:00Z', place: { id: 1 } }, // 1800s
            { id: 2, started_at: '2026-04-25T10:00:00Z', ended_at: '2026-04-25T10:10:00Z', place: { id: 1 } }, // 600s
          ]),
        )
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalDuration).toBe(2400)
    })

    test('falls back to visits_count when bbox returns no matching visits', async () => {
      mockAxiosGet
        .mockImplementationOnce(() =>
          placesPage([
            { id: 1, name: 'P', latitude: targetLat, longitude: targetLng, visits_count: 12 },
          ]),
        )
        // Bbox is empty (e.g. very large place history; visits not in this radius slice)
        .mockImplementationOnce(() => visitsPage([]))
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.totalVisits).toBe(12)
      expect(result.recentVisits).toEqual([])
      expect(result.lastVisit).toBeNull()
    })

    test('hashes the instance URL on every response', async () => {
      mockAxiosGet
        .mockImplementationOnce(() => placesPage([]))
      const result = await integration.getPlaceVisitHistory(credentials, {
        lat: targetLat,
        lng: targetLng,
      })
      expect(result.source.instanceUrlHash).toMatch(/^[0-9a-f]{16}$/)
      expect(result.source.instanceUrlHash).not.toContain('dawarich')
    })
  })
})
