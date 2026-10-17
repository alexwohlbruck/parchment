/**
 * Road surfaces near a deck's end made one clean area: merged, gaps between
 * pieces closed and slivers dropped, so what is laid on the deck there has no
 * stray bars or notches between pieces mapped apart.
 */
import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { mercator, type Bounds, type Point } from './decks'

/** Gaps between pieces closed, and the narrowest sliver kept, in metres. */
export const CLOSE = { gap: 1.2, sliver: 0.5 }

const lngLat = ([x, y]: Point): [number, number] => [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI]

/** Areas (outer ring then holes, mercator) within these boxes, merged with their gaps closed and slivers dropped. */
export function closedAreas(areas: Point[][][], boxes: Bounds[], { gap, sliver } = CLOSE): Point[][][] {
  const pieces: Feature<Polygon | MultiPolygon>[] = []
  for (const box of boxes) {
    const bbox = [...lngLat([box.minX, box.maxY]), ...lngLat([box.maxX, box.minY])] as [number, number, number, number]
    for (const rings of areas) {
      const polygon = turf.polygon(rings.map(ring => closeRing(ring.map(lngLat))))
      const clipped = turf.bboxClip(polygon, bbox)
      if (clipped.geometry.coordinates.length && turf.area(clipped) > 0) pieces.push(clipped as Feature<Polygon | MultiPolygon>)
    }
  }
  if (!pieces.length) return []
  const merged = pieces.length > 1 ? turf.union(turf.featureCollection(pieces)) : pieces[0]
  if (!merged) return []
  // Grown and shrunk to close the gaps; shrunk and grown to drop what is too thin.
  let shape: Feature<Polygon | MultiPolygon> | undefined = merged
  for (const by of [gap / 2, -gap / 2, -sliver / 2, sliver / 2]) {
    shape = shape && (turf.buffer(shape, by, { units: 'meters' }) as Feature<Polygon | MultiPolygon> | undefined)
    if (!shape) return []
  }
  const polygons = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates
  return polygons.map(rings => rings.map(ring => ring.slice(0, -1).map(c => mercator(c))))
}

function closeRing(ring: [number, number][]): [number, number][] {
  const [a, b] = [ring[0], ring[ring.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a]
}
