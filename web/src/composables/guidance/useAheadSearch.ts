import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useAbortController } from '@/composables/useAbortController'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { routeAhead } from '@/lib/guidance/nav-route'
import { searchAhead, type AheadResult } from '@/services/guidance/route-search.service'
import { AheadResultsLayer } from '@/services/guidance/ahead-results-layer'

/** Searches the route still ahead and marks what it finds on the map. */
export function useAheadSearch() {
  const guidance = useGuidanceStore()
  const { nextSignal } = useAbortController()
  const results = shallowRef<AheadResult[]>([])
  const loading = ref(false)
  const failed = ref(false)
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const layer = map ? new AheadResultsLayer(map) : null

  async function search(params: { query?: string; categories?: string[] }) {
    const route = guidance.followed
    const s = guidance.progress?.puck.s ?? 0
    if (!route) return
    loading.value = true
    failed.value = false
    try {
      results.value = await searchAhead({
        route: routeAhead(route, s),
        mode: guidance.travelMode,
        ...params,
        signal: nextSignal(),
      })
    } catch (error) {
      if ((error as Error)?.name === 'CanceledError') return
      failed.value = true
      results.value = []
    } finally {
      loading.value = false
    }
  }

  const stop = watch(results, list => layer?.setPlaces(list.map(r => r.place.geometry.value.center)))

  onScopeDispose(() => {
    stop()
    layer?.destroy()
  })

  return { results, loading, failed, search }
}
