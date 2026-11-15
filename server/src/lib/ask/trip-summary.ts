import type { TransitItinerary } from '../../types/integration.types'
import type { TripResponse, TripSegment } from '../../types/trip.types'
import type { AskTripKind } from '../../types/ask.types'
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
export function parseTripTime(
  input: string,
  timeZone: string | null,
): Date | null {
  const wall = WALL_TIME.exec(input.trim())
  if (wall) {
    const [, y, mo, d, h, mi, s] = wall.map(Number)
    return wallClockToUtc(Date.UTC(y, mo - 1, d, h, mi, s || 0), timeZone)
  }
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? null : date
}

function flatSegments(trip: TripResponse): TripSegment[] {
  return trip.segments.flatMap(
    (segment) => segment.details?.multimodalSegments ?? [segment],
  )
}

export function tripKind(segments: TripSegment[]): AskTripKind {
  const has = (mode: string) =>
    segments.some((segment) => segment.mode === mode)
  if (
    segments.some((segment) => segment.details?.sharedMobilityDetails) &&
    !has('transit')
  )
    return 'bikeshare'
  if (has('transit')) return 'transit'
  if (has('rideshare')) return 'rideshare'
  if (has('driving')) return 'driving'
  if (has('biking')) return 'biking'
  return 'walking'
}

function describeSegment(segment: TripSegment, timeZone: string | null) {
  const minutes = Math.max(1, Math.round(segment.duration / 60))
  const shared = segment.details?.sharedMobilityDetails
  if (shared) {
    return {
      ride: `${shared.provider} ${shared.vehicleType}`,
      pick_up_at: shared.stationName,
      drop_off_at: shared.toStationName,
      minutes,
      ...(shared.availableVehicles != null && {
        bikes_at_pick_up: shared.availableVehicles,
      }),
      ...(shared.availableDocks != null && {
        docks_at_drop_off: shared.availableDocks,
      }),
    }
  }
  const transit = segment.details?.transitDetails
  if (transit) {
    return {
      ride:
        transit.shortName ?? transit.route.shortName ?? transit.route.longName,
      ...(transit.headsign && { toward: transit.headsign }),
      board: transit.departureStop.name,
      alight: transit.arrivalStop.name,
      depart: localClock(segment.startTime, timeZone),
      minutes,
    }
  }
  return { [segment.mode === 'walking' ? 'walk' : segment.mode]: minutes }
}

/** A planned trip as the moves a person makes, in the trip's local time. */
export function summarizeTrip(trip: TripResponse, timeZone: string | null) {
  const segments = flatSegments(trip)
  return {
    kind: tripKind(segments),
    minutes: Math.round(trip.tripStats.totalDuration / 60),
    leave: localClock(trip.earliestStartTime, timeZone),
    arrive: localClock(trip.latestEndTime, timeZone),
    ...(trip.tripStats.totalCost && {
      cost: `${trip.tripStats.totalCost.value.toFixed(2)} ${trip.tripStats.totalCost.currency}`,
    }),
    steps: segments.map((segment) => describeSegment(segment, timeZone)),
  }
}
