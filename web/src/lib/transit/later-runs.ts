export interface Run {
  departureMs: number
  lineName?: string
}

/** Within this of the planned departure, a run is the planned one running early or late. */
const SAME_RUN_MS = 45_000
const SHOWN = 2

/** The first runs after the planned one, skipping the planned run itself. */
export function laterRuns(runs: Run[], plannedMs: number, count = SHOWN): Run[] {
  return runs.filter(r => r.departureMs > plannedMs + SAME_RUN_MS).slice(0, count)
}
