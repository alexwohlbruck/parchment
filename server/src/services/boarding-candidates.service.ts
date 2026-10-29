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
/** How much faster or slower than planned a run may reach a later stop: an express, a delay. */
const FASTEST_RIDE = 0.6
const SLOWEST_RIDE = 1.5

function splitStopId(id: string): { feedId: string; stopId: string } | null {
  const split = id.indexOf('_')
  return split > 0 ? { feedId: id.slice(0, split), stopId: id.slice(split + 1) } : null
}

/** A stop's boards over `[fromMs, toMs]`, and whether they hold every run in it rather than stopping at the event cap. */
async function fetchBoard(id: string, fromMs: number, toMs: number): Promise<{ boards: Board[]; complete: boolean }> {
  const stop = splitStopId(id)
  if (!stop) return { boards: [], complete: false }
  try {
    const res = await requestBarrelman('/transit/departures', {
      ...stop,
      time: new Date(fromMs).toISOString(),
      windowMinutes: String(Math.ceil((toMs - fromMs) / 60_000)),
      n: String(BOARD_EVENTS),
    })
    if (!res.ok) return { boards: [], complete: false }
    const body = await res.json()
    const boards: Board[] = Array.isArray(body) ? body : []
    const events = boards.reduce((sum, b) => sum + (b.departures?.length ?? 0), 0)
    return { boards, complete: boards.length > 0 && events < BOARD_EVENTS }
  } catch {
    return { boards: [], complete: false }
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
  const rideMs = Math.max(0, Date.parse(query.arrival) - plannedMs)
  const all = [...new Set(query.stops)]
  const later = sampleStops(all, MAX_LATER_STOPS)
  const [board, laterBoards] = await Promise.all([
    fetchBoard(query.stopId, plannedMs - EARLY_MINUTES * 60_000, plannedMs + LATE_MINUTES * 60_000),
    inBatches(later, (id) => {
      const reachMs = (rideMs * (all.indexOf(id) + 1)) / all.length
      return fetchBoard(id, plannedMs + reachMs * FASTEST_RIDE - EARLY_MINUTES * 60_000, plannedMs + reachMs * SLOWEST_RIDE + LATE_MINUTES * 60_000)
    }),
  ])
  const candidates = boardingCandidates({
    board: board.boards,
    later: later.map((stopId, i) => ({ stopId, boards: laterBoards[i].boards })),
    plannedMs,
    routes: query.routes,
    directionId: query.directionId,
  })
  return {
    candidates: candidates.length ? withPositions(candidates, await fetchVehicles(candidates)) : [],
    stops: later.filter((_, i) => laterBoards[i].complete),
  }
}
