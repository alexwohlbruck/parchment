import { offersArrivalPointsIn } from '@server/lib/place/arrival-points'
import type { AutocompleteResult } from '@/types/search.types'
import type { Waypoint } from '@/types/map.types'

/**
 * Rows a place's arrival points take before the rest fold behind "N more":
 * enough for every terminal at most airports, few enough that the search
 * results after the place stay in view.
 */
export const SHOWN_BEFORE_MORE = 6

export interface ArrivalTarget {
  id?: string
  lat: number
  lng: number
}

/**
 * What to ask about a stop: its place id when it has an OSM one, and always its
 * point, which the server falls back on for a dropped pin or a geocoded address.
 */
export function arrivalTarget(waypoint: Waypoint | null | undefined): ArrivalTarget | null {
  if (!waypoint?.lngLat || waypoint.place?.id === 'current-location') return null
  const id = waypoint.place?.id
  return {
    ...(id?.startsWith('osm/') && { id }),
    lat: Number(waypoint.lngLat.lat.toFixed(5)),
    lng: Number(waypoint.lngLat.lng.toFixed(5)),
  }
}

/** Whether a search result holds precise destinations worth listing under it in this mode. */
export function offersArrivalPoints(result: AutocompleteResult, mode: string): boolean {
  return offersArrivalPointsIn(result.arrivalPresetId, mode)
}

/** The arrival points to list under their place, and how many are folded away. */
export function visibleArrivalPoints<T>(points: T[], expanded: boolean): { shown: T[]; hidden: number } {
  // Folding a single row away saves nothing: the "more" row would take its place.
  if (expanded || points.length <= SHOWN_BEFORE_MORE + 1) return { shown: points, hidden: 0 }
  return {
    shown: points.slice(0, SHOWN_BEFORE_MORE),
    hidden: points.length - SHOWN_BEFORE_MORE,
  }
}
