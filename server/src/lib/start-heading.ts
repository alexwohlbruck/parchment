/** How the traveller is moving at the origin: compass degrees and m/s. */
export interface StartMotion {
  heading?: number
  speed?: number
}

/** Above this a cyclist is riding with traffic and cannot simply turn round. */
export const HELD_CYCLING_SPEED = 4

/** Whether the route must leave the way the traveller faces, rather than have them turn round. */
export function holdsStartHeading(mode: string, speed: number | null | undefined): boolean {
  if (mode === 'driving') return true
  if (mode === 'cycling' || mode === 'biking') return (speed ?? 0) > HELD_CYCLING_SPEED
  return false
}

/** The heading to hold the router to at the start of a `mode` segment, if any. */
export function startHeading(origin: StartMotion | undefined, mode: string): number | undefined {
  if (origin?.heading == null || !Number.isFinite(origin.heading)) return undefined
  return holdsStartHeading(mode, origin.speed) ? origin.heading : undefined
}
