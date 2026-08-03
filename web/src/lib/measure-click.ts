import {
  findSegmentToInsert,
  shouldCloseLoop,
  distancePx,
  INSERT_THRESHOLD_PX,
  CLOSE_LOOP_THRESHOLD_PX,
  VERTEX_NEAR_PX,
  type ProjectFn,
} from '@/lib/measure.utils'
import type { LngLat } from '@/types/map.types'

export interface MeasureClick {
  lngLat: LngLat
  point: { x: number; y: number }
}

/**
 * Where a click on an existing measurement should land: inserted into a
 * segment, closing the loop, or appended to the end.
 *
 * Split out of the context menu because it's geometry, not menu wiring — and
 * because the same three-way decision was written twice there, once for a
 * closed path and once for an open one, with only the fallthrough differing.
 */
export function nextMeasurePoints(
  points: LngLat[],
  click: MeasureClick,
  project: ProjectFn,
  isClosed: boolean,
): LngLat[] | null {
  // Off-screen clicks can't be compared against rendered segments.
  if (!project(click.lngLat)) return [...points, click.lngLat]

  const insert = findSegmentToInsert(points, click, project, INSERT_THRESHOLD_PX)
  if (insert) {
    const start = project(points[insert.segmentIndex])
    const end = project(points[insert.segmentIndex + 1])
    const at = project(insert.point)
    const nearStart = start && at && distancePx(at, start) < VERTEX_NEAR_PX
    const nearEnd = end && at && distancePx(at, end) < VERTEX_NEAR_PX

    // Landing on an existing vertex would insert a duplicate point.
    if (!nearStart && !nearEnd) {
      const next = [...points]
      next.splice(insert.segmentIndex + 1, 0, insert.point)
      return next
    }
  }

  // A closed path has no end to extend, so anything else is a no-op.
  if (isClosed) return null

  if (shouldCloseLoop(points, click, project, CLOSE_LOOP_THRESHOLD_PX)) {
    return [...points, { ...points[0] }]
  }

  return [...points, click.lngLat]
}
