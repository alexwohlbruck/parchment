import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { StationAccessChoice, StationWalk, TransitTransfer } from '@server/types/station-guidance.types'

export interface GuidedSegment {
  mode: string
  /** Named ('subway') or a GTFS route_type number. */
  routeType?: string | number
  transfer?: TransitTransfer | null
  entrance?: StationAccessChoice | null
  exit?: StationAccessChoice | null
}

export type StationWalkKind = 'access' | 'transfer' | 'egress'

export interface PlacedWalk {
  kind: StationWalkKind
  walk: StationWalk
  /** The ride the walk boards or leaves. */
  ride: number
}

export interface StationWalkProps {
  kind: StationWalkKind
  /** Absent where the map gives no level. */
  level?: number
}

const isRide = (segment?: GuidedSegment) => segment?.mode === 'transit'

/** Rides boarded inside a station; a change to or from a bus or tram has no station to walk through. */
const STATION_ROUTE_TYPES = new Set<string | number>(['subway', 'rail', 'monorail', 'funicular', 1, 2, 7, 12])
const inStation = (segment?: GuidedSegment) => isRide(segment) && (segment!.routeType == null || STATION_ROUTE_TYPES.has(segment!.routeType))

/** An estimate is a time between two ends only; nothing to draw or narrate. */
export const isWalked = (walk: StationWalk | null | undefined): walk is StationWalk =>
  !!walk && !walk.estimate && (walk.geometry?.coordinates.length ?? 0) >= 2

/** How the rider changes onto the ride at `index`, or onto the ride after the walk at `index`. */
export function transferAt(segments: GuidedSegment[], index: number): TransitTransfer | null {
  const [from, to] = isRide(segments[index]) ? [segments[index - 1], segments[index]] : [segments[index - 1], segments[index + 1]]
  return inStation(from) && inStation(to) ? to!.transfer ?? null : null
}

/** Every walk inside a station along the trip, in order. */
export function stationWalks(segments: GuidedSegment[]): PlacedWalk[] {
  return segments.flatMap((segment, ride) => {
    if (!isRide(segment)) return []
    const walks: PlacedWalk[] = []
    if (segment.entrance) walks.push({ kind: 'access', walk: segment.entrance.walk, ride })
    if (segment.transfer?.walk) walks.push({ kind: 'transfer', walk: segment.transfer.walk, ride })
    if (segment.exit) walks.push({ kind: 'egress', walk: segment.exit.walk, ride })
    return walks
  })
}

/** The station walks that belong with the segment at `index`: the exit before a street walk, the entrance after it, or the change between rides. */
export function stationWalksAt(segments: GuidedSegment[], index: number): PlacedWalk[] {
  const segment = segments[index]
  const previous = isRide(segments[index - 1])
  const next = isRide(segments[index + 1])
  return stationWalks(segments).filter(({ kind, ride }) => {
    if (isRide(segment)) return kind === 'transfer' && ride === index && previous
    if (kind === 'transfer') return ride === index + 1 && previous
    if (previous && next) return false
    return (kind === 'egress' && ride === index - 1) || (kind === 'access' && ride === index + 1)
  })
}

/** Walking segments between two rides whose line the station walk draws instead. */
export function replacedTransferWalks(segments: GuidedSegment[]): Set<number> {
  const replaced = new Set<number>()
  segments.forEach((segment, i) => {
    if (segment.mode === 'walking' && isRide(segments[i - 1]) && isWalked(transferAt(segments, i)?.walk)) replaced.add(i)
  })
  return replaced
}

/** Each drawable walk, split where it changes level so a floor picker can fade the others. */
export function stationWalkFeatures(segments: GuidedSegment[]): FeatureCollection<LineString, StationWalkProps> {
  const features: Feature<LineString, StationWalkProps>[] = []
  for (const { kind, walk } of stationWalks(segments)) {
    if (!isWalked(walk)) continue
    for (const run of levelRuns(walk)) {
      const properties = run.level == null ? { kind } : { kind, level: run.level }
      features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: run.coordinates } })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Stretches of a walk on one level; neighbouring stretches share their joining vertex. */
export function levelRuns(walk: StationWalk): { level: number | null; coordinates: [number, number][] }[] {
  const coordinates = walk.geometry?.coordinates ?? []
  const levels = walk.vertexLevels ?? []
  const runs: { level: number | null; coordinates: [number, number][] }[] = []
  coordinates.forEach((point, i) => {
    const level = levels[i] ?? null
    const run = runs.at(-1)
    if (run && run.level === level) return void run.coordinates.push(point)
    run?.coordinates.push(point)
    runs.push({ level, coordinates: [point] })
  })
  return runs.filter(run => run.coordinates.length >= 2)
}
