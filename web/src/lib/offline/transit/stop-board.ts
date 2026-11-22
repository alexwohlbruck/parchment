import { approxMeters } from '@/lib/offline/streets/street-graph'
import { departuresFrom, type Timetable } from './timetable'
import type { TransitDeparture, TransitStopInfo } from '@server/types/place.types'

/** How far ahead the board looks, like the online one. */
const WINDOW_MINUTES = 90
const BOARD_LIMIT = 40
const NEARBY_METRES = 150

/** The stop a place names: by feed and stop id, or else the station nearest its point. */
export function findStop(
  tt: Timetable,
  { feedId, stopId, lat, lng }: { feedId?: string; stopId?: string; lat?: number; lng?: number },
): number | null {
  // A named stop that isn't here has no board here; a neighbour's would mislead.
  if (feedId && stopId) {
    const feed = tt.pkg.feeds.findIndex(f => f.id === feedId)
    const index = tt.stops.findIndex(s => s.feed === feed && s.stopId === stopId)
    return index >= 0 ? (tt.stops[index].parent ?? index) : null
  }
  if (lat === undefined || lng === undefined) return null
  let best: number | null = null
  let bestMetres = NEARBY_METRES
  tt.stops.forEach((s, i) => {
    if (s.parent !== undefined) return
    const metres = approxMeters(lng, lat, s.lng, s.lat)
    if (metres < bestMetres) {
      best = i
      bestMetres = metres
    }
  })
  return best
}

const isoDate = (epoch: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(epoch * 1000)

const clock = (epoch: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(
    epoch * 1000,
  )

const hex = (color?: string) => (color ? `#${color.replace(/^#/, '')}` : undefined)

/** Scheduled departures from a stop, in the shape of the online departures board. */
export function stopBoard(tt: Timetable, stop: number, afterEpoch: number): TransitStopInfo {
  const until = afterEpoch + WINDOW_MINUTES * 60
  const all = departuresFrom(tt, stop, afterEpoch, BOARD_LIMIT + 1)
  const shown = all.filter(d => d.departure <= until).slice(0, BOARD_LIMIT)
  const s = tt.stops[stop]
  const feed = tt.pkg.feeds[s.feed]
  const departures: TransitDeparture[] = shown.map(d => {
    const pattern = tt.pkg.patterns[d.pattern]
    const route = tt.routes[pattern.route]
    const at = new Date(d.departure * 1000).toISOString()
    return {
      departureTime: clock(d.departure, feed.timezone),
      departureAt: at,
      scheduledDepartureTime: clock(d.departure, feed.timezone),
      serviceDate: isoDate(d.run.base + 12 * 3600, feed.timezone),
      timezone: feed.timezone,
      realTime: false,
      headsign: pattern.headsign,
      trip: { id: tt.pkg.trips[d.run.trip].tripId, routeId: route.routeId, headsign: pattern.headsign, directionId: pattern.directionId },
      route: {
        id: route.routeId,
        shortName: route.shortName || undefined,
        longName: route.longName || undefined,
        color: hex(route.color),
        textColor: hex(route.textColor),
        type: route.type,
      },
      agency: route.agency ? { id: feed.id, name: route.agency } : undefined,
    }
  })
  const routes = new Map<number, (typeof tt.routes)[number]>()
  for (const p of [stop, ...tt.children[stop]].flatMap(i => tt.stopPatterns[i])) {
    const r = tt.pkg.patterns[p[0]].route
    routes.set(r, tt.routes[r])
  }
  return {
    stopId: s.stopId,
    feedId: feed.id,
    lat: s.lat,
    lng: s.lng,
    name: s.name,
    timezone: feed.timezone,
    departures,
    windowMinutes: WINDOW_MINUTES,
    hasMore: all.length > shown.length,
    routes: [...routes.values()].map(r => ({
      id: r.routeId,
      shortName: r.shortName || undefined,
      longName: r.longName || undefined,
      color: hex(r.color),
      textColor: hex(r.textColor),
      type: r.type,
      via: 'station' as const,
    })),
  }
}
