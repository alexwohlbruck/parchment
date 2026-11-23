import type { OfflinePackageKind } from './offline-package.types'

/** [west, south, east, north] in degrees. */
export type Bounds = [number, number, number, number]

export type OfflineSourceKind = 'vector' | 'raster' | 'raster-dem'

/** One tile pyramid to save, resolved from the map when the region is made. */
export interface OfflineSource {
  kind: OfflineSourceKind
  tiles: string[]
  minzoom: number
  maxzoom: number
  bounds?: Bounds
  /** Manifests saved alongside, only when the source reaches the region. */
  files?: string[]
}

/** Something the user can choose to save: the map itself, or a layer. */
export interface OfflineLayerOption {
  id: string
  name: string
  icon?: string | null
  sources: OfflineSource[]
  /** Single files the layer needs besides its tiles: glyphs, sprites, manifests. */
  files: string[]
  /** Saved whether or not it is picked. */
  required?: boolean
}

/** Data saved beside the tiles so search and directions work offline. */
export interface OfflinePackageRef {
  kind: OfflinePackageKind
  url: string
}

export type OfflineRegionStatus = 'downloading' | 'paused' | 'ready' | 'failed'

export interface OfflineRegion {
  id: string
  name: string
  bounds: Bounds
  layers: { id: string; name: string }[]
  sources: OfflineSource[]
  files: string[]
  /** Absent on regions saved before packages existed. */
  packages?: OfflinePackageRef[]
  /** Last service day the saved timetable covers, `YYYY-MM-DD`. */
  timetableUntil?: string
  timetableSavedAt?: string
  /** Deleted after this local day, `YYYY-MM-DD`; absent keeps it until the user deletes it. */
  keepUntil?: string
  status: OfflineRegionStatus
  total: number
  saved: number
  failed: number
  bytes: number
  createdAt: string
  updatedAt: string
}
