import type { StationWalk } from '@server/types/station-guidance.types'

export interface StepSegment {
  coordinates: [number, number][]
  /** The floor to show for the step: where it ends up, for a change of level. */
  level: number | null
}

export interface LngLatBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

const known = (...levels: (number | null | undefined)[]) => levels.find(level => level != null) ?? null

/** The floor a step of the walk happens on. */
export function stepLevel(walk: StationWalk, index: number): number | null {
  const step = walk.steps?.[index]
  if (!step) return null
  const levels = walk.vertexLevels ?? []
  return known(step.toLevel, step.fromLevel, levels[step.toVertex], levels[step.fromVertex])
}

/** The stretch of the walk's line a step covers, and its floor. */
export function stepSegment(walk: StationWalk, index: number): StepSegment | null {
  const step = walk.steps?.[index]
  const line = walk.geometry?.coordinates ?? []
  if (!step || !line.length) return null
  const last = line.length - 1
  const from = Math.min(Math.max(0, step.fromVertex), last)
  const to = Math.min(Math.max(from, step.toVertex), last)
  return { coordinates: line.slice(from, to + 1), level: stepLevel(walk, index) }
}

export function lineBounds(coordinates: [number, number][]): LngLatBounds | null {
  if (!coordinates.length) return null
  const lngs = coordinates.map(([lng]) => lng)
  const lats = coordinates.map(([, lat]) => lat)
  return { minLng: Math.min(...lngs), minLat: Math.min(...lats), maxLng: Math.max(...lngs), maxLat: Math.max(...lats) }
}
