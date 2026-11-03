// Watching the bike share station a trip depends on: is it likely to have a
// bike (or a free dock) when the rider gets there?

import type { LngLat } from '@/types/map.types'

export type DockNeed = 'bike' | 'dock'
export type DockRisk = 'ok' | 'at-risk' | 'gone'

export interface DockSample {
  t: number
  available: number
}

export interface WatchedDock {
  /** The segment ending at the station; it and the next are replanned on a switch. */
  boundary: number
  need: DockNeed
  location: LngLat
  name?: string
}

interface DockSegment {
  mode: string
  ownership?: string
  geometry?: LngLat[]
  sharedMobilityDetails?: { stationName?: string; toStationName?: string } | null
}

/** Fewer than this at arrival is cutting it close. */
export const DOCK_MIN = 3
const TREND_SAMPLES = 5
const NEAR_METERS = 1000
const NEAR_SECONDS = 300

const isSharedRide = (s?: DockSegment) => !!s && (s.mode === 'cycling' || s.mode === 'biking') && s.ownership === 'shared'

/** The station that matters from the segment the rider is on: the dock while riding, the bike while walking to it. */
export function watchedDock(segments: DockSegment[], current: number): WatchedDock | null {
  const here = segments[current]
  const next = segments[current + 1]
  if (isSharedRide(here)) {
    const end = here.geometry?.at(-1)
    return end ? { boundary: current, need: 'dock', location: end, name: here.sharedMobilityDetails?.toStationName } : null
  }
  if (here?.mode === 'walking' && isSharedRide(next)) {
    const start = next?.geometry?.[0]
    return start ? { boundary: current, need: 'bike', location: start, name: next?.sharedMobilityDetails?.stationName } : null
  }
  return null
}

/** Availability at `atMs` from a least-squares line through the latest samples, never below zero. */
export function projectAvailability(samples: DockSample[], atMs: number): number {
  const recent = samples.slice(-TREND_SAMPLES)
  const last = recent.at(-1)
  if (!last) return 0
  if (recent.length < 2) return last.available
  const meanT = recent.reduce((sum, s) => sum + s.t, 0) / recent.length
  const meanN = recent.reduce((sum, s) => sum + s.available, 0) / recent.length
  const sxx = recent.reduce((sum, s) => sum + (s.t - meanT) ** 2, 0)
  const slope = sxx > 0 ? recent.reduce((sum, s) => sum + (s.t - meanT) * (s.available - meanN), 0) / sxx : 0
  return Math.max(0, last.available + slope * (atMs - last.t))
}

export function dockRisk(samples: DockSample[], etaMs: number): DockRisk {
  const last = samples.at(-1)
  if (!last) return 'ok'
  if (last.available === 0) return 'gone'
  return projectAvailability(samples, etaMs) < DOCK_MIN ? 'at-risk' : 'ok'
}

/** Check more often once the station is close. */
export function pollInterval(distanceM: number, etaSec: number): number {
  return distanceM < NEAR_METERS || etaSec < NEAR_SECONDS ? 30_000 : 60_000
}

export interface StationSwitch {
  name: string
  location: LngLat
}

/** The leg after switching stations: both segments meeting at the old one are replanned around the new. */
export function switchStation<T extends DockSegment>(
  segments: T[],
  boundary: number,
  intoStation: Partial<T>,
  outOfStation: Partial<T>,
  station: StationSwitch,
): T[] {
  const before = segments[boundary]
  const after = segments[boundary + 1]
  if (!before || !after) return segments
  const rename = (segment: T, key: 'stationName' | 'toStationName') =>
    segment.sharedMobilityDetails ? { ...segment.sharedMobilityDetails, [key]: station.name } : segment.sharedMobilityDetails
  return [
    { ...before, ...intoStation, sharedMobilityDetails: rename(before, 'toStationName') },
    { ...after, ...outOfStation, sharedMobilityDetails: rename(after, 'stationName') },
    ...segments.slice(boundary + 2),
  ]
}
