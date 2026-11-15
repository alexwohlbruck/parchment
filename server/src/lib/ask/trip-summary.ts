import type { TransitItinerary } from '../../types/integration.types'
import { wallClockToUtc } from '../timezone'

/** "Fri 21:42" in the trip's own time zone, so the model never converts from UTC. */
export function localClock(iso: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone ?? 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

const minutes = (seconds: number) => Math.round(seconds / 60)

export function summarizeItinerary(
  itinerary: TransitItinerary,
  timeZone: string | null,
) {
  const rides = itinerary.legs.filter((leg) => leg.transitLeg)
  return {
    leave: localClock(itinerary.startTime, timeZone),
    arrive: localClock(itinerary.endTime, timeZone),
    minutes: minutes(itinerary.duration),
    transfers: itinerary.transfers,
    walk_minutes: minutes(itinerary.walkTime),
    ...(itinerary.fare && {
      fare: `${itinerary.fare.amount.toFixed(2)} ${itinerary.fare.currency}`,
    }),
    rides: rides.map((leg) => {
      const late = minutes(leg.departureDelay ?? 0)
      return {
        line: leg.routeShortName || leg.routeLongName || leg.mode,
        ...(leg.agencyName && { agency: leg.agencyName }),
        ...(leg.headsign && { toward: leg.headsign }),
        board: leg.from.name,
        alight: leg.to.name,
        depart: localClock(leg.startTime, timeZone),
        arrive: localClock(leg.endTime, timeZone),
        live: leg.realTime === true,
        ...(late > 0 && { late_minutes: late }),
      }
    }),
  }
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/** An ISO time; one without an offset is read as wall-clock time in `timeZone`. Null when unreadable. */
export function parseTripTime(input: string, timeZone: string | null): Date | null {
  const wall = WALL_TIME.exec(input.trim())
  if (wall) {
    const [, y, mo, d, h, mi, s] = wall.map(Number)
    return wallClockToUtc(Date.UTC(y, mo - 1, d, h, mi, s || 0), timeZone)
  }
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? null : date
}
