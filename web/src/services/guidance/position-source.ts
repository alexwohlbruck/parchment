// Geolocation + DeviceMotion for guidance. The simulator overrides
// `navigator.geolocation` underneath, so nothing here knows about it.

import type { Fix } from '@/lib/guidance/guidance-engine'
import type { MotionSample } from '@/lib/guidance/motion'
import { isTauri } from '@/lib/api'

const simulatorActive = () =>
  import.meta.env.DEV && !!(navigator.geolocation as { simulated?: boolean }).simulated

export interface PositionSourceHandlers {
  onFix: (fix: Fix) => void
  onMotion?: (sample: MotionSample) => void
  onError?: (error: GeolocationPositionError) => void
}

type PermissionRequester = { requestPermission?: () => Promise<'granted' | 'denied'> }

/** iOS only grants motion access from a user gesture; call from the Start tap. */
export async function requestMotionPermission(): Promise<boolean> {
  const ctor = (globalThis as { DeviceMotionEvent?: PermissionRequester }).DeviceMotionEvent
  if (!ctor) return false
  if (typeof ctor.requestPermission !== 'function') return true
  try {
    return (await ctor.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

type PositionLike = Pick<GeolocationPosition, 'timestamp'> & {
  coords: Pick<GeolocationCoordinates, 'latitude' | 'longitude' | 'accuracy' | 'speed' | 'heading'>
}

function toFix(position: PositionLike): Fix {
  const { coords } = position
  return {
    t: position.timestamp / 1000,
    position: { lat: coords.latitude, lng: coords.longitude },
    accuracy: coords.accuracy,
    speed: coords.speed != null && coords.speed >= 0 ? coords.speed : null,
    heading: coords.heading != null && Number.isFinite(coords.heading) ? coords.heading : null,
  }
}

function toMotion(event: DeviceMotionEvent): MotionSample | null {
  const g = event.accelerationIncludingGravity
  const r = event.rotationRate
  if (!g || g.x == null || g.y == null || g.z == null) return null
  return {
    t: Date.now() / 1000,
    accelWithGravity: { x: g.x, y: g.y, z: g.z },
    rotationRate: { x: r?.beta ?? 0, y: r?.gamma ?? 0, z: r?.alpha ?? 0 },
  }
}

const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }

export interface PositionSource {
  stop: () => void
  /** How often to ask for a fix. The browser decides for itself, so only the apps honour it. */
  setFixInterval: (ms: number) => void
}

/**
 * The apps read the OS location service, which keeps delivering with the screen off.
 * The Android plugin uses `timeout` as the update interval; iOS ignores it.
 */
function watchNative(onFix: (fix: Fix) => void, intervalMs: number): PositionSource {
  let stopped = false
  let id: number | null = null
  let pending = Promise.resolve()
  const geolocation = import('@tauri-apps/plugin-geolocation')

  const rewatch = (ms: number) => {
    pending = pending.then(async () => {
      const plugin = await geolocation
      if (id != null) await plugin.clearWatch(id)
      id = null
      if (stopped) return
      id = await plugin.watchPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: ms }, position => {
        if (position && !stopped) onFix(toFix(position))
      })
    }).catch(() => {})
  }

  pending = geolocation.then(async plugin => {
    const { location } = await plugin.checkPermissions()
    if (location !== 'granted') await plugin.requestPermissions(['location'])
  }).catch(() => {})
  rewatch(intervalMs)

  return {
    stop: () => {
      stopped = true
      rewatch(intervalMs)
    },
    setFixInterval: ms => {
      if (ms !== intervalMs) rewatch((intervalMs = ms))
    },
  }
}

function watchBrowser(handlers: PositionSourceHandlers): PositionSource {
  const watchId = navigator.geolocation.watchPosition(
    position => handlers.onFix(toFix(position)),
    error => handlers.onError?.(error),
    WATCH_OPTIONS,
  )
  return { stop: () => navigator.geolocation.clearWatch(watchId), setFixInterval: () => {} }
}

export function startPositionSource(handlers: PositionSourceHandlers, intervalMs: number): PositionSource {
  // The dev simulator stands in for navigator.geolocation, so it always takes that path.
  const watch = isTauri && !simulatorActive() ? watchNative(handlers.onFix, intervalMs) : watchBrowser(handlers)

  const onDeviceMotion = (event: DeviceMotionEvent) => {
    const sample = toMotion(event)
    if (sample) handlers.onMotion?.(sample)
  }
  if (handlers.onMotion) window.addEventListener('devicemotion', onDeviceMotion)

  return {
    stop: () => {
      watch.stop()
      window.removeEventListener('devicemotion', onDeviceMotion)
    },
    setFixInterval: watch.setFixInterval,
  }
}
