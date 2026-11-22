import { arrivalAt, departureAt, runsAround, type ServiceRun, type Timetable } from './timetable'

/** Seconds to be at the stop before a departure, after walking to it. */
const BOARD_SLACK = 60
const MAX_ROUNDS = 5

export type JourneyLeg =
  | { kind: 'access'; stop: number; seconds: number; depart: number; arrive: number }
  | { kind: 'ride'; pattern: number; run: ServiceRun; from: number; to: number; depart: number; arrive: number }
  | { kind: 'transfer'; from: number; to: number; seconds: number; depart: number; arrive: number }
  | { kind: 'egress'; stop: number; seconds: number; depart: number; arrive: number }

export interface Journey {
  legs: JourneyLeg[]
  depart: number
  arrive: number
  rides: number
}

interface Label {
  kind: 'access' | 'ride' | 'transfer'
  stop: number
  arrive: number
  prev: number
  pattern?: number
  run?: ServiceRun
  /** Positions in the pattern. */
  from?: number
  to?: number
  seconds?: number
}

export interface RaptorQuery {
  /** Seconds of walking from the origin to each stop it can reach. */
  access: Map<number, number>
  /** Seconds of walking from each stop to the destination. */
  egress: Map<number, number>
  /** Epoch seconds. */
  departAfter: number
}

/** Earliest-arrival journeys, at most one per number of rides, each strictly faster than the one with fewer rides. */
export function planJourneys(tt: Timetable, { access, egress, departAfter }: RaptorQuery): Journey[] {
  const stopCount = tt.stops.length
  const labels: Label[] = []
  let best = new Float64Array(stopCount).fill(Infinity)
  let bestLabel = new Int32Array(stopCount).fill(-1)
  const bestEver = new Float64Array(stopCount).fill(Infinity)
  let marked = new Set<number>()

  for (const [stop, seconds] of access) {
    const arrive = departAfter + seconds
    if (arrive >= best[stop]) continue
    best[stop] = bestEver[stop] = arrive
    bestLabel[stop] = labels.push({ kind: 'access', stop, arrive, prev: -1, seconds }) - 1
    marked.add(stop)
  }

  const runCache = new Map<number, ServiceRun[]>()
  const runs = (pattern: number) => {
    let list = runCache.get(pattern)
    if (!list) runCache.set(pattern, (list = runsAround(tt, pattern, departAfter)))
    return list
  }

  const destinationBound = () => {
    let bound = Infinity
    for (const [stop, seconds] of egress) bound = Math.min(bound, bestEver[stop] + seconds)
    return bound
  }

  const journeys: Journey[] = []
  for (let round = 1; round <= MAX_ROUNDS && marked.size; round++) {
    const previous = best
    const previousLabel = bestLabel
    best = previous.slice()
    bestLabel = previousLabel.slice()

    const queue = new Map<number, number>()
    for (const stop of marked) {
      for (const [pattern, position] of tt.stopPatterns[stop]) {
        const queued = queue.get(pattern)
        if (queued === undefined || position < queued) queue.set(pattern, position)
      }
    }
    const improved = new Set<number>()
    const bound = destinationBound()

    for (const [pattern, start] of queue) {
      const stops = tt.patternStops[pattern]
      const list = runs(pattern)
      let run: ServiceRun | null = null
      let boardPosition = -1
      let boardLabel = -1
      for (let position = start; position < stops.length; position++) {
        const stop = stops[position]
        if (run) {
          const arrive = arrivalAt(tt, run, position)
          if (arrive < bestEver[stop] && arrive < bound) {
            best[stop] = bestEver[stop] = arrive
            bestLabel[stop] =
              labels.push({ kind: 'ride', stop, arrive, prev: boardLabel, pattern, run, from: boardPosition, to: position }) - 1
            improved.add(stop)
          }
        }
        const ready = previous[stop]
        if (ready === Infinity) continue
        const earliest = ready + (labels[previousLabel[stop]].kind === 'access' ? BOARD_SLACK : 0)
        if (run && departureAt(tt, run, position) <= earliest) continue
        const next = list.find(r => departureAt(tt, r, position) >= earliest)
        if (next && (!run || departureAt(tt, next, position) < departureAt(tt, run, position))) {
          run = next
          boardPosition = position
          boardLabel = previousLabel[stop]
        }
      }
    }

    marked = new Set(improved)
    for (const stop of improved) {
      for (const [to, seconds] of tt.transfers[stop]) {
        const arrive = best[stop] + seconds
        if (arrive >= bestEver[to]) continue
        best[to] = bestEver[to] = arrive
        bestLabel[to] = labels.push({ kind: 'transfer', stop: to, arrive, prev: bestLabel[stop], seconds }) - 1
        marked.add(to)
      }
    }

    let arrival = Infinity
    let exit = -1
    for (const [stop, seconds] of egress) {
      const label = bestLabel[stop]
      if (label < 0 || labels[label].kind === 'access') continue
      if (best[stop] + seconds < arrival) {
        arrival = best[stop] + seconds
        exit = stop
      }
    }
    if (exit >= 0 && arrival < (journeys.at(-1)?.arrive ?? Infinity)) {
      journeys.push(reconstruct(tt, labels, bestLabel[exit], exit, egress.get(exit)!, departAfter))
    }
  }
  return journeys
}

function reconstruct(
  tt: Timetable,
  labels: Label[],
  last: number,
  exit: number,
  egressSeconds: number,
  departAfter: number,
): Journey {
  const chain: Label[] = []
  for (let i = last; i >= 0; i = labels[i].prev) chain.unshift(labels[i])
  const legs: JourneyLeg[] = []
  let rides = 0
  for (const label of chain) {
    if (label.kind === 'access') {
      legs.push({ kind: 'access', stop: label.stop, seconds: label.seconds!, depart: departAfter, arrive: label.arrive })
    } else if (label.kind === 'ride') {
      rides++
      legs.push({
        kind: 'ride',
        pattern: label.pattern!,
        run: label.run!,
        from: label.from!,
        to: label.to!,
        depart: departureAt(tt, label.run!, label.from!),
        arrive: label.arrive,
      })
    } else {
      const from = legs.at(-1)
      const fromStop = from?.kind === 'ride' ? tt.patternStops[from.pattern][from.to] : label.stop
      legs.push({ kind: 'transfer', from: fromStop, to: label.stop, seconds: label.seconds!, depart: label.arrive - label.seconds!, arrive: label.arrive })
    }
  }
  const arrive = chain.at(-1)!.arrive + egressSeconds
  legs.push({ kind: 'egress', stop: exit, seconds: egressSeconds, depart: chain.at(-1)!.arrive, arrive })
  // Leave as late as the first ride allows rather than waiting at the stop.
  const firstRide = legs.find(l => l.kind === 'ride')
  const accessLeg = legs[0]
  if (firstRide && accessLeg.kind === 'access') {
    accessLeg.arrive = firstRide.depart - BOARD_SLACK
    accessLeg.depart = accessLeg.arrive - accessLeg.seconds
  }
  return { legs, depart: legs[0].depart, arrive, rides }
}
