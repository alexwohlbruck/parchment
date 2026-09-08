/**
 * Where the overlay's layers slot into the basemap's stack — the pure half,
 * so the ordering can be asserted against a layer list instead of a map.
 */

type StyleLayer = { id: string; type: string }

/**
 * The basemap's first label layer, optionally restricted to the layers drawn
 * above `after`.
 *
 * The ghost ribbon passes the building layer here. Without it the search
 * finds the style's oneway arrows — a symbol layer, but one drawn *below* the
 * buildings — and the dimmed copy lands back underneath the towers it exists
 * to show through, which reads as the route simply vanishing into the block.
 */
export function firstLabelLayerId(
  layers: readonly StyleLayer[],
  after?: string,
): string | undefined {
  const start = after ? layers.findIndex(l => l.id === after) + 1 : 0
  return layers
    .slice(start)
    .find(l => l.type === 'symbol' && !l.id.startsWith('portolan-'))?.id
}
