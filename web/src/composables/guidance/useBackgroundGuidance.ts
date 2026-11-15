import { onScopeDispose, watch } from 'vue'
import { useRoute } from 'vue-router'
import { AppRoute } from '@/router'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useDirectionsService } from '@/services/directions.service'
import { useGuidanceRouteLine } from './useGuidanceRouteLine'
import { useGuidanceVehicle } from './useGuidanceVehicle'

/** Whether a route shows the trip being navigated, so its lines stay when navigation ends there. */
export function showsTrip(name: unknown): boolean {
  return name === AppRoute.TRIP || name === AppRoute.DIRECTIONS || name === AppRoute.ROUTE_PREVIEW
}

const ARRIVAL_END_MS = 8_000

/** Keeps navigation on the map while the rest of the app is in use, and ends it once nothing is left to navigate. */
export function useBackgroundGuidance() {
  const guidance = useGuidanceStore()
  const route = useRoute()
  const directionsService = useDirectionsService()

  useGuidanceRouteLine({
    route: () => guidance.route,
    focus: () => {
      const puck = guidance.progress?.puck
      if (!puck) return null
      return { s: puck.s, speed: puck.speed, travelled: puck.snapped ? puck.s : 0, next: null, hazards: false, overview: true }
    },
  })
  useGuidanceVehicle()

  let endTimer: ReturnType<typeof setTimeout> | null = null
  function end() {
    guidance.stop()
    if (!showsTrip(route.name)) directionsService.clearTrip()
  }
  watch(
    () => guidance.status === 'arrived' && guidance.nextLeg == null,
    arrived => {
      if (endTimer) clearTimeout(endTimer)
      endTimer = arrived ? setTimeout(end, ARRIVAL_END_MS) : null
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    if (endTimer) clearTimeout(endTimer)
  })
}
