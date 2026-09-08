import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  _resetConnectivityForTests,
  configureConnectivityProbe,
  connectivityStatus,
  isOffline,
  onReconnected,
  reportServerReachable,
  reportServerUnreachable,
} from './connectivity'

describe('connectivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetConnectivityForTests()
  })

  afterEach(() => {
    _resetConnectivityForTests()
    vi.useRealTimers()
  })

  it('starts online', () => {
    expect(isOffline.value).toBe(false)
    expect(connectivityStatus.value).toBe('online')
  })

  it('goes to reconnecting when the server stops answering', () => {
    reportServerUnreachable()
    expect(isOffline.value).toBe(true)
    expect(connectivityStatus.value).toBe('reconnecting')
  })

  it('returns online on server evidence', () => {
    reportServerUnreachable()
    reportServerReachable()
    expect(isOffline.value).toBe(false)
    expect(connectivityStatus.value).toBe('online')
  })

  it('recovers via the probe once it succeeds', async () => {
    let reachable = false
    configureConnectivityProbe(async () => reachable)

    reportServerUnreachable()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(isOffline.value).toBe(true)

    reachable = true
    // Second attempt backs off to 10s.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(isOffline.value).toBe(false)
  })

  it('fires onReconnected on the offline → online edge only', async () => {
    const cb = vi.fn()
    const stop = onReconnected(cb)

    reportServerUnreachable()
    await nextTick()
    expect(cb).not.toHaveBeenCalled()

    reportServerReachable()
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)

    // Staying online doesn't re-fire.
    reportServerReachable()
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)

    stop()
  })
})
