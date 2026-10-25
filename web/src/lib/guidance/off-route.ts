// Hysteresis: leaving the route needs sustained evidence, rejoining needs the
// vehicle well back inside, so a noisy fix near the line can't flap the state.

export interface OffRouteInput {
  /** Perpendicular distance to the route, metres. */
  offset: number
  accuracy: number
  speed: number | null
  /** Fix course minus route bearing, degrees. */
  courseError: number | null
  /** Distance along the route; departure noise is ignored near the start. */
  s: number
  /** Distance to the next maneuver; tolerance tightens inside its zone. */
  distanceToManeuver: number
}

export interface OffRouteOptions {
  minRadius: number
  accuracyMargin: number
  maneuverZone: number
  courseLimit: number
  minCourseSpeed: number
  departureGrace: number
  rejoinFraction: number
}

export const DEFAULT_OFF_ROUTE_OPTIONS: OffRouteOptions = {
  minRadius: 50,
  accuracyMargin: 15,
  maneuverZone: 40,
  courseLimit: 45,
  minCourseSpeed: 3,
  departureGrace: 40,
  rejoinFraction: 0.5,
}

export class OffRouteDetector {
  private offRoute = false
  private strikes = 0
  private rejoinStreak = 0
  private readonly options: OffRouteOptions

  constructor(options?: Partial<OffRouteOptions>) {
    this.options = { ...DEFAULT_OFF_ROUTE_OPTIONS, ...options }
  }

  get isOffRoute(): boolean {
    return this.offRoute
  }

  radius(input: Pick<OffRouteInput, 'accuracy' | 'distanceToManeuver'>): number {
    const { minRadius, accuracyMargin, maneuverZone } = this.options
    const base = Math.max(minRadius, input.accuracy + accuracyMargin)
    return input.distanceToManeuver <= maneuverZone ? base / 2 : base
  }

  update(input: OffRouteInput): boolean {
    const { courseLimit, minCourseSpeed, departureGrace, rejoinFraction } = this.options
    const radius = this.radius(input)

    if (this.offRoute) {
      this.rejoinStreak = input.offset < radius * rejoinFraction ? this.rejoinStreak + 1 : 0
      if (this.rejoinStreak >= 2) {
        this.offRoute = false
        this.strikes = 0
        this.rejoinStreak = 0
      }
      return this.offRoute
    }

    if (input.s < departureGrace) {
      this.strikes = 0
      return false
    }

    const wrongCourse =
      input.courseError != null &&
      input.speed != null &&
      input.speed > minCourseSpeed &&
      Math.abs(input.courseError) > courseLimit
    const outside = input.offset > radius

    if (outside) {
      this.strikes += 2
    } else if (wrongCourse) {
      this.strikes += 1
    } else {
      this.strikes = 0
    }

    const needed = Math.max(4, Math.round(input.accuracy / 4))
    if (this.strikes >= needed) {
      this.offRoute = true
      this.rejoinStreak = 0
    }
    return this.offRoute
  }

  reset(): void {
    this.offRoute = false
    this.strikes = 0
    this.rejoinStreak = 0
  }
}
