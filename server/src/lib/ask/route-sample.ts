import type { LatLng } from '../../types/ask.types'

/** At most `max` points from a line, evenly spaced and keeping both ends. */
export function samplePoints<T extends LatLng>(points: T[], max: number): T[] {
  if (points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)])
}
