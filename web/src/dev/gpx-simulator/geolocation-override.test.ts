/**
 * Geolocation override — verifies the safety contract:
 *
 *   - When the simulator is stopped, calls to `navigator.geolocation`
 *     pass straight through to the real (or test-stubbed) browser API.
 *     If this regressed, the production app could see fake GPS or no
 *     GPS at all in dev — both bad outcomes.
 *
 *   - When the simulator is playing or paused, calls receive simulated
 *     coordinates derived from the current track point. Real-GPS
 *     callbacks must NOT reach consumers in this state.
 *
 * The override mutates `navigator.geolocation` once at install time;
 * tests share a single override across cases (the module is a
 * singleton). Per-test setup mounts a fresh fake real-geolocation so
 * we can observe what passthrough actually delivers.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  _resetForTests as _resetOverride,
  installGeolocationOverride,
} from './geolocation-override'
import type { GpxPoint } from './gpx-parser'
import { simulatorStore } from './simulator-store'

interface FakeRealGeo {
  watchers: Map<
    number,
    { onSuccess: PositionCallback; onError?: PositionErrorCallback | null }
  >
  emit: (pos: GeolocationPosition) => void
  cleared: number[]
  watchPosition: ReturnType<typeof vi.fn>
  getCurrentPosition: ReturnType<typeof vi.fn>
  clearWatch: ReturnType<typeof vi.fn>
}

let originalGeo: Geolocation | undefined

function makePos(lat: number, lng: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  } as GeolocationPosition
}

function installFakeRealGeo(): FakeRealGeo {
  const watchers = new Map<
    number,
    { onSuccess: PositionCallback; onError?: PositionErrorCallback | null }
  >()
  const cleared: number[] = []
  let nextId = 100

  const fake: FakeRealGeo = {
    watchers,
    cleared,
    emit(pos) {
      for (const w of watchers.values()) w.onSuccess(pos)
    },
    watchPosition: vi.fn((onSuccess, onError) => {
      const id = nextId++
      watchers.set(id, { onSuccess, onError })
      return id
    }),
    getCurrentPosition: vi.fn((onSuccess) => {
      onSuccess(makePos(10, 20))
    }),
    clearWatch: vi.fn((id: number) => {
      cleared.push(id)
      watchers.delete(id)
    }),
  }

  // Replace navigator.geolocation BEFORE installing the override so
  // the override captures `fake` as its real backing.
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    get: () => fake as unknown as Geolocation,
  })
  return fake
}

beforeEach(() => {
  originalGeo = navigator.geolocation
  // Tear down any leftover override first so each test installs fresh
  // against its own fake real-geo.
  _resetOverride()
  simulatorStore.unload()
})

afterEach(() => {
  _resetOverride()
  simulatorStore.unload()
  if (originalGeo !== undefined) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: () => originalGeo as Geolocation,
    })
  }
})

const SIMULATED_TRACK: GpxPoint[] = [
  { lat: 40, lng: -70, time: 1000, altitude: null, speed: 1, heading: 90 },
  { lat: 40, lng: -69.999, time: 2000, altitude: null, speed: 1, heading: 90 },
]

describe('geolocation-override — passthrough when stopped', () => {
  test('getCurrentPosition delegates to real geolocation', () => {
    const fake = installFakeRealGeo()
    installGeolocationOverride()

    const onSuccess = vi.fn()
    navigator.geolocation.getCurrentPosition(onSuccess)

    expect(fake.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0].coords.latitude).toBe(10)
  })

  test('watchPosition forwards real-GPS callbacks to consumer', () => {
    const fake = installFakeRealGeo()
    installGeolocationOverride()

    const onSuccess = vi.fn()
    navigator.geolocation.watchPosition(onSuccess)

    // Simulator is stopped → real GPS reaches the consumer.
    fake.emit(makePos(11, 22))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0].coords.latitude).toBe(11)
  })

  test('clearWatch reaches the underlying real watch', () => {
    const fake = installFakeRealGeo()
    installGeolocationOverride()

    const id = navigator.geolocation.watchPosition(vi.fn())
    navigator.geolocation.clearWatch(id)

    expect(fake.clearWatch).toHaveBeenCalledTimes(1)
    expect(fake.cleared.length).toBe(1)
  })
})

describe('geolocation-override — playing simulator', () => {
  test('watchPosition emits simulated coords on subscribe', () => {
    installFakeRealGeo()
    installGeolocationOverride()
    simulatorStore.load('t.gpx', SIMULATED_TRACK)
    simulatorStore.play()

    const onSuccess = vi.fn()
    navigator.geolocation.watchPosition(onSuccess)

    // Initial fire on subscribe should be the current sim point.
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0].coords.latitude).toBeCloseTo(40, 6)
    expect(onSuccess.mock.calls[0][0].coords.longitude).toBeCloseTo(-70, 6)
  })

  test('getCurrentPosition returns the simulated current point', () => {
    installFakeRealGeo()
    installGeolocationOverride()
    simulatorStore.load('t.gpx', SIMULATED_TRACK)
    simulatorStore.play()

    const onSuccess = vi.fn()
    navigator.geolocation.getCurrentPosition(onSuccess)

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0].coords.latitude).toBeCloseTo(40, 6)
  })

  test('real-GPS callbacks are dropped while sim is active', () => {
    const fake = installFakeRealGeo()
    installGeolocationOverride()

    const onSuccess = vi.fn()
    navigator.geolocation.watchPosition(onSuccess)
    onSuccess.mockClear()

    // Sim hasn't started — real GPS still passes through.
    fake.emit(makePos(99, 99))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    onSuccess.mockClear()

    simulatorStore.load('t.gpx', SIMULATED_TRACK)
    simulatorStore.play()
    onSuccess.mockClear()

    // Now real GPS is suppressed.
    fake.emit(makePos(99, 99))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  test('seek pushes the new point to subscribed watchers', () => {
    installFakeRealGeo()
    installGeolocationOverride()
    simulatorStore.load('t.gpx', SIMULATED_TRACK)
    simulatorStore.play()

    const onSuccess = vi.fn()
    navigator.geolocation.watchPosition(onSuccess)
    onSuccess.mockClear()

    simulatorStore.seek(1000) // jumps to the second point
    expect(onSuccess).toHaveBeenCalled()
    const last = onSuccess.mock.calls[onSuccess.mock.calls.length - 1][0]
    expect(last.coords.longitude).toBeCloseTo(-69.999, 6)
  })
})

describe('geolocation-override — toggling sim on and off', () => {
  test('watcher resumes real GPS after sim is stopped', () => {
    const fake = installFakeRealGeo()
    installGeolocationOverride()

    const onSuccess = vi.fn()
    navigator.geolocation.watchPosition(onSuccess)
    onSuccess.mockClear()

    // Active sim → real GPS suppressed.
    simulatorStore.load('t.gpx', SIMULATED_TRACK)
    simulatorStore.play()
    onSuccess.mockClear()
    fake.emit(makePos(50, 60))
    expect(onSuccess).not.toHaveBeenCalled()

    // Stop sim → real GPS reaches consumer again.
    simulatorStore.stop()
    simulatorStore.unload()
    onSuccess.mockClear()
    fake.emit(makePos(50, 60))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0].coords.latitude).toBe(50)
  })
})

describe('geolocation-override — install idempotence', () => {
  test('safe to call install twice (second call is a no-op)', () => {
    installFakeRealGeo()
    installGeolocationOverride()
    // The second install must not re-wrap navigator.geolocation
    // (would compose two proxies and break passthrough).
    installGeolocationOverride()

    const onSuccess = vi.fn()
    navigator.geolocation.getCurrentPosition(onSuccess)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})
