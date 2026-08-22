import { computed, reactive, type Ref } from 'vue'
import type { TransitStopInfo } from '@/types/place.types'
import { orderBullets } from '@/lib/transit-bullets'

type StationLines = NonNullable<TransitStopInfo['routes']>

/**
 * Bridge between the transit departures widget and the place header.
 *
 * The line bullets for a station (N Q R W S 1 2 3 7…) belong next to the
 * place title, Apple-Maps style — but the data arrives with the transit
 * widget's async fetch, deep in the widget tree. The widget publishes the
 * lines here per place id; the header subscribes.
 *
 * They come out in portolan's bullet order, because the map is usually
 * open beside the panel and the two must agree: Columbus Circle listed
 * 1 2 A B C D here while the map drew A C · B D · 1 2, which is the order
 * the MTA and Apple both use. Sorting on the way OUT rather than the way
 * in means every subscriber gets it, whatever published the lines.
 */
const linesByPlace = reactive<Record<string, StationLines>>({})

export function setPlaceTransitLines(placeId: string | undefined, routes: StationLines | undefined) {
  if (!placeId || !routes?.length) return
  linesByPlace[placeId] = routes
}

export function usePlaceTransitLines(placeId: Ref<string | undefined>) {
  return computed<StationLines>(() => {
    const lines = (placeId.value && linesByPlace[placeId.value]) || []
    return orderBullets(lines, r => ({
      // the label portolan sorts by is the bullet's own glyphs — short
      // name, long name if there is none. Not parchment's translated
      // mode fallback ("Tram"), which would sort by the UI language.
      label: r.shortName || r.longName || '',
      color: r.color,
      id: r.id,
    }))
  })
}
