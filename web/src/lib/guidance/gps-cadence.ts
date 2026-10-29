// How often guidance asks the OS for a fix. Between fixes the engine dead-reckons
// along the route, so a cruise with nothing to do can afford a sparser feed.

export const PRECISE_INTERVAL_MS = 1000
export const CRUISE_INTERVAL_MS = 3000
/** Under the ride estimator's 10 s freshness, so its fixes stay trusted. */
export const RIDE_INTERVAL_MS = 5000

/** Driving at least this fast (m/s, ~65 km/h) counts as cruising. */
export const CRUISE_MIN_SPEED = 18
/** Cruising this long before the feed relaxes. */
export const CRUISE_SETTLE_SEC = 20
/** The feed tightens this far, or this many seconds, before the next maneuver. */
export const TIGHTEN_METERS = 1500
export const TIGHTEN_SEC = 45
/** Extra distance needed to relax again, so the boundary can't flap. */
const RELAX_MARGIN_METERS = 500
/** A ride tightens this close to the alighting stop. */
export const ALIGHT_TIGHTEN_METERS = 800

export interface CadenceInput {
  /** Seconds. */
  t: number
  /** On the route and following it; anything else needs every fix. */
  tracking: boolean
  mode: string
  speed: number
  /** Metres to the next maneuver; null when none is left. */
  distanceToManeuver: number | null
  /** Aboard a transit ride. */
  ride: { stopsLeft: number; remaining: number } | null
}

export class GpsCadence {
  private cruisingSince: number | null = null
  private current = PRECISE_INTERVAL_MS

  get interval(): number {
    return this.current
  }

  update(input: CadenceInput): number {
    this.current = this.next(input)
    return this.current
  }

  reset(): void {
    this.cruisingSince = null
    this.current = PRECISE_INTERVAL_MS
  }

  private next({ t, tracking, mode, speed, distanceToManeuver, ride }: CadenceInput): number {
    if (!tracking) {
      this.cruisingSince = null
      return PRECISE_INTERVAL_MS
    }
    if (ride) {
      this.cruisingSince = null
      return ride.stopsLeft > 1 && ride.remaining > ALIGHT_TIGHTEN_METERS ? RIDE_INTERVAL_MS : PRECISE_INTERVAL_MS
    }
    if (mode !== 'driving' || speed < CRUISE_MIN_SPEED) {
      this.cruisingSince = null
      return PRECISE_INTERVAL_MS
    }
    this.cruisingSince ??= t
    const relaxed = this.current === CRUISE_INTERVAL_MS
    const clearance = Math.max(TIGHTEN_METERS, speed * TIGHTEN_SEC) + (relaxed ? 0 : RELAX_MARGIN_METERS)
    const clear = distanceToManeuver == null || distanceToManeuver > clearance
    const settled = t - this.cruisingSince >= CRUISE_SETTLE_SEC
    return clear && settled ? CRUISE_INTERVAL_MS : PRECISE_INTERVAL_MS
  }
}
