import type { LngLat } from '@/types/map.types'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import type { NavSegmentInput } from './nav-route'

/** Start the new route where the traveller will be, so it doesn't open behind them. */
export const REROUTE_LEAD_SECONDS = 8

export function rerouteOrigin(position: LngLat, heading: number | null, speed: number | null): LngLat {
  if (heading == null || !speed || speed < 1) return position
  return projectLatLng(position, speed, heading, REROUTE_LEAD_SECONDS)
}

/** The leg after a reroute: the fresh segment, then whatever followed the one replaced. */
export function spliceReroute<T extends NavSegmentInput>(segments: T[], replaced: number, fresh: Partial<T>): T[] {
  const current = segments[replaced]
  if (!current) return segments
  return [{ ...current, ...fresh }, ...segments.slice(replaced + 1)]
}
