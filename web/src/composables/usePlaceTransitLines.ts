import { computed, reactive, type Ref } from 'vue'
import type { TransitStopInfo } from '@/types/place.types'

type StationLines = NonNullable<TransitStopInfo['routes']>

/**
 * Bridge between the transit departures widget and the place header.
 *
 * The line bullets for a station (N Q R W S 1 2 3 7…) belong next to the
 * place title, Apple-Maps style — but the data arrives with the transit
 * widget's async fetch, deep in the widget tree. The widget publishes the
 * lines here per place id; the header subscribes.
 */
const linesByPlace = reactive<Record<string, StationLines>>({})

export function setPlaceTransitLines(placeId: string | undefined, routes: StationLines | undefined) {
  if (!placeId || !routes?.length) return
  linesByPlace[placeId] = routes
}

export function usePlaceTransitLines(placeId: Ref<string | undefined>) {
  return computed<StationLines>(() => (placeId.value && linesByPlace[placeId.value]) || [])
}
