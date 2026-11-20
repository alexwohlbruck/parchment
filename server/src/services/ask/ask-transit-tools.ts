import { requestBarrelman } from '../barrelman.service'
import type { DepartureBoard, BoardAlert } from '../../lib/ask/departure-board'
import { AskToolError, cached, centre, pointSchema, type AskTool, type PointArg } from './ask-tool-base'

interface LineStop {
  stopId: string
  stopName: string
  parentStation?: string
}

interface LineDetail {
  routeShortName: string | null
  routeLongName: string | null
  agencyName: string | null
  stops: LineStop[]
}

interface LineVehicle {
  nextStopId?: string
  timestamp: string
}

interface LiveVehicles {
  vehicles?: LineVehicle[]
  /** Empty when the feed publishes no positions for the line, as subway feeds often don't. */
  feedTimestamps?: Record<string, unknown>
}

const MAX_STOPS = 80
const MAX_ALERTS = 5

async function barrelman<T>(path: string, query: Record<string, unknown>): Promise<T | null> {
  const response = await requestBarrelman(path, query, { cacheControl: 'no-cache' }).catch(() => null)
  return response?.ok ? ((await response.json()) as T) : null
}

/** A line's feed and route ids: by its GTFS id where riders' names match it, else from a departure board near where it runs. */
async function findLine(line: string, near: { lat: number; lng: number }, station?: string) {
  const name = line.trim()
  const byId = await barrelman<{ feedId: string; routeId: string }>('/transit/resolve-route', {
    routeId: name.toUpperCase(),
    ...near,
  })
  if (byId?.feedId && byId.routeId) return byId
  const boards = await barrelman<DepartureBoard[]>('/transit/departures', {
    ...near,
    n: 20,
    complex: 'true',
    routeShortNames: name,
    ...(station && { name: station }),
  })
  const wanted = name.toLowerCase()
  for (const board of boards ?? []) {
    const match = board.departures.find(
      ({ route }) => route.shortName?.toLowerCase() === wanted || route.longName?.toLowerCase() === wanted,
    )
    if (match) return { feedId: board.stop.feedId, routeId: match.route.id }
  }
  return null
}

const transitLine: AskTool<{ line: string; at?: PointArg; station?: string }> = {
  name: 'transit_line',
  description:
    'One transit line: every stop it calls at in order, how many vehicles are running on it right now and where they are, and its service alerts. For "where does the M15 go", "is the L running", "where is my bus".',
  parameters: {
    type: 'object',
    properties: {
      line: { type: 'string', description: 'The line as riders call it, e.g. "L", "M15", "Red"' },
      station: { type: 'string', description: 'A station the line calls at, to tell same-named lines apart' },
      at: pointSchema("Near this point, where the line runs. Defaults to the map's centre."),
    },
    required: ['line'],
  },
  label: () => 'Checking the line',
  detail: ({ line }) => line,
  async run(args, context) {
    const near = await centre(args.at ?? args.station, context)
    const found = await findLine(args.line, near, args.station)
    if (!found) throw new AskToolError(`No ${args.line} line stops near there. Name a station it calls at.`)
    const { feedId, routeId } = found
    const [detail, live, alerts] = await Promise.all([
      cached('transit_line', { feedId, routeId }, { language: context.language }, async () => {
        const detail = await barrelman<LineDetail>('/transit/route-detail', { feedId, routeId })
        if (!detail) throw new AskToolError(`The ${args.line} line's details are unavailable`)
        return detail
      }),
      barrelman<LiveVehicles>('/transit/route-vehicles', { feedId, routeIds: routeId }),
      barrelman<{ alerts?: BoardAlert[] }>('/transit/alerts', { feedId, routeIds: routeId }),
    ])

    const stopName = new Map<string, string>()
    for (const stop of detail.stops) {
      stopName.set(stop.stopId, stop.stopName)
      if (stop.parentStation) stopName.set(stop.parentStation, stop.stopName)
    }
    const stops = detail.stops.map(({ stopName }) => stopName).filter((name, i, all) => name !== all[i - 1])
    const vehicles = live?.vehicles ?? []
    const tracked = vehicles.length > 0 || Object.keys(live?.feedTimestamps ?? {}).length > 0
    return {
      line: detail.routeShortName ?? args.line,
      ...(detail.routeLongName && { name: detail.routeLongName }),
      ...(detail.agencyName && { agency: detail.agencyName }),
      stops: stops.length > MAX_STOPS ? [...stops.slice(0, MAX_STOPS - 1), `… ${stops.length - MAX_STOPS + 1} more`, stops.at(-1)] : stops,
      ...(tracked && {
        running_now: vehicles.length,
        next_stops: [
          ...new Set(vehicles.map(({ nextStopId }) => nextStopId && stopName.get(nextStopId)).filter(Boolean)),
        ].slice(0, 12),
      }),
      alerts: (alerts?.alerts ?? []).slice(0, MAX_ALERTS).map(({ header, effect }) => ({ header, effect })),
    }
  },
}

export const transitTools: AskTool[] = [transitLine]
