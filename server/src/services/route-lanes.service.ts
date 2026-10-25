import { routingService } from './routing.service'
import { applyLanes, drivingSideFor, lanesRequest, segmentCountry, type LanedSegment } from '../lib/route-lanes'
import { logWarn } from '../lib/logger'

/**
 * Gives each driven segment its driving side and, where barrelman has the
 * lanes, the route drawn in them and a lane plan per maneuver. A segment
 * barrelman can't answer for keeps what it had.
 */
export async function attachLanes(segments: LanedSegment[], getLanes = routingService.getLanes.bind(routingService)): Promise<void> {
  await Promise.all(
    segments
      .filter(s => s.mode === 'driving')
      .map(async segment => {
        segment.drivingSide = drivingSideFor(segmentCountry(segment.edgeSegments))
        const request = lanesRequest(segment)
        if (!request) return
        try {
          const lanes = await getLanes(request)
          if (lanes) applyLanes(segment, lanes)
        } catch (error) {
          logWarn(`Lane geometry failed: ${error instanceof Error ? error.message : error}`)
        }
      }),
  )
}
