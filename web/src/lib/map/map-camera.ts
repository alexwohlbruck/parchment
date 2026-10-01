import type { MapCamera } from '@/types/map.types'

export function resolveMapCenter(center: unknown): [number, number] {
  if (Array.isArray(center)) return [center[0], center[1]]
  const point = center as { lng?: number; lon?: number; lat?: number } | null
  if (point?.lng != null) return [point.lng, point.lat ?? 0]
  if (point?.lon != null) return [point.lon, point.lat ?? 0]
  return [0, 0]
}

export interface CameraReadout {
  coordinates: string
  zoom: string
  pitch: string
  bearing: string
}

export function formatCameraReadout(camera: MapCamera): CameraReadout {
  const [lng, lat] = resolveMapCenter(camera.center)
  return {
    coordinates: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    zoom: camera.zoom.toFixed(2),
    pitch: `${camera.pitch.toFixed(1)}°`,
    bearing: `${camera.bearing.toFixed(1)}°`,
  }
}

export function formatCameraReadoutText(camera: MapCamera): string {
  const { coordinates, zoom, pitch, bearing } = formatCameraReadout(camera)
  return `${coordinates} · z ${zoom} · pitch ${pitch} · bearing ${bearing}`
}
