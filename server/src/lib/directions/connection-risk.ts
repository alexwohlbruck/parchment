/** The expected time lost to missed connections, for ranking fragile trips lower. */

import type { TransferRisk } from './departure-profile'

/** Chance of missing a connection with this much slack, in seconds. */
function missProbability(slackSec: number): number {
  if (slackSec < 0) return 1
  if (slackSec < 60) return 0.5
  if (slackSec < 120) return 0.25
  if (slackSec < 240) return 0.1
  return 0
}

export function expectedMissPenaltySec(transfers: readonly TransferRisk[]): number {
  return transfers.reduce((sum, t) => sum + missProbability(t.slackSec) * t.missDelaySec, 0)
}
