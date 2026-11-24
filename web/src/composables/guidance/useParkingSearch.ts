import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useAbortController } from '@/composables/useAbortController'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { PARKING, parkingOptions, type ParkingDestination, type ParkingOption } from '@/lib/guidance/parking'
import { fetchParkingNear } from '@/services/guidance/parking.service'
import { AheadResultsLayer } from '@/services/guidance/ahead-results-layer'

/** Finds parking near the destination, marks it on the map, and parks at the one picked. */
export function useParkingSearch() {
  const guidance = useGuidanceStore()
  const { nextSignal } = useAbortController()
  const options = shallowRef<ParkingOption[]>([])
  const loading = ref(false)
  const failed = ref(false)
  const parking = ref<string | null>(null)
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const layer = map ? new AheadResultsLayer(map) : null

  async function search({ location, vehicle }: ParkingDestination) {
    const { presetId, searchMeters } = PARKING[vehicle]
    loading.value = true
    failed.value = false
    try {
      options.value = parkingOptions(await fetchParkingNear(presetId, location, searchMeters, nextSignal()), location, vehicle)
    } catch (error) {
      if ((error as Error)?.name === 'CanceledError') return
      failed.value = true
      options.value = []
    } finally {
      loading.value = false
    }
  }

  async function park(option: ParkingOption, label: string): Promise<boolean> {
    parking.value = option.id
    try {
      return await guidance.parkAt({ label, location: option.location })
    } catch {
      return false
    } finally {
      parking.value = null
    }
  }

  const stop = watch(options, list => layer?.setPlaces(list.map(o => o.location)))
  onScopeDispose(() => {
    stop()
    layer?.destroy()
  })

  return { options, loading, failed, parking, search, park }
}
