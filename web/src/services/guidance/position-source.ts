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

/** The apps read the OS location service, which keeps delivering with the screen off. */
function watchNative(onFix: (fix: Fix) => void): () => void {
  let stopped = false
  let id: number | null = null
  void (async () => {
    const geolocation = await import('@tauri-apps/plugin-geolocation')
    const { location } = await geolocation.checkPermissions()
    if (location !== 'granted') await geolocation.requestPermissions(['location'])
    if (stopped) return
    id = await geolocation.watchPosition(WATCH_OPTIONS, position => {
      if (position) onFix(toFix(position))
    })
    if (stopped) void geolocation.clearWatch(id)
  })()
  return () => {
    stopped = true
    if (id != null) void import('@tauri-apps/plugin-geolocation').then(g => g.clearWatch(id!))
  }
}

function watchBrowser(handlers: PositionSourceHandlers): () => void {
  const watchId = navigator.geolocation.watchPosition(
    position => handlers.onFix(toFix(position)),
    error => handlers.onError?.(error),
    WATCH_OPTIONS,
  )
  return () => navigator.geolocation.clearWatch(watchId)
}

export function startPositionSource(handlers: PositionSourceHandlers): () => void {
  // The dev simulator stands in for navigator.geolocation, so it always takes that path.
  const stopWatch = isTauri && !simulatorActive() ? watchNative(handlers.onFix) : watchBrowser(handlers)

  const onDeviceMotion = (event: DeviceMotionEvent) => {
    const sample = toMotion(event)
    if (sample) handlers.onMotion?.(sample)
  }
  if (handlers.onMotion) window.addEventListener('devicemotion', onDeviceMotion)

  return () => {
    stopWatch()
    window.removeEventListener('devicemotion', onDeviceMotion)
  }
}
