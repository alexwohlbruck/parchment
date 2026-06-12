/**
 * Re-anchor an existing trip plan on a different departure — pure schedule
 * math, no re-planning.
 *
 * Semantics (Transit-app style):
 * - The chosen transit leg moves to the chosen run.
 * - Legs BEFORE it: if the chosen leg is the first boarding, the whole
 *   approach shifts rigidly (leave home later; internal stop-buffer waits
 *   are preserved). Mid-trip, earlier legs already ran on their schedule —
 *   the extra wait is spent at the platform, absorbed by the transfer walk.
 * - Legs AFTER it: walks restart where the previous leg ends (moving time
 *   constant, wait recomputed); transit keeps its planned run when the
 *   connection still holds, otherwise rolls to the next departure of the
 *   same line (via the provided lookup).
 */

export interface RebookableStop {
  arrivalTime?: string
  departureTime?: string
}

export interface RebookableSegment {
  mode: string
  startTime: string | Date
  endTime: string | Date
  /** seconds */
  duration: number
  /** seconds of wait folded into this segment, after the moving portion */
  waitSeconds?: number
  intermediateStops?: RebookableStop[]
}

/** Next run of segment `segmentIndex`'s line departing at/after minMs. */
export type NextDepartureLookup = (
  segmentIndex: number,
  minMs: number,
) => Promise<number | null>

function asMs(v: string | Date): number {
  return new Date(v).getTime()
}

function shiftSegmentTimes(s: RebookableSegment, deltaMs: number) {
  s.startTime = new Date(asMs(s.startTime) + deltaMs)
  s.endTime = new Date(asMs(s.endTime) + deltaMs)
  for (const stop of s.intermediateStops ?? []) {
    if (stop.arrivalTime) {
      stop.arrivalTime = new Date(asMs(stop.arrivalTime) + deltaMs).toISOString()
    }
    if (stop.departureTime) {
      stop.departureTime = new Date(asMs(stop.departureTime) + deltaMs).toISOString()
    }
  }
}

/**
 * Mutates `segments` in place. Returns false when the change is a no-op
 * (delta under a second).
 */
export async function applyDepartureChange(
  segments: RebookableSegment[],
  segmentIndex: number,
  departureMs: number,
  nextDeparture: NextDepartureLookup,
): Promise<boolean> {
  const chosen = segments[segmentIndex]
  const delta = departureMs - asMs(chosen.startTime)
  if (Math.abs(delta) < 1000) return false

  // Legs before the chosen boarding
  const isFirstTransit = !segments
    .slice(0, segmentIndex)
    .some((s) => s.mode === 'transit')
  if (isFirstTransit) {
    for (let i = 0; i < segmentIndex; i++) shiftSegmentTimes(segments[i], delta)
  } else {
    const prev = segments[segmentIndex - 1]
    if (prev?.mode === 'walking') {
      prev.endTime = new Date(asMs(prev.endTime) + delta)
      prev.duration += delta / 1000
      prev.waitSeconds = (prev.waitSeconds ?? 0) + delta / 1000
    }
  }

  shiftSegmentTimes(chosen, delta)

  // Cascade forward
  let cursorMs = asMs(chosen.endTime)
  for (let i = segmentIndex + 1; i < segments.length; i++) {
    const s = segments[i]
    if (s.mode !== 'transit') {
      const movingMs = Math.max(0, (s.duration - (s.waitSeconds ?? 0)) * 1000)
      s.startTime = new Date(cursorMs)
      s.endTime = new Date(cursorMs + movingMs)
      s.duration = movingMs / 1000
      s.waitSeconds = undefined
      cursorMs += movingMs
    } else {
      const plannedDep = asMs(s.startTime)
      const rideMs = asMs(s.endTime) - plannedDep
      let dep = plannedDep
      if (cursorMs > plannedDep) {
        dep = (await nextDeparture(i, cursorMs)) ?? cursorMs
      }
      // The preceding walk stretches to the departure; slack is wait.
      const prev = segments[i - 1]
      if (prev && prev.mode !== 'transit' && dep > asMs(prev.endTime)) {
        const waitMs = dep - asMs(prev.endTime)
        prev.endTime = new Date(dep)
        prev.duration += waitMs / 1000
        prev.waitSeconds = waitMs / 1000
      }
      shiftSegmentTimes(s, dep - plannedDep)
      void rideMs
      cursorMs = asMs(s.endTime)
    }
  }

  return true
}
