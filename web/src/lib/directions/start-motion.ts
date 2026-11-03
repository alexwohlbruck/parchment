import type { StartMotion } from '@server/lib/start-heading'

/** Below this the GPS course is noise; the browser reports none at all when still. */
export const MIN_COURSE_SPEED = 1
/** iOS compass accuracy, in degrees, beyond which the reading is not worth using. */
const MAX_COMPASS_ERROR = 30

export interface HeadingSources {
  course: number | null
  speed: number | null
  compass: number | null
  compassAccuracy?: number | null
}

function usable(deg: number | null | undefined): deg is number {
  return deg != null && Number.isFinite(deg)
}

/** The way the traveller is facing: their course while moving, else a calibrated compass. */
export function travellerHeading({ course, speed, compass, compassAccuracy }: HeadingSources): number | null {
  if (usable(course) && usable(speed) && speed >= MIN_COURSE_SPEED) return course
  if (!usable(compass)) return null
  if (compassAccuracy != null && (compassAccuracy < 0 || compassAccuracy > MAX_COMPASS_ERROR)) return null
  return compass
}

/** What the trip planner is told about the traveller at a current-location origin. */
export function startMotion(sources: HeadingSources): StartMotion {
  const heading = travellerHeading(sources)
  return {
    ...(heading != null && { heading: Math.round(heading) % 360 }),
    ...(usable(sources.speed) && { speed: Math.max(0, sources.speed) }),
  }
}
