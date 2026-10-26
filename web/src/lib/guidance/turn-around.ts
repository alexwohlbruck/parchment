// Walkers and slow cyclists are routed without regard to which way they face,
// so guidance tells them to turn round when they start off facing away.

import { holdsStartHeading } from '@server/lib/start-heading'
import { angleDelta, normalizeDeg } from './spring'

export const TURN_AROUND_DEGREES = 110
export const ALIGNED_DEGREES = 60
/** Progress along the route that shows the traveller found the way. */
const UNDER_WAY_METERS = 30

export const CARDINALS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const
export type Cardinal = (typeof CARDINALS)[number]

export function cardinal(bearing: number): Cardinal {
  return CARDINALS[Math.round(normalizeDeg(bearing) / 45) % 8]
}

/** Whether `mode` is routed without the start heading, so the traveller may need to turn round. */
export function turnsRound(mode: string, speed: number | null): boolean {
  return (mode === 'walking' || mode === 'cycling' || mode === 'biking') && !holdsStartHeading(mode, speed)
}

export function facesAway(heading: number, routeBearing: number): boolean {
  return Math.abs(angleDelta(heading, routeBearing)) > TURN_AROUND_DEGREES
}

export interface StartPose {
  mode: string
  speed: number | null
  heading: number | null
  routeBearing: number
  /** Distance along the route. */
  s: number
}

/** Watches the start of one route: raises a turn-around once, clears it once the traveller faces the route. */
export class TurnAroundWatch {
  private watching = true
  private raised = false

  constructor(private readonly startS = 0) {}

  get active(): boolean {
    return this.raised
  }

  /** True the moment the traveller is first seen facing away. */
  update({ mode, speed, heading, routeBearing, s }: StartPose): boolean {
    if (!this.watching) return false
    if (!turnsRound(mode, speed) || s - this.startS > UNDER_WAY_METERS) return this.settle()
    if (heading == null) return false
    if (Math.abs(angleDelta(heading, routeBearing)) < ALIGNED_DEGREES) return this.settle()
    if (facesAway(heading, routeBearing) && !this.raised) {
      this.raised = true
      return true
    }
    return false
  }

  private settle(): false {
    this.watching = false
    this.raised = false
    return false
  }
}
