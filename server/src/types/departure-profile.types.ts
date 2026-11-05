/** Modes a rider can rule out of trip planning. Walking is always allowed. */
export const TRIP_MODE_TOKENS = [
  'transit',
  'biking',
  'bikeshare',
  'rideshare',
  'driving',
] as const

export type TripModeToken = (typeof TRIP_MODE_TOKENS)[number]

/** One catchable run of a trip's first transit leg. Times are ISO strings. */
export interface DepartureRun {
  /** Latest moment to leave the origin and still board this run. */
  leaveBy: string
  /** When the first transit leg departs. */
  departAt: string
  /** Door-to-door arrival when this run and its connections are taken. */
  arriveAt: string
  /** Smallest gap at a transfer, in seconds; absent without transfers. */
  minTransferSlackSec?: number
  /** Stop name where that smallest gap happens. */
  tightestTransferAt?: string
  /** Every transit leg of this run is timed from realtime data. */
  live: boolean
}

/**
 * How a trip's arrival changes with the moment you leave, built from the
 * departure boards of its transit legs. Runs are in departure order.
 */
export interface DepartureProfile {
  runs: DepartureRun[]
  /** Index into `runs` of the run the trip itself is planned on. */
  plannedRunIndex: number
  /** Leave times after this are outside the boards read. Re-plan instead. */
  validUntil: string
}
