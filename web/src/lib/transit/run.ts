export interface Run {
  departureMs: number
  lineName?: string
}

/** Within this of the planned departure, a run is the planned one running early or late. */
export const SAME_RUN_MS = 45_000
