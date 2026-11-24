import type { BoardingPosition } from '@server/types/station-guidance.types'

export interface BoardingTarget {
  kind: BoardingPosition['toward']
  /** "Canal St & 6 Av" for an exit, "7" for a line. */
  name: string
}

/** Walks along the platform shorter than this aren't worth a wait hint. */
export const WAIT_WALK_MIN_S = 20
/** Time to spare on top of the walk before it is worth suggesting. */
export const WAIT_WALK_MARGIN_S = 60

/** What boarding there lines the rider up with: the exit's corner, or the line changed to. */
export function boardingTarget(position: Pick<BoardingPosition, 'toward' | 'landmark'>): BoardingTarget | null {
  const name = position.landmark?.split(' · ')[0].replace(/^the /, '').trim()
  return name ? { kind: position.toward, name } : null
}

/** Seconds left before departure when the rider can comfortably walk to the boarding spot first, else null. */
export function waitWalkSeconds(
  position: Pick<BoardingPosition, 'platformWalkSeconds'>,
  departureMs: number,
  nowMs: number,
): number | null {
  const walk = position.platformWalkSeconds
  if (walk == null || walk < WAIT_WALK_MIN_S) return null
  const left = (departureMs - nowMs) / 1000
  return left >= walk + WAIT_WALK_MARGIN_S ? left : null
}

/** Whole minutes to say for a wait, never rounding up past what is left. */
export const waitMinutes = (seconds: number) => Math.max(1, Math.floor(seconds / 60))
