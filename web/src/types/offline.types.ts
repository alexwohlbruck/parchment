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

export type OfflineRegionStatus = 'downloading' | 'paused' | 'ready' | 'failed'

export interface OfflineRegion {
  id: string
  name: string
  bounds: Bounds
  layers: { id: string; name: string }[]
  sources: OfflineSource[]
  files: string[]
  status: OfflineRegionStatus
  total: number
  saved: number
  failed: number
  bytes: number
  createdAt: string
  updatedAt: string
}
