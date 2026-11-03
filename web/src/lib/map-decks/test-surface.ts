import { along, boundsOf, deckMesh, deckMeshOut, edgePoints, type Chain, type DeckSurface, type Point, type Top } from './decks'

/** A straight road deck as the deck layer lays things on it, with its drawn top; `half` metres each side. */
export function testSurface(points: Point[], z: number[], ground: number[] = z.map(v => v - 8), half = 6, extra: Partial<DeckSurface> = {}): DeckSurface {
  const chain: Chain = { points, grounded: [true, true], layer: 1, width: 2 * half, kind: 'road', edges: [half, half] }
  const tops: Top[] = []
  deckMesh(chain, z, ground, points[0], { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }, deckMeshOut(), undefined, undefined, tops)
  return { points, z, d: along(points), width: 2 * half + 1, bounds: boundsOf(points, half + 1), ground, kind: 'road', edges: edgePoints(chain), tops, ...extra }
}
