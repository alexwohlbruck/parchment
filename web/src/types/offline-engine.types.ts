import type { OfflinePackageKind } from './offline-package.types'
import type { OfflineTripRequest } from '@/lib/offline/offline-trips'

/** A saved region as the offline engine loads it. */
export interface EngineRegion {
  id: string
  /** Changes whenever the region's packages are saved again, so the engine reloads them. */
  savedAt: string
  urls: Partial<Record<OfflinePackageKind, string>>
}

export interface StopQuery {
  feedId?: string
  stopId?: string
  lat?: number
  lng?: number
}

export type EngineRequest =
  | { type: 'sync'; regions: EngineRegion[] }
  | { type: 'search'; query: string; near?: { lat: number; lng: number }; limit?: number }
  | { type: 'place'; id: string }
  | { type: 'departures'; stop: StopQuery; after: number }
  | { type: 'plan'; request: OfflineTripRequest }

export type EngineResponse = { id: number; result: unknown } | { id: number; error: string }
