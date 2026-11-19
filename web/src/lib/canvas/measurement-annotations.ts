/** The map's measuring tools' results, as marks a canvas can keep. */

import type { Position } from 'geojson'
import type { IsochroneMode } from '@server/types/isochrone.types'
import type { IsochroneBand } from '@/lib/directions/isochrone'
import { createAnnotation } from '@/lib/canvas/canvas-annotations'
import type { CanvasAnnotation } from '@/types/canvas.types'
import type { LngLat } from '@/types/map.types'

const position = (point: LngLat): Position => [point.lng, point.lat]

/** A closed path is an area; anything else is a line. */
export function measureAnnotation(
  points: LngLat[],
  closed: boolean,
): CanvasAnnotation | null {
  const [first] = points
  const last = points[points.length - 1]
  const repeatsStart =
    points.length > 1 && first.lng === last.lng && first.lat === last.lat
  const ring = repeatsStart ? points.slice(0, -1) : points
  if (closed && ring.length >= 3) {
    return createAnnotation('polygon', ring.map(position))
  }
  return points.length >= 2 ? createAnnotation('line', points.map(position)) : null
}

export function radiusAnnotation(
  center: LngLat | null,
  radiusMeters: number,
): CanvasAnnotation | null {
  if (!center || radiusMeters <= 0) return null
  return { ...createAnnotation('circle', [position(center)]), radiusMeters }
}

/**
 * One mark per band, outermost first so it draws underneath. A band split
 * into islands becomes one mark per island, since a mark holds one polygon.
 */
export function isochroneAnnotations(
  origin: LngLat | null,
  bands: IsochroneBand[],
  mode: IsochroneMode,
  label: (minutes: number) => string,
): CanvasAnnotation[] {
  if (!origin) return []
  return [...bands].reverse().flatMap(band => {
    const minutes = Math.round(band.durationMinutes)
    const parts =
      band.geometry.type === 'Polygon'
        ? [band.geometry.coordinates]
        : band.geometry.coordinates
    return parts.map(geometry => ({
      ...createAnnotation('isochrone', [position(origin)], {
        fillOpacity: band.opacity,
      }),
      isochrone: { geometry, mode, minutes },
      label: label(minutes),
      labelVisible: false,
    }))
  })
}
