import { requestBarrelman } from './barrelman.service'
import {
  boardingCandidates,
  EARLY_MINUTES,
  LATE_MINUTES,
  sampleStops,
  withPositions,
  type Board,
  type BoardingCandidate,
  type LiveVehicle,
} from '../lib/transit/boarding-candidates'

export interface BoardingCandidatesQuery {
  /** Timetable stop id (`{feed}_{stop}`) where the leg boards. */
  stopId: string
  /** The leg's later stop ids in ride order, the alighting stop last. */
  stops: string[]
  departure: string
  arrival: string
  routes: string[]
  directionId?: string
}

/** Boards fetched per request, so one leg cannot fan out without limit. */
const MAX_LATER_STOPS = 10
const BOARD_EVENTS = 150
const CONCURRENCY = 6

function splitStopId(id: string): { feedId: string; stopId: string } | null {
  const split = id.indexOf('_')
  return split > 0 ? { feedId: id.slice(0, split), stopId: id.slice(split + 1) } : null
}

async function fetchBoard(id: string, fromMs: number, windowMinutes: number): Promise<Board[]> {
  const stop = splitStopId(id)
  if (!stop) return []
  try {
    const res = await requestBarrelman('/transit/departures', {
      ...stop,
      time: new Date(fromMs).toISOString(),
      windowMinutes: String(Math.ceil(windowMinutes)),
      n: String(BOARD_EVENTS),
    })
    if (!res.ok) return []
    const boards = await res.json()
    return Array.isArray(boards) ? boards : []
  } catch {
    return []
  }
}

async function fetchVehicles(candidates: BoardingCandidate[]): Promise<LiveVehicle[]> {
  const byFeed = new Map<string, Set<string>>()
  for (const c of candidates) {
    if (!c.route.feedId || !c.route.id) continue
    byFeed.set(c.route.feedId, (byFeed.get(c.route.feedId) ?? new Set()).add(c.route.id))
  }
  const answers = await Promise.all(
    [...byFeed].map(async ([feedId, routeIds]) => {
      try {
        const res = await requestBarrelman('/transit/route-vehicles', { feedId, routeIds: [...routeIds].join(',') })
        if (!res.ok) return []
        const body = (await res.json()) as { vehicles?: LiveVehicle[] }
        return body.vehicles ?? []
      } catch {
        return []
      }
    }),
  )
  return answers.flat()
}

async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await run(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return out
}

export interface BoardingCandidates {
  candidates: BoardingCandidate[]
  /** The later stops whose boards were read; a run absent from one of them does not call there. */
  stops: string[]
}

export async function findBoardingCandidates(query: BoardingCandidatesQuery): Promise<BoardingCandidates> {
  const plannedMs = Date.parse(query.departure)
  const arrivalMs = Date.parse(query.arrival)
  const fromMs = plannedMs - EARLY_MINUTES * 60_000
  const boardWindow = EARLY_MINUTES + LATE_MINUTES
  const rideWindow = boardWindow + Math.max(0, (arrivalMs - plannedMs) / 60_000) + LATE_MINUTES
  const later = sampleStops([...new Set(query.stops)], MAX_LATER_STOPS)
  const [board, laterBoards] = await Promise.all([
    fetchBoard(query.stopId, fromMs, boardWindow),
    inBatches(later, (id) => fetchBoard(id, fromMs, rideWindow)),
  ])
  const candidates = boardingCandidates({
    board,
    later: later.map((stopId, i) => ({ stopId, boards: laterBoards[i] })),
    plannedMs,
    routes: query.routes,
    directionId: query.directionId,
  })
  return {
    candidates: candidates.length ? withPositions(candidates, await fetchVehicles(candidates)) : [],
    stops: later.filter((_, i) => laterBoards[i].length > 0),
  }
}
