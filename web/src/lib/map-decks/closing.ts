/** The road surfaces at a deck's end as one clean area: pieces merged, gaps closed, slivers dropped, the bridge's own left out. */
import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { boundsOf, densify, meets, mercator, unprojected, type Bounds, type Point } from './decks'

/** Gaps between pieces closed, the narrowest sliver kept, and the spacing of the returned rings' points, in metres. */
const CLOSE = { gap: 1, sliver: 0.5, step: 3 }
/** Results kept, by box and the pieces in it. */
const CACHE_SIZE = 256

type Shape = Feature<Polygon | MultiPolygon>
type Area = { rings: Point[][]; bounds: Bounds }

const cache = new Map<string, Point[][][]>()

/**
 * The ground's road surfaces within each box, merged with gaps under CLOSE.gap
 * closed and slivers dropped, less the bridge's own carriageway there; mercator
 * rings with a point every CLOSE.step metres. Where the geometry defeats the
 * merge, the pieces as they are.
 */
export function closedAreas(ground: Point[][][], own: Point[][][], boxes: Bounds[]): Point[][][] {
  const index = (areas: Point[][][]): Area[] => areas.map(rings => ({ rings, bounds: boundsOf(rings[0]) }))
  const [groundAreas, ownAreas] = [index(ground), index(own)]
  return boxes.flatMap(box => {
    const near = groundAreas.filter(a => meets(a.bounds, box))
    if (!near.length) return []
    const mine = ownAreas.filter(a => meets(a.bounds, box))
    const key = [box.minX, box.minY, box.maxX, box.maxY, ...near.map(a => a.rings[0][0].join()), '|', ...mine.map(a => a.rings[0][0].join())].join()
    let out = cache.get(key)
    if (!out) {
      out = closedIn(box, near, mine)
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!)
      cache.set(key, out)
    }
    return out
  })
}

function closedIn(box: Bounds, near: Area[], mine: Area[]): Point[][][] {
  const [w, n] = unprojected([box.minX, box.minY])
  const [e, s] = unprojected([box.maxX, box.maxY])
  const clip = (areas: Area[]) => areas.flatMap(a => {
    const piece = turf.bboxClip(turf.polygon(a.rings.map(closed)), [w, s, e, n]) as Shape
    return piece.geometry.coordinates.length ? [piece] : []
  })
  const pieces = clip(near)
  if (!pieces.length) return []
  try {
    let shape: Shape | null = pieces.length > 1 ? (turf.union(turf.featureCollection(pieces)) as Shape | null) : pieces[0]
    // Grown and shrunk to close the gaps; shrunk and grown to drop what is too thin.
    for (const by of [CLOSE.gap / 2, -CLOSE.gap / 2, -CLOSE.sliver / 2, CLOSE.sliver / 2]) {
      shape = shape && ((turf.buffer(shape, by, { units: 'meters' }) as Shape | undefined) ?? null)
    }
    const others = clip(mine)
    if (shape && others.length) shape = turf.difference(turf.featureCollection([shape, ...others])) as Shape | null
    return shape ? polygonsOf(shape) : []
  } catch {
    return pieces.flatMap(polygonsOf)
  }
}

const closed = (ring: Point[]): Position[] => {
  const out = ring.map(unprojected)
  const [a, b] = [out[0], out[out.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? out : [...out, a]
}

function polygonsOf(shape: Shape): Point[][][] {
  const polygons = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates
  // Closed for the densifying, so the edge back to the start gets its points too, then opened again.
  return polygons.map(rings => rings.map(ring => densify(ring.map(c => mercator(c)), CLOSE.step).slice(0, -1)))
}
