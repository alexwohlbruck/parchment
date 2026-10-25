import { onScopeDispose, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { maneuverKind } from '@/lib/directions/maneuver'
import { bearingAt, pointAt } from '@/lib/guidance/nav-route'
import { lanePlan } from '@/lib/guidance/lanes'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { roadGlyphsNear } from '@/services/guidance/lane-guidance.service'

/** Read the lanes once the turn is this close, so its tiles are in. */
const LOOK_WITHIN_METERS = 800
const APPROACH_METERS = 20
const RETRY_MS = 2000

/** Works out the lanes for each upcoming turn of a drive from the arrows painted before it. */
export function useLaneGuidance() {
  const guidance = useGuidanceStore()
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const tried = new Map<number, number>()

  const stop = watch(
    () => guidance.progress,
    progress => {
      const route = guidance.route
      const next = progress?.next
      if (!map || !route || !next || progress.distanceToNext == null || progress.distanceToNext > LOOK_WITHIN_METERS) return
      if (guidance.lanePlans.has(next.index) || travelModeAt(route, next.startDistance) !== 'driving') return
      const last = tried.get(next.index)
      if (last && Date.now() - last < RETRY_MS) return
      tried.set(next.index, Date.now())
      const at = pointAt(route, next.startDistance)
      const bearing = bearingAt(route, Math.max(0, next.startDistance - APPROACH_METERS))
      const plan = lanePlan(roadGlyphsNear(map, at), at, bearing, maneuverKind(next.instruction))
      if (plan) guidance.setLanePlan(next.index, plan)
    },
  )

  onScopeDispose(stop)
}
