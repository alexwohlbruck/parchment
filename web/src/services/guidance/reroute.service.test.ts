import { describe, test, expect, beforeEach, vi } from 'vitest'
import { NetworkErrorKind, tagNetworkError } from '@/lib/network-errors'

const post = vi.fn()
const planOffline = vi.fn()
vi.mock('@/lib/api', () => ({ api: { post: (...args: unknown[]) => post(...args) } }))
vi.mock('@/services/offline/offline-engine.service', () => ({ planOffline: (...args: unknown[]) => planOffline(...args) }))
vi.mock('@/services/layers/features/portolan/portolan-bullets', () => ({ withCuratedTripColors: (trips: unknown) => trips }))

const { requestReroute } = await import('./reroute.service')

const from = { lng: -73.99, lat: 40.735 }
const to = { lng: -73.986, lat: 40.739 }
const offlineSegment = {
  mode: 'walking',
  duration: 300,
  distance: 400,
  geometry: [from, to],
  instructions: [{ type: 'depart', text: 'Head north' }],
}

function networkError(kind: NetworkErrorKind) {
  const error = new Error('request failed')
  tagNetworkError(error, kind)
  return error
}

describe('requestReroute', () => {
  beforeEach(() => {
    post.mockReset()
    planOffline.mockReset()
    planOffline.mockResolvedValue({ trips: [{ trip: { segments: [offlineSegment] } }] })
  })

  test('plans the leg from saved areas when the server is unreachable', async () => {
    post.mockRejectedValue(networkError(NetworkErrorKind.Offline))
    const segment = await requestReroute({ position: from, heading: 10, destination: to, mode: 'biking' })

    expect(planOffline.mock.calls[0][0]).toMatchObject({ origin: from, destination: to, selectedMode: 'biking' })
    expect(segment).toEqual({ ...offlineSegment, mode: 'biking' })
  })

  test('keeps the server error when no saved area covers the leg', async () => {
    const error = networkError(NetworkErrorKind.Unreachable)
    post.mockRejectedValue(error)
    planOffline.mockResolvedValue(null)

    await expect(requestReroute({ position: from, heading: null, destination: to, mode: 'walking' })).rejects.toBe(error)
  })

  test('never plans driving on the device', async () => {
    post.mockRejectedValue(networkError(NetworkErrorKind.Offline))

    await expect(requestReroute({ position: from, heading: null, destination: to, mode: 'driving' })).rejects.toThrow()
    expect(planOffline).not.toHaveBeenCalled()
  })

  test('does not mask a server-side failure', async () => {
    post.mockRejectedValue(networkError(NetworkErrorKind.Client))

    await expect(requestReroute({ position: from, heading: null, destination: to, mode: 'walking' })).rejects.toThrow()
    expect(planOffline).not.toHaveBeenCalled()
  })
})
