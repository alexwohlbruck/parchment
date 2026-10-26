import { markRaw, onScopeDispose, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { deckLiftAt } from '@/services/guidance/deck-lift.service'
import { register as registerTick, type Tick } from '@/lib/map/animation-scheduler'
import { VEHICLE_LAYER_ID, VehicleLayer, type VehiclePose } from '@/lib/guidance/vehicle-layer'
import type { VehicleModel } from '@/lib/guidance/vehicle-indicator'

/** Draws the puck as the 3D vehicle chosen for the travel mode underway. */
export function useGuidanceVehicle() {
  const guidance = useGuidanceStore()
  const strategy = useMapStore().getMapStrategy()
  const map = strategy?.mapInstance as MaplibreMap | undefined
  if (!map || !strategy) return

  const ground = (lng: number, lat: number) => strategy.groundHeight(lng, lat) ?? 0
  const readPose = (out: VehiclePose) => {
    const puck = guidanceEngine.sample()
    if (!puck) return false
    out.lng = puck.position.lng
    out.lat = puck.position.lat
    out.bearing = puck.bearing
    out.elevation = ground(out.lng, out.lat) + deckLiftAt(puck.s)
    return true
  }
  const layer = markRaw(new VehicleLayer(readPose))
  let unregisterTick: (() => void) | null = null
  const last = { lng: NaN, lat: NaN, bearing: NaN }

  const tick: Tick = now => {
    if (!guidanceEngine.frameDue(now)) return 'active'
    const puck = guidanceEngine.sample()
    if (puck && (puck.position.lng !== last.lng || puck.position.lat !== last.lat || puck.bearing !== last.bearing)) {
      last.lng = puck.position.lng
      last.lat = puck.position.lat
      last.bearing = puck.bearing
      map.triggerRepaint()
    }
    return 'active'
  }

  const attach = () => {
    if (!map.getLayer(VEHICLE_LAYER_ID)) map.addLayer(layer)
  }

  function show(model: VehicleModel | null, color: string) {
    layer.setVehicle(model, color)
    if (model) {
      attach()
      unregisterTick ??= registerTick(tick)
    } else {
      unregisterTick?.()
      unregisterTick = null
      if (map!.getLayer(VEHICLE_LAYER_ID)) map!.removeLayer(VEHICLE_LAYER_ID)
    }
  }

  const stopWatch = watch(
    () => guidance.vehicle,
    ({ indicator, color }) => show(indicator === 'arrow' ? null : indicator, color),
    { immediate: true },
  )
  const onStyle = () => {
    if (guidance.vehicle.indicator !== 'arrow') attach()
  }
  map.on('style.load', onStyle)

  onScopeDispose(() => {
    stopWatch()
    map.off('style.load', onStyle)
    show(null, guidance.vehicle.color)
  })
}
