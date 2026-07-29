/**
 * Unit tests for the Mapillary integration.
 *
 * `findNearestImage` powers the street-view preview on the place detail. The
 * radius is clamped to 50m regardless of what the caller asks for — a wider
 * search returns imagery from a different street, which reads as a wrong photo
 * rather than a missing one.
 *
 * A result with no thumbnail is unusable, so it must resolve to null rather
 * than surface a preview card with a broken image.
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

const { MapillaryIntegration } = await import('./mapillary-integration')

function imageResponse(over: Partial<any> = {}) {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'img-1',
          geometry: { coordinates: [-80.8005, 35.2005] },
          captured_at: 1735689600000,
          compass_angle: 90,
          is_pano: false,
          thumb_1024_url: 'https://images.test/img-1.jpg',
          ...over,
        },
      ],
    }),
    { status: 200 },
  )
}

/** An initialized integration with a token. */
function configured() {
  const integration = new MapillaryIntegration()
  integration.initialize({ accessToken: 'mly-token' } as any)
  return integration
}

beforeEach(() => {
  fetchCalls.length = 0
  fetchResponse = null
  fetchError = null
})

describe('configuration', () => {
  test('validates that an access token is present', () => {
    const integration = new MapillaryIntegration()

    expect(integration.validateConfig({ accessToken: 'token' } as any)).toBe(true)
    expect(integration.validateConfig({ accessToken: '' } as any)).toBe(false)
  })

  test('returns null before a token is configured, without a request', async () => {
    const integration = new MapillaryIntegration()

    expect(await integration.findNearestImage(35.2, -80.8)).toBeNull()
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('findNearestImage', () => {
  test('maps the nearest image into a preview', async () => {
    fetchResponse = imageResponse()

    const preview = await configured().findNearestImage(35.2, -80.8)

    expect(preview).toMatchObject({
      imageId: 'img-1',
      thumbUrl: 'https://images.test/img-1.jpg',
      isPano: false,
      capturedAt: 1735689600000,
      compassAngle: 90,
      lat: 35.2005,
      lng: -80.8005,
    })
  })

  test('computes the distance to the image in whole metres', async () => {
    fetchResponse = imageResponse()

    const preview = await configured().findNearestImage(35.2, -80.8)

    expect(Number.isInteger(preview!.distanceMeters)).toBe(true)
    expect(preview!.distanceMeters).toBeGreaterThan(0)
    expect(preview!.distanceMeters).toBeLessThan(100)
  })

  test('sends the access token and requested fields', async () => {
    fetchResponse = imageResponse()

    await configured().findNearestImage(35.2, -80.8)

    const url = new URL(fetchCalls[0])
    expect(url.origin + url.pathname).toBe('https://graph.mapillary.com/images')
    expect(url.searchParams.get('access_token')).toBe('mly-token')
    expect(url.searchParams.get('fields')).toContain('thumb_1024_url')
    expect(url.searchParams.get('limit')).toBe('1')
  })

  test('defaults the search radius to 50m', async () => {
    fetchResponse = imageResponse()

    await configured().findNearestImage(35.2, -80.8)

    expect(new URL(fetchCalls[0]).searchParams.get('radius')).toBe('50')
  })

  test('clamps a wider requested radius to 50m', async () => {
    // A wider search returns imagery from a different street entirely.
    fetchResponse = imageResponse()

    await configured().findNearestImage(35.2, -80.8, 5000)

    expect(new URL(fetchCalls[0]).searchParams.get('radius')).toBe('50')
  })

  test('honours a narrower requested radius', async () => {
    fetchResponse = imageResponse()

    await configured().findNearestImage(35.2, -80.8, 10)

    expect(new URL(fetchCalls[0]).searchParams.get('radius')).toBe('10')
  })

  test('returns null when no imagery is nearby', async () => {
    fetchResponse = new Response(JSON.stringify({ data: [] }), { status: 200 })

    expect(await configured().findNearestImage(35.2, -80.8)).toBeNull()
  })

  test('returns null when the response has no data field', async () => {
    fetchResponse = new Response('{}', { status: 200 })

    expect(await configured().findNearestImage(35.2, -80.8)).toBeNull()
  })

  test('returns null for an image with no thumbnail', async () => {
    // A preview card with no image is worse than no card.
    fetchResponse = imageResponse({ thumb_1024_url: undefined })

    expect(await configured().findNearestImage(35.2, -80.8)).toBeNull()
  })

  test('falls back to the query coordinates when geometry is absent', async () => {
    fetchResponse = imageResponse({ geometry: undefined })

    const preview = await configured().findNearestImage(35.2, -80.8)

    expect(preview).toMatchObject({ lat: 35.2, lng: -80.8, distanceMeters: 0 })
  })

  test('reports a panorama', async () => {
    fetchResponse = imageResponse({ is_pano: true })

    expect((await configured().findNearestImage(35.2, -80.8))!.isPano).toBe(true)
  })

  test('coerces a missing is_pano to false', async () => {
    fetchResponse = imageResponse({ is_pano: undefined })

    expect((await configured().findNearestImage(35.2, -80.8))!.isPano).toBe(false)
  })

  test('throws on an upstream error so the caller can decide', async () => {
    fetchResponse = new Response('rate limited', { status: 429 })

    await expect(configured().findNearestImage(35.2, -80.8)).rejects.toThrow(
      'Mapillary image search failed: 429',
    )
  })

  test('propagates a network failure', async () => {
    fetchError = new Error('ETIMEDOUT')

    await expect(configured().findNearestImage(35.2, -80.8)).rejects.toThrow(
      'ETIMEDOUT',
    )
  })
})
