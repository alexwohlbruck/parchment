import { stationWalksAt, type GuidedSegment, type PlacedWalk } from './station-walks'

export interface SignedSegment extends GuidedSegment {
  lineName?: string
  headsign?: string
  directionLabel?: string
}

/** What the station's own signs point to, for a walk we can't route step by step. */
export type StationSign =
  | { kind: 'platform'; line: string; toward?: string }
  /** The exit itself is already named on the walk's row. */
  | { kind: 'exit' }

export function stationSign(segments: SignedSegment[], placed: PlacedWalk): StationSign | null {
  const ride = segments[placed.ride]
  if (!ride) return null
  if (placed.kind === 'egress') return { kind: 'exit' }
  if (placed.kind === 'transfer' && ride.transfer?.class === 'same_platform') return null
  if (!ride.lineName) return null
  return { kind: 'platform', line: ride.lineName, toward: ride.directionLabel || ride.headsign || undefined }
}

/** The signs to follow at the end of the street walk at `index`, into the station it boards at. */
export function boardingSign(segments: SignedSegment[], index: number): StationSign | null {
  const access = stationWalksAt(segments, index).find(w => w.kind === 'access')
  return access ? stationSign(segments, access) : null
}

type TFn = (key: string, named?: Record<string, unknown>) => string

export function stationSignText(sign: StationSign, t: TFn): string {
  if (sign.kind === 'exit') return t('directions.station.signs.exit')
  return sign.toward
    ? t('directions.station.signs.platform', { line: sign.line, toward: sign.toward })
    : t('directions.station.signs.line', { line: sign.line })
}
