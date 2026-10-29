/**
 * Transparent override of `navigator.geolocation`.
 *
 * When the simulator is not playing, the override forwards calls and
 * watch updates to the real Geolocation API — the rest of the app is
 * indistinguishable from the un-overridden case. When the simulator is
 * playing, the override emits coordinates derived from the current
 * track point and stops forwarding real GPS to consumers.
 *
 * Install once at app boot, before any `watchPosition` consumer
 * subscribes. The override stays installed forever (idempotent on
 * repeat calls) — toggling between real and simulated GPS is done via
 * `simulatorStore.play()` / `pause()` / `stop()`.
 */

import { simulatorStore } from './simulator-store'
import type { GpxPoint } from './gpx-parser'
import { FixNoise, type NoisyFix } from './fix-model'

interface ManagedWatcher {
  onSuccess: PositionCallback
  onError: PositionErrorCallback | null
  realId: number
  /**
   * Last sim point sent to this watcher. Lets us skip emitting when
   * the current point hasn't changed, which can happen between
   * sub-meter ticks.
   */
  lastPoint: GpxPoint | null
}

let installed = false
let originalGeolocationDescriptor: PropertyDescriptor | undefined
let unsubscribeStore: (() => void) | undefined
let fixTimer: ReturnType<typeof setInterval> | null = null

export function installGeolocationOverride() {
  if (installed) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  installed = true
  originalGeolocationDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'geolocation',
  )

  // Capture the real Geolocation. Bind methods so they can be invoked
  // detached without a `this` reference.
  const real = navigator.geolocation
  const realGetCurrentPosition = real.getCurrentPosition.bind(real)
  const realWatchPosition = real.watchPosition.bind(real)
  const realClearWatch = real.clearWatch.bind(real)

  const watchers = new Map<number, ManagedWatcher>()
  let nextId = 1

  function isSimulating(): boolean {
    const s = simulatorStore.getState()
    return s.status === 'playing' || s.status === 'paused'
  }

  function makePosition(
    point: Omit<NoisyFix, 'accuracy'> & { accuracy?: number },
    timestamp = Date.now(),
  ): GeolocationPosition {
    const coords = {
      latitude: point.lat,
      longitude: point.lng,
      accuracy: point.accuracy ?? 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: point.heading,
      speed: point.speed,
    }
    return {
      coords: {
        ...coords,
        // Some libraries call `.toJSON()`. Provide a stub.
        toJSON() {
          return coords
        },
      },
      timestamp,
      toJSON() {
        return {
          coords: this.coords,
          timestamp: this.timestamp,
        }
      },
    } as GeolocationPosition
  }

  let lastNoisy: GeolocationPosition | null = null
  let noise: FixNoise | null = null

  function emitNoisyFix() {
    const state = simulatorStore.getState()
    const model = state.fixModel
    if (!model || state.status === 'stopped' || simulatorStore.inOutage()) return
    noise ??= new FixNoise(model, Math.floor(Math.random() * 1e9))
    const truth = simulatorStore.pointAtOffset(-model.latencyMs * state.playbackRate)
    if (!truth) return
    // Playback compresses time, so reported speed scales with it.
    const scaled = { ...truth, speed: truth.speed * state.playbackRate }
    const fix = noise.next(scaled, (model.intervalMs * state.playbackRate) / 1000)
    if (!fix) return
    lastNoisy = makePosition(fix, Date.now() - model.latencyMs)
    for (const w of watchers.values()) {
      try {
        w.onSuccess(lastNoisy)
      } catch (err) {
        console.error('[gpx-sim] watcher onSuccess threw:', err)
      }
    }
  }

  function syncFixTimer() {
    const state = simulatorStore.getState()
    const wanted = state.fixModel && state.status !== 'stopped'
    if (wanted && !fixTimer) {
      fixTimer = setInterval(emitNoisyFix, state.fixModel!.intervalMs)
    } else if (!wanted && fixTimer) {
      clearInterval(fixTimer)
      fixTimer = null
      noise = null
      lastNoisy = null
    }
  }

  const fakeGeo: Geolocation & { readonly simulated: boolean } = {
    /** Read by guidance, which otherwise prefers the apps' native location service. */
    get simulated() {
      return isSimulating()
    },
    getCurrentPosition(onSuccess, onError, options) {
      if (isSimulating() && lastNoisy) {
        onSuccess(lastNoisy)
        return
      }
      if (isSimulating() && !simulatorStore.getState().fixModel) {
        const point = simulatorStore.getState().currentPoint
        if (point) {
          try {
            onSuccess(makePosition(point))
          } catch (err) {
            console.error('[gpx-sim] getCurrentPosition success threw:', err)
          }
          return
        }
      }
      realGetCurrentPosition(onSuccess, onError ?? undefined, options)
    },

    watchPosition(onSuccess, onError, options) {
      // Always register a real watch. While the simulator is stopped,
      // real GPS updates flow through to the consumer. When the
      // simulator activates, real updates are dropped at the
      // forwarding step — but the real subscription stays alive so
      // toggling back to real GPS is instantaneous.
      const realId = realWatchPosition(
        (pos) => {
          if (!isSimulating()) {
            try {
              onSuccess(pos)
            } catch (err) {
              console.error('[gpx-sim] real watch success threw:', err)
            }
          }
        },
        onError ?? undefined,
        options,
      )

      const id = nextId++
      const w: ManagedWatcher = {
        onSuccess,
        onError: onError ?? null,
        realId,
        lastPoint: null,
      }
      watchers.set(id, w)

      // If simulator is already running, fire the current point now so
      // consumers don't wait for the next store tick.
      if (isSimulating() && !simulatorStore.getState().fixModel) {
        const point = simulatorStore.getState().currentPoint
        if (point) {
          try {
            onSuccess(makePosition(point))
            w.lastPoint = point
          } catch (err) {
            console.error('[gpx-sim] watch initial threw:', err)
          }
        }
      }

      return id
    },

    clearWatch(id) {
      const w = watchers.get(id)
      if (w) {
        realClearWatch(w.realId)
        watchers.delete(id)
      }
    },
  }

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    get: () => fakeGeo,
  })

  // Subscribe to store updates and push simulated positions to every
  // watcher when the current point changes. Per-watcher dedup avoids
  // double-emit when the store ticks but the point hasn't moved.
  unsubscribeStore = simulatorStore.subscribe((state) => {
    syncFixTimer()
    if (state.fixModel) return
    if (state.status !== 'playing' && state.status !== 'paused') return
    const point = state.currentPoint
    if (!point) return
    const pos = makePosition(point)
    for (const w of watchers.values()) {
      if (w.lastPoint === point) continue
      w.lastPoint = point
      try {
        w.onSuccess(pos)
      } catch (err) {
        console.error('[gpx-sim] watcher onSuccess threw:', err)
      }
    }
  })
}

/**
 * Testing hook — restore the original navigator.geolocation descriptor
 * and clear the installed flag so the next `installGeolocationOverride`
 * call sets up a fresh proxy. Not used in production.
 */
export function _resetForTests(): void {
  if (!installed) return
  unsubscribeStore?.()
  unsubscribeStore = undefined
  if (fixTimer) clearInterval(fixTimer)
  fixTimer = null
  if (originalGeolocationDescriptor !== undefined) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocationDescriptor)
  }
  originalGeolocationDescriptor = undefined
  installed = false
}
