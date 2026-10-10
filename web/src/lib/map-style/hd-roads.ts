import { MapEngine } from '@/types/map.types'

/** A stored `null` means the user never chose, so the engine's default applies. */
export function resolveHdRoads(
  stored: boolean | null | undefined,
  engine: MapEngine,
): boolean {
  return stored ?? engine === MapEngine.MAPLIBRE
}
