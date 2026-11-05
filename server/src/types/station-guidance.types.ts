/**
 * Station guidance barrelman attaches to transit legs: how each transfer is
 * made, which entrance and exit to use, where to stand on the train, and the
 * walk inside the station step by step. Mirrors barrelman's contract.
 */

export type TransferClass = 'same_platform' | 'in_station' | 'in_system_passage' | 'out_of_system'

/** Best first: walked on the station graph, bridged across a gap, the agency's time, an estimate, a straight line. */
export type StationPathSource = 'graph' | 'bridged' | 'agency' | 'estimated' | 'straight_line'

export type GuidanceStepType =
  | 'walk' | 'platform' | 'stairs' | 'escalator' | 'elevator' | 'bridge' | 'fare_gate' | 'enter' | 'exit' | 'board'

export interface GuidanceStep {
  type: GuidanceStepType
  instruction: string
  /** Metres walked in the step. */
  distance: number
  /** Expected seconds. */
  duration: number
  fromLevel: number | null
  toLevel: number | null
  /** Levels climbed (positive) or descended (negative); null when the map doesn't say. */
  levelChange: number | null
  /** Signs or places to look for: a line, a direction, an exit's name. */
  landmark: string | null
  /** Across a short gap the map does not connect; no turn-by-turn there. */
  bridged: boolean
  /** Vertex range in the walk's geometry. */
  fromVertex: number
  toVertex: number
}

export interface StationEndpoint {
  id: string
  kind: 'platform' | 'entrance'
  name: string | null
  lat: number
  lng: number
  level: number | null
}

/** A walk inside a station. An estimate is a time between its ends only: never drawn or narrated. */
export interface StationWalk {
  source: StationPathSource
  estimate: boolean
  seconds: number
  uncertaintyS: number
  metres: number
  levels: number
  from: StationEndpoint
  to: StationEndpoint
  geometry?: { type: 'LineString'; coordinates: [number, number][] }
  /** Level of each geometry vertex. */
  vertexLevels?: (number | null)[]
  steps?: GuidanceStep[]
}

/** The entrance a first ride is boarded through, or the exit a last ride is left by. */
export interface StationAccessChoice {
  id: string
  name: string | null
  ref: string | null
  /** "Broadway & West 28th Street · NW corner". */
  cornerLabel: string | null
  lat: number
  lng: number
  /** Street walk between the entrance and the trip's origin or destination. */
  streetSeconds: number
  /** Entrance to platform, or platform to exit. */
  stationSeconds: number
  totalSeconds: number
  walk: StationWalk
}

/** How a rider gets from the previous ride to this one. */
export interface TransitTransfer {
  class: TransferClass
  /** Goes up to street level; null when only an estimate is known. */
  surfaces: boolean | null
  /** For `out_of_system`: whether re-entering is free; null when unknown or not applicable. */
  reentryFree: boolean | null
  /** Seconds for tapping out and back in, included in `seconds`. */
  fareGateDelayS: number
  /** The walk plus any fare gates; null when nothing times it. */
  seconds: number | null
  source: StationPathSource | null
  walk: StationWalk | null
}

/** Where to stand so the train stops next to the exit or transfer. */
export interface BoardingPosition {
  section: 'front' | 'middle' | 'back'
  /** 0 at the back of the train, 1 at the front. */
  fraction: number
  /** Seconds saved on the alighting platform against standing at the worst end. */
  savesSeconds: number
  toward: 'exit' | 'transfer'
  /** The exit's name or the line transferred to. */
  landmark: string | null
}

/** The guidance fields a transit leg may carry. */
export interface StationGuidance {
  entrance?: StationAccessChoice
  exit?: StationAccessChoice
  transfer?: TransitTransfer
  boardingPosition?: BoardingPosition
}
