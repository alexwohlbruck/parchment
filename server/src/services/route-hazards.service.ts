import { routingService } from './routing.service'
import { getWeatherOutlook } from './weather-outlook.service'
import { routeHazards, type HazardSegment } from '../lib/route-hazards'
import { isFreezing, needsOutlook, pointHazards, pointHazardsRequest } from '../lib/route-point-hazards'
import type { WeatherOutlook } from '../types/integration.types'
import type { RouteHazard, RoutePointHazard, RoutePointHazardsRequest } from '../types/unified-routing.types'

export interface HazardedSegment extends HazardSegment {
  hazards?: RouteHazard[]
  details?: any
  distance?: number
  duration?: number
  startTime?: Date | string
}

interface AttachOptions {
  premium: boolean
  /** When the trip leaves, for segments that don't carry their own start. */
  departure?: Date
  getHazards?: (request: RoutePointHazardsRequest) => Promise<RoutePointHazard[] | null>
  getOutlook?: (lat: number, lng: number) => Promise<WeatherOutlook | null>
}

function withNested<T extends HazardedSegment>(segments: T[]): T[] {
  return segments.flatMap(s => [...withNested((s.details?.multimodalSegments as T[] | undefined) ?? []), s])
}

/** Edge and shape hazards plus barrelman's tagged ones, judged against the hour and forecast; premium kinds only for members. */
export async function attachHazards<T extends HazardedSegment>(segments: T[], options: AttachOptions): Promise<void> {
  const getHazards = options.getHazards ?? routingService.getHazards.bind(routingService)
  const getOutlook = options.getOutlook ?? getWeatherOutlook
  await Promise.all(
    withNested(segments).map(async segment => {
      const request = pointHazardsRequest(segment)
      const found = request ? await getHazards(request).catch(() => null) : null
      const origin = segment.geometry?.[0]
      const outlook = origin && needsOutlook(segment, found) ? await getOutlook(origin.lat, origin.lng) : null
      const start = segment.startTime ? new Date(segment.startTime) : (options.departure ?? new Date())
      const points = found && pointHazards(found, segment, { start, duration: segment.duration, outlook })
      const hazards = routeHazards(segment, { points, freezing: isFreezing(outlook) })
      segment.hazards = options.premium ? hazards : hazards.filter(h => !h.premium)
    }),
  )
}
