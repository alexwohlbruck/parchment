export type CoverInputs = {
  /** A deck in view has no baked mesh, so its bridge can only be drawn flat. */
  missing: boolean
  /** A mesh in view failed to download or decode. */
  failed: boolean
  wanted: number
  resident: number
  /** The deck tiles for the view have loaded, so `wanted` is complete. */
  settled: boolean
}

/**
 * Whether the decks stand in for the flat bridges. Once they do, they keep on
 * while further meshes load, as long as one of the view's decks is drawn.
 */
export function deckCover(covered: boolean, view: CoverInputs): boolean {
  if (view.missing || view.failed) return false
  if (!view.wanted) return view.settled ? false : covered
  return view.resident === view.wanted || (covered && view.resident > 0)
}
