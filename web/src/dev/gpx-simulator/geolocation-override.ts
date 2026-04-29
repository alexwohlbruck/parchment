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

  function makePosition(point: GpxPoint): GeolocationPosition {
    return {
      coords: {
        latitude: point.lat,
        longitude: point.lng,
        accuracy: 5,
        altitude: point.altitude,
        altitudeAccuracy: null,
        heading: point.heading,
        speed: point.speed,
        // Some libraries call `.toJSON()`. Provide a stub.
        toJSON() {
          return {
            latitude: point.lat,
            longitude: point.lng,
            accuracy: 5,
            altitude: point.altitude,
            altitudeAccuracy: null,
            heading: point.heading,
            speed: point.speed,
          }
        },
      },
      timestamp: Date.now(),
      toJSON() {
        return {
          coords: this.coords,
          timestamp: this.timestamp,
        }
      },
    } as GeolocationPosition
  }

  const fakeGeo: Geolocation = {
    getCurrentPosition(onSuccess, onError, options) {
      if (isSimulating()) {
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
      if (isSimulating()) {
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
  if (originalGeolocationDescriptor !== undefined) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocationDescriptor)
  }
  originalGeolocationDescriptor = undefined
  installed = false
}
