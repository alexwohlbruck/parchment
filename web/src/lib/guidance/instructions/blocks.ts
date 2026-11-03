// Distance on foot as a local gives it: the blocks to the maneuver, counted
// from the cross streets the route crosses, where the grid is regular enough
// that a junction the walker doesn't cross can't be hiding between them.

import type { NavRoute, NavStep } from '../nav-route'
import { crossingsWithin, sameStreet } from '../walk-steps'

/** Crossings this close are one junction: a diagonal corner, a parkway's service roads. */
const JUNCTION_METERS = 40
const MIN_BLOCK_METERS = 40
const MAX_BLOCK_METERS = 320
/** The longest block may be this many times the shortest. */
const MAX_SPREAD = 1.8
const MIN_BLOCKS = 2
const MAX_BLOCKS = 12
/** The way to the first corner, part of a block, can't be much longer than a whole one. */
const FIRST_BLOCK_SLACK = 1.25
/** A crossing this close before the maneuver is its own corner's. */
const CORNER_METERS = 25

interface Junction { start: number; end: number; name: string }

/** Blocks from `from` to `step`, or null where they can't be counted with confidence. */
export function blocksTo(route: NavRoute, from: number, step: NavStep): number | null {
  const previous = route.steps[step.index - 1]
  const along = previous?.instruction.streetName || previous?.instruction.streetRef || ''
  const junctions: Junction[] = []
  for (const crossing of crossingsWithin(route.edges, from, step.startDistance - CORNER_METERS)) {
    const name = [...crossing.names][0]
    if (!name || (along && sameStreet(name, along))) continue
    const last = junctions.at(-1)
    if (last && (crossing.start - last.end <= JUNCTION_METERS || sameStreet(name, last.name))) last.end = crossing.end
    else junctions.push({ start: crossing.start, end: crossing.end, name })
  }
  const blocks = junctions.length + 1
  if (blocks < MIN_BLOCKS || blocks > MAX_BLOCKS) return null
  const lengths = junctions.map((j, i) => (junctions[i + 1]?.start ?? step.startDistance) - j.end)
  const shortest = Math.min(...lengths)
  const longest = Math.max(...lengths)
  const first = junctions[0].start - from
  if (shortest < MIN_BLOCK_METERS || longest > MAX_BLOCK_METERS || longest > shortest * MAX_SPREAD) return null
  return first <= longest * FIRST_BLOCK_SLACK ? blocks : null
}
