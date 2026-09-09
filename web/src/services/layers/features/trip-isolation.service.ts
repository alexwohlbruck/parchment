/**
 * Trip Isolation Service
 *
 * Decides what the transit network does while an itinerary is on the map,
 * hovered in the list or opened.
 *
 * A trip that rides transit steps the network back, so the trip's own
 * polyline reads as the subject instead of competing with every line it
 * crosses. A trip that rides none takes it off the map altogether: there
 * the ribbons are not context for a walking or driving line, just clutter
 * beside it.
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
import {
  useTransitFocusStore,
  type TransitNetworkMode,
} from '@/stores/transit-focus.store'
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
  let mode: TransitNetworkMode = 'normal'

  function apply(next: TransitNetworkMode) {
    if (!mapInstance || next === mode) return
    mode = next
    portolan.setNetworkDim(next === 'dimmed')
    portolan.setNetworkHidden(next === 'hidden')
    // The retired transitland layers have no renderer of their own to ask,
    // so they take the flat override — zero opacity is how they hide.
    const opacity =
      next === 'dimmed' ? networkDimOpacity() : next === 'hidden' ? 0 : null
    fadeTransitNetwork(mapInstance, opacity, { skipPortolan: true })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function initialize(map: any) {
    mapInstance = map
    watchStop = watch(() => focus.networkMode, apply, { immediate: true })
  }

  function destroy() {
    apply('normal')
    watchStop?.()
    watchStop = null
    mapInstance = null
  }

  return { initialize, destroy }
}
