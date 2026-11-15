import type { MapCamera } from '@/types/map.types'

export function toLngLat(center: MapCamera['center']): { lng: number; lat: number } {
  if (Array.isArray(center)) return { lng: center[0], lat: center[1] }
  if ('lon' in center) return { lng: center.lon, lat: center.lat }
  return { lng: center.lng, lat: center.lat }
}
