import { boundsWidthKm } from './tiles'
import type { OfflinePackageKind } from '@/types/offline-package.types'
import type { Bounds } from '@/types/offline.types'

/** A package's URL on the app server, the same for every download of the region. */
export function packageUrl(serverUrl: string, kind: OfflinePackageKind, bounds: Bounds): string {
  return `${serverUrl}/offline/${kind}?bbox=${bounds.map(v => v.toFixed(5)).join(',')}`
}

/** Bytes per square kilometre, measured on a 10 km square of Manhattan. */
const BYTES_PER_KM2: Record<OfflinePackageKind, number> = {
  places: 71_000,
  timetable: 216_000,
  streets: 42_000,
}

export function estimatePackageBytes(kinds: readonly OfflinePackageKind[], bounds: Bounds): number {
  const height = (bounds[3] - bounds[1]) * 111.32
  const area = boundsWidthKm(bounds) * height
  return kinds.reduce((sum, kind) => sum + BYTES_PER_KM2[kind] * area, 0)
}

/** A timetable older than this is fetched again when online, so it never runs out. */
export const TIMETABLE_REFRESH_MS = 5 * 86_400_000
