import type { LngLat } from '@/types/map.types'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import type { NavSegmentInput } from './nav-route'

/** Start the new route where the traveller will be, so it doesn't open behind them. */
export const REROUTE_LEAD_SECONDS = 8

export function rerouteOrigin(position: LngLat, heading: number | null, speed: number | null): LngLat {
  if (heading == null || !speed || speed < 1) return position
  return projectLatLng(position, speed, heading, REROUTE_LEAD_SECONDS)
}

/** A segment without what was drawn from its old geometry, which a fresh one replaces. */
function withoutLanes<T extends NavSegmentInput>(segment: T): T {
  const { laneGeometry: _geometry, lanePlan: _plan, ...rest } = segment
  return rest as T
}

/** The leg after a reroute: the fresh segment, then whatever followed the one replaced. */
export function spliceReroute<T extends NavSegmentInput>(segments: T[], replaced: number, fresh: Partial<T>): T[] {
  const current = segments[replaced]
  if (!current) return segments
  return [{ ...withoutLanes(current), ...fresh }, ...segments.slice(replaced + 1)]
}

/** The leg after switching to another transit plan at segment `from`: its segments, ending where the leg did. */
export function adoptItinerary<T extends NavSegmentInput & { legIndex?: number; end?: unknown }>(segments: T[], from: number, fresh: T[]): T[] {
  const legIndex = segments[from]?.legIndex
  const end = segments.at(-1)?.end
  return fresh.map((segment, i) => ({ ...segment, legIndex, ...(i === fresh.length - 1 ? { end } : {}) }))
}

export interface AddedStop {
  label?: string
  location: LngLat
}

/** A stop added mid-segment: this leg now ends there, and the rest of the segment follows as the next. */
export function splitAtStop<T extends NavSegmentInput & { end?: { label?: string; location?: LngLat } }>(
  segments: T[],
  index: number,
  toStop: Partial<T>,
  fromStop: Partial<T>,
  stop: AddedStop,
): { leg: T[]; continuation: T[] } | null {
  const current = segments[index]
  if (!current) return null
  return {
    leg: [{ ...withoutLanes(current), ...toStop, end: { label: stop.label, location: stop.location } }],
    continuation: [{ ...withoutLanes(current), ...fromStop }, ...segments.slice(index + 1)],
  }
}

/** The ride at `index` now ends at `lot`, and a walk takes over to where the leg was headed. */
export function parkAndWalk<T extends NavSegmentInput & { legIndex?: number; end?: { label?: string; location?: LngLat } }>(
  segments: T[],
  index: number,
  toLot: Partial<T>,
  walk: Partial<T>,
  lot: AddedStop,
): T[] {
  const ride = segments[index]
  if (!ride) return segments
  const next = segments[index + 1]
  const walksOn = next?.mode === 'walking'
  const base = walksOn ? withoutLanes(next) : ({ legIndex: ride.legIndex, end: ride.end } as T)
  return [
    { ...withoutLanes(ride), ...toLot, end: { label: lot.label, location: lot.location } },
    { ...base, ...walk, mode: 'walking' },
    ...segments.slice(index + (walksOn ? 2 : 1)),
  ]
}
