/**
 * The ground carved away over a deck that runs under a roof: a covered way,
 * such as a level of a stacked cantilever under the one above. The terrain
 * takes the roof for ground and would bury the deck in it; carved down to the
 * deck's own ground under its width, the deck stands open, banking back up to
 * the roof beside it.
 */
import { footprint, type Footprint } from '@/lib/map-terrain/carve'
import type { Chain, DeckSurface } from './decks'

/** Metres past the deck's edges the ground stays down before it banks back up, and how far it banks. */
const SHOULDER = 0.5
const BANK_OUT = 4

/** A cut under each roofed deck, keyed by its first point. */
export function roofCuts(stands: Array<{ chain: Chain; surface: DeckSurface }>): Map<string, Footprint> {
  const cuts = new Map<string, Footprint>()
  for (const { chain, surface } of stands) {
    const { points, ground } = surface
    if (!surface.roofed || !ground || ground.length !== points.length || points.length < 2) continue
    const sides = (m: number) => [chain.edges[0] + m, chain.edges[1] + m] as [number, number]
    cuts.set(`${points[0][0]},${points[0][1]}`, footprint(points, ground, [ground, ground], sides(SHOULDER), sides(SHOULDER), sides(SHOULDER + BANK_OUT)))
  }
  return cuts
}
