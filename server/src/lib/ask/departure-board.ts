import { localClock } from './trip-summary'

/** What Barrelman's /transit/departures returns per stop, as far as Ask reads it. */
export interface DepartureBoard {
  stop: { stopId: string; feedId: string; name: string; timezone?: string }
  departures: Array<{
    route: { id: string; shortName?: string; longName?: string }
    headsign?: string
    tripDestination?: string
    departureTime: string
    delay?: number
    realTime: boolean
    cancelled: boolean
  }>
}

export interface BoardAlert {
  header: string
  effect: string
  informedEntities: Array<{ routeId?: string; stopId?: string }>
}

const MAX_BOARDS = 3

/** Each station's next runs as a rider reads a board: line, toward, leaves at, in N minutes; plus alerts on those lines. */
export function summarizeBoards(
  boards: DepartureBoard[],
  alerts: BoardAlert[],
  now: Date,
  perBoard: number,
) {
  return boards.slice(0, MAX_BOARDS).map(({ stop, departures }) => {
    const routeIds = new Set(departures.map((departure) => departure.route.id))
    const lineOf = (routeId: string) => {
      const route = departures.find(
        (departure) => departure.route.id === routeId,
      )?.route
      return route?.shortName ?? route?.longName ?? routeId
    }
    const stopAlerts = alerts.filter(({ informedEntities }) =>
      informedEntities.some(
        (entity) =>
          (entity.routeId && routeIds.has(entity.routeId)) ||
          entity.stopId === stop.stopId,
      ),
    )
    return {
      station: stop.name,
      departures: departures.slice(0, perBoard).map((departure) => {
        const late = Math.round((departure.delay ?? 0) / 60)
        return {
          line:
            departure.route.shortName ??
            departure.route.longName ??
            departure.route.id,
          toward: departure.headsign ?? departure.tripDestination,
          leaves: localClock(departure.departureTime, stop.timezone ?? null),
          in_minutes: Math.max(
            0,
            Math.round(
              (Date.parse(departure.departureTime) - now.getTime()) / 60_000,
            ),
          ),
          live: departure.realTime,
          ...(late > 0 && { late_minutes: late }),
          ...(departure.cancelled && { cancelled: true }),
        }
      }),
      ...(stopAlerts.length && {
        alerts: stopAlerts.map((alert) => ({
          lines: [
            ...new Set(
              alert.informedEntities.flatMap((entity) =>
                entity.routeId && routeIds.has(entity.routeId)
                  ? [lineOf(entity.routeId)]
                  : [],
              ),
            ),
          ],
          says: alert.header,
          effect: alert.effect.toLowerCase().replaceAll('_', ' '),
        })),
      }),
    }
  })
}
