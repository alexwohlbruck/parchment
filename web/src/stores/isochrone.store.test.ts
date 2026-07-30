/**
 * Unit tests for the isochrone store.
 *
 * The interesting behaviour is around the request: control changes have to
 * coalesce into one call, a slow early response must not overwrite a fast
 * later one, and transit's lower duration ceiling has to be enforced before
 * the request goes out rather than bounced back as a 400.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { api } from '@/lib/api'
import { useIsochroneStore } from './isochrone.store'
import type { IsochroneResponse } from '@server/types/isochrone.types'
import { MAX_CONTOUR_MINUTES, maxMinutesForMode } from '@/lib/isochrone.utils'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const get = vi.mocked(api.get)
const ORIGIN = { lng: -78.6382, lat: 35.7796 }

/** Axis-aligned square centred on the origin, `half` degrees to a side. */
function square(half: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [ORIGIN.lng - half, ORIGIN.lat - half],
        [ORIGIN.lng + half, ORIGIN.lat - half],
        [ORIGIN.lng + half, ORIGIN.lat + half],
        [ORIGIN.lng - half, ORIGIN.lat + half],
        [ORIGIN.lng - half, ORIGIN.lat - half],
      ],
    ],
  }
}

function response(durations: number[] = [300, 600, 900]): IsochroneResponse {
  return {
    mode: 'walk',
    origin: { lat: ORIGIN.lat, lng: ORIGIN.lng },
    arriveBy: false,
    isochrones: {
      type: 'FeatureCollection',
      features: durations.map((durationSeconds, i) => ({
        type: 'Feature' as const,
        properties: {
          mode: 'walk' as const,
          durationSeconds,
          durationMinutes: durationSeconds / 60,
          bucket: i,
        },
        geometry: square(0.01 * (i + 1)),
      })),
    },
    meta: { durations, computeMs: 12 },
  }
}

/** Params of the Nth `api.get` call. */
function paramsOf(call: number): Record<string, unknown> {
  return (get.mock.calls[call]?.[1] as { params: Record<string, unknown> })
    .params
}

describe('useIsochroneStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    get.mockReset()
    get.mockResolvedValue({ data: response() } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setOrigin', () => {
    test('requests immediately and turns the contours into bands', async () => {
      const store = useIsochroneStore()

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      expect(get).toHaveBeenCalledTimes(1)
      expect(get.mock.calls[0][0]).toBe('/isochrone')
      expect(store.status).toBe('ready')
      expect(store.bands).toHaveLength(3)
    })

    test('sends the origin, mode and evenly spaced durations', async () => {
      const store = useIsochroneStore()

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      expect(paramsOf(0)).toMatchObject({
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        mode: 'walk',
        durations: '300,600,900',
      })
    })

    test('omits arriveBy unless it is on — a reverse isochrone costs more', async () => {
      const store = useIsochroneStore()

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()
      expect(paramsOf(0).arriveBy).toBeUndefined()

      store.setArriveBy(true)
      await vi.runAllTimersAsync()
      expect(paramsOf(1).arriveBy).toBe(true)
    })

    test('clearing the origin drops the result without another request', async () => {
      const store = useIsochroneStore()
      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      store.setOrigin(null)
      await vi.runAllTimersAsync()

      expect(get).toHaveBeenCalledTimes(1)
      expect(store.origin).toBeNull()
      expect(store.bands).toEqual([])
      expect(store.status).toBe('empty')
    })
  })

  describe('control changes', () => {
    test('coalesce a slider drag into a single request', async () => {
      const store = useIsochroneStore()
      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()
      get.mockClear()

      store.setMaxMinutes(20)
      store.setMaxMinutes(25)
      store.setMaxMinutes(30)
      await vi.runAllTimersAsync()

      expect(get).toHaveBeenCalledTimes(1)
      expect(paramsOf(0).durations).toBe('600,1200,1800')
    })

    test('show the pending state before the debounce elapses', () => {
      const store = useIsochroneStore()
      store.setOrigin(ORIGIN)

      store.setMaxMinutes(45)

      // The contours on screen no longer match the controls, so the tool says
      // so immediately rather than looking frozen for the debounce window.
      expect(store.status).toBe('loading')
    })

    test('do nothing until there is an origin to measure from', async () => {
      const store = useIsochroneStore()

      store.setMode('bike')
      store.setMaxMinutes(30)
      store.setBandCount(5)
      await vi.runAllTimersAsync()

      expect(get).not.toHaveBeenCalled()
      expect(store.status).toBe('empty')
    })

    test('band count changes the number of contours requested', async () => {
      const store = useIsochroneStore()
      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()
      get.mockClear()

      store.setBandCount(1)
      await vi.runAllTimersAsync()

      expect(paramsOf(0).durations).toBe('900')
    })
  })

  describe('mode ceilings', () => {
    test('never leaves the reach above the new mode ceiling', async () => {
      const store = useIsochroneStore()
      store.setMaxMinutes(MAX_CONTOUR_MINUTES)

      for (const mode of ['walk', 'bike', 'car', 'transit'] as const) {
        store.setMode(mode)
        expect(store.mode).toBe(mode)
        expect(store.maxMinutes).toBeLessThanOrEqual(maxMinutesForMode(mode))
      }
    })

    test('a reach past the mode ceiling is clamped, not sent', async () => {
      const store = useIsochroneStore()
      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()
      get.mockClear()

      store.setMaxMinutes(9999)
      await vi.runAllTimersAsync()

      const durations = String(paramsOf(0).durations).split(',').map(Number)
      // 60 minutes is the tool's ceiling; anything above it is a 400 upstream.
      expect(Math.max(...durations)).toBeLessThanOrEqual(60 * 60)
    })
  })

  describe('in-flight requests', () => {
    test('a slow early response never overwrites a newer one', async () => {
      const store = useIsochroneStore()
      let resolveFirst: (value: unknown) => void = () => {}
      get.mockImplementationOnce(
        () => new Promise(resolve => (resolveFirst = resolve)) as never,
      )

      store.setOrigin(ORIGIN)
      // Second request supersedes the first while it is still pending.
      store.setOrigin({ lng: -78.5, lat: 35.8 })
      await vi.runAllTimersAsync()

      resolveFirst({ data: response([1, 2]) })
      await vi.runAllTimersAsync()

      // Three bands is the second (live) response, not the stale two.
      expect(store.bands).toHaveLength(3)
      expect(store.status).toBe('ready')
    })

    test('an aborted request leaves the tool loading, not errored', async () => {
      const store = useIsochroneStore()
      get.mockRejectedValueOnce(
        Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }),
      )

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      expect(store.status).not.toBe('error')
    })
  })

  describe('failures', () => {
    test("surface Barrelman's message, which names the offending parameter", async () => {
      const store = useIsochroneStore()
      get.mockRejectedValueOnce({
        response: { data: { error: 'Point not found in graph' } },
      })

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      expect(store.status).toBe('error')
      expect(store.error).toBe('Point not found in graph')
    })

    test('a plain-text body still says something useful', async () => {
      const store = useIsochroneStore()
      // What a server predating the isochrone route returns: Elysia's own
      // 404, whose body is text rather than our JSON error shape. Without
      // handling it the panel showed only "Request failed with status code
      // 404", which says nothing about the endpoint being missing.
      get.mockRejectedValueOnce({
        response: { status: 404, data: 'NOT_FOUND' },
        message: 'Request failed with status code 404',
      })

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      expect(store.status).toBe('error')
      expect(store.error).toBe('404 NOT_FOUND')
    })

    test('an empty contour set reads as unreachable, not as success', async () => {
      const store = useIsochroneStore()
      get.mockResolvedValueOnce({ data: response([]) } as never)

      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      expect(store.status).toBe('error')
      expect(store.error).toBe('unreachable')
      expect(store.bands).toEqual([])
    })

    test('retry re-runs the request against the same origin', async () => {
      const store = useIsochroneStore()
      get.mockRejectedValueOnce(new Error('offline'))
      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()
      expect(store.status).toBe('error')

      store.retry()
      await vi.runAllTimersAsync()

      expect(store.status).toBe('ready')
      expect(store.bands).toHaveLength(3)
    })
  })

  describe('derived state', () => {
    test('durations track the reach and band count', () => {
      const store = useIsochroneStore()

      store.setMaxMinutes(30)
      store.setBandCount(3)

      expect(store.durations).toEqual([600, 1200, 1800])
    })

    test('clear resets every field back to empty', async () => {
      const store = useIsochroneStore()
      store.setOrigin(ORIGIN)
      await vi.runAllTimersAsync()

      store.clear()

      expect(store.origin).toBeNull()
      expect(store.bands).toEqual([])
      expect(store.meta).toBeNull()
      expect(store.error).toBeNull()
      expect(store.status).toBe('empty')
    })
  })
})
