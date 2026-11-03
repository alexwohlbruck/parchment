// A fix the traveller can't have reached is a glitch until a run of good,
// mutually consistent fixes over several seconds says the estimate is wrong.

import { distanceMeters } from '@/lib/map/movement-interpolation'
import type { Fix } from './guidance-engine'

const RELOCATE_FIXES = 5
const RELOCATE_SPAN_SEC = 4
const AGREEMENT_MARGIN = 10

export class RelocationVote {
  private run: Fix[] = []

  /** Adds an implausible fix; true once the run of them is strong enough to move to. */
  offer(fix: Fix, maxSpeed: number): boolean {
    const last = this.run.at(-1)
    if (last && !agree(last, fix, maxSpeed)) this.run = []
    this.run.push(fix)
    return this.run.length >= RELOCATE_FIXES && fix.t - this.run[0].t >= RELOCATE_SPAN_SEC
  }

  reset(): void {
    this.run = []
  }
}

function agree(a: Fix, b: Fix, maxSpeed: number): boolean {
  const dt = b.t - a.t
  if (dt <= 0) return false
  return distanceMeters(a.position, b.position) - a.accuracy - b.accuracy <= maxSpeed * dt + AGREEMENT_MARGIN
}
