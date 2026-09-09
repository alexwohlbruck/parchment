/**
 * Trip Isolation Service
 *
 * Steps the transit network back while an itinerary is on the map, so the
 * trip's own polyline reads as the subject instead of competing with
 * every line it crosses.
 *
 * That is all it does. The route panel lifts its line out of portolan's
 * ribbons; a trip must not, because portolan draws bundled routes at
 * parallel slot offsets — an isolated A would land beside the trip line
 * rather than under it, the same line drawn twice in two styles. The trip
 * line is already the highlight; the dim is the other half of it.
 *
 * Stands down entirely when the route panel is the focus: that view owns
 * the dim, and two owners would fight over the paint they restore.
 *
 * Portolan dims its own ribbons rather than being painted over: they mount
 * progressively as tiles hydrate, and a one-shot override catches only the
 * layers that exist the instant it runs. The flat override is left to the
 * retired transitland layers, which are static when they are there at all.
 */

import { watch, type WatchStopHandle } from 'vue'
import { useTransitFocusStore } from '@/stores/transit-focus.store'
import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'
import {
  fadeTransitNetwork,
  networkDimOpacity,
} from '@/services/layers/features/transit-network-dim'

export function useTripIsolationService() {
  const focus = useTransitFocusStore()
  const portolan = usePortolanTransitService()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mapInstance: any = null
  let watchStop: WatchStopHandle | null = null
  let dimmed = false

  function apply(active: boolean) {
    if (!mapInstance || active === dimmed) return
    dimmed = active
    portolan.setNetworkDim(active)
    fadeTransitNetwork(mapInstance, active ? networkDimOpacity() : null, {
      skipPortolan: true,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function initialize(map: any) {
    mapInstance = map
    watchStop = watch(
      () => focus.source === 'trip',
      apply,
      { immediate: true },
    )
  }

  function destroy() {
    apply(false)
    watchStop?.()
    watchStop = null
    mapInstance = null
  }

  return { initialize, destroy }
}
