/** Venue outlines whole again from the tile-clipped pieces a vector source returns. */
import { convexHull, mercator, type Point } from '@/lib/map-decks/decks'
import { parseVenueLevels } from './indoor-venue'

type VenueFeature = { properties: Record<string, unknown> | null; geometry: { type: string; coordinates: any } }

/** Each venue's outline in mercator units, by venue id; the outline is a convex hull, so the hull of its pieces is the whole of it. */
export function venueOutlines(features: VenueFeature[]): Map<number, Point[]> {
  const points = new Map<number, Point[]>()
  for (const { properties, geometry } of features) {
    const id = Number(properties?.venue)
    if (!Number.isFinite(id)) continue
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
    const list = points.get(id) ?? []
    for (const polygon of polygons) for (const p of polygon[0] ?? []) list.push(mercator(p))
    points.set(id, list)
  }
  const outlines = new Map<number, Point[]>()
  for (const [id, list] of points) {
    const hull = convexHull(list)
    if (hull.length >= 3) outlines.set(id, hull)
  }
  return outlines
}

/** An outline widened by newly loaded pieces; the same one when they add under `share` of its area, as tiles quantise one edge differently at each zoom. */
export function grownOutline(known: Point[] | undefined, next: Point[], share = 0.01): Point[] {
  if (!known) return next
  const hull = convexHull([...known, ...next])
  return area(hull) > area(known) * (1 + share) ? hull : known
}

const area = (ring: Point[]) =>
  Math.abs(ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length]
    return sum + x * ny - nx * y
  }, 0)) / 2

/** Whether a venue has a floor at or above the ground, rather than lying wholly beneath it. */
export const standsOnGround = (feature: VenueFeature) => parseVenueLevels(feature.properties?.levels, '').some(l => l.level >= 0)
