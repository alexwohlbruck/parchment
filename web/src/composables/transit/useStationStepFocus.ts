import { onScopeDispose } from 'vue'
import type { StationWalk } from '@server/types/station-guidance.types'
import { useMapService } from '@/services/map/map.service'
import { lineBounds, stepLevel, stepSegment } from '@/lib/transit/station/step-segment'

const FRAME_MS = 800
const FRAME_PADDING = 48

/** Turns the floor picker to the station step in focus, and frames a step on the map. Lets go when the caller's scope ends. */
export function useStationStepFocus() {
  const mapService = useMapService()
  let requested: string | null = null

  /** `key` names the step; focusing the same one again leaves a floor the rider picked alone. */
  function focus(key: string, walk: StationWalk, index: number) {
    requested = key
    mapService.requestIndoorLevel({ key, level: stepLevel(walk, index) })
  }

  function frame(key: string, walk: StationWalk, index: number) {
    focus(key, walk, index)
    const bounds = lineBounds(stepSegment(walk, index)?.coordinates ?? [])
    if (bounds) mapService.fitBounds(bounds, { duration: FRAME_MS, padding: FRAME_PADDING })
  }

  onScopeDispose(() => {
    if (requested) mapService.requestIndoorLevel(null)
  })

  return { focus, frame }
}
