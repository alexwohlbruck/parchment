export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * Return the area of a lat/lng bounding box in square degrees.
 * Used for comparing relative viewport sizes; not a geographic area measurement.
 */
export function calculateBoundsArea(bounds: MapBounds): number {
  const width = Math.abs(bounds.east - bounds.west)
  const height = Math.abs(bounds.north - bounds.south)
  return width * height
}

/**
 * Return the area of the intersection of two bounding boxes, or 0 if they don't overlap.
 */
export function calculateIntersectionArea(bounds1: MapBounds, bounds2: MapBounds): number {
  // Bail early if there's no overlap at all
  if (
    bounds1.east < bounds2.west ||
    bounds1.west > bounds2.east ||
    bounds1.north < bounds2.south ||
    bounds1.south > bounds2.north
  ) {
    return 0
  }

  const intersection: MapBounds = {
    north: Math.min(bounds1.north, bounds2.north),
    south: Math.max(bounds1.south, bounds2.south),
    east: Math.min(bounds1.east, bounds2.east),
    west: Math.max(bounds1.west, bounds2.west),
  }

  return calculateBoundsArea(intersection)
}

/**
 * Return the fraction of `currentBounds` that is newly visible compared to `previousBounds`.
 * A value of 1.0 means the viewport is entirely new; 0 means it hasn't moved at all.
 */
export function newViewFraction(previousBounds: MapBounds, currentBounds: MapBounds): number {
  const currentArea = calculateBoundsArea(currentBounds)
  if (currentArea === 0) return 0

  const intersectionArea = calculateIntersectionArea(previousBounds, currentBounds)
  const newArea = currentArea - intersectionArea
  return newArea / currentArea
}
