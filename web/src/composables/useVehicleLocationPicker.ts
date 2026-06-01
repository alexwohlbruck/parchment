/**
 * Vehicle Location Picker
 *
 * Composable that manages the "pick on map" flow for setting vehicle locations.
 * When activated:
 *   1. Stores the target vehicle ID in the vehicles store
 *   2. Collapses the panel (LeftSheet / BottomSheet) to reveal the map,
 *      or navigates away for dialog routes (e.g. settings)
 *   3. Overrides mapEventBus.click to capture the next click
 *   4. On click → saves the location via API → restores panel → cleans up
 *   5. Can be cancelled via cancel()
 *
 * The UI layer (MapPickLocationBanner) watches `vehiclesStore.pickingVehicle`
 * to show/hide the banner overlay.
 */

import { watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { mapEventBus } from '@/lib/eventBus'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useAppStore } from '@/stores/app.store'
import { AppRoute } from '@/router'
import type { MapEvents } from '@/types/map.types'

type ClickHandler = (data: MapEvents['click']) => void

let activeHandler: ClickHandler | null = null
/** Whether we collapsed the panel instead of navigating away. */
let panelWasHidden = false
/** Where to navigate after pick/cancel for dialog routes. */
let savedReturnTo: string | null = null

export function useVehicleLocationPicker() {
  const vehiclesStore = useVehiclesStore()
  const router = useRouter()
  const appStore = useAppStore()

  /**
   * Start the pick-on-map flow for a vehicle.
   *
   * For panel views (Lookout, TrackerDetail, etc.) the panel is collapsed
   * in place — the route stays the same so the view is preserved. After
   * picking, the panel expands back to where it was.
   *
   * For dialog routes (settings) the dialog is dismissed via navigation
   * and the `returnTo` path is used after the pick completes.
   *
   * @param returnTo — route to navigate to after picking (only used for
   *   dialog routes). Pass `null` to stay on the map.
   */
  function startPicking(vehicleId: string, returnTo: string | null = null) {
    // Clean up any existing pick session
    cancel()

    vehiclesStore.pickingLocationForVehicleId = vehicleId
    savedReturnTo = returnTo

    // Determine if we're in a panel view (LeftSheet / BottomSheet) that
    // can be collapsed, or a dialog route that needs full navigation.
    const route = router.currentRoute.value
    const isSheetView =
      route.matched.length > 1 &&
      route.name !== AppRoute.MAP &&
      !route.meta.dialog

    if (isSheetView) {
      // Collapse the panel to reveal the map. The route stays the same
      // so the panel content is preserved for when we expand it back.
      appStore.leftSheetHidden = true
      panelWasHidden = true
    } else {
      // Dialog routes (e.g. settings): navigate away to reveal the map
      router.push('/')
    }

    // Set up the click override
    activeHandler = async (data) => {
      const { lngLat } = data
      await vehiclesStore.updateVehicleLocation(
        vehicleId,
        { lat: lngLat.lat, lng: lngLat.lng },
        'manual',
      )
      returnToOrigin()
    }

    mapEventBus.setOverride('click', activeHandler)
  }

  /**
   * Cancel the pick-on-map flow without saving.
   * Restores the panel or navigates back to the originating route.
   */
  function cancel() {
    returnToOrigin()
  }

  /**
   * Tear down the pick session and return to where the user came from.
   * For panel views: the panel expands back (no navigation).
   * For dialog routes: navigates to the saved returnTo path.
   */
  function returnToOrigin() {
    const wasPanel = panelWasHidden
    const returnPath = savedReturnTo
    cleanup()
    // Only navigate for dialog routes — panel views restore in place
    if (!wasPanel && returnPath) {
      router.push(returnPath)
    }
  }

  function cleanup() {
    if (activeHandler) {
      mapEventBus.removeOverride('click', activeHandler)
      activeHandler = null
    }
    if (panelWasHidden) {
      appStore.leftSheetHidden = false
      panelWasHidden = false
    }
    savedReturnTo = null
    vehiclesStore.pickingLocationForVehicleId = null
  }

  // Auto-cleanup when the composable's component unmounts
  onUnmounted(() => {
    // Only cancel if this component instance started the pick
    // Don't cancel if we're unmounting because the settings dialog closed
    // (the pick flow should survive that)
  })

  return {
    startPicking,
    cancel,
  }
}
