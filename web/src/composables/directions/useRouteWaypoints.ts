import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme.store'
import { waypointToDisplay, type PlaceDisplay } from '@/services/place/place-display'
import type { TripsResponse } from '@/types/directions.types'
import type { Place } from '@/types/place.types'

type RequestWaypoint = NonNullable<TripsResponse['request']>['waypoints'][number]

export interface RouteWaypointDisplay {
  id: string
  role: 'origin' | 'via' | 'destination'
  displayName: string
  time: Date | string | null
  place?: Partial<Place> | null
  /** What the timeline renders the stop from. */
  display: PlaceDisplay
  /**
   * Whether `display.icon` is the stop's own — a POI's glyph, the locate mark
   * for current location — rather than a bare point on the map.
   */
  ownIcon: boolean
}

/** The requested stops of a trip, ready for its timeline. */
export function useRouteWaypoints(
  source: MaybeRefOrGetter<{ waypoints?: RequestWaypoint[]; startTime?: Date | string; endTime?: Date | string }>,
) {
  const themeStore = useThemeStore()
  const { t } = useI18n()

  return computed<RouteWaypointDisplay[]>(() => {
    const { waypoints, startTime, endTime } = toValue(source)
    if (!waypoints?.length) return []
    let viaCounter = 0
    return waypoints.map((wp, i) => {
      const role = i === 0 ? 'origin' : i === waypoints.length - 1 ? 'destination' : 'via'
      const fallbackName = role === 'origin' ? 'Origin' : role === 'destination' ? 'Destination' : `Stop ${++viaCounter}`
      const place = wp.place ?? null
      return {
        id: wp.id || `wp-${i}`,
        role,
        displayName: wp.name?.trim() || fallbackName,
        time: role === 'origin' ? startTime ?? null : role === 'destination' ? endTime ?? null : null,
        place,
        ...waypointToDisplay(place, { isDark: themeStore.isDark, t, fallbackTitle: wp.name?.trim() || fallbackName }),
      }
    })
  })
}
